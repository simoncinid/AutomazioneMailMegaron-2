import { z } from "zod";
import type { ZoneSheetRule } from "../domain/types.js";
import { hasDatabaseConnection } from "./pgPool.js";
import { logger } from "../logging/logger.js";
import { loadZoneMappingFromSheet } from "../sheets/loadZoneMappingFromSheet.js";

const HARD_CODED_ZONE_SHEET_MAPPING_RAW = `
BARBARICINA\tAG\tBORGHETTO\tEROS\tCALAMBRONE\tAG\tCEP\tAG\tCISANELLO\tSTEFANIA\tCOLTANO\tREBECCA\tDON BOSCO\tAG\tGAGNO\tAG\tGHEZZANO\tDAVIDE\tI PASSI\tAG\tLA FONTINA\tDAVIDE\tLA VETTOLA\tAG\tMARINA DI PISA\tAG\tMONTACCHIELLO\tREBECCA\tORATOIO\tAG\tOSPEDALETTO\tREBECCA\tPIAGGE\tSTEFANIA\tPISANOVA\tAG\tPORTA A LUCCA\tGIUSEPPE\tPORTA A MARE\tVALENTINA\tPORTA FIORENTINA\tAG\tPORTA NUOVA\tMATTIA\tPRATALE\tGIUSEPPE\tPUTIGNANO\tAG\tRIGLIONE\tAG\tSAN FRANCESCO\tEROS\tSAN GIUSTO\tAG\tSAN MARCO\tAG\tSAN MARTINO\tSAMUELE\tSAN PIERO A GRADO\tAG\tSAN ROSSORE\tAG\tSANTA MARIA\tMATTIA\tSANT'ANTONIO\tVALENTINA\tSANT'ERMETE\tAG\tSTAZIONE\tSAMUELE\tTIRRENIA\tAG
Bientina\tAG\tButi\tAG\tCalci\tGIUSEPPE\tCalcinaia\tREBECCA\tCapannoli\tPATRIZIA\tCasale Marittimo\tAG\tCasciana Terme Lari\tFAUSTO\tCascina\tTOMMASO\tCastelfranco di Sotto\tAG\tCastellina Marittima\tAG\tCastelnuovo di Val di Cecina\tAG\tChianni\tAG\tCrespina Lorenzana\tFAUSTO\tFauglia\tAG\tGuardistallo\tAG\tLajatico\tAG\tLorenzana\tAG\tMontecatini Val di Cecina\tAG\tMontescudaio\tAG\tMonteverdi Marittimo\tAG\tMontopoli in Val d'Arno\tAG\tOrciano Pisano\tAG\tPalaia\tAG\tPeccioli\tAG\tPomarance\tAG\tPonsacco\tAG\tPontedera\tELISABETTA\tRiparbella\tAG\tSan Giuliano Terme\tDAVIDE\tSan Miniato\tAG\tSanta Croce sull'Arno\tAG\tSanta Luce\tAG\tSanta Maria a Monte\tAG\tTerricciola\tAG\tVecchiano\tDAVIDE\tVicopisano\tLUIS\tVolterra\tAG
`.trim();

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
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY obbligatoria"),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),

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
  /** Mapping hardcoded (default) stile test python: righe tab-delimitate zona<TAB>foglio */
  ZONE_SHEET_MAPPING_RAW: z.string().default(HARD_CODED_ZONE_SHEET_MAPPING_RAW),

  /** Se impostato, colonne A–B del tab leggono zona → nome foglio (stesso file). */
  MAPPING_SPREADSHEET_ID: z.string().optional(),
  MAPPING_SHEET_NAME: z.string().default("mapping"),
  /** Allineato al test Python (`IMAP_ZONE_MATCH=contains`). */
  MAPPING_ZONE_MATCH: z.enum(["contains", "equals"]).default("contains"),

  /** Obbligatorio se non usi solo MAPPING_SPREADSHEET_ID (viene defaultato al mapping file). */
  DEFAULT_SPREADSHEET_ID: z.string().optional(),
  DEFAULT_SHEET_TITLE: z.string().min(1),

  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),

  NO_ID_FOUND_SHEET_TITLE: z.string().default("no-id-trovato"),
  MULTI_ID_FOUND_SHEET_TITLE: z.string().default("no-singolo-id"),
  BLOCKED_EMAIL_SUBSTRINGS: z.string().default(
    "immobiliare,noreply,no-reply,idealista,gruppoinsieme,mailer-daemon",
  ),

  EXTRA_ID_REGEX: z.string().optional(),

  /** Worker IMAP Aruba (sorgente inbox). Allineato al test Python (`IMAP_TEST_SINCE_DAYS=7`). */
  IMAP_EMAIL: z.string().optional(),
  IMAP_PASSWORD: z.string().optional(),
  IMAP_SERVER: z.string().default("imaps.aruba.it"),
  IMAP_PORT: z.coerce.number().default(993),
  IMAP_SECURE: z
    .string()
    .optional()
    .transform((s) => (s == null ? true : s === "true" || s === "1")),
  /** Finestra IMAP `SINCE` in giorni (default 7 = ultima settimana, come `test_imap_aruba.py`). */
  IMAP_LOOKBACK_DAYS: z.coerce.number().min(1).default(7),
  /** Numero massimo di messaggi processati per ciclo (allineato al test). */
  IMAP_FETCH_LIMIT: z.coerce.number().min(1).max(1000).default(200),

  WORKER_POLL_INTERVAL_MINUTES: z.coerce.number().min(5).default(60),
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

function normalizeZone(zone: string): string {
  return zone.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Allineato al test Python `_resolve_sheet_for_zone`: ogni regola usa
 * `MAPPING_ZONE_MATCH` (default `contains`); con `contains`, le chiavi più
 * lunghe vengono valutate prima per evitare match parziali troppo aggressivi.
 */
function parseZoneMappingRaw(
  raw: string,
  spreadsheetId: string,
  matchMode: "contains" | "equals",
): ZoneSheetRule[] {
  const rules: ZoneSheetRule[] = [];
  const rows = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const row of rows) {
    const cells = row
      .split("\t")
      .map((cell) => cell.trim())
      .filter(Boolean);
    if (cells.length < 2) continue;
    if (cells.length % 2 !== 0) {
      throw new Error(`ZONE_SHEET_MAPPING_RAW non valido: colonne dispari nella riga "${row}"`);
    }
    for (let i = 0; i < cells.length; i += 2) {
      const zone = cells[i]!;
      const sheetTitle = cells[i + 1]!;
      rules.push({
        name: `raw_mapping_${normalizeZone(zone).replace(/\s+/g, "_")}`,
        pattern: zone,
        match: matchMode,
        spreadsheetId,
        sheetTitle,
      });
    }
  }

  if (matchMode === "contains") {
    rules.sort((a, b) => b.pattern.length - a.pattern.length);
  }
  return rules;
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
  const hasJsonMapping = parsed.ZONE_SHEET_MAP_JSON.trim() !== "[]";
  const hasRawMapping = Boolean(parsed.ZONE_SHEET_MAPPING_RAW?.trim());

  if (hasRawMapping || hasJsonMapping) {
    defaultSpreadsheetIdResolved =
      parsed.DEFAULT_SPREADSHEET_ID ?? parsed.MAPPING_SPREADSHEET_ID ?? "";
    if (!defaultSpreadsheetIdResolved) {
      throw new Error(
        "Con ZONE_SHEET_MAPPING_RAW/ZONE_SHEET_MAP_JSON devi impostare DEFAULT_SPREADSHEET_ID oppure MAPPING_SPREADSHEET_ID",
      );
    }
    if (hasRawMapping) {
      zoneSheetRules = parseZoneMappingRaw(
        parsed.ZONE_SHEET_MAPPING_RAW ?? "",
        defaultSpreadsheetIdResolved,
        parsed.MAPPING_ZONE_MATCH,
      );
      if (zoneSheetRules.length === 0) {
        throw new Error("ZONE_SHEET_MAPPING_RAW impostato ma senza righe valide");
      }
    } else {
      try {
        zoneSheetRules = parseZoneMapJson(parsed.ZONE_SHEET_MAP_JSON);
      } catch (e) {
        throw new Error(
          `ZONE_SHEET_MAP_JSON non valido: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      if (zoneSheetRules.length === 0) {
        throw new Error("ZONE_SHEET_MAP_JSON impostato ma senza regole valide");
      }
    }
  } else if (parsed.MAPPING_SPREADSHEET_ID) {
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
