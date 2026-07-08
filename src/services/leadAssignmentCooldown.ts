import type { AppEnv } from "../config/loadEnv.js";
import { logger } from "../logging/logger.js";
import { withGoogleSheetsOperation } from "../sheets/googleSheetsOperation.js";
import { formatSheetRange } from "../sheets/sheetRange.js";

const log = logger.child({ module: "leadAssignmentCooldown" });
const COOLDOWN_MONTHS = 6;

interface SheetTarget {
  spreadsheetId: string;
  sheetTitle: string;
}

type NormalizedStatus =
  | "da_chiamare"
  | "appuntamento_fissato"
  | "non_risponde"
  | "chiamato"
  | "unknown";

interface LeadRowRef {
  spreadsheetId: string;
  sheetTitle: string;
  rowNumber: number;
}

interface LeadSnapshot {
  leadEmail: string;
  listingId: string;
  phone: string;
  zone: string;
  nome: string;
  cognome: string;
  statusRaw: string;
}

interface StoredAssignment {
  assignedAt: Date;
  status: NormalizedStatus;
  rowRef: LeadRowRef | null;
  snapshot: LeadSnapshot;
}

export interface LeadCooldownDecision {
  shouldSkip: boolean;
  lastAssignedAt?: Date;
  blockedUntil?: Date;
  matchedOn?: "email" | "phone";
  matchedValue?: string;
}

export interface LeadRecurrenceDecision {
  action: "none" | "skip" | "reactivate";
  reason?:
    | "status_da_chiamare"
    | "status_appuntamento_fissato"
    | "status_non_risponde"
    | "status_chiamato"
    | "status_unknown";
  existing?: {
    assignedAt: Date;
    status: NormalizedStatus;
    rowRef: LeadRowRef | null;
    snapshot: LeadSnapshot;
    matchedOn: "email" | "phone";
    matchedValue: string;
  };
}

export interface ReactivationPayload {
  identity: { email?: string; phone?: string };
  listingId: string;
  assignmentDate: string;
  phone: string;
  zone: string;
  nome: string;
  cognome: string;
  leadEmail: string;
  processedAt: Date;
}

/**
 * Carica e mantiene in memoria gli ultimi contatti lead per email/telefono
 * sui tab agenti, per gestire duplicati/riattivazioni nel range 6 mesi.
 */
export class LeadAssignmentCooldown {
  private readonly targets: SheetTarget[];
  private readonly lastAssignmentByIdentity = new Map<string, StoredAssignment>();
  private loadPromise: Promise<void> | null = null;
  private loaded = false;

  constructor(private readonly env: AppEnv) {
    this.targets = buildTrackedTargets(env);
  }

  async shouldSkip(
    identity: { email?: string; phone?: string },
    now: Date,
  ): Promise<LeadCooldownDecision> {
    const decision = await this.evaluateRecurrence(identity, now);
    if (decision.action !== "skip") return { shouldSkip: false };

    return {
      shouldSkip: true,
      lastAssignedAt: decision.existing?.assignedAt,
      blockedUntil: decision.existing?.assignedAt
        ? addMonths(decision.existing.assignedAt, COOLDOWN_MONTHS)
        : undefined,
      matchedOn: decision.existing?.matchedOn,
      matchedValue: decision.existing?.matchedValue,
    };
  }

  async evaluateRecurrence(
    identity: { email?: string; phone?: string },
    now: Date,
  ): Promise<LeadRecurrenceDecision> {
    const keys = buildIdentityKeys(identity);
    if (keys.length === 0) return { action: "none" };

    await this.ensureLoaded();

    let best:
      | {
          assignedAt: Date;
          status: NormalizedStatus;
          rowRef: LeadRowRef | null;
          snapshot: LeadSnapshot;
          matchedOn: "email" | "phone";
          matchedValue: string;
        }
      | null = null;

    for (const key of keys) {
      const record = this.lastAssignmentByIdentity.get(key.key);
      if (!record) continue;
      if (!best || record.assignedAt.getTime() > best.assignedAt.getTime()) {
        best = {
          assignedAt: record.assignedAt,
          status: record.status,
          rowRef: record.rowRef,
          snapshot: record.snapshot,
          matchedOn: key.type,
          matchedValue: key.normalizedValue,
        };
      }
    }

    if (!best) return { action: "none" };

    const blockedUntil = addMonths(best.assignedAt, COOLDOWN_MONTHS);
    if (now >= blockedUntil) {
      return { action: "none" };
    }

    if (best.status === "da_chiamare") {
      return {
        action: "skip",
        reason: "status_da_chiamare",
        existing: best,
      };
    }
    if (best.status === "appuntamento_fissato") {
      return {
        action: "skip",
        reason: "status_appuntamento_fissato",
        existing: best,
      };
    }
    if (best.status === "non_risponde") {
      return {
        action: "reactivate",
        reason: "status_non_risponde",
        existing: best,
      };
    }
    if (best.status === "chiamato") {
      return {
        action: "reactivate",
        reason: "status_chiamato",
        existing: best,
      };
    }

    return {
      action: "skip",
      reason: "status_unknown",
      existing: best,
    };
  }

  async reactivateExistingRow(
    decision: LeadRecurrenceDecision,
    payload: ReactivationPayload,
  ): Promise<{ spreadsheetId: string; sheetTitle: string; rowNumber: number }> {
    if (decision.action !== "reactivate" || !decision.existing) {
      throw new Error("Decisione non valida: atteso action=reactivate con record esistente");
    }

    const rowRef = decision.existing.rowRef;
    if (!rowRef) {
      throw new Error("Impossibile riattivare: riferimento riga non disponibile");
    }

    const prev = decision.existing.snapshot;
    const leadEmail = payload.leadEmail || prev.leadEmail;
    const nextValues = [
      leadEmail,
      payload.listingId || prev.listingId,
      payload.assignmentDate,
      payload.phone || prev.phone,
      payload.zone || prev.zone,
      payload.nome || prev.nome,
      payload.cognome || prev.cognome,
      "Da Chiamare",
    ];

    const range = formatSheetRange(rowRef.sheetTitle, `A${rowRef.rowNumber}:H${rowRef.rowNumber}`);

    await withGoogleSheetsOperation((sheets) =>
      sheets.spreadsheets.values.update({
        spreadsheetId: rowRef.spreadsheetId,
        range,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [nextValues] },
      }),
      {
        spreadsheetId: rowRef.spreadsheetId,
        sheetTitle: rowRef.sheetTitle,
        range,
        operation: "values.update.reactivate",
      },
    );

    this.recordAssignment(
      { email: leadEmail, phone: payload.phone || prev.phone },
      payload.processedAt,
      {
        statusRaw: "Da Chiamare",
        rowRef,
        snapshot: {
          leadEmail,
          listingId: String(nextValues[1] ?? ""),
          phone: String(nextValues[3] ?? ""),
          zone: String(nextValues[4] ?? ""),
          nome: String(nextValues[5] ?? ""),
          cognome: String(nextValues[6] ?? ""),
          statusRaw: "Da Chiamare",
        },
      },
    );

    return rowRef;
  }

  recordAssignment(
    identity: { email?: string; phone?: string },
    assignedAt: Date,
    options?: {
      statusRaw?: string;
      rowRef?: LeadRowRef | null;
      snapshot?: Partial<LeadSnapshot>;
    },
  ): void {
    const keys = buildIdentityKeys(identity);
    if (keys.length === 0) return;

    const statusRaw = (options?.statusRaw ?? "Da Chiamare").trim();
    const status = normalizeStatus(statusRaw);
    const snapshot: LeadSnapshot = {
      leadEmail: options?.snapshot?.leadEmail ?? (identity.email ?? ""),
      listingId: options?.snapshot?.listingId ?? "",
      phone: options?.snapshot?.phone ?? (identity.phone ?? ""),
      zone: options?.snapshot?.zone ?? "",
      nome: options?.snapshot?.nome ?? "",
      cognome: options?.snapshot?.cognome ?? "",
      statusRaw,
    };

    for (const k of keys) {
      const current = this.lastAssignmentByIdentity.get(k.key);
      if (!current || assignedAt.getTime() > current.assignedAt.getTime()) {
        this.lastAssignmentByIdentity.set(k.key, {
          assignedAt,
          status,
          rowRef: options?.rowRef ?? null,
          snapshot,
        });
      }
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
    let loadedSheets = 0;

    for (const target of this.targets) {
      const range = formatSheetRange(target.sheetTitle, "A:H");
      try {
        const res = await withGoogleSheetsOperation((sheets) =>
          sheets.spreadsheets.values.get({
            spreadsheetId: target.spreadsheetId,
            range,
            valueRenderOption: "UNFORMATTED_VALUE",
            dateTimeRenderOption: "SERIAL_NUMBER",
          }),
          {
            spreadsheetId: target.spreadsheetId,
            sheetTitle: target.sheetTitle,
            range,
            operation: "values.get.cooldown",
          },
        );

        const rows = res.data.values ?? [];
        for (let i = 0; i < rows.length; i += 1) {
          const row = rows[i] ?? [];
          const assignedAt = parseSheetDateCell(row[2]);
          if (!assignedAt) continue;

          const leadEmail = cellToString(row[0]);
          const phone = cellToString(row[3]);
          const keys = buildIdentityKeys({ email: leadEmail, phone });
          if (keys.length === 0) continue;

          const statusRaw = cellToString(row[7]).trim() || "Da Chiamare";
          const record: StoredAssignment = {
            assignedAt,
            status: normalizeStatus(statusRaw),
            rowRef: {
              spreadsheetId: target.spreadsheetId,
              sheetTitle: target.sheetTitle,
              rowNumber: i + 1,
            },
            snapshot: {
              leadEmail,
              listingId: cellToString(row[1]),
              phone,
              zone: cellToString(row[4]),
              nome: cellToString(row[5]),
              cognome: cellToString(row[6]),
              statusRaw,
            },
          };

          for (const k of keys) {
            const current = this.lastAssignmentByIdentity.get(k.key);
            if (!current || record.assignedAt.getTime() > current.assignedAt.getTime()) {
              this.lastAssignmentByIdentity.set(k.key, record);
            }
          }
        }
        loadedSheets += 1;
      } catch (error) {
        log.warn(
          {
            err: error,
            spreadsheetId: target.spreadsheetId,
            sheetTitle: target.sheetTitle,
          },
          "Impossibile leggere tab per gestione contatti multipli: continuo con gli altri",
        );
      }
    }

    log.info(
      {
        loadedSheets,
        trackedContacts: this.lastAssignmentByIdentity.size,
      },
      "Gestione contatti multipli caricata (tab lead A:H)",
    );
  }
}

function buildTrackedTargets(env: AppEnv): SheetTarget[] {
  const out = new Map<string, SheetTarget>();
  const push = (spreadsheetId: string | undefined, sheetTitle: string | undefined): void => {
    const sid = (spreadsheetId ?? "").trim();
    const st = (sheetTitle ?? "").trim();
    if (!sid || !st) return;
    // Non usare tab di supporto/configurazione per il cooldown.
    if (st.toLowerCase() === env.MAPPING_SHEET_NAME.trim().toLowerCase()) return;
    out.set(`${sid}::${st}`, { spreadsheetId: sid, sheetTitle: st });
  };

  for (const rule of env.zoneSheetRules) {
    push(rule.spreadsheetId, rule.sheetTitle);
  }

  return [...out.values()];
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

function cellToString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function normalizeStatus(rawStatus: string): NormalizedStatus {
  const s = rawStatus
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");

  if (s === "da chiamare") return "da_chiamare";
  if (s === "non risponde") return "non_risponde";
  if (s === "chiamato") return "chiamato";
  if (
    s === "appuntamento fissato" ||
    s === "fissato appuntamento" ||
    (s.includes("appuntamento") && s.includes("fissat"))
  ) {
    return "appuntamento_fissato";
  }
  return "unknown";
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
