import { describe, expect, it } from "vitest";
import type { RawEnv } from "../src/config/loadEnv.js";
import {
  normalizeTlsPem,
  resolvePgPoolConfig,
  stripSslParamsFromDatabaseUrl,
} from "../src/config/pgPool.js";

function makeEnv(overrides: Partial<RawEnv> = {}): RawEnv {
  return {
    NODE_ENV: "test",
    PORT: 3000,
    LOG_LEVEL: "info",
    OPENAI_API_KEY: "test",
    OPENAI_MODEL: "gpt-4o-mini",
    LISTING_SOURCE: "database",
    GESTIM_API_BASE_URL: undefined,
    DATABASE_URL: undefined,
    DB_HOST: undefined,
    DB_PORT: undefined,
    DB_USER: undefined,
    DB_PASSWORD: undefined,
    DB_NAME: undefined,
    DB_SSL: false,
    TLS_CERT: undefined,
    ZONE_SHEET_MAP_JSON: "[]",
    ZONE_SHEET_MAPPING_RAW: "",
    MAPPING_SPREADSHEET_ID: undefined,
    MAPPING_SHEET_NAME: "mapping",
    MAPPING_ZONE_MATCH: "contains",
    DEFAULT_SPREADSHEET_ID: undefined,
    DEFAULT_SHEET_TITLE: "AG",
    GOOGLE_APPLICATION_CREDENTIALS: "./dummy.json",
    GOOGLE_SERVICE_ACCOUNT_JSON: undefined,
    NO_ID_FOUND_SHEET_TITLE: "no-id-trovato",
    MULTI_ID_FOUND_SHEET_TITLE: "no-singolo-id",
    BLOCKED_EMAIL_SUBSTRINGS: "",
    EXTRA_ID_REGEX: undefined,
    IMAP_EMAIL: undefined,
    IMAP_PASSWORD: undefined,
    IMAP_SERVER: "imaps.aruba.it",
    IMAP_PORT: 993,
    IMAP_SECURE: true,
    IMAP_LOOKBACK_DAYS: 7,
    IMAP_FETCH_LIMIT: 200,
    WORKER_POLL_INTERVAL_MINUTES: 60,
    ...overrides,
  };
}

describe("pgPool TLS helpers", () => {
  it("normalizza PEM con newline letterali", () => {
    const input = "  -----BEGIN CERTIFICATE-----\\nabc\\n-----END CERTIFICATE-----  ";
    expect(normalizeTlsPem(input)).toBe("-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----");
  });

  it("normalizza PEM anche con virgolette e CRLF escaped", () => {
    const input = "\"-----BEGIN CERTIFICATE-----\\r\\nabc\\r\\n-----END CERTIFICATE-----\"";
    expect(normalizeTlsPem(input)).toBe("-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----");
  });

  it("rimuove i parametri ssl* dalla DATABASE_URL", () => {
    const input =
      "postgresql://user:pass@db.example.com:5432/app?sslmode=require&sslrootcert=/tmp/ca.pem&application_name=worker";
    const output = stripSslParamsFromDatabaseUrl(input);

    expect(output).toContain("application_name=worker");
    expect(output).not.toContain("sslmode=");
    expect(output).not.toContain("sslrootcert=");
  });

  it("usa TLS_CERT e ignora sslmode nell'URL", () => {
    const env = makeEnv({
      DATABASE_URL:
        "postgresql://user:pass@195.154.71.55:18973/rdb?sslmode=verify-full&sslrootcert=/tmp/a.pem",
      TLS_CERT: "-----BEGIN CERTIFICATE-----\\nabc\\n-----END CERTIFICATE-----",
    });

    const cfg = resolvePgPoolConfig(env);
    expect(cfg.connectionString).toBe("postgresql://user:pass@195.154.71.55:18973/rdb");
    expect(cfg.host).toBe("195.154.71.55");
    expect((cfg.ssl as Record<string, unknown>).rejectUnauthorized).toBe(true);
    expect((cfg.ssl as Record<string, unknown>).ca).toBe(
      "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----",
    );
    expect(typeof (cfg.ssl as Record<string, unknown>).checkServerIdentity).toBe("function");
  });

  it("con DB_SSL=true forza rejectUnauthorized=false e ripulisce l'URL", () => {
    const env = makeEnv({
      DATABASE_URL: "postgresql://user:pass@db.example.com:5432/app?sslmode=verify-full",
      DB_SSL: true,
    });

    const cfg = resolvePgPoolConfig(env);
    expect(cfg.connectionString).toBe("postgresql://user:pass@db.example.com:5432/app");
    expect(cfg.host).toBe("db.example.com");
    expect(cfg.ssl).toEqual({ rejectUnauthorized: false });
  });
});
