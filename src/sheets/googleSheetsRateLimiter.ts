import { logger } from "../logging/logger.js";

const log = logger.child({ module: "googleSheetsRateLimiter" });
const REQUEST_BURST_LIMIT = 50;
const COOLDOWN_MS = 120_000;

let requestCounter = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Rate limiter semplice a finestra locale processo:
 * dopo 50 richieste verso Sheets applica una pausa di 120s.
 */
export async function withGoogleSheetsRateLimit<T>(
  operation: () => Promise<T>,
): Promise<T> {
  if (requestCounter >= REQUEST_BURST_LIMIT) {
    log.warn(
      { requestCounter, cooldownMs: COOLDOWN_MS },
      "Raggiunta soglia richieste Google Sheets, avvio pausa anti-rate-limit",
    );
    await sleep(COOLDOWN_MS);
    requestCounter = 0;
  }

  requestCounter += 1;
  return operation();
}

export function resetGoogleSheetsRateLimitCounter(): void {
  requestCounter = 0;
}
