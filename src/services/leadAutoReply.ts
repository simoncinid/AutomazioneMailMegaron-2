import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { AppEnv } from "../config/loadEnv.js";
import { logger } from "../logging/logger.js";

const log = logger.child({ module: "leadAutoReply" });

interface ReplyContact {
  phone: string;
  email: string;
}

interface ReplyPayload {
  leadEmail: string;
  sheetTitle: string;
  originalSubject: string;
  originalMessageId?: string;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function maybeReplyMessageId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!trimmed.includes("@")) return undefined;
  return trimmed;
}

function parseAgentContacts(raw: string): Map<string, ReplyContact> {
  const out = new Map<string, ReplyContact>();
  if (!raw.trim()) return out;

  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("AGENT_REPLY_CONTACTS_JSON deve essere un oggetto JSON");
  }

  for (const [sheet, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const phone = String((value as Record<string, unknown>).phone ?? "").trim();
    const email = String((value as Record<string, unknown>).email ?? "").trim().toLowerCase();
    if (!phone || !email) continue;
    out.set(normalizeKey(sheet), { phone, email });
  }
  return out;
}

export class LeadAutoReplyService {
  private readonly transporter: Transporter;
  private readonly forcedTo: string;
  private readonly agencyContact: ReplyContact;
  private readonly agentContacts: Map<string, ReplyContact>;

  constructor(private readonly env: AppEnv) {
    this.transporter = nodemailer.createTransport({
      host: this.env.SMTP_HOST,
      port: this.env.SMTP_PORT,
      secure: this.env.SMTP_SECURE,
      auth: {
        user: this.env.SMTP_USER,
        pass: this.env.SMTP_PASSWORD,
      },
    });
    this.forcedTo = this.env.LEAD_REPLY_FORCE_TO.trim().toLowerCase();
    this.agencyContact = {
      phone: this.env.AGENCY_REPLY_PHONE.trim(),
      email: this.env.AGENCY_REPLY_EMAIL.trim().toLowerCase(),
    };
    this.agentContacts = parseAgentContacts(this.env.AGENT_REPLY_CONTACTS_JSON);
  }

  async sendReplyForLeadAssignment(payload: ReplyPayload): Promise<void> {
    if (!payload.leadEmail.trim()) return;
    if (!this.forcedTo) {
      log.warn("LEAD_REPLY_FORCE_TO vuoto: risposta non inviata");
      return;
    }

    const normalizedSheet = normalizeKey(payload.sheetTitle);
    const isAgSheet = normalizedSheet === "ag";
    const contact = isAgSheet ? this.agencyContact : this.agentContacts.get(normalizedSheet);
    if (!contact) {
      log.warn(
        { sheet: payload.sheetTitle },
        "Nessun contatto risposta configurato per il foglio: skip invio",
      );
      return;
    }

    const cleanSubject = payload.originalSubject.trim() || "Richiesta informazioni immobile";
    const subject = `Re: ${cleanSubject}`;
    const text = isAgSheet
      ? [
          "Grazie per averci contattato.",
          `Per informazioni puoi contattare l'agenzia al numero ${contact.phone} e alla mail ${contact.email}.`,
        ].join("\n")
      : [
          "Grazie per averci contattato.",
          `La tua richiesta e' stata presa in carico da un agente. Puoi contattarlo al numero ${contact.phone} e alla mail ${contact.email}.`,
        ].join("\n");

    const replyToMessageId = maybeReplyMessageId(payload.originalMessageId);
    await this.transporter.sendMail({
      from: this.env.SMTP_FROM,
      to: this.forcedTo,
      subject,
      text: `${text}\n\n[TEST MODE]\nDestinatario reale lead: ${payload.leadEmail}`,
      inReplyTo: replyToMessageId,
      references: replyToMessageId ? [replyToMessageId] : undefined,
    });

    log.info(
      {
        sheet: payload.sheetTitle,
        forcedTo: this.forcedTo,
        realLeadEmail: payload.leadEmail,
      },
      "Risposta lead inviata (modalita' test)",
    );
  }
}
