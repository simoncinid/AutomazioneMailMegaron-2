import type { AppEnv } from "../config/loadEnv.js";
import { logger } from "../logging/logger.js";
import { withGoogleSheetsRateLimit } from "../sheets/googleSheetsRateLimiter.js";
import { getSheetsClient } from "../sheets/sheetsClient.js";
import { formatSheetRange } from "../sheets/sheetRange.js";

const log = logger.child({ module: "leadAssignmentCooldown" });
const COOLDOWN_MONTHS = 6;

/**
 * "lead"        => riga A:G  (A = email, C = data assegnazione, D = telefono)
 * "diagnostic"  => riga A:H  (A = data, G = email lead, H = telefono)
 *
 * Indica al loader come scoprire `(contatto, data)` su ciascun tab.
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
  matchedOn?: "email" | "phone";
  matchedValue?: string;
}

/**
 * Cooldown 6 mesi per contatto lead (email o telefono), calcolato globalmente su:
 *  - tab lead (tutte le destinazioni del mapping zona)
 *  - tab diagnostico `no-id-trovato`
 *
 * Lo stato viene caricato 1 volta dai Google Sheets e poi aggiornato in memoria
 * tramite `recordAssignment` man mano che il worker scrive righe nel ciclo:
 * così due mail uguali nello stesso run non finiscono in due righe duplicate.
 */
export class LeadAssignmentCooldown {
  private readonly targets: SheetTarget[];
  private readonly lastAssignmentByIdentity = new Map<string, Date>();
  private loadPromise: Promise<void> | null = null;
  private loaded = false;

  constructor(private readonly env: AppEnv) {
    this.targets = buildTrackedTargets(env);
  }

  async shouldSkip(
    identity: { email?: string; phone?: string },
    now: Date,
  ): Promise<LeadCooldownDecision> {
    const keys = buildIdentityKeys(identity);
    if (keys.length === 0) return { shouldSkip: false };

    await this.ensureLoaded();

    let best: { key: string; date: Date; matchedOn: "email" | "phone"; value: string } | null = null;
    for (const k of keys) {
      const date = this.lastAssignmentByIdentity.get(k.key);
      if (!date) continue;
      if (!best || date.getTime() > best.date.getTime()) {
        best = { key: k.key, date, matchedOn: k.type, value: k.normalizedValue };
      }
    }
    if (!best) return { shouldSkip: false };

    const blockedUntil = addMonths(best.date, COOLDOWN_MONTHS);
    if (now < blockedUntil) {
      return {
        shouldSkip: true,
        lastAssignedAt: best.date,
        blockedUntil,
        matchedOn: best.matchedOn,
        matchedValue: best.value,
      };
    }
    return {
      shouldSkip: false,
      lastAssignedAt: best.date,
      blockedUntil,
      matchedOn: best.matchedOn,
      matchedValue: best.value,
    };
  }

  recordAssignment(identity: { email?: string; phone?: string }, assignedAt: Date): void {
    const keys = buildIdentityKeys(identity);
    for (const k of keys) {
      upsertLatest(this.lastAssignmentByIdentity, k.key, assignedAt);
    }
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
      const rangeSuffix = target.kind === "lead" ? "A:D" : "A:H";
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
          let emailCell: unknown = "";
          let phoneCell: unknown = "";
          let dateCell: unknown;
          if (target.kind === "lead") {
            emailCell = row[0];
            dateCell = row[2];
            phoneCell = row[3];
          } else {
            // Layout diagnostico: A=data, G=email, H=telefono.
            dateCell = row[0];
            emailCell = row[6];
            phoneCell = row[7];
          }
          const assignedAt = parseSheetDateCell(dateCell);
          if (!assignedAt) continue;

          const keys = buildIdentityKeys({
            email: typeof emailCell === "string" ? emailCell : "",
            phone: typeof phoneCell === "string" ? phoneCell : "",
          });
          if (keys.length === 0) continue;
          for (const k of keys) {
            upsertLatest(this.lastAssignmentByIdentity, k.key, assignedAt);
          }
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
        trackedContacts: this.lastAssignmentByIdentity.size,
      },
      "Cooldown lead caricato (ricerca globale: lead A:D + diagnostici A:H)",
    );
  }
}

/**
 * Tutti i tab che contengono contatti lead da considerare per il cooldown:
 *  - tutte le destinazioni del mapping zona                                   -> layout "lead"
 *  - NO_ID_FOUND_SHEET_TITLE                                                 -> layout "diagnostic"
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

  for (const rule of env.zoneSheetRules) {
    push(rule.spreadsheetId, rule.sheetTitle, "lead");
  }

  push(env.defaultSpreadsheetIdResolved, env.NO_ID_FOUND_SHEET_TITLE, "diagnostic");

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

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.length >= 11 && digits.startsWith("39")) return digits.slice(2);
  return digits;
}

function buildIdentityKeys(identity: {
  email?: string;
  phone?: string;
}): Array<{ key: string; type: "email" | "phone"; normalizedValue: string }> {
  const out: Array<{ key: string; type: "email" | "phone"; normalizedValue: string }> = [];

  const email = normalizeEmail(identity.email ?? "");
  if (email.includes("@")) {
    out.push({ key: `email:${email}`, type: "email", normalizedValue: email });
  }

  const phone = normalizePhone(identity.phone ?? "");
  if (phone.length >= 6) {
    out.push({ key: `phone:${phone}`, type: "phone", normalizedValue: phone });
  }

  return out;
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
