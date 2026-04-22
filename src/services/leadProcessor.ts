import type { AppEnv } from "../config/loadEnv.js";
import { resolveSheetForZone } from "../config/resolveSheetForZone.js";
import type { GestimListingRow, LeadRowPayload, ParsedInboundEmail } from "../domain/types.js";
import { logger } from "../logging/logger.js";
import type { ListingRepository } from "../repositories/listingRepository.js";
import { GoogleSheetsWriter } from "../sheets/googleSheetsWriter.js";
import { extractFirstBodyEmail, extractFirstPhone } from "./contactExtractor.js";
import { extractExternalListingIds } from "./idExtractor.js";

const log = logger.child({ module: "leadProcessor" });

export interface LeadProcessorDeps {
  env: AppEnv;
  listings: ListingRepository;
  sheets: GoogleSheetsWriter;
  extraIdPatterns?: string[];
  listingCache?: Map<string, GestimListingRow | null>;
  deferSheetFlush?: boolean;
}

function combinedBody(email: ParsedInboundEmail): string {
  return [email.textBody, email.htmlBody ?? ""].join("\n");
}

function parseBlockedSubstrings(env: AppEnv): string[] {
  return env.BLOCKED_EMAIL_SUBSTRINGS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function formatArrivalTime(receivedAt: Date): string {
  const hh = String(receivedAt.getHours()).padStart(2, "0");
  const mm = String(receivedAt.getMinutes()).padStart(2, "0");
  const ss = String(receivedAt.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/**
 * Orchestrazione worker:
 * - Estrae ID annuncio dal corpo
 * - Estrae email lead dal corpo saltando indirizzi "bloccati"
 * - Instrada per numero ID:
 *   0 -> NO_ID_FOUND_SHEET_TITLE
 *   >1 -> MULTI_ID_FOUND_SHEET_TITLE
 *   1 -> lookup DB/API, mappa zona -> foglio
 * - Appende una riga A:E
 */
export async function processInboundEmail(
  email: ParsedInboundEmail,
  deps: LeadProcessorDeps,
  _processedAt: Date = new Date(),
): Promise<void> {
  const extractedIds = extractExternalListingIds(email.textBody, email.htmlBody, {
    extraRegexStrings: deps.extraIdPatterns,
  });
  const uniqueIds = [...new Set(extractedIds)];
  const telefono = extractFirstPhone(combinedBody(email));
  const blockedSubstrings = parseBlockedSubstrings(deps.env);
  const leadEmail = extractFirstBodyEmail(email.textBody, email.htmlBody, blockedSubstrings);
  const arrivalTime = formatArrivalTime(email.receivedAt);

  log.info(
    {
      messageId: email.messageId,
      from: email.from,
      idCount: uniqueIds.length,
      ids: uniqueIds,
      leadEmail,
    },
    "Email normalizzata",
  );

  if (uniqueIds.length === 0) {
    await appendLeadRow(deps, {
      leadEmail,
      listingId: "",
      arrivalTime,
      phone: telefono,
      zone: "",
      target: {
        spreadsheetId: deps.env.defaultSpreadsheetIdResolved,
        sheetTitle: deps.env.NO_ID_FOUND_SHEET_TITLE,
      },
      routingLog: "no_id_found",
    });
    return;
  }

  if (uniqueIds.length > 1) {
    await appendLeadRow(deps, {
      leadEmail,
      listingId: uniqueIds.join(","),
      arrivalTime,
      phone: telefono,
      zone: "",
      target: {
        spreadsheetId: deps.env.defaultSpreadsheetIdResolved,
        sheetTitle: deps.env.MULTI_ID_FOUND_SHEET_TITLE,
      },
      routingLog: "multiple_ids_found",
    });
    return;
  }

  const listingId = uniqueIds[0]!;
  let zone = "";
  let target = resolveUnmappedOrDefault(deps.env);
  let routingLog = "listing_not_found";

  try {
    let listing = deps.listingCache?.get(listingId) ?? null;
    if (!deps.listingCache?.has(listingId)) {
      listing = await deps.listings.findLatestByExternalListingId(listingId);
      deps.listingCache?.set(listingId, listing);
    }
    if (listing?.zone?.trim()) {
      zone = listing.zone.trim();
      routingLog = "zone_mapped";
      const resolved = resolveSheetForZone(
        zone,
        deps.env.zoneSheetRules,
        deps.env.defaultSpreadsheetIdResolved,
        deps.env.DEFAULT_SHEET_TITLE,
      );

      let spreadsheetId = resolved.spreadsheetId;
      let sheetTitle = resolved.sheetTitle;
      routingLog = resolved.fallback
        ? "zone_unmapped_used_default"
        : `zone_mapped:${resolved.matchedRule?.name ?? resolved.matchedRule?.pattern ?? "rule"}`;

      if (resolved.fallback && deps.env.UNMAPPED_ZONE_SPREADSHEET_ID) {
        spreadsheetId = deps.env.UNMAPPED_ZONE_SPREADSHEET_ID;
        sheetTitle = deps.env.UNMAPPED_ZONE_SHEET_TITLE ?? deps.env.DEFAULT_SHEET_TITLE;
        routingLog = "zone_unmapped_routed_to_unmapped_bucket";
      }
      target = { spreadsheetId, sheetTitle };
    }
  } catch (e) {
    log.error({ err: e, listingId }, "Errore nel recupero annuncio");
    routingLog = `listing_lookup_error:${e instanceof Error ? e.message : String(e)}`;
  }

  await appendLeadRow(deps, {
    leadEmail,
    listingId,
    arrivalTime,
    phone: telefono,
    zone,
    target,
    routingLog,
  });
}

function resolveUnmappedOrDefault(env: AppEnv): {
  spreadsheetId: string;
  sheetTitle: string;
} {
  if (env.UNMAPPED_ZONE_SPREADSHEET_ID) {
    return {
      spreadsheetId: env.UNMAPPED_ZONE_SPREADSHEET_ID,
      sheetTitle: env.UNMAPPED_ZONE_SHEET_TITLE ?? env.DEFAULT_SHEET_TITLE,
    };
  }
  return {
    spreadsheetId: env.defaultSpreadsheetIdResolved,
    sheetTitle: env.DEFAULT_SHEET_TITLE,
  };
}

async function appendLeadRow(
  deps: LeadProcessorDeps,
  args: {
    leadEmail: string;
    listingId: string;
    arrivalTime: string;
    phone: string;
    zone: string;
    target: { spreadsheetId: string; sheetTitle: string };
    routingLog: string;
  },
): Promise<void> {
  log.info(
    {
      routingLog: args.routingLog,
      spreadsheetId: args.target.spreadsheetId,
      sheetTitle: args.target.sheetTitle,
      listingId: args.listingId,
      zone: args.zone,
    },
    "Lead instradato",
  );
  const payload = buildPayload(
    {
      leadEmail: args.leadEmail,
      listingId: args.listingId,
      arrivalTime: args.arrivalTime,
      phone: args.phone,
      zone: args.zone,
    },
    args.target,
  );
  if (deps.deferSheetFlush) {
    deps.sheets.queueLead(payload);
    return;
  }
  await deps.sheets.appendLead(payload);
}

function buildPayload(
  fields: {
    leadEmail: string;
    listingId: string;
    arrivalTime: string;
    phone: string;
    zone: string;
  },
  target: { spreadsheetId: string; sheetTitle: string },
): LeadRowPayload {
  return {
    leadEmail: fields.leadEmail,
    listingId: fields.listingId,
    arrivalTime: fields.arrivalTime,
    phone: fields.phone,
    zone: fields.zone,
    spreadsheetId: target.spreadsheetId,
    sheetTitle: target.sheetTitle,
  };
}
