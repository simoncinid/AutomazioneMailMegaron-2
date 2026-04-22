import { z } from "zod";
import type { ZoneSheetRule } from "../domain/types.js";
import { hasDatabaseConnection } from "./pgPool.js";
import { logger } from "../logging/logger.js";
import { loadZoneMappingFromSheet } from "../sheets/loadZoneMappingFromSheet.js";

const zoneRuleSchema = z.object({
  name: z.string().optional(),
  pattern: z.string().min(1),
  match: z.enum(["contains", "equals", "regex"]),
  spreadsheetId: z.string().min(1),
  sheetTitle: z.string().min(1),
});

export const rawEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.string().optional(),

  /** Dettagli annunci: da tabella `gestim_listings` (consigliato) oppure API HTTP legacy. */
  LISTING_SOURCE: z.enum(["api", "database"]).default("database"),
  /** Obbligatorio solo se LISTING_SOURCE=api */
  GESTIM_API_BASE_URL: z.string().url().optional(),
  /** Connessione PostgreSQL: una tra DATABASE_URL oppure DB_HOST + DB_USER + DB_PASSWORD + DB_NAME */
  DATABASE_URL: z.string().optional(),
  DB_HOST: z.string().optional(),
  DB_PORT: z.coerce.number().optional(),
  DB_USER: z.string().optional(),
  DB_PASSWORD: z.string().optional(),
  DB_NAME: z.string().optional(),
  /** "true" / "1" abilita TLS senza PEM dedicato (solo se TLS_CERT non è impostato) */
  DB_SSL: z
    .string()
    .optional()
    .transform((s) => s === "true" || s === "1"),
  /** PEM della CA (o catena) per verificare il certificato del server; supporta `\n` letterali */
  TLS_CERT: z.string().optional(),

  /** Alternativa al foglio "mapping": regole JSON */
  ZONE_SHEET_MAP_JSON: z.string().default("[]"),

  /** Se impostato, colonne A–B del tab leggono zona → nome foglio (stesso file). */
  MAPPING_SPREADSHEET_ID: z.string().optional(),
  MAPPING_SHEET_NAME: z.string().default("mapping"),
  MAPPING_ZONE_MATCH: z.enum(["contains", "equals"]).default("contains"),

  /** Obbligatorio se non usi solo MAPPING_SPREADSHEET_ID (viene defaultato al mapping file). */
  DEFAULT_SPREADSHEET_ID: z.string().optional(),
  DEFAULT_SHEET_TITLE: z.string().min(1),

  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),

  UNMAPPED_ZONE_SPREADSHEET_ID: z.string().optional(),
  UNMAPPED_ZONE_SHEET_TITLE: z.string().optional(),
  NO_ID_FOUND_SHEET_TITLE: z.string().default("no-id-trovato"),
  MULTI_ID_FOUND_SHEET_TITLE: z.string().default("no-singolo-id"),
  BLOCKED_EMAIL_SUBSTRINGS: z.string().default(
    "immobiliare,noreply,no-reply,idealista,gruppoinsieme,mailer-daemon",
  ),

  EXTRA_ID_REGEX: z.string().optional(),

  /** Microsoft Graph (worker posta in arrivo) */
  GRAPH_TENANT_ID: z.string().optional(),
  GRAPH_CLIENT_ID: z.string().optional(),
  GRAPH_CLIENT_SECRET: z.string().optional(),
  /** UPN o indirizzo della casella da leggere (es. megaron@...) */
  MAILBOX_USER: z.string().optional(),

  WORKER_POLL_INTERVAL_MINUTES: z.coerce.number().min(5).default(60),
  GRAPH_LOOKBACK_HOURS: z.coerce.number().min(1).default(24),
  /** Dove memorizzare gli id messaggio già processati (stesso file dei lead se omesso). */
  GRAPH_STATE_SPREADSHEET_ID: z.string().optional(),
  GRAPH_STATE_SHEET_NAME: z.string().default("_graph_processed"),
});

export type RawEnv = z.infer<typeof rawEnvSchema>;

export type AppEnv = RawEnv & {
  zoneSheetRules: ZoneSheetRule[];
  /** Sempre valorizzato dopo bootstrap */
  defaultSpreadsheetIdResolved: string;
};

function parseZoneMapJson(json: string): ZoneSheetRule[] {
  const raw = JSON.parse(json) as unknown;
  const arr = z.array(zoneRuleSchema).parse(raw);
  return arr;
}

function validateGoogleCreds(r: RawEnv): void {
  if (!r.GOOGLE_APPLICATION_CREDENTIALS && !r.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error(
      "Impostare GOOGLE_APPLICATION_CREDENTIALS (path) oppure GOOGLE_SERVICE_ACCOUNT_JSON",
    );
  }
}

/**
 * Legge env e costruisce `zoneSheetRules` da JSON o dal foglio Google "mapping".
 */
export async function bootstrapEnv(): Promise<AppEnv> {
  const parsed = rawEnvSchema.parse(process.env);
  validateGoogleCreds(parsed);

  if (parsed.LISTING_SOURCE === "database" && !hasDatabaseConnection(parsed)) {
    throw new Error(
      "LISTING_SOURCE=database richiede DATABASE_URL oppure DB_HOST, DB_USER, DB_PASSWORD, DB_NAME",
    );
  }
  if (parsed.LISTING_SOURCE === "api" && !parsed.GESTIM_API_BASE_URL) {
    throw new Error("LISTING_SOURCE=api richiede GESTIM_API_BASE_URL");
  }

  let zoneSheetRules: ZoneSheetRule[];
  let defaultSpreadsheetIdResolved: string;

  if (parsed.MAPPING_SPREADSHEET_ID) {
    zoneSheetRules = await loadZoneMappingFromSheet({
      spreadsheetId: parsed.MAPPING_SPREADSHEET_ID,
      sheetName: parsed.MAPPING_SHEET_NAME,
      matchMode: parsed.MAPPING_ZONE_MATCH,
    });
    if (zoneSheetRules.length === 0) {
      logger.warn(
        "Foglio mapping vuoto o senza righe A:B valide: userai solo DEFAULT_SHEET_TITLE.",
      );
    }
    defaultSpreadsheetIdResolved =
      parsed.DEFAULT_SPREADSHEET_ID ?? parsed.MAPPING_SPREADSHEET_ID;
  } else {
    try {
      zoneSheetRules = parseZoneMapJson(parsed.ZONE_SHEET_MAP_JSON);
    } catch (e) {
      throw new Error(
        `ZONE_SHEET_MAP_JSON non valido: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (zoneSheetRules.length === 0) {
      throw new Error(
        "Impostare MAPPING_SPREADSHEET_ID oppure ZONE_SHEET_MAP_JSON con almeno una regola",
      );
    }
    if (!parsed.DEFAULT_SPREADSHEET_ID) {
      throw new Error("DEFAULT_SPREADSHEET_ID obbligatorio se non usi MAPPING_SPREADSHEET_ID");
    }
    defaultSpreadsheetIdResolved = parsed.DEFAULT_SPREADSHEET_ID;
  }

  return {
    ...parsed,
    zoneSheetRules,
    defaultSpreadsheetIdResolved,
  };
}

/** @deprecated Usare bootstrapEnv. Solo per test che non caricano il mapping da sheet. */
export function loadEnvFromJsonOnly(zoneSheetRules: ZoneSheetRule[], overrides: Partial<RawEnv> = {}): AppEnv {
  const parsed = rawEnvSchema.parse({ ...process.env, ...overrides });
  validateGoogleCreds(parsed);
  const defaultSpreadsheetIdResolved =
    parsed.DEFAULT_SPREADSHEET_ID ?? parsed.MAPPING_SPREADSHEET_ID ?? "test-default";
  return { ...parsed, zoneSheetRules, defaultSpreadsheetIdResolved };
}
