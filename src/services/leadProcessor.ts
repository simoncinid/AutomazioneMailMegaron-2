import type { AppEnv } from "../config/loadEnv.js";
import { resolveSheetForZone } from "../config/resolveSheetForZone.js";
import type { GestimListingRow, LeadRowPayload, ParsedInboundEmail } from "../domain/types.js";
import { logger } from "../logging/logger.js";
import type { ListingRepository } from "../repositories/listingRepository.js";
import { GoogleSheetsWriter } from "../sheets/googleSheetsWriter.js";
import { extractExternalListingIds } from "./idExtractor.js";
import { extractFirstPhone, nomeFromEmailAddress } from "./contactExtractor.js";
import { formatDataIt, formatTempoDaInvioMail } from "./dateFormatIt.js";

const log = logger.child({ module: "leadProcessor" });

export interface LeadProcessorDeps {
  env: AppEnv;
  listings: ListingRepository;
  sheets: GoogleSheetsWriter;
  extraIdPatterns?: string[];
}

function combinedBody(email: ParsedInboundEmail): string {
  return [email.textBody, email.htmlBody ?? ""].join("\n");
}

function buildContactFields(email: ParsedInboundEmail): {
  nomeCognome: string;
  telefono: string;
} {
  const nome =
    (email.fromDisplayName && email.fromDisplayName.trim()) ||
    nomeFromEmailAddress(email.from) ||
    "";
  const telefono = extractFirstPhone(combinedBody(email));
  return { nomeCognome: nome, telefono };
}

function tempoField(email: ParsedInboundEmail, processedAt: Date): string {
  return formatTempoDaInvioMail(processedAt.getTime() - email.receivedAt.getTime());
}

/**
 * Orchestrazione: estrazione ID → match → zona → foglio → append (5 colonne).
 */
export async function processInboundEmail(
  email: ParsedInboundEmail,
  deps: LeadProcessorDeps,
  processedAt: Date = new Date(),
): Promise<void> {
  const ids = extractExternalListingIds(email.textBody, email.htmlBody, {
    extraRegexStrings: deps.extraIdPatterns,
  });

  const { nomeCognome, telefono } = buildContactFields(email);
  const dataIt = formatDataIt(email.receivedAt);

  log.info(
    {
      messageId: email.messageId,
      from: email.from,
      idCount: ids.length,
      ids,
    },
    "Email normalizzata",
  );

  if (ids.length === 0) {
    await appendLeadRow(deps, email, processedAt, {
      dataIt,
      nomeCognome,
      telefono,
      riferimentoImmobile: "",
      target: resolveUnmappedOrDefault(deps.env),
      routingLog: "no_external_listing_id_extracted",
    });
    return;
  }

  const uniqueIds = [...new Set(ids)];

  let listingById: Map<string, GestimListingRow>;
  try {
    listingById = await deps.listings.findLatestByExternalListingIds(uniqueIds);
  } catch (e) {
    log.error({ err: e, ids: uniqueIds }, "Errore nel recupero annunci (batch)");
    for (const externalId of uniqueIds) {
      await appendLeadRow(deps, email, processedAt, {
        dataIt,
        nomeCognome,
        telefono,
        riferimentoImmobile: externalId,
        target: resolveUnmappedOrDefault(deps.env),
        routingLog: `listing_lookup_error:${e instanceof Error ? e.message : String(e)}`,
      });
    }
    return;
  }

  log.info(
    { messageId: email.messageId, requested: uniqueIds.length, found: listingById.size },
    "Dettagli annunci caricati (batch)",
  );

  for (const externalId of uniqueIds) {
    const listing = listingById.get(externalId);

    if (!listing) {
      log.warn({ externalId }, "ID annuncio non trovato nel DB/API");
      const target = resolveUnmappedOrDefault(deps.env);
      await appendLeadRow(deps, email, processedAt, {
        dataIt,
        nomeCognome,
        telefono,
        riferimentoImmobile: externalId,
        target,
        routingLog: "listing_not_found",
      });
      continue;
    }

    const zone = listing.zone;
    const resolved = resolveSheetForZone(
      zone,
      deps.env.zoneSheetRules,
      deps.env.defaultSpreadsheetIdResolved,
      deps.env.DEFAULT_SHEET_TITLE,
    );

    let spreadsheetId = resolved.spreadsheetId;
    let sheetTitle = resolved.sheetTitle;
    let routingLog = resolved.fallback
      ? "zone_unmapped_used_default"
      : `zone_mapped:${resolved.matchedRule?.name ?? resolved.matchedRule?.pattern ?? "rule"}`;

    if (resolved.fallback && deps.env.UNMAPPED_ZONE_SPREADSHEET_ID) {
      spreadsheetId = deps.env.UNMAPPED_ZONE_SPREADSHEET_ID;
      sheetTitle =
        deps.env.UNMAPPED_ZONE_SHEET_TITLE ?? deps.env.DEFAULT_SHEET_TITLE;
      routingLog = "zone_unmapped_routed_to_unmapped_bucket";
    }

    log.info(
      { externalId, zone, spreadsheetId, sheetTitle, routingLog },
      "Lead instradato",
    );

    await deps.sheets.appendLead(
      buildPayload(
        email,
        processedAt,
        {
          dataIt,
          nomeCognome,
          telefono,
          riferimentoImmobile: externalId,
        },
        { spreadsheetId, sheetTitle },
      ),
    );
  }
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
  email: ParsedInboundEmail,
  processedAt: Date,
  args: {
    dataIt: string;
    nomeCognome: string;
    telefono: string;
    riferimentoImmobile: string;
    target: { spreadsheetId: string; sheetTitle: string };
    routingLog: string;
  },
): Promise<void> {
  log.info({ routingLog: args.routingLog }, "Lead (fallback / errore)");
  await deps.sheets.appendLead(
    buildPayload(
      email,
      processedAt,
      {
        dataIt: args.dataIt,
        nomeCognome: args.nomeCognome,
        telefono: args.telefono,
        riferimentoImmobile: args.riferimentoImmobile,
      },
      args.target,
    ),
  );
}

function buildPayload(
  email: ParsedInboundEmail,
  processedAt: Date,
  fields: {
    dataIt: string;
    nomeCognome: string;
    telefono: string;
    riferimentoImmobile: string;
  },
  target: { spreadsheetId: string; sheetTitle: string },
): LeadRowPayload {
  return {
    dataIt: fields.dataIt,
    nomeCognome: fields.nomeCognome,
    telefono: fields.telefono,
    riferimentoImmobile: fields.riferimentoImmobile,
    tempoDaInvioMail: tempoField(email, processedAt),
    spreadsheetId: target.spreadsheetId,
    sheetTitle: target.sheetTitle,
  };
}
