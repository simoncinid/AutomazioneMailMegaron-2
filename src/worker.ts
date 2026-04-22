import "dotenv/config";

/**
 * Worker Render: polling periodico della posta in arrivo via Microsoft Graph (client credentials).
 * Pattern analogo a JospaAutomation: loop + sleep, niente Outlook desktop.
 */
import { bootstrapEnv, type AppEnv } from "./config/loadEnv.js";
import { graphMessageToParsedEmail } from "./graph/graphMessageToParsedEmail.js";
import {
  getGraphAccessToken,
  getMessageDetail,
  listInboxMessagesSince,
} from "./graph/microsoftGraph.js";
import { logger } from "./logging/logger.js";
import { createListingRepository } from "./repositories/createListingRepository.js";
import type { GestimListingRow, ParsedInboundEmail } from "./domain/types.js";
import {
  appendProcessedMessageIds,
  loadProcessedMessageIds,
} from "./state/graphProcessedIds.js";
import { GoogleSheetsWriter } from "./sheets/googleSheetsWriter.js";
import { extractExternalListingIds } from "./services/idExtractor.js";
import { processInboundEmail } from "./services/leadProcessor.js";

const log = logger.child({ module: "worker" });

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function requireGraphEnv(env: AppEnv): void {
  if (
    !env.GRAPH_TENANT_ID ||
    !env.GRAPH_CLIENT_ID ||
    !env.GRAPH_CLIENT_SECRET ||
    !env.MAILBOX_USER
  ) {
    throw new Error(
      "Worker Graph: impostare GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, MAILBOX_USER",
    );
  }
}

function lookbackIso(hours: number): string {
  const d = new Date();
  d.setHours(d.getHours() - hours);
  return d.toISOString();
}

async function runCycle(env: AppEnv): Promise<void> {
  requireGraphEnv(env);
  const stateSpreadsheetId =
    env.GRAPH_STATE_SPREADSHEET_ID ?? env.defaultSpreadsheetIdResolved;
  const processed = await loadProcessedMessageIds({
    spreadsheetId: stateSpreadsheetId,
    sheetName: env.GRAPH_STATE_SHEET_NAME,
  });

  const token = await getGraphAccessToken({
    tenantId: env.GRAPH_TENANT_ID!,
    clientId: env.GRAPH_CLIENT_ID!,
    clientSecret: env.GRAPH_CLIENT_SECRET!,
  });

  const sinceIso = lookbackIso(env.GRAPH_LOOKBACK_HOURS);
  const list = await listInboxMessagesSince({
    accessToken: token,
    mailboxUser: env.MAILBOX_USER!,
    sinceIso,
    top: 50,
  });

  log.info(
    { count: list.length, sinceIso, mailbox: env.MAILBOX_USER },
    "Messaggi inbox da analizzare",
  );

  const listings = createListingRepository(env);
  const sheets = new GoogleSheetsWriter();
  const listingCache = new Map<string, GestimListingRow | null>();
  const messageIdsToPersist: string[] = [];
  const extraIdPatterns = env.EXTRA_ID_REGEX
    ? env.EXTRA_ID_REGEX.split("|")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  try {
    const pending = list.filter((item) => item.id && !processed.has(item.id));
    const parsedMessages: Array<{ messageId: string; email: ParsedInboundEmail }> = [];
    const lookupIds = new Set<string>();

    for (const item of pending) {
      const detail = await getMessageDetail({
        accessToken: token,
        mailboxUser: env.MAILBOX_USER!,
        messageId: item.id!,
      });
      const email = graphMessageToParsedEmail(detail);
      parsedMessages.push({ messageId: item.id!, email });

      const extracted = extractExternalListingIds(email.textBody, email.htmlBody, {
        extraRegexStrings: extraIdPatterns,
      });
      const uniqueIds = [...new Set(extracted)];
      if (uniqueIds.length === 1) lookupIds.add(uniqueIds[0]!);
    }

    if (lookupIds.size > 0) {
      const preloaded = await listings.findLatestByExternalListingIds([...lookupIds]);
      for (const listingId of lookupIds) {
        listingCache.set(listingId, preloaded.get(listingId) ?? null);
      }
    }

    for (const item of parsedMessages) {
      const processedAt = new Date();
      try {
        await processInboundEmail(
          item.email,
          {
            env,
            listings,
            sheets,
            extraIdPatterns,
            listingCache,
            deferSheetFlush: true,
          },
          processedAt,
        );
        messageIdsToPersist.push(item.messageId);
        processed.add(item.messageId);
      } catch (e) {
        log.error({ err: e, messageId: item.messageId }, "Elaborazione messaggio fallita");
      }
    }

    await sheets.flush();
    await appendProcessedMessageIds({
      spreadsheetId: stateSpreadsheetId,
      sheetName: env.GRAPH_STATE_SHEET_NAME,
      messageIds: messageIdsToPersist,
    });
  } finally {
    sheets.clear();
    listingCache.clear();
    processed.clear();
    messageIdsToPersist.length = 0;
    if ("end" in listings && typeof listings.end === "function") {
      await listings.end();
    }
  }
}

async function main(): Promise<void> {
  log.info("Avvio worker Graph + lead");
  for (;;) {
    let sleepMinutes = 60;
    try {
      const env = await bootstrapEnv();
      sleepMinutes = env.WORKER_POLL_INTERVAL_MINUTES;
      await runCycle(env);
    } catch (e) {
      log.error({ err: e }, "Errore nel ciclo worker");
    }
    const ms = sleepMinutes * 60_000;
    log.info({ sleepMinutes }, "Pausa prima del prossimo ciclo");
    await sleep(ms);
  }
}

main().catch((e) => {
  log.fatal({ err: e }, "Worker terminato");
  process.exit(1);
});
