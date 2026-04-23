import type { AppEnv } from "../config/loadEnv.js";
import { logger } from "../logging/logger.js";
import { withGoogleSheetsRateLimit } from "../sheets/googleSheetsRateLimiter.js";
import { getSheetsClient } from "../sheets/sheetsClient.js";
import { formatSheetRange } from "../sheets/sheetRange.js";

const log = logger.child({ module: "leadAssignmentCooldown" });
const COOLDOWN_MONTHS = 6;

interface SheetTarget {
  spreadsheetId: string;
  sheetTitle: string;
}

export interface LeadCooldownDecision {
  shouldSkip: boolean;
  lastAssignedAt?: Date;
  blockedUntil?: Date;
}

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

    for (const target of this.targets) {
      const range = formatSheetRange(target.sheetTitle, "A:C");
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
          const emailCell = row[0];
          const dateCell = row[2];
          if (typeof emailCell !== "string") continue;
          const normalizedEmail = normalizeEmail(emailCell);
          if (!normalizedEmail) continue;
          const assignedAt = parseSheetDateCell(dateCell);
          if (!assignedAt) continue;
          upsertLatest(this.lastAssignmentByEmail, normalizedEmail, assignedAt);
        }
      } catch (error) {
        log.warn(
          {
            err: error,
            spreadsheetId: target.spreadsheetId,
            sheetTitle: target.sheetTitle,
          },
          "Impossibile leggere tab per cooldown lead: continuo con gli altri",
        );
      }
    }

    log.info(
      {
        trackedTargets: this.targets.length,
        trackedEmails: this.lastAssignmentByEmail.size,
      },
      "Cooldown lead caricato",
    );
  }
}

function buildTrackedTargets(env: AppEnv): SheetTarget[] {
  const out = new Map<string, SheetTarget>();
  const push = (spreadsheetId: string | undefined, sheetTitle: string | undefined): void => {
    const sid = (spreadsheetId ?? "").trim();
    const st = (sheetTitle ?? "").trim();
    if (!sid || !st) return;
    out.set(`${sid}::${st}`, { spreadsheetId: sid, sheetTitle: st });
  };

  push(env.defaultSpreadsheetIdResolved, env.DEFAULT_SHEET_TITLE);
  push(env.defaultSpreadsheetIdResolved, env.NO_ID_FOUND_SHEET_TITLE);
  push(env.defaultSpreadsheetIdResolved, env.MULTI_ID_FOUND_SHEET_TITLE);

  if (env.UNMAPPED_ZONE_SPREADSHEET_ID) {
    push(env.UNMAPPED_ZONE_SPREADSHEET_ID, env.UNMAPPED_ZONE_SHEET_TITLE ?? env.DEFAULT_SHEET_TITLE);
  }

  for (const rule of env.zoneSheetRules) {
    push(rule.spreadsheetId, rule.sheetTitle);
  }

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
