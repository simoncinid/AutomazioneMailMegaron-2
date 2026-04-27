import type {
  LeadRowPayload,
  MultiIdRowPayload,
  NoIdRowPayload,
} from "../domain/types.js";
import { getSheetsClient } from "./sheetsClient.js";
import { withGoogleSheetsRateLimit } from "./googleSheetsRateLimiter.js";
import { formatSheetRange } from "./sheetRange.js";

export { formatSheetRange } from "./sheetRange.js";

/**
 * Tre tipi di riga gestiti, allineati al test Python `test_imap_aruba.py`:
 *  - "lead"     => A:G  (email, ID, data, telefono, zona, nome, cognome)
 *  - "no-id"    => A:H  (data, ora, mittente, corpo, nome, cognome, email, telefono)
 *  - "multi-id" => A:I  (data, ora, mittente, corpo, nome, cognome, email, telefono, listaID)
 */
export const LEAD_SHEET_COLUMNS = [
  "Email",
  "ID annuncio",
  "Data assegnazione",
  "Telefono",
  "Zona",
  "Nome",
  "Cognome",
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
] as const;

export const MULTI_ID_SHEET_COLUMNS = [
  "Data",
  "Ora",
  "Mittente",
  "Corpo mail",
  "Nome",
  "Cognome",
  "Email",
  "Telefono",
  "Lista ID trovati",
] as const;

type RowKind = "lead" | "no-id" | "multi-id";

interface QueueEntry {
  kind: RowKind;
  values: (string | number)[];
}

const RANGE_BY_KIND: Record<RowKind, string> = {
  lead: "A:G",
  "no-id": "A:H",
  "multi-id": "A:I",
};

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
  return [
    emailCellOrPlaceholder(p.leadEmail),
    p.listingId,
    p.assignmentDate,
    p.phone,
    p.zone,
    p.nome,
    p.cognome,
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
  ];
}

function rowFromMultiId(p: MultiIdRowPayload): (string | number)[] {
  return [
    p.dataMail,
    p.oraMail,
    p.mittente,
    p.corpoMail,
    p.nome,
    p.cognome,
    p.leadEmail,
    p.phone,
    p.listaId,
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

  queueMultiId(payload: MultiIdRowPayload): void {
    this.queue(payload.spreadsheetId, payload.sheetTitle, "multi-id", rowFromMultiId(payload));
  }

  async appendLead(payload: LeadRowPayload): Promise<void> {
    this.queueLead(payload);
    await this.flush();
  }

  async appendNoId(payload: NoIdRowPayload): Promise<void> {
    this.queueNoId(payload);
    await this.flush();
  }

  async appendMultiId(payload: MultiIdRowPayload): Promise<void> {
    this.queueMultiId(payload);
    await this.flush();
  }

  async flush(): Promise<void> {
    if (this.bufferedRows.size === 0) return;
    const sheets = await getSheetsClient();

    for (const [key, entries] of this.bufferedRows) {
      if (entries.length === 0) continue;
      const [spreadsheetId, sheetTitle, kind] = key.split("::") as [string, string, RowKind];
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
}
