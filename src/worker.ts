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
import {
  appendProcessedMessageId,
  loadProcessedMessageIds,
} from "./state/graphProcessedIds.js";
import { GoogleSheetsWriter } from "./sheets/googleSheetsWriter.js";
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
  const extraIdPatterns = env.EXTRA_ID_REGEX
    ? env.EXTRA_ID_REGEX.split("|")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  for (const item of list) {
    if (!item.id || processed.has(item.id)) continue;

    const detail = await getMessageDetail({
      accessToken: token,
      mailboxUser: env.MAILBOX_USER!,
      messageId: item.id,
    });
    const email = graphMessageToParsedEmail(detail);
    const processedAt = new Date();

    try {
      await processInboundEmail(
        email,
        { env, listings, sheets, extraIdPatterns },
        processedAt,
      );
      await appendProcessedMessageId({
        spreadsheetId: stateSpreadsheetId,
        sheetName: env.GRAPH_STATE_SHEET_NAME,
        messageId: item.id,
      });
      processed.add(item.id);
    } catch (e) {
      log.error({ err: e, messageId: item.id }, "Elaborazione messaggio fallita");
    }
  }
}

async function main(): Promise<void> {
  log.info("Avvio worker Graph + lead");
  for (;;) {
    const env = await bootstrapEnv();
    try {
      await runCycle(env);
    } catch (e) {
      log.error({ err: e }, "Errore nel ciclo worker");
    }
    const ms = env.WORKER_POLL_INTERVAL_MINUTES * 60_000;
    log.info({ sleepMinutes: env.WORKER_POLL_INTERVAL_MINUTES }, "Pausa prima del prossimo ciclo");
    await sleep(ms);
  }
}

main().catch((e) => {
  log.fatal({ err: e }, "Worker terminato");
  process.exit(1);
});
