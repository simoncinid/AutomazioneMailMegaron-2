import type { PoolConfig } from "pg";
import type { RawEnv } from "./loadEnv.js";

/** Normalizza certificati PEM salvati in env con `\n` letterali. */
export function normalizeTlsPem(s: string): string {
  return s.replace(/\\n/g, "\n").trim();
}

/** True se è configurata una connessione DB (URL oppure host/user/pass/name). */
export function hasDatabaseConnection(env: RawEnv): boolean {
  if (env.DATABASE_URL?.trim()) return true;
  return Boolean(
    env.DB_HOST?.trim() &&
      env.DB_USER?.trim() &&
      env.DB_PASSWORD !== undefined &&
      env.DB_PASSWORD !== null &&
      env.DB_NAME?.trim(),
  );
}

/**
 * Configurazione `pg.Pool`: `DATABASE_URL` oppure variabili `DB_*`.
 * Con `TLS_CERT`, il PEM viene usato come CA per verificare il server (tipico su DB gestiti).
 */
export function resolvePgPoolConfig(env: RawEnv): PoolConfig {
  if (env.DATABASE_URL?.trim()) {
    const cfg: PoolConfig = { connectionString: env.DATABASE_URL.trim() };
    if (env.TLS_CERT?.trim()) {
      cfg.ssl = {
        rejectUnauthorized: true,
        ca: normalizeTlsPem(env.TLS_CERT),
      };
    }
    return cfg;
  }

  if (!hasDatabaseConnection(env)) {
    throw new Error(
      "Connessione DB: impostare DATABASE_URL oppure DB_HOST, DB_USER, DB_PASSWORD, DB_NAME",
    );
  }

  const port = env.DB_PORT ?? 5432;
  let ssl: PoolConfig["ssl"];
  if (env.TLS_CERT?.trim()) {
    ssl = {
      rejectUnauthorized: true,
      ca: normalizeTlsPem(env.TLS_CERT),
    };
  } else if (env.DB_SSL) {
    ssl = { rejectUnauthorized: false };
  } else {
    ssl = false;
  }

  return {
    host: env.DB_HOST!.trim(),
    port,
    user: env.DB_USER!.trim(),
    password: env.DB_PASSWORD!,
    database: env.DB_NAME!.trim(),
    ssl,
  };
}
