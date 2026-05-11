import type {
  LeadRowPayload,
  NoIdRowPayload,
} from "../domain/types.js";
import { logger } from "../logging/logger.js";
import type { sheets_v4 } from "googleapis";
import { getSheetsClient } from "./sheetsClient.js";
import { withGoogleSheetsRateLimit } from "./googleSheetsRateLimiter.js";
import { formatSheetRange } from "./sheetRange.js";

export { formatSheetRange } from "./sheetRange.js";

/**
 * Due tipi di riga gestiti, allineati al test Python `test_imap_aruba.py`:
 *  - "lead"     => A:J  (email, ID, data, telefono, zona, nome, cognome, stato, I, provincia)
 *  - "no-id"    => A:I  (data, ora, mittente, corpo, nome, cognome, email, telefono, stato)
 */
export const LEAD_SHEET_COLUMNS = [
  "Email",
  "ID annuncio",
  "Data assegnazione",
  "Telefono",
  "Zona",
  "Nome",
  "Cognome",
  "Stato",
  "Extra I",
  "Provincia",
] as const;

export const NO_ID_SHEET_COLUMNS = [
  "Data",
  "Ora",
  "Mittente",
  "Corpo mail",
  "Nome",
  "Cognome",
  "Email",
  "Telefono",
  "Stato",
] as const;

type RowKind = "lead" | "no-id";

interface QueueEntry {
  kind: RowKind;
  values: (string | number)[];
}

interface TouchedSheet {
  spreadsheetId: string;
  sheetTitle: string;
  minEndColumnIndex: number;
}

const RANGE_BY_KIND: Record<RowKind, string> = {
  lead: "A:J",
  "no-id": "A:I",
};

const END_COLUMN_INDEX_BY_KIND: Record<RowKind, number> = {
  lead: LEAD_SHEET_COLUMNS.length,
  "no-id": NO_ID_SHEET_COLUMNS.length,
};

const DEFAULT_STATO = "Da Chiamare";
const log = logger.child({ module: "googleSheetsWriter" });

/**
 * Riempie la colonna A (lead.email) anche se vuota: senza placeholder le righe
 * sembrano "iniziare da B". Default: "—". Per A vera-vera vuota: env
 * `SHEET_PLACEHOLDER_EMPTY_LEAD_EMAIL=""`.
 */
function emailCellOrPlaceholder(value: string): string {
  const s = (value ?? "").trim();
  if (s) return s;
  if ("SHEET_PLACEHOLDER_EMPTY_LEAD_EMAIL" in process.env) {
    return (process.env.SHEET_PLACEHOLDER_EMPTY_LEAD_EMAIL ?? "").trim();
  }
  return "—";
}

function rowFromLead(p: LeadRowPayload): (string | number)[] {
  const province = (p.province ?? "").trim();
  return [
    emailCellOrPlaceholder(p.leadEmail),
    p.listingId,
    p.assignmentDate,
    p.phone,
    p.zone,
    p.nome,
    p.cognome,
    DEFAULT_STATO,
    "",
    province,
  ];
}

function rowFromNoId(p: NoIdRowPayload): (string | number)[] {
  return [
    p.dataMail,
    p.oraMail,
    p.mittente,
    p.corpoMail,
    p.nome,
    p.cognome,
    p.leadEmail,
    p.phone,
    DEFAULT_STATO,
  ];
}

function bufferKey(spreadsheetId: string, sheetTitle: string, kind: RowKind): string {
  return `${spreadsheetId}::${sheetTitle}::${kind}`;
}

export class GoogleSheetsWriter {
  private bufferedRows = new Map<string, QueueEntry[]>();

  queueLead(payload: LeadRowPayload): void {
    this.queue(payload.spreadsheetId, payload.sheetTitle, "lead", rowFromLead(payload));
  }

  queueNoId(payload: NoIdRowPayload): void {
    this.queue(payload.spreadsheetId, payload.sheetTitle, "no-id", rowFromNoId(payload));
  }

  async appendLead(payload: LeadRowPayload): Promise<void> {
    this.queueLead(payload);
    await this.flush();
  }

  async appendNoId(payload: NoIdRowPayload): Promise<void> {
    this.queueNoId(payload);
    await this.flush();
  }

  async flush(): Promise<void> {
    if (this.bufferedRows.size === 0) return;
    const sheets = await getSheetsClient();
    const touched = new Map<string, TouchedSheet>();

    for (const [key, entries] of this.bufferedRows) {
      if (entries.length === 0) continue;
      const [spreadsheetId, sheetTitle, kind] = key.split("::") as [string, string, RowKind];
      const touchedKey = `${spreadsheetId}::${sheetTitle}`;
      const currentTouched = touched.get(touchedKey);
      const minEndColumnIndex = END_COLUMN_INDEX_BY_KIND[kind];
      if (currentTouched) {
        currentTouched.minEndColumnIndex = Math.max(
          currentTouched.minEndColumnIndex,
          minEndColumnIndex,
        );
      } else {
        touched.set(touchedKey, { spreadsheetId, sheetTitle, minEndColumnIndex });
      }

      if (kind === "lead") {
        await this.writeLeadRowsWithFixedColumns(
          sheets,
          spreadsheetId,
          sheetTitle,
          entries.map((e) => e.values),
        );
        continue;
      }

      const range = formatSheetRange(sheetTitle, RANGE_BY_KIND[kind]);
      await withGoogleSheetsRateLimit(async () =>
        sheets.spreadsheets.values.append({
          spreadsheetId,
          range,
          valueInputOption: "USER_ENTERED",
          insertDataOption: "INSERT_ROWS",
          requestBody: { values: entries.map((e) => e.values) },
        }),
      );
    }

    if (touched.size > 0) {
      await this.syncBasicFilterRange(sheets, [...touched.values()]);
    }
    this.clear();
  }

  clear(): void {
    this.bufferedRows.clear();
  }

  private queue(
    spreadsheetId: string,
    sheetTitle: string,
    kind: RowKind,
    values: (string | number)[],
  ): void {
    const key = bufferKey(spreadsheetId, sheetTitle, kind);
    const arr = this.bufferedRows.get(key) ?? [];
    arr.push({ kind, values });
    this.bufferedRows.set(key, arr);
  }

  private async writeLeadRowsWithFixedColumns(
    sheets: sheets_v4.Sheets,
    spreadsheetId: string,
    sheetTitle: string,
    rows: (string | number)[][],
  ): Promise<void> {
    const readRange = formatSheetRange(sheetTitle, "A:J");
    const readRes = await withGoogleSheetsRateLimit(async () =>
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: readRange,
      }),
    );
    const existingRows = readRes.data.values?.length ?? 0;
    const nextRow = Math.max(2, existingRows + 1);
    const endRow = nextRow + rows.length - 1;
    await this.ensureRowCapacity(sheets, spreadsheetId, sheetTitle, endRow);
    const writeRange = formatSheetRange(sheetTitle, `A${nextRow}:J${endRow}`);

    await withGoogleSheetsRateLimit(async () =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: writeRange,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: rows },
      }),
    );
  }

  private async ensureRowCapacity(
    sheets: sheets_v4.Sheets,
    spreadsheetId: string,
    sheetTitle: string,
    requiredRowCount: number,
  ): Promise<void> {
    const meta = await withGoogleSheetsRateLimit(async () =>
      sheets.spreadsheets.get({
        spreadsheetId,
        fields: "sheets(properties(sheetId,title,gridProperties(rowCount)))",
      }),
    );
    const target = (meta.data.sheets ?? []).find((s) => s.properties?.title === sheetTitle);
    const sheetId = target?.properties?.sheetId;
    const rowCount = target?.properties?.gridProperties?.rowCount ?? 0;
    if (sheetId == null) {
      throw new Error(`Foglio non trovato: ${sheetTitle}`);
    }
    if (rowCount >= requiredRowCount) return;

    const rowsToAppend = requiredRowCount - rowCount;
    await withGoogleSheetsRateLimit(async () =>
      sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              appendDimension: {
                sheetId,
                dimension: "ROWS",
                length: rowsToAppend,
              },
            },
          ],
        },
      }),
    );
  }

  private async syncBasicFilterRange(
    sheets: sheets_v4.Sheets,
    touchedSheets: TouchedSheet[],
  ): Promise<void> {
    const bySpreadsheet = new Map<string, TouchedSheet[]>();
    for (const target of touchedSheets) {
      const arr = bySpreadsheet.get(target.spreadsheetId) ?? [];
      arr.push(target);
      bySpreadsheet.set(target.spreadsheetId, arr);
    }

    for (const [spreadsheetId, targets] of bySpreadsheet) {
      try {
        const meta = await withGoogleSheetsRateLimit(async () =>
          sheets.spreadsheets.get({
            spreadsheetId,
            fields: "sheets(properties(sheetId,title),basicFilter)",
          }),
        );
        const allSheets = meta.data.sheets ?? [];
        const byTitle = new Map<string, sheets_v4.Schema$Sheet>();
        for (const sheet of allSheets) {
          const title = sheet.properties?.title;
          if (title) byTitle.set(title, sheet);
        }

        const requests: sheets_v4.Schema$Request[] = [];
        for (const target of targets) {
          const sheet = byTitle.get(target.sheetTitle);
          const basic = sheet?.basicFilter;
          const sheetId = sheet?.properties?.sheetId;
          const currentRange = basic?.range;
          if (sheetId == null || !basic || !currentRange) continue;

          const currentEndColumnIndex = currentRange.endColumnIndex ?? 0;
          const nextEndColumnIndex = Math.max(
            currentEndColumnIndex,
            target.minEndColumnIndex,
          );
          const nextRange: sheets_v4.Schema$GridRange = {
            ...currentRange,
            sheetId,
            endColumnIndex: nextEndColumnIndex,
          };
          // Manteniamo il filtro "aperto" in basso così include automaticamente
          // le nuove righe appendate in futuro.
          delete nextRange.endRowIndex;

          const hasSameColumnCoverage = nextEndColumnIndex === currentEndColumnIndex;
          const isAlreadyOpenRows = currentRange.endRowIndex == null;
          if (hasSameColumnCoverage && isAlreadyOpenRows) continue;

          requests.push({
            setBasicFilter: {
              filter: {
                range: nextRange,
                criteria: basic.criteria,
                filterSpecs: basic.filterSpecs,
                sortSpecs: basic.sortSpecs,
              },
            },
          });
        }

        if (requests.length > 0) {
          await withGoogleSheetsRateLimit(async () =>
            sheets.spreadsheets.batchUpdate({
              spreadsheetId,
              requestBody: { requests },
            }),
          );
        }
      } catch (error) {
        log.warn(
          { err: error, spreadsheetId },
          "Impossibile aggiornare il range del filtro base; append completato comunque",
        );
      }
    }
  }
}
