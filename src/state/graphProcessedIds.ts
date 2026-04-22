import { logger } from "../logging/logger.js";
import { getSheetsClient } from "../sheets/sheetsClient.js";
import { withGoogleSheetsRateLimit } from "../sheets/googleSheetsRateLimiter.js";
import { formatSheetRange } from "../sheets/sheetRange.js";

const log = logger.child({ module: "graphProcessedIds" });

/**
 * Traccia gli ID messaggio Graph già elaborati (deduplica tra run del worker).
 * Tab dedicata, colonna A = message id (un id per riga).
 */
export async function loadProcessedMessageIds(params: {
  spreadsheetId: string;
  sheetName: string;
}): Promise<Set<string>> {
  const sheets = await getSheetsClient();
  const range = formatSheetRange(params.sheetName, "A:A");
  let res;
  try {
    res = await withGoogleSheetsRateLimit(async () =>
      sheets.spreadsheets.values.get({
        spreadsheetId: params.spreadsheetId,
        range,
      }),
    );
  } catch (e) {
    log.warn(
      { err: e },
      "Impossibile leggere il foglio stato Graph (crea il tab o verifica permessi)",
    );
    return new Set();
  }
  const rows = res.data.values ?? [];
  const set = new Set<string>();
  for (const row of rows) {
    const id = String(row[0] ?? "").trim();
    if (id) set.add(id);
  }
  return set;
}

export async function appendProcessedMessageId(params: {
  spreadsheetId: string;
  sheetName: string;
  messageId: string;
}): Promise<void> {
  await appendProcessedMessageIds({
    spreadsheetId: params.spreadsheetId,
    sheetName: params.sheetName,
    messageIds: [params.messageId],
  });
}

export async function appendProcessedMessageIds(params: {
  spreadsheetId: string;
  sheetName: string;
  messageIds: string[];
}): Promise<void> {
  if (params.messageIds.length === 0) return;
  const sheets = await getSheetsClient();
  const range = formatSheetRange(params.sheetName, "A:A");
  await withGoogleSheetsRateLimit(async () =>
    sheets.spreadsheets.values.append({
      spreadsheetId: params.spreadsheetId,
      range,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: params.messageIds.map((messageId) => [messageId]) },
    }),
  );
}
