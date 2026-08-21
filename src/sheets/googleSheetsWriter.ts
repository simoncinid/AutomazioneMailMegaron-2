import type {
  LeadRowPayload,
  NoIdRowPayload,
} from "../domain/types.js";
import { logger } from "../logging/logger.js";
import type { sheets_v4 } from "googleapis";
import { withGoogleSheetsOperation } from "./googleSheetsOperation.js";
import { formatSheetRange } from "./sheetRange.js";

export { formatSheetRange } from "./sheetRange.js";

/**
 * Due tipi di riga gestiti, allineati al test Python `test_imap_aruba.py`:
 *  - "lead"     => A:J  (email, ID, data, telefono, zona, nome, cognome, stato, I, provincia)
 *  - "no-id"    => A:L  (A:J come lead + K:L data, ora)
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
  "EMAIL",
  "ID ANNUNCIO",
  "DATA ASSEGNAZIONE",
  "NUMERO TELEFONO",
  "ZONA",
  "NOME",
  "COGNOME",
  "Stato Contatto",
  "Ultimo Update Stato",
  "provincia",
  "data",
  "ora",
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
  "no-id": "A:L",
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
    emailCellOrPlaceholder(""),
    p.listingId,
    p.assignmentDate,
    p.phone,
    "",
    p.nome,
    "",
    DEFAULT_STATO,
    "",
    "",
    p.dataMail,
    p.oraMail,
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

      await this.appendRowsStartingAtColA(
        spreadsheetId,
        sheetTitle,
        entries.map((e) => e.values),
      );
      this.bufferedRows.delete(key);
    }

    if (touched.size > 0) {
      await this.syncBasicFilterRange([...touched.values()]);
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

  /**
   * Scrive in coda partendo sempre dalla colonna A, alla prima riga vuota dopo l'ultima data (col. C).
   * appendCells / values.append possono inserire in mezzo al foglio se la "tabella" rilevata è sbagliata.
   */
  private async appendRowsStartingAtColA(
    spreadsheetId: string,
    sheetTitle: string,
    rows: (string | number)[][],
  ): Promise<void> {
    if (rows.length === 0) return;

    const startRow = await this.resolveNextAppendRow(spreadsheetId, sheetTitle);
    const range = formatSheetRange(sheetTitle, `A${startRow}`);

    await withGoogleSheetsOperation(
      (sheets) =>
        sheets.spreadsheets.values.update({
          spreadsheetId,
          range,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: rows },
        }),
      { spreadsheetId, sheetTitle, range, operation: "values.update.appendAtEnd" },
    );
  }

  /** Ultima riga con data in col. C (header escluso) + 1. */
  private async resolveNextAppendRow(
    spreadsheetId: string,
    sheetTitle: string,
  ): Promise<number> {
    const range = formatSheetRange(sheetTitle, "C:C");
    const readRes = await withGoogleSheetsOperation(
      (sheets) =>
        sheets.spreadsheets.values.get({
          spreadsheetId,
          range,
        }),
      { spreadsheetId, sheetTitle, range, operation: "values.get.lastDataRow" },
    );
    const values = readRes.data.values ?? [];
    // Riga 1 = header; values.length è l'ultima riga occupata in C (1-based).
    return Math.max(values.length + 1, 2);
  }

  private async syncBasicFilterRange(touchedSheets: TouchedSheet[]): Promise<void> {
    const bySpreadsheet = new Map<string, TouchedSheet[]>();
    for (const target of touchedSheets) {
      const arr = bySpreadsheet.get(target.spreadsheetId) ?? [];
      arr.push(target);
      bySpreadsheet.set(target.spreadsheetId, arr);
    }

    for (const [spreadsheetId, targets] of bySpreadsheet) {
      try {
        const meta = await withGoogleSheetsOperation((sheets) =>
          sheets.spreadsheets.get({
            spreadsheetId,
            fields: "sheets(properties(sheetId,title),basicFilter)",
          }),
          { spreadsheetId, operation: "spreadsheets.get.basicFilter" },
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
          const hasSortSpecs = (basic.sortSpecs?.length ?? 0) > 0;
          if (hasSameColumnCoverage && isAlreadyOpenRows && !hasSortSpecs) continue;

          // sortSpecs omesso: evita vista filtrata ordinata diversamente dalle righe fisiche.
          requests.push({
            setBasicFilter: {
              filter: {
                range: nextRange,
                criteria: basic.criteria,
                filterSpecs: basic.filterSpecs,
              },
            },
          });
        }

        if (requests.length > 0) {
          await withGoogleSheetsOperation((sheets) =>
            sheets.spreadsheets.batchUpdate({
              spreadsheetId,
              requestBody: { requests },
            }),
            { spreadsheetId, operation: "spreadsheets.batchUpdate.basicFilter" },
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
