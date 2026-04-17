import type { LeadRowPayload } from "../domain/types.js";
import { getSheetsClient } from "./sheetsClient.js";
import { formatSheetRange } from "./sheetRange.js";

export { formatSheetRange } from "./sheetRange.js";

/** Intestazione logica delle colonne (solo documentazione; il foglio può avere riga header manuale). */
export const LEAD_SHEET_COLUMNS = [
  "Data",
  "Nome e Cognome",
  "Telefono",
  "Riferimento immobile",
  "Tempo da invio mail",
] as const;

function rowFromPayload(p: LeadRowPayload): (string | number)[] {
  return [
    p.dataIt,
    p.nomeCognome,
    p.telefono,
    p.riferimentoImmobile,
    p.tempoDaInvioMail,
  ];
}

export class GoogleSheetsWriter {
  async appendLead(payload: LeadRowPayload): Promise<void> {
    const sheets = await getSheetsClient();
    const range = formatSheetRange(payload.sheetTitle);
    const values = [rowFromPayload(payload)];
    await sheets.spreadsheets.values.append({
      spreadsheetId: payload.spreadsheetId,
      range,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values },
    });
  }
}
