/**
 * Tipi di dominio condivisi.
 * Stack: Node.js 20+, TypeScript, Express (webhook), worker Graph, PostgreSQL o API REST per gli annunci.
 */

export interface GestimListingRow {
  externalListingId: string;
  title: string | null;
  city: string | null;
  province?: string | null;
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

/** Riga da appendere nel foglio lead (10 colonne operative A:J, con provincia in J). */
export interface LeadRowPayload {
  leadEmail: string;
  listingId: string;
  assignmentDate: string;
  phone: string;
  zone: string;
  /** Provincia annuncio (scritta in colonna J dei fogli lead). */
  province?: string;
  nome: string;
  cognome: string;
  spreadsheetId: string;
  sheetTitle: string;
}

/**
 * Riga per `no-id-trovato` allineata ai tab lead:
 * A:J come i lead (alcune colonne forzate vuote) + extra diagnostiche K:L (data, ora).
 */
export interface NoIdRowPayload {
  leadEmail: string;
  listingId: string;
  assignmentDate: string;
  phone: string;
  zone: string;
  /** Sempre vuota per no-id-trovato, mantenuta per allineamento colonne. */
  province?: string;
  nome: string;
  cognome: string;
  dataMail: string;
  oraMail: string;
  /** Non usato in output tabellare (mantenuto per compatibilità chiamanti). */
  corpoMail: string;
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
  resolutionSource?: "disambiguation" | "mapping_rule" | "default_fallback";
  disambiguationHint?: string;
}
