import "dotenv/config";

/**
 * Worker Render: polling periodico della posta in arrivo via IMAP Aruba.
 */
import { bootstrapEnv, type AppEnv } from "./config/loadEnv.js";
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
import { listInboxMessagesFromImap } from "./imap/imapAruba.js";

const log = logger.child({ module: "worker" });

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function requireImapEnv(env: AppEnv): void {
  if (!env.IMAP_EMAIL || !env.IMAP_PASSWORD) {
    throw new Error(
      "Worker IMAP: impostare IMAP_EMAIL e IMAP_PASSWORD (server Aruba di default: imaps.aruba.it:993)",
    );
  }
}

async function runCycle(env: AppEnv): Promise<void> {
  requireImapEnv(env);
  const stateSpreadsheetId =
    env.GRAPH_STATE_SPREADSHEET_ID ?? env.defaultSpreadsheetIdResolved;
  const processed = await loadProcessedMessageIds({
    spreadsheetId: stateSpreadsheetId,
    sheetName: env.GRAPH_STATE_SHEET_NAME,
  });

  const list = await listInboxMessagesFromImap({
    host: env.IMAP_SERVER,
    port: env.IMAP_PORT,
    user: env.IMAP_EMAIL!,
    password: env.IMAP_PASSWORD!,
    secure: env.IMAP_SECURE,
    lookbackHours: env.IMAP_LOOKBACK_HOURS,
    limit: env.IMAP_FETCH_LIMIT,
  });

  log.info(
    { count: list.length, mailbox: env.IMAP_EMAIL, host: env.IMAP_SERVER },
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
    const pending = list.filter((email) => email.messageId && !processed.has(email.messageId));
    const parsedMessages: Array<{ messageId: string; email: ParsedInboundEmail }> = [];
    const lookupIds = new Set<string>();

    for (const email of pending) {
      parsedMessages.push({ messageId: email.messageId!, email });

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
  log.info("Avvio worker IMAP Aruba + lead");
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
