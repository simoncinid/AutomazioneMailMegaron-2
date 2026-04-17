import { logger } from "../logging/logger.js";
import { getSheetsClient } from "../sheets/sheetsClient.js";
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
    res = await sheets.spreadsheets.values.get({
      spreadsheetId: params.spreadsheetId,
      range,
    });
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
  const sheets = await getSheetsClient();
  const range = formatSheetRange(params.sheetName, "A:A");
  await sheets.spreadsheets.values.append({
    spreadsheetId: params.spreadsheetId,
    range,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [[params.messageId]] },
  });
}
