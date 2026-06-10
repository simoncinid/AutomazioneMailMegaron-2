import type { AppEnv } from "../config/loadEnv.js";
import { resolveSheetForZone } from "../config/resolveSheetForZone.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  GestimListingRow,
  LeadRowPayload,
  NoIdRowPayload,
  ParsedInboundEmail,
} from "../domain/types.js";
import { logger, printOpenAiExtractionBlock } from "../logging/logger.js";
import type { ListingRepository } from "../repositories/listingRepository.js";
import { GoogleSheetsWriter } from "../sheets/googleSheetsWriter.js";
import type { LeadAssignmentCooldown } from "./leadAssignmentCooldown.js";
import type { LeadAutoReplyService } from "./leadAutoReply.js";
import { extractFirstBodyEmail, extractFirstPhone, isLikelyLeadEmail } from "./contactExtractor.js";
import {
  extractLeadDataWithAi,
  type AiLeadExtraction,
} from "./leadAiExtractor.js";
import { extractExternalListingIds } from "./idExtractor.js";

const log = logger.child({ module: "leadProcessor" });
const DEFAULT_PISA_ROUND_ROBIN_STATE_PATH = join(process.cwd(), ".state", "pisa-round-robin.json");
const DEFAULT_LUCCA_VIAREGGIO_ROUND_ROBIN_STATE_PATH = join(
  process.cwd(),
  ".state",
  "viareggio-round-robin.json",
);
const DEFAULT_PONTEDERA_ROUND_ROBIN_STATE_PATH = join(
  process.cwd(),
  ".state",
  "pontedera-round-robin.json",
);
const DEFAULT_LIVORNO_ROUND_ROBIN_STATE_PATH = join(
  process.cwd(),
  ".state",
  "livorno-round-robin.json",
);
const PISA_AGENT_SHEETS = [
  "MASSIMO",
  "DAVIDE",
  "EROS",
  "SAMUELE",
  "GIUSEPPE",
  "TOMMASO",
  "REBECCA",
  "MATTIA",
  "STEFANIA",
  "VALENTINA",
  "MARCO",
  "MARTA",
] as const;
const LUCCA_VIAREGGIO_AGENT_SHEETS = [
  "ALFREDO",
  "MARY",
] as const;
const PONTEDERA_AGENT_SHEETS = [
  "REBECCA",
  "FAUSTO",
  "ELISABETTA",
  "LUIS",
] as const;
const LIVORNO_AGENT_SHEETS = [
  "MATTEO",
  "VIVIANA",
  "MASSIMILIANO",
  "GUIDO",
] as const;
const PISA_RANDOM_POOL_ZONE_KEYS = new Set([
  "capannoli",
  "san pietro belvedere",
  "santo pietro belvedere",
  "solaia",
]);
type AgentSelectionStrategy = "round_robin" | "random_fallback" | "random_pool";

type SheetTarget = { spreadsheetId: string; sheetTitle: string };

export interface LeadProcessorDeps {
  env: AppEnv;
  listings: ListingRepository;
  sheets: GoogleSheetsWriter;
  assignmentCooldown?: LeadAssignmentCooldown;
  leadAutoReply?: LeadAutoReplyService;
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

/** Estrae un'etichetta UID amichevole per i log STDOUT (`imap-uid-12345` -> `12345`). */
function uidFromEmail(email: ParsedInboundEmail): string {
  if (!email.messageId) return "";
  const match = /^imap-uid-(.+)$/.exec(email.messageId);
  return match ? match[1]! : email.messageId;
}

function normalizeSheetKey(value: string): string {
  return value.trim().toLowerCase();
}

function isAgencySheet(sheetTitle: string): boolean {
  const k = normalizeSheetKey(sheetTitle);
  return k === "ag" || k.startsWith("ag-");
}

function isAgPisaSheet(sheetTitle: string): boolean {
  return normalizeSheetKey(sheetTitle) === "ag-pisa";
}

function isAgViareggioSheet(sheetTitle: string): boolean {
  return normalizeSheetKey(sheetTitle) === "ag-viareggio";
}

function isAgLuccaSheet(sheetTitle: string): boolean {
  return normalizeSheetKey(sheetTitle) === "ag-lucca";
}

function isAgPontederaSheet(sheetTitle: string): boolean {
  return normalizeSheetKey(sheetTitle) === "ag-pontedera";
}

function isAgLivornoSheet(sheetTitle: string): boolean {
  return normalizeSheetKey(sheetTitle) === "ag-livorno";
}

function getRoundRobinStatePath(envName: string, defaultPath: string): string {
  return process.env[envName]?.trim() || defaultPath;
}

async function pickAgentSheetFromRoundRobin(
  candidates: readonly string[],
  statePath: string,
  emptyPoolError: string,
): Promise<{
  sheetTitle: string;
  strategy: AgentSelectionStrategy;
}> {
  const pool = [...candidates];
  const modulo = pool.length;
  if (modulo === 0) {
    throw new Error(emptyPoolError);
  }

  let nextIndex = 0;
  try {
    const raw = await readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as { nextIndex?: unknown };
    if (typeof parsed.nextIndex === "number" && Number.isFinite(parsed.nextIndex)) {
      nextIndex = Math.max(0, Math.trunc(parsed.nextIndex));
    }
  } catch {
    // Primo avvio o file corrotto/mancante: si riparte da indice 0.
  }

  const index = nextIndex % modulo;
  const selected = pool[index]!;
  const nextState = {
    nextIndex: (index + 1) % modulo,
  };

  try {
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(statePath, JSON.stringify(nextState), "utf8");
    return { sheetTitle: selected, strategy: "round_robin" };
  } catch {
    const fallbackIndex = Math.floor(Math.random() * modulo);
    return { sheetTitle: pool[fallbackIndex]!, strategy: "random_fallback" };
  }
}

async function pickPisaAgentSheet(): Promise<{
  sheetTitle: string;
  strategy: AgentSelectionStrategy;
}> {
  return pickAgentSheetFromRoundRobin(
    PISA_AGENT_SHEETS,
    getRoundRobinStatePath("PISA_ROUND_ROBIN_STATE_PATH", DEFAULT_PISA_ROUND_ROBIN_STATE_PATH),
    "Nessun agente Pisa configurato per il routing AG-PISA",
  );
}

async function pickLuccaViareggioAgentSheet(): Promise<{
  sheetTitle: string;
  strategy: AgentSelectionStrategy;
}> {
  return pickAgentSheetFromRoundRobin(
    LUCCA_VIAREGGIO_AGENT_SHEETS,
    getRoundRobinStatePath(
      "VIAREGGIO_ROUND_ROBIN_STATE_PATH",
      DEFAULT_LUCCA_VIAREGGIO_ROUND_ROBIN_STATE_PATH,
    ),
    "Nessun agente Lucca/Viareggio configurato per il routing AG-LUCCA/AG-VIAREGGIO",
  );
}

async function pickPontederaAgentSheet(): Promise<{
  sheetTitle: string;
  strategy: AgentSelectionStrategy;
}> {
  return pickAgentSheetFromRoundRobin(
    PONTEDERA_AGENT_SHEETS,
    getRoundRobinStatePath(
      "PONTEDERA_ROUND_ROBIN_STATE_PATH",
      DEFAULT_PONTEDERA_ROUND_ROBIN_STATE_PATH,
    ),
    "Nessun agente Pontedera configurato per il routing AG-PONTEDERA",
  );
}

async function pickLivornoAgentSheet(): Promise<{
  sheetTitle: string;
  strategy: AgentSelectionStrategy;
}> {
  return pickAgentSheetFromRoundRobin(
    LIVORNO_AGENT_SHEETS,
    getRoundRobinStatePath("LIVORNO_ROUND_ROBIN_STATE_PATH", DEFAULT_LIVORNO_ROUND_ROBIN_STATE_PATH),
    "Nessun agente Livorno configurato per il routing AG-LIVORNO",
  );
}

function pickRandomPisaAgentSheetFromPool(): {
  sheetTitle: string;
  strategy: AgentSelectionStrategy;
} {
  const index = Math.floor(Math.random() * PISA_AGENT_SHEETS.length);
  return {
    sheetTitle: PISA_AGENT_SHEETS[index]!,
    strategy: "random_pool",
  };
}

function pickRandomAgentTarget(env: AppEnv): SheetTarget | null {
  const seen = new Map<string, SheetTarget>();
  for (const rule of env.zoneSheetRules) {
    if (isAgencySheet(rule.sheetTitle)) continue;
    const key = `${rule.spreadsheetId}::${rule.sheetTitle}`;
    if (!seen.has(key)) {
      seen.set(key, { spreadsheetId: rule.spreadsheetId, sheetTitle: rule.sheetTitle });
    }
  }

  const candidates = [...seen.values()];
  if (candidates.length === 0) {
    if (!isAgencySheet(env.DEFAULT_SHEET_TITLE)) {
      return {
        spreadsheetId: env.defaultSpreadsheetIdResolved,
        sheetTitle: env.DEFAULT_SHEET_TITLE,
      };
    }
    return null;
  }

  const index = Math.floor(Math.random() * candidates.length);
  return candidates[index] ?? null;
}

async function maybeHandleExistingContact(
  deps: LeadProcessorDeps,
  args: {
    uidLabel: string;
    leadEmail: string;
    phone: string;
    selectedListingId: string;
    assignmentDate: string;
    nome: string;
    cognome: string;
    processedAt: Date;
    emailSubject: string;
    emailMessageId?: string;
  },
): Promise<boolean> {
  if (!deps.assignmentCooldown || (!args.leadEmail && !args.phone)) return false;

  const decision = await deps.assignmentCooldown.evaluateRecurrence(
    { email: args.leadEmail, phone: args.phone },
    args.processedAt,
  );

  if (decision.action === "skip") {
    log.info(
      {
        uid: args.uidLabel,
        matchedOn: decision.existing?.matchedOn,
        matchedValue: decision.existing?.matchedValue,
        status: decision.existing?.snapshot.statusRaw,
      },
      "[contatto-multiplo] skip entro 6 mesi",
    );
    return true;
  }

  if (decision.action !== "reactivate" || !decision.existing) return false;

  const row = await deps.assignmentCooldown.reactivateExistingRow(decision, {
    identity: { email: args.leadEmail, phone: args.phone },
    listingId: args.selectedListingId,
    assignmentDate: args.assignmentDate,
    phone: args.phone,
    zone: "",
    nome: args.nome,
    cognome: args.cognome,
    leadEmail: args.leadEmail,
    processedAt: args.processedAt,
  });

  if (args.leadEmail) {
    await deps.leadAutoReply?.sendReplyForLeadAssignment({
      leadEmail: args.leadEmail,
      leadPhone: args.phone,
      sheetTitle: row.sheetTitle,
      originalSubject: args.emailSubject,
      originalMessageId: args.emailMessageId,
    });
  }

  log.info(
    {
      uid: args.uidLabel,
      sheet: row.sheetTitle,
      row: row.rowNumber,
      reason: decision.reason,
    },
    "[contatto-multiplo] riattivato: stato -> Da Chiamare",
  );
  return true;
}

async function insertLeadRow(
  deps: LeadProcessorDeps,
  payload: LeadRowPayload,
  processedAt: Date,
  originalSubject: string,
  originalMessageId: string | undefined,
): Promise<void> {
  await emitLeadRow(deps, payload);
  deps.assignmentCooldown?.recordAssignment(
    { email: payload.leadEmail, phone: payload.phone },
    processedAt,
    {
      statusRaw: "Da Chiamare",
      snapshot: {
        leadEmail: payload.leadEmail,
        listingId: payload.listingId,
        phone: payload.phone,
        zone: payload.zone,
        nome: payload.nome,
        cognome: payload.cognome,
      },
    },
  );

  if (payload.leadEmail) {
    await deps.leadAutoReply?.sendReplyForLeadAssignment({
      leadEmail: payload.leadEmail,
      leadPhone: payload.phone,
      sheetTitle: payload.sheetTitle,
      originalSubject,
      originalMessageId,
    });
  }
}

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
    risposta: false,
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

  const blockedSubstrings = parseBlockedSubstrings(deps.env);
  const aiEmailBlocked = blockedSubstrings.some((s) =>
    aiResult.email.toLowerCase().includes(s.toLowerCase()),
  );
  const aiEmailValid = aiResult.email ? isLikelyLeadEmail(aiResult.email) : false;
  const leadEmail =
    aiResult.email && !aiEmailBlocked && aiEmailValid
      ? aiResult.email
      : extractFirstBodyEmail(email.textBody, email.htmlBody, blockedSubstrings);
  const phone = aiResult.numeroTelefono || extractFirstPhone(combinedBody(email));
  const nome = aiResult.nome;
  const cognome = aiResult.cognome;

  if (!leadEmail && !phone) {
    log.info(
      { uid: uidLabel, from: email.from || "(sconosciuto)" },
      "[sheets] skip mail: nessun contatto utile (email e telefono assenti)",
    );
    return;
  }

  if (aiResult.risposta) {
    log.info(
      { uid: uidLabel, leadEmail, phone },
      "[ai] mail classificata come risposta/chiamata ricevuta: skip totale",
    );
    return;
  }

  const fallbackIds = extractExternalListingIds(email.textBody, email.htmlBody, {
    extraRegexStrings: deps.extraIdPatterns,
  });
  const selectedListingId = aiResult.idAnnuncio || fallbackIds[0] || "";

  const assignmentDate = formatAssignmentDate(processedAt);
  const { data: dataMail, ora: oraMail } = splitDataOraRome(email.receivedAt);
  const noIdMarker = selectedListingId || "NO-ID";

  const handledByRecurrence = await maybeHandleExistingContact(deps, {
    uidLabel,
    leadEmail,
    phone,
    selectedListingId,
    assignmentDate,
    nome,
    cognome,
    processedAt,
    emailSubject: email.subject,
    emailMessageId: email.messageId,
  });
  if (handledByRecurrence) return;

  if (!selectedListingId) {
    const randomTarget = pickRandomAgentTarget(deps.env);
    if (!randomTarget) {
      await emitNoIdRow(deps, {
        leadEmail,
        listingId: "NO-ID",
        assignmentDate,
        phone,
        zone: "NO-ID",
        province: "",
        nome,
        cognome,
        dataMail,
        oraMail,
        corpoMail: noIdMarker,
        spreadsheetId: deps.env.defaultSpreadsheetIdResolved,
        sheetTitle: deps.env.NO_ID_FOUND_SHEET_TITLE,
      });
      log.warn(
        { uid: uidLabel, sheet: deps.env.NO_ID_FOUND_SHEET_TITLE },
        "[routing] no-ID senza target agente: fallback su no-id-trovato",
      );
      return;
    }

    await insertLeadRow(
      deps,
      {
        leadEmail,
        listingId: "NO-ID",
        assignmentDate,
        phone,
        zone: "NO-ID",
        province: "",
        nome,
        cognome,
        spreadsheetId: randomTarget.spreadsheetId,
        sheetTitle: randomTarget.sheetTitle,
      },
      processedAt,
      email.subject,
      email.messageId,
    );
    log.info(
      { uid: uidLabel, sheet: randomTarget.sheetTitle },
      "[routing] no-ID: assegnazione random su foglio agente",
    );
    return;
  }

  const listingId = selectedListingId;
  let zone = "";
  let leadProvince = "";
  let target: SheetTarget | null = null;
  let routingLog = "fallback_default";

  try {
    let listing = deps.listingCache?.get(listingId) ?? null;
    if (!deps.listingCache?.has(listingId)) {
      listing = await deps.listings.findLatestByExternalListingId(listingId);
      deps.listingCache?.set(listingId, listing);
    }

    if (!listing || !listing.zone || !listing.zone.trim()) {
      await emitNoIdRow(deps, {
        leadEmail,
        listingId,
        assignmentDate,
        phone,
        zone: "NO-ZONA",
        province: listing?.province?.trim() ?? "",
        nome,
        cognome,
        dataMail,
        oraMail,
        corpoMail: listingId,
        spreadsheetId: deps.env.defaultSpreadsheetIdResolved,
        sheetTitle: deps.env.NO_ID_FOUND_SHEET_TITLE,
      });
      log.info(
        { uid: uidLabel, listingId, sheet: deps.env.NO_ID_FOUND_SHEET_TITLE },
        "[sheets] ID senza zona in gestim -> no-id-trovato (A:L)",
      );
      return;
    }

    zone = listing.zone.trim();
    const listingCity = listing.city?.trim() ?? "";
    const listingProvince = listing.province?.trim() ?? "";
    leadProvince = listingProvince;
    const resolved = resolveSheetForZone(
      zone,
      deps.env.zoneSheetRules,
      deps.env.defaultSpreadsheetIdResolved,
      deps.env.DEFAULT_SHEET_TITLE,
      { city: listing.city, province: listing.province ?? null },
    );
    if (resolved.fallback) {
      await emitNoIdRow(deps, {
        leadEmail,
        listingId,
        assignmentDate,
        phone,
        zone,
        province: listingProvince,
        nome,
        cognome,
        dataMail,
        oraMail,
        corpoMail: listingId,
        spreadsheetId: deps.env.defaultSpreadsheetIdResolved,
        sheetTitle: deps.env.NO_ID_FOUND_SHEET_TITLE,
      });
      log.warn(
        {
          uid: uidLabel,
          listingId,
          zone,
          city: listingCity,
          province: listingProvince,
          sheet: deps.env.NO_ID_FOUND_SHEET_TITLE,
        },
        "[routing] fallback disabilitato: lead inviato a no-id-trovato",
      );
      return;
    }

    target = { spreadsheetId: resolved.spreadsheetId, sheetTitle: resolved.sheetTitle };
    if (isAgPisaSheet(target.sheetTitle)) {
      const reassigned = PISA_RANDOM_POOL_ZONE_KEYS.has(zone.trim().toLowerCase())
        ? pickRandomPisaAgentSheetFromPool()
        : await pickPisaAgentSheet();
      const originalSheet = target.sheetTitle;
      target = {
        ...target,
        sheetTitle: reassigned.sheetTitle,
      };
      log.info(
        { uid: uidLabel, listingId, fromSheet: originalSheet, toSheet: target.sheetTitle, strategy: reassigned.strategy },
        "[routing] AG-PISA riassegnata agente Pisa",
      );
    }
    if (isAgLuccaSheet(target.sheetTitle) || isAgViareggioSheet(target.sheetTitle)) {
      const reassigned = await pickLuccaViareggioAgentSheet();
      const originalSheet = target.sheetTitle;
      target = {
        ...target,
        sheetTitle: reassigned.sheetTitle,
      };
      log.info(
        { uid: uidLabel, listingId, fromSheet: originalSheet, toSheet: target.sheetTitle, strategy: reassigned.strategy },
        "[routing] AG-LUCCA/AG-VIAREGGIO riassegnata pool Lucca+Viareggio",
      );
    }
    if (isAgPontederaSheet(target.sheetTitle)) {
      const reassigned = await pickPontederaAgentSheet();
      const originalSheet = target.sheetTitle;
      target = {
        ...target,
        sheetTitle: reassigned.sheetTitle,
      };
      log.info(
        { uid: uidLabel, listingId, fromSheet: originalSheet, toSheet: target.sheetTitle, strategy: reassigned.strategy },
        "[routing] AG-PONTEDERA riassegnata pool Pontedera",
      );
    }
    if (isAgLivornoSheet(target.sheetTitle)) {
      const reassigned = await pickLivornoAgentSheet();
      const originalSheet = target.sheetTitle;
      target = {
        ...target,
        sheetTitle: reassigned.sheetTitle,
      };
      log.info(
        { uid: uidLabel, listingId, fromSheet: originalSheet, toSheet: target.sheetTitle, strategy: reassigned.strategy },
        "[routing] AG-LIVORNO riassegnata pool Livorno",
      );
    }

    if (resolved.resolutionSource === "disambiguation") {
      log.info(
        {
          uid: uidLabel,
          listingId,
          zone,
          city: listing.city ?? "",
          province: listing.province ?? "",
          selectedSheet: target.sheetTitle,
          disambiguation: resolved.disambiguationHint ?? "",
        },
        "[routing] disambiguazione zona tramite city/province",
      );
    }
    routingLog = resolved.fallback
      ? `zone_unmapped_used_default(${zone})`
      : `zone_mapped:${resolved.matchedRule?.name ?? resolved.matchedRule?.pattern ?? "rule"}`;
  } catch (e) {
    await emitNoIdRow(deps, {
      leadEmail,
      listingId,
      assignmentDate,
      phone,
      zone: zone || "NO-ROUTING",
      province: leadProvince,
      nome,
      cognome,
      dataMail,
      oraMail,
      corpoMail: listingId,
      spreadsheetId: deps.env.defaultSpreadsheetIdResolved,
      sheetTitle: deps.env.NO_ID_FOUND_SHEET_TITLE,
    });
    log.error(
      { err: e, uid: uidLabel, listingId, sheet: deps.env.NO_ID_FOUND_SHEET_TITLE },
      "[db] lookup/routing fallito: lead inviato a no-id-trovato",
    );
    return;
  }

  if (!target) {
    log.warn(
      { uid: uidLabel, listingId, sheet: deps.env.NO_ID_FOUND_SHEET_TITLE },
      "[routing] target non valorizzato: skip difensivo",
    );
    return;
  }

  log.info(
    { uid: uidLabel, routingLog, zone, listingId, sheet: target.sheetTitle },
    "[sheets] zona -> tab",
  );

  try {
    await insertLeadRow(
      deps,
      {
        leadEmail,
        listingId,
        assignmentDate,
        phone,
        zone,
        province: leadProvince,
        nome,
        cognome,
        spreadsheetId: target.spreadsheetId,
        sheetTitle: target.sheetTitle,
      },
      processedAt,
      email.subject,
      email.messageId,
    );
    log.info({ uid: uidLabel, sheet: target.sheetTitle }, "[sheets] riga lead A:J (ok)");
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
