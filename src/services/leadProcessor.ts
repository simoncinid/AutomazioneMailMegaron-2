import type { AppEnv } from "../config/loadEnv.js";
import { resolveSheetForZone } from "../config/resolveSheetForZone.js";
import type {
  GestimListingRow,
  LeadRowPayload,
  MultiIdRowPayload,
  NoIdRowPayload,
  ParsedInboundEmail,
} from "../domain/types.js";
import { logger, printOpenAiExtractionBlock } from "../logging/logger.js";
import type { ListingRepository } from "../repositories/listingRepository.js";
import { GoogleSheetsWriter } from "../sheets/googleSheetsWriter.js";
import type { LeadAssignmentCooldown } from "./leadAssignmentCooldown.js";
import { extractFirstBodyEmail, extractFirstPhone } from "./contactExtractor.js";
import {
  buildCombinedBodyForModel,
  extractLeadDataWithAi,
  type AiLeadExtraction,
} from "./leadAiExtractor.js";
import { extractExternalListingIds } from "./idExtractor.js";

const log = logger.child({ module: "leadProcessor" });

/** Stessa soglia del test Python `_body_preview_for_sheet` per la colonna "corpo". */
const MAX_BODY_PREVIEW_CHARS = 15_000;

export interface LeadProcessorDeps {
  env: AppEnv;
  listings: ListingRepository;
  sheets: GoogleSheetsWriter;
  assignmentCooldown?: LeadAssignmentCooldown;
  extraIdPatterns?: string[];
  listingCache?: Map<string, GestimListingRow | null>;
  /** Se true le righe vengono accodate e flushate dal chiamante (worker batch). */
  deferSheetFlush?: boolean;
}

export interface ProcessMessageContext {
  index: number;
  total: number;
}

function combinedBody(email: ParsedInboundEmail): string {
  return [email.textBody, email.htmlBody ?? ""].join("\n");
}

function parseBlockedSubstrings(env: AppEnv): string[] {
  return env.BLOCKED_EMAIL_SUBSTRINGS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildPartsRecord(parts: Intl.DateTimeFormatPart[]): Record<string, string> {
  return parts.reduce<Record<string, string>>((acc, p) => {
    if (p.type !== "literal") acc[p.type] = p.value;
    return acc;
  }, {});
}

/** "%d/%m/%Y %H:%M:%S" in fuso Europe/Rome (allineato a `assignment_date` del test Python). */
function formatAssignmentDate(value: Date): string {
  const dateP = buildPartsRecord(
    new Intl.DateTimeFormat("it-IT", {
      timeZone: "Europe/Rome",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(value),
  );
  const timeP = buildPartsRecord(
    new Intl.DateTimeFormat("it-IT", {
      timeZone: "Europe/Rome",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(value),
  );
  return `${dateP.day}/${dateP.month}/${dateP.year} ${timeP.hour}:${timeP.minute}:${timeP.second}`;
}

/** "%d/%m/%Y" + "%H:%M:%S" separati (per le tab diagnostiche, fuso Europe/Rome). */
function splitDataOraRome(value: Date): { data: string; ora: string } {
  const dateP = buildPartsRecord(
    new Intl.DateTimeFormat("it-IT", {
      timeZone: "Europe/Rome",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(value),
  );
  const timeP = buildPartsRecord(
    new Intl.DateTimeFormat("it-IT", {
      timeZone: "Europe/Rome",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(value),
  );
  return {
    data: `${dateP.day}/${dateP.month}/${dateP.year}`,
    ora: `${timeP.hour}:${timeP.minute}:${timeP.second}`,
  };
}

/**
 * Stesso testo passato ad OpenAI (text + HTML pulito + CSS rimosso): scriviamo
 * sui fogli diagnostici esattamente quello che il modello legge.
 */
function bodyPreviewForSheet(email: ParsedInboundEmail): string {
  const body = buildCombinedBodyForModel(email.textBody ?? "", email.htmlBody ?? "");
  if (body.length > MAX_BODY_PREVIEW_CHARS) {
    return `${body.slice(0, MAX_BODY_PREVIEW_CHARS)}\n...[TRONCATO]`;
  }
  return body;
}

/** Estrae un'etichetta UID amichevole per i log STDOUT (`imap-uid-12345` -> `12345`). */
function uidFromEmail(email: ParsedInboundEmail): string {
  if (!email.messageId) return "";
  const match = /^imap-uid-(.+)$/.exec(email.messageId);
  return match ? match[1]! : email.messageId;
}

/**
 * Pipeline allineata a `test_imap_aruba.py` (con cooldown globale):
 *  1. Estrae i 5 campi via OpenAI (con fallback regex per ID, email lead, telefono).
 *  2. Stampa su STDOUT i 4 campi (nome/cognome/email/id_annuncio) per la mail in corso.
 *  3. Cooldown 6 mesi sull'email lead (cache globale: tutti i tab lead + diagnostici).
 *     Se l'email è già stata vista negli ultimi 6 mesi (anche da una riga inserita
 *     poco prima nello stesso ciclo), la mail viene saltata interamente — niente
 *     duplicati neanche tra `no-id-trovato` / `no-singolo-id` / tab lead.
 *  4. Routing per numero ID:
 *     - 0 ID  -> tab `no-id-trovato`  (A:H = data, ora, mittente, corpo, nome, cognome, email, tel)
 *     - >1 ID -> tab `no-singolo-id`  (A:I = + lista ID)
 *     - 1 ID  -> lookup zona in gestim_listings:
 *           * nessuna zona/annuncio -> `no-id-trovato` con prefisso "[ID …: nessuna zona/annuncio]"
 *           * zona in DB -> mapping `MAPPING_ZONE_MATCH` (default `contains`); fallback DEFAULT_SHEET_TITLE
 *     Riga lead A:G = email, ID, data assegnazione, telefono, zona, nome, cognome.
 *  5. Dopo OGNI riga inserita (lead/no-id/multi-id) la cache cooldown viene
 *     aggiornata in memoria, in modo che la prossima mail con la stessa email
 *     dello stesso ciclo venga skippata.
 */
export async function processInboundEmail(
  email: ParsedInboundEmail,
  deps: LeadProcessorDeps,
  processedAt: Date = new Date(),
  ctx?: ProcessMessageContext,
): Promise<void> {
  const uidLabel = uidFromEmail(email) || email.messageId || "?";
  let aiResult: AiLeadExtraction = {
    nome: "",
    numeroTelefono: "",
    cognome: "",
    idAnnuncio: "",
    email: "",
  };
  try {
    aiResult = await extractLeadDataWithAi(email, deps.env);
  } catch (e) {
    log.error({ err: e, uid: uidLabel }, "[OpenAI] estrazione fallita: salto la mail");
    return;
  }

  printOpenAiExtractionBlock(ctx?.index ?? null, ctx?.total ?? null, uidLabel, {
    nome: aiResult.nome,
    cognome: aiResult.cognome,
    email: aiResult.email,
    idAnnuncio: aiResult.idAnnuncio,
  });

  const fallbackIds = extractExternalListingIds(email.textBody, email.htmlBody, {
    extraRegexStrings: deps.extraIdPatterns,
  });
  const uniqueIds = aiResult.idAnnuncio ? [aiResult.idAnnuncio] : [...new Set(fallbackIds)];

  const blockedSubstrings = parseBlockedSubstrings(deps.env);
  const aiEmailBlocked = blockedSubstrings.some((s) =>
    aiResult.email.toLowerCase().includes(s.toLowerCase()),
  );
  const leadEmail =
    aiResult.email && !aiEmailBlocked
      ? aiResult.email
      : extractFirstBodyEmail(email.textBody, email.htmlBody, blockedSubstrings);
  const phone = aiResult.numeroTelefono || extractFirstPhone(combinedBody(email));
  const nome = aiResult.nome;
  const cognome = aiResult.cognome;

  const assignmentDate = formatAssignmentDate(processedAt);
  const { data: dataMail, ora: oraMail } = splitDataOraRome(email.receivedAt);
  const mittente = email.from || "(sconosciuto)";
  const corpoMail = bodyPreviewForSheet(email);

  // Cooldown GLOBALE prima di qualsiasi routing: la cache include tab lead + diagnostici
  // ed è aggiornata anche dalle righe inserite nei messaggi precedenti dello stesso ciclo.
  if (leadEmail && deps.assignmentCooldown) {
    const decision = await deps.assignmentCooldown.shouldSkip(leadEmail, processedAt);
    if (decision.shouldSkip) {
      log.info(
        {
          uid: uidLabel,
          leadEmail,
          lastAssignedAt: decision.lastAssignedAt?.toISOString(),
          blockedUntil: decision.blockedUntil?.toISOString(),
        },
        "[sheets] skip mail: cooldown 6 mesi globale (nessuna riga inserita)",
      );
      return;
    }
  }

  if (uniqueIds.length === 0) {
    await emitNoIdRow(deps, {
      dataMail,
      oraMail,
      mittente,
      corpoMail,
      nome,
      cognome,
      leadEmail,
      phone,
      spreadsheetId: deps.env.defaultSpreadsheetIdResolved,
      sheetTitle: deps.env.NO_ID_FOUND_SHEET_TITLE,
    });
    if (leadEmail) deps.assignmentCooldown?.recordAssignment(leadEmail, processedAt);
    log.info(
      { uid: uidLabel, sheet: deps.env.NO_ID_FOUND_SHEET_TITLE },
      "[sheets] no-id-trovato A:H = data, ora, mittente, corpo, nome, cognome, email, tel",
    );
    return;
  }

  if (uniqueIds.length > 1) {
    await emitMultiIdRow(deps, {
      dataMail,
      oraMail,
      mittente,
      corpoMail,
      nome,
      cognome,
      leadEmail,
      phone,
      listaId: uniqueIds.join(","),
      spreadsheetId: deps.env.defaultSpreadsheetIdResolved,
      sheetTitle: deps.env.MULTI_ID_FOUND_SHEET_TITLE,
    });
    if (leadEmail) deps.assignmentCooldown?.recordAssignment(leadEmail, processedAt);
    log.info(
      { uid: uidLabel, sheet: deps.env.MULTI_ID_FOUND_SHEET_TITLE, ids: uniqueIds },
      "[sheets] no-singolo-id A:I (con lista ID)",
    );
    return;
  }

  const listingId = uniqueIds[0]!;
  let zone = "";
  let target: { spreadsheetId: string; sheetTitle: string } = {
    spreadsheetId: deps.env.defaultSpreadsheetIdResolved,
    sheetTitle: deps.env.DEFAULT_SHEET_TITLE,
  };
  let routingLog = "fallback_default";

  try {
    let listing = deps.listingCache?.get(listingId) ?? null;
    if (!deps.listingCache?.has(listingId)) {
      listing = await deps.listings.findLatestByExternalListingId(listingId);
      deps.listingCache?.set(listingId, listing);
    }

    if (!listing || !listing.zone || !listing.zone.trim()) {
      const corpoNoGestim = `[ID ${listingId}: nessuna zona/annuncio in gestim_listings]\n${corpoMail}`;
      await emitNoIdRow(deps, {
        dataMail,
        oraMail,
        mittente,
        corpoMail: corpoNoGestim,
        nome,
        cognome,
        leadEmail,
        phone,
        spreadsheetId: deps.env.defaultSpreadsheetIdResolved,
        sheetTitle: deps.env.NO_ID_FOUND_SHEET_TITLE,
      });
      if (leadEmail) deps.assignmentCooldown?.recordAssignment(leadEmail, processedAt);
      log.info(
        { uid: uidLabel, listingId, sheet: deps.env.NO_ID_FOUND_SHEET_TITLE },
        "[sheets] ID senza zona in gestim → no-id-trovato (A:H)",
      );
      return;
    }

    zone = listing.zone.trim();
    const resolved = resolveSheetForZone(
      zone,
      deps.env.zoneSheetRules,
      deps.env.defaultSpreadsheetIdResolved,
      deps.env.DEFAULT_SHEET_TITLE,
    );
    target = { spreadsheetId: resolved.spreadsheetId, sheetTitle: resolved.sheetTitle };
    routingLog = resolved.fallback
      ? `zone_unmapped_used_default(${zone})`
      : `zone_mapped:${resolved.matchedRule?.name ?? resolved.matchedRule?.pattern ?? "rule"}`;
  } catch (e) {
    log.error(
      { err: e, uid: uidLabel, listingId },
      "[db] lookup gestim_listings fallito (fallback default)",
    );
    routingLog = `listing_lookup_error:${e instanceof Error ? e.message : String(e)}`;
  }

  log.info(
    { uid: uidLabel, routingLog, zone, listingId, sheet: target.sheetTitle },
    "[sheets] zona → tab",
  );

  try {
    await emitLeadRow(deps, {
      leadEmail,
      listingId,
      assignmentDate,
      phone,
      zone,
      nome,
      cognome,
      spreadsheetId: target.spreadsheetId,
      sheetTitle: target.sheetTitle,
    });
    if (leadEmail) deps.assignmentCooldown?.recordAssignment(leadEmail, processedAt);
    log.info({ uid: uidLabel, sheet: target.sheetTitle }, "[sheets] riga lead A:G (ok)");
  } catch (e) {
    log.error(
      { err: e, uid: uidLabel, sheet: target.sheetTitle },
      "[sheets] append fallita (le altre email proseguono)",
    );
  }
}

async function emitLeadRow(deps: LeadProcessorDeps, payload: LeadRowPayload): Promise<void> {
  if (deps.deferSheetFlush) {
    deps.sheets.queueLead(payload);
    return;
  }
  await deps.sheets.appendLead(payload);
}

async function emitNoIdRow(deps: LeadProcessorDeps, payload: NoIdRowPayload): Promise<void> {
  if (deps.deferSheetFlush) {
    deps.sheets.queueNoId(payload);
    return;
  }
  await deps.sheets.appendNoId(payload);
}

async function emitMultiIdRow(deps: LeadProcessorDeps, payload: MultiIdRowPayload): Promise<void> {
  if (deps.deferSheetFlush) {
    deps.sheets.queueMultiId(payload);
    return;
  }
  await deps.sheets.appendMultiId(payload);
}
