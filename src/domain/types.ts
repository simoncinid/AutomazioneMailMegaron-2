/**
 * Tipi di dominio condivisi.
 * Stack: Node.js 20+, TypeScript, Express (webhook), worker Graph, PostgreSQL o API REST per gli annunci.
 */

export interface GestimListingRow {
  externalListingId: string;
  title: string | null;
  city: string | null;
  zone: string | null;
  address: string | null;
  price: string | number | null;
  propertyType: string | null;
  contractType: string | null;
  surfaceM2: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  updatedAt: Date | null;
}

/** Email normalizzata in ingresso al pipeline (indipendente dal provider). */
export interface ParsedInboundEmail {
  messageId?: string;
  from: string;
  /** Nome visualizzato da Graph / header */
  fromDisplayName?: string;
  to?: string;
  subject: string;
  receivedAt: Date;
  textBody: string;
  htmlBody?: string;
}

/** Riga da appendere nel foglio lead (7 colonne operative A:G). */
export interface LeadRowPayload {
  leadEmail: string;
  listingId: string;
  assignmentDate: string;
  phone: string;
  zone: string;
  nome: string;
  cognome: string;
  spreadsheetId: string;
  sheetTitle: string;
}

/**
 * Riga diagnostica per `no-id-trovato` (8 colonne A:H):
 * data, ora, mittente, corpo, nome, cognome, email_lead, telefono.
 */
export interface NoIdRowPayload {
  dataMail: string;
  oraMail: string;
  mittente: string;
  corpoMail: string;
  nome: string;
  cognome: string;
  leadEmail: string;
  phone: string;
  spreadsheetId: string;
  sheetTitle: string;
}

/**
 * Riga diagnostica per `no-singolo-id` (9 colonne A:I):
 * data, ora, mittente, corpo, nome, cognome, email_lead, telefono, lista_id.
 */
export interface MultiIdRowPayload {
  dataMail: string;
  oraMail: string;
  mittente: string;
  corpoMail: string;
  nome: string;
  cognome: string;
  leadEmail: string;
  phone: string;
  /** Lista ID separati da virgola. */
  listaId: string;
  spreadsheetId: string;
  sheetTitle: string;
}

export type ZoneMatchMode = "contains" | "equals" | "regex";

export interface ZoneSheetRule {
  /** Etichetta per log (opzionale). */
  name?: string;
  pattern: string;
  match: ZoneMatchMode;
  spreadsheetId: string;
  sheetTitle: string;
}

export interface ResolvedSheetTarget {
  spreadsheetId: string;
  sheetTitle: string;
  matchedRule: ZoneSheetRule | null;
  fallback: boolean;
}
