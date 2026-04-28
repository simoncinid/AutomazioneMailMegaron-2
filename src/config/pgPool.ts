import type { PoolConfig } from "pg";
import type { RawEnv } from "./loadEnv.js";

/** Normalizza certificati PEM salvati in env con `\n` letterali. */
export function normalizeTlsPem(s: string): string {
  return s.replace(/\\n/g, "\n").trim();
}

const SSL_URL_PARAMS = ["sslmode", "sslcert", "sslkey", "sslrootcert", "ssl"];

/**
 * Rimuove parametri SSL dal connection string URI-style.
 * Serve perché `pg` dà precedenza ai parametri SSL presenti nell'URL e può
 * sovrascrivere `cfg.ssl` (CA/rejectUnauthorized) passato nel config object.
 */
export function stripSslParamsFromDatabaseUrl(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    for (const key of SSL_URL_PARAMS) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    // Fallback: conninfo non URI-style (es. formato libpq key=value).
    return connectionString;
  }
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
 *
 * TLS:
 * - `TLS_CERT` (PEM): verifica forte del certificato server (preferito su cloud).
 * - `DB_SSL=true` senza PEM: `{ rejectUnauthorized: false }` — necessario quando il Postgres
 *   usa un cert **self-signed** o una CA interna che Node non ha nel bundle (molto comune su
 *   Scaleway/OVH/Render esterni). Senza questo, errore tipo `DEPTH_ZERO_SELF_SIGNED_CERT`.
 * - Senza PEM e senza `DB_SSL`: nessun override `ssl`; `pg` segue comunque parametri nell'URL,
 *   ma molti ambienti rompono sulla verifica: in quel caso impostare CA o `DB_SSL=true`.
 */
export function resolvePgPoolConfig(env: RawEnv): PoolConfig {
  if (env.DATABASE_URL?.trim()) {
    const rawConnectionString = env.DATABASE_URL.trim();
    const mustForceSslConfig = Boolean(env.TLS_CERT?.trim() || env.DB_SSL);
    const cfg: PoolConfig = {
      connectionString: mustForceSslConfig
        ? stripSslParamsFromDatabaseUrl(rawConnectionString)
        : rawConnectionString,
    };
    if (env.TLS_CERT?.trim()) {
      cfg.ssl = {
        rejectUnauthorized: true,
        ca: normalizeTlsPem(env.TLS_CERT),
      };
    } else if (env.DB_SSL) {
      cfg.ssl = { rejectUnauthorized: false };
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
