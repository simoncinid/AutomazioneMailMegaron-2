import type { AppEnv } from "../config/loadEnv.js";
import { logger } from "../logging/logger.js";
import { withGoogleSheetsRateLimit } from "../sheets/googleSheetsRateLimiter.js";
import { getSheetsClient } from "../sheets/sheetsClient.js";
import { formatSheetRange } from "../sheets/sheetRange.js";

const log = logger.child({ module: "leadAssignmentCooldown" });
const COOLDOWN_MONTHS = 6;

/**
 * "lead"        => riga A:G  (A = email, C = data assegnazione)
 * "diagnostic"  => riga A:H/A:I  (A = data, G = email lead)
 *
 * Indica al loader come scoprire `(email, data)` su ciascun tab.
 */
type TargetKind = "lead" | "diagnostic";

interface SheetTarget {
  spreadsheetId: string;
  sheetTitle: string;
  kind: TargetKind;
}

export interface LeadCooldownDecision {
  shouldSkip: boolean;
  lastAssignedAt?: Date;
  blockedUntil?: Date;
}

/**
 * Cooldown 6 mesi per email lead, calcolato globalmente su:
 *  - tab lead (DEFAULT_SHEET_TITLE + tutte le destinazioni del mapping zona)
 *  - tab diagnostici `no-id-trovato` e `no-singolo-id`
 *
 * Lo stato viene caricato 1 volta dai Google Sheets e poi aggiornato in memoria
 * tramite `recordAssignment` man mano che il worker scrive righe nel ciclo:
 * così due mail uguali nello stesso run non finiscono in due righe duplicate.
 */
export class LeadAssignmentCooldown {
  private readonly targets: SheetTarget[];
  private readonly lastAssignmentByEmail = new Map<string, Date>();
  private loadPromise: Promise<void> | null = null;
  private loaded = false;

  constructor(private readonly env: AppEnv) {
    this.targets = buildTrackedTargets(env);
  }

  async shouldSkip(email: string, now: Date): Promise<LeadCooldownDecision> {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return { shouldSkip: false };

    await this.ensureLoaded();

    const lastAssignedAt = this.lastAssignmentByEmail.get(normalizedEmail);
    if (!lastAssignedAt) return { shouldSkip: false };

    const blockedUntil = addMonths(lastAssignedAt, COOLDOWN_MONTHS);
    if (now < blockedUntil) {
      return { shouldSkip: true, lastAssignedAt, blockedUntil };
    }
    return { shouldSkip: false, lastAssignedAt, blockedUntil };
  }

  recordAssignment(email: string, assignedAt: Date): void {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return;
    upsertLatest(this.lastAssignmentByEmail, normalizedEmail, assignedAt);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!this.loadPromise) {
      this.loadPromise = this.loadFromSheets();
    }
    await this.loadPromise;
    this.loaded = true;
  }

  private async loadFromSheets(): Promise<void> {
    const sheets = await getSheetsClient();
    let leadTargets = 0;
    let diagnosticTargets = 0;

    for (const target of this.targets) {
      const rangeSuffix = target.kind === "lead" ? "A:C" : "A:G";
      const range = formatSheetRange(target.sheetTitle, rangeSuffix);
      try {
        const res = await withGoogleSheetsRateLimit(async () =>
          sheets.spreadsheets.values.get({
            spreadsheetId: target.spreadsheetId,
            range,
            valueRenderOption: "UNFORMATTED_VALUE",
            dateTimeRenderOption: "SERIAL_NUMBER",
          }),
        );
        const rows = res.data.values ?? [];
        for (const row of rows) {
          let emailCell: unknown;
          let dateCell: unknown;
          if (target.kind === "lead") {
            emailCell = row[0];
            dateCell = row[2];
          } else {
            // Layout diagnostico: A=data, G=email (indice 6).
            dateCell = row[0];
            emailCell = row[6];
          }
          if (typeof emailCell !== "string") continue;
          if (!emailCell.includes("@")) continue;
          const normalizedEmail = normalizeEmail(emailCell);
          if (!normalizedEmail) continue;
          const assignedAt = parseSheetDateCell(dateCell);
          if (!assignedAt) continue;
          upsertLatest(this.lastAssignmentByEmail, normalizedEmail, assignedAt);
        }
        if (target.kind === "lead") leadTargets += 1;
        else diagnosticTargets += 1;
      } catch (error) {
        log.warn(
          {
            err: error,
            spreadsheetId: target.spreadsheetId,
            sheetTitle: target.sheetTitle,
            kind: target.kind,
          },
          "Impossibile leggere tab per cooldown lead: continuo con gli altri",
        );
      }
    }

    log.info(
      {
        leadTargets,
        diagnosticTargets,
        trackedEmails: this.lastAssignmentByEmail.size,
      },
      "Cooldown lead caricato (ricerca globale: lead A:C + diagnostici A:G)",
    );
  }
}

/**
 * Tutti i tab che contengono email lead da considerare per il cooldown:
 *  - DEFAULT_SHEET_TITLE (es. "AG") e tutte le destinazioni del mapping zona  -> layout "lead"
 *  - NO_ID_FOUND_SHEET_TITLE e MULTI_ID_FOUND_SHEET_TITLE                    -> layout "diagnostic"
 */
function buildTrackedTargets(env: AppEnv): SheetTarget[] {
  const out = new Map<string, SheetTarget>();
  const push = (
    spreadsheetId: string | undefined,
    sheetTitle: string | undefined,
    kind: TargetKind,
  ): void => {
    const sid = (spreadsheetId ?? "").trim();
    const st = (sheetTitle ?? "").trim();
    if (!sid || !st) return;
    out.set(`${sid}::${st}`, { spreadsheetId: sid, sheetTitle: st, kind });
  };

  push(env.defaultSpreadsheetIdResolved, env.DEFAULT_SHEET_TITLE, "lead");
  for (const rule of env.zoneSheetRules) {
    push(rule.spreadsheetId, rule.sheetTitle, "lead");
  }

  push(env.defaultSpreadsheetIdResolved, env.NO_ID_FOUND_SHEET_TITLE, "diagnostic");
  push(env.defaultSpreadsheetIdResolved, env.MULTI_ID_FOUND_SHEET_TITLE, "diagnostic");

  return [...out.values()];
}

function upsertLatest(store: Map<string, Date>, email: string, date: Date): void {
  const current = store.get(email);
  if (!current || date.getTime() > current.getTime()) {
    store.set(email, date);
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function addMonths(base: Date, months: number): Date {
  const out = new Date(base);
  out.setMonth(out.getMonth() + months);
  return out;
}

function parseSheetDateCell(raw: unknown): Date | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    const ms = Math.round(raw * 86_400_000);
    const parsed = new Date(excelEpoch + ms);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;

  const iso = new Date(value);
  if (!Number.isNaN(iso.getTime())) return iso;

  const itMatch =
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
  if (!itMatch) return null;

  const day = Number(itMatch[1]);
  const monthIndex = Number(itMatch[2]) - 1;
  const yy = Number(itMatch[3]);
  const year = yy < 100 ? 2000 + yy : yy;
  const hour = Number(itMatch[4] ?? "0");
  const minute = Number(itMatch[5] ?? "0");
  const second = Number(itMatch[6] ?? "0");

  const parsed = new Date(year, monthIndex, day, hour, minute, second);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}
