import type { LeadRowPayload } from "../domain/types.js";
import { getSheetsClient } from "./sheetsClient.js";
import { withGoogleSheetsRateLimit } from "./googleSheetsRateLimiter.js";
import { formatSheetRange } from "./sheetRange.js";

export { formatSheetRange } from "./sheetRange.js";

/** Intestazione logica delle colonne (solo documentazione; il foglio può avere riga header manuale). */
export const LEAD_SHEET_COLUMNS = [
  "Email",
  "ID annuncio",
  "Data assegnazione",
  "Telefono",
  "Zona",
] as const;

function rowFromPayload(p: LeadRowPayload): (string | number)[] {
  return [p.leadEmail, p.listingId, p.assignmentDate, p.phone, p.zone];
}

export class GoogleSheetsWriter {
  private bufferedRows = new Map<string, (string | number)[][]>();

  queueLead(payload: LeadRowPayload): void {
    const key = `${payload.spreadsheetId}::${payload.sheetTitle}`;
    const values = this.bufferedRows.get(key) ?? [];
    values.push(rowFromPayload(payload));
    this.bufferedRows.set(key, values);
  }

  async appendLead(payload: LeadRowPayload): Promise<void> {
    this.queueLead(payload);
    await this.flush();
  }

  async flush(): Promise<void> {
    if (this.bufferedRows.size === 0) return;

    const sheets = await getSheetsClient();
    for (const [key, values] of this.bufferedRows) {
      if (values.length === 0) continue;
      const sep = key.indexOf("::");
      const spreadsheetId = key.slice(0, sep);
      const sheetTitle = key.slice(sep + 2);
      const range = formatSheetRange(sheetTitle);
      await withGoogleSheetsRateLimit(async () =>
        sheets.spreadsheets.values.append({
          spreadsheetId,
          range,
          valueInputOption: "USER_ENTERED",
          insertDataOption: "INSERT_ROWS",
          requestBody: { values },
        }),
      );
    }
    this.clear();
  }

  clear(): void {
    this.bufferedRows.clear();
  }
}
