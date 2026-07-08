import type { sheets_v4 } from "googleapis";
import { logger } from "../logging/logger.js";
import { withGoogleSheetsRateLimit } from "./googleSheetsRateLimiter.js";
import { getSheetsClient, resetSheetsClient } from "./sheetsClient.js";

const log = logger.child({ module: "googleSheetsOperation" });
const MAX_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [1_000, 3_000, 8_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withGoogleSheetsOperation<T>(
  operation: (sheets: sheets_v4.Sheets) => Promise<T>,
  context: Record<string, unknown> = {},
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const sheets = await getSheetsClient();
    try {
      return await withGoogleSheetsRateLimit(() => operation(sheets));
    } catch (error) {
      const retryable = isRetryableGoogleSheetsError(error);
      if (!retryable || attempt >= MAX_ATTEMPTS) {
        throw error;
      }

      resetSheetsClient();
      const delayMs = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS.at(-1) ?? 1_000;
      log.warn(
        { err: error, attempt, nextAttempt: attempt + 1, delayMs, ...context },
        "Errore transitorio Google Sheets: ritento con nuovo client",
      );
      await sleep(delayMs);
    }
  }

  throw new Error("Retry Google Sheets esauriti");
}

export function isRetryableGoogleSheetsError(error: unknown): boolean {
  const values = collectErrorValues(error);
  const codes = values
    .map((value) => value.code)
    .filter((code): code is string | number => typeof code === "string" || typeof code === "number");
  const statuses = values
    .flatMap((value) => [value.status, value.response?.status])
    .filter((status): status is number => typeof status === "number");
  const messages = values
    .map((value) => value.message)
    .filter((message): message is string => typeof message === "string")
    .join(" ");
  const urls = values
    .map((value) => value.config?.url)
    .filter((url): url is string => typeof url === "string")
    .join(" ");

  if (codes.some((code) => code === "ERR_STREAM_PREMATURE_CLOSE")) return true;
  if (codes.some((code) => ["ECONNRESET", "ETIMEDOUT", "EPIPE"].includes(String(code)))) {
    return true;
  }
  if (statuses.some((status) => status === 408 || status === 429 || status >= 500)) return true;
  if (/premature close|socket hang up|network timeout/i.test(messages)) return true;
  if (/oauth2\/v4\/token|oauth2\.googleapis\.com\/token/i.test(urls) && /invalid response body/i.test(messages)) {
    return true;
  }

  return false;
}

function collectErrorValues(error: unknown): Array<Record<string, any>> {
  const out: Array<Record<string, any>> = [];
  const seen = new Set<unknown>();
  let current = error;

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    out.push(current as Record<string, any>);
    current = (current as Record<string, any>).error;
  }

  return out;
}
