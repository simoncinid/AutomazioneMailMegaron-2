import "dotenv/config";

/**
 * Worker Render: ciclo di polling IMAP Aruba allineato a `test_imap_aruba.py`.
 *
 * - Finestra `SINCE` configurabile in giorni (`IMAP_LOOKBACK_DAYS`, default 7).
 * - Per ogni mail: estrae i campi via OpenAI, scrive su Google Sheets (lead A:G,
 *   diagnostiche A:H/A:I), aggiorna il cooldown 6 mesi sui tab lead.
 * - Logging: STDOUT contiene SOLO il blocco "campi OpenAI" per ciascuna mail
 *   (nome / cognome / email / id_annuncio); tutto il resto (setup, decisioni di
 *   routing, errori) finisce su STDERR via pino.
 */
import { bootstrapEnv, type AppEnv } from "./config/loadEnv.js";
import { logger } from "./logging/logger.js";
import { createListingRepository } from "./repositories/createListingRepository.js";
import type { GestimListingRow } from "./domain/types.js";
import { GoogleSheetsWriter } from "./sheets/googleSheetsWriter.js";
import { LeadAssignmentCooldown } from "./services/leadAssignmentCooldown.js";
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

  log.info(
    {
      mailbox: env.IMAP_EMAIL,
      host: env.IMAP_SERVER,
      lookbackDays: env.IMAP_LOOKBACK_DAYS,
      limit: env.IMAP_FETCH_LIMIT,
    },
    "Avvio ciclo IMAP",
  );

  const list = await listInboxMessagesFromImap({
    host: env.IMAP_SERVER,
    port: env.IMAP_PORT,
    user: env.IMAP_EMAIL!,
    password: env.IMAP_PASSWORD!,
    secure: env.IMAP_SECURE,
    lookbackDays: env.IMAP_LOOKBACK_DAYS,
    limit: env.IMAP_FETCH_LIMIT,
  });

  log.info({ count: list.length }, "Messaggi inbox da elaborare");

  const listings = createListingRepository(env);
  const sheets = new GoogleSheetsWriter();
  const assignmentCooldown = new LeadAssignmentCooldown(env);
  const listingCache = new Map<string, GestimListingRow | null>();
  const extraIdPatterns = env.EXTRA_ID_REGEX
    ? env.EXTRA_ID_REGEX.split("|")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  try {
    // Mirror del test Python: percorre i messaggi più recenti per primi.
    const pending = [...list].reverse();

    // Pre-warm cache annunci per il caso ID singolo (riduce latenza DB nel ciclo).
    const lookupIds = new Set<string>();
    for (const email of pending) {
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

    const total = pending.length;
    let index = 0;
    for (const email of pending) {
      index += 1;
      const processedAt = new Date();
      try {
        await processInboundEmail(
          email,
          {
            env,
            listings,
            sheets,
            assignmentCooldown,
            extraIdPatterns,
            listingCache,
            deferSheetFlush: true,
          },
          processedAt,
          { index, total },
        );
      } catch (e) {
        log.error({ err: e, messageId: email.messageId }, "Elaborazione messaggio fallita");
      }
    }

    await sheets.flush();
  } finally {
    sheets.clear();
    listingCache.clear();
    if ("end" in listings && typeof listings.end === "function") {
      await listings.end();
    }
  }
}

async function main(): Promise<void> {
  log.info("Avvio worker IMAP Aruba + lead (allineato a test_imap_aruba.py)");
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
