import type { ZoneSheetRule } from "../domain/types.js";
import { getSheetsClient } from "./sheetsClient.js";
import { formatSheetRange } from "./sheetRange.js";

export interface LoadZoneMappingOptions {
  spreadsheetId: string;
  /** Nome tab (es. "mapping") — colonne A=zona, B=nome foglio destinazione, senza riga header */
  sheetName: string;
  /** Come confrontare la colonna A con la zona dell'annuncio */
  matchMode: "contains" | "equals";
}

/**
 * Legge righe A:B dal foglio configurazione: colonna A = testo zona (keyword),
 * colonna B = nome del tab nel *medesimo* spreadsheet dove appendere i lead.
 */
export async function loadZoneMappingFromSheet(
  options: LoadZoneMappingOptions,
): Promise<ZoneSheetRule[]> {
  const sheets = await getSheetsClient();
  const range = formatSheetRange(options.sheetName, "A:B");
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: options.spreadsheetId,
    range,
  });
  const rows = res.data.values ?? [];
  const rules: ZoneSheetRule[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 2) continue;
    const zoneCell = String(row[0] ?? "").trim();
    const sheetTitle = String(row[1] ?? "").trim();
    if (!zoneCell || !sheetTitle) continue;
    rules.push({
      name: `mapping_row_${i + 1}`,
      pattern: zoneCell,
      match: options.matchMode,
      spreadsheetId: options.spreadsheetId,
      sheetTitle,
    });
  }
  return rules;
}
