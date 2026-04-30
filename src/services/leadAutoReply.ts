import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { AppEnv } from "../config/loadEnv.js";
import { logger } from "../logging/logger.js";

const log = logger.child({ module: "leadAutoReply" });

interface ReplyContact {
  phone: string;
  email: string;
  address?: string;
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

const DEFAULT_PERSON_CONTACTS: Record<string, ReplyContact> = {
  rebecca: { phone: "3407280036", email: "rebecca.romiti@megaronimmobiliare.it" },
  patrizia: { phone: "3888030328", email: "patrizia.forte@megaronimmobiliare.it" },
  fausto: { phone: "3664674898", email: "fausto.nassi@megaronimmobiliare.it" },
  elisabetta: { phone: "3756116954", email: "elisabetta.tinucci@megaronimmobiliare.it" },
  attilio: { phone: "3478180313", email: "attiliochinello@megaronimmobiliare.it" },
  luis: { phone: "3270190216", email: "luis.cela@megaronimmobiliare.it" },
  matteo: { phone: "3355369662", email: "matteo.angelini@megaronimmobiliare.it" },
  viviana: { phone: "3200447626", email: "viviana.dagati@megaronimmobiliare.it" },
  massimiliano: { phone: "3772500544", email: "massimiliano.mencacci@megaronimmobiliare.it" },
  guido: { phone: "3803746906", email: "guido.radicchi@megaronimmobiliare.it" },
  eros: { phone: "3283787523", email: "eros.nieri@megaronimmobiliare.it" },
  alfredo: { phone: "3311231722", email: "alfredo.bertucci@megaronimmobiliare.it" },
  fernando: { phone: "3311231721", email: "fernando.satti@megaronimmobiliare.it" },
  mary: { phone: "3279396775", email: "maryluz.sarvabui@megaronimmobiliare.it" },
  davide: { phone: "3476756493", email: "davide.pedala@megaronimmobiliare.it" },
  samuele: { phone: "3534667306", email: "samuele.logli@megaronimmobiliare.it" },
  giuseppe: { phone: "3341708218", email: "giuseppe.mililli@megaronimmobiliare.it" },
  tommaso: { phone: "3287555205", email: "tommaso.pasquini@megaronimmobiliare.it" },
  mattia: { phone: "3534667302", email: "mattia.pellegrini@megaronimmobiliare.it" },
  stefania: { phone: "3804137182", email: "stefania.lupo@megaronimmobiliare.it" },
  valentina: { phone: "3395063633", email: "valentina.foa@megaronimmobiliare.it" },
  massimo: { phone: "3341488711", email: "massimo.nieri@megaronimmobiliare.it" },
};

const AGENCY_PISA_CONTACT: ReplyContact = {
  phone: "050.500227",
  email: "pisa@megaronimmobiliare.it",
  address: "via Carlo Cattaneo n.59, Pisa",
};

const AGENCY_CONTACTS_BY_SHEET: Record<string, ReplyContact> = {
  "ag-pisa": AGENCY_PISA_CONTACT,
  "ag-lucca": AGENCY_PISA_CONTACT,
  "ag-viareggio": {
    phone: "05841840552",
    email: "viareggio@megaronimmobiliare.it",
  },
};

export class LeadAutoReplyService {
  private readonly transporter: Transporter;
  private readonly forcedTo: string;
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
    const configuredAgentContacts = parseAgentContacts(this.env.AGENT_REPLY_CONTACTS_JSON);
    this.agentContacts = new Map<string, ReplyContact>();
    for (const [sheet, contact] of Object.entries(DEFAULT_PERSON_CONTACTS)) {
      this.agentContacts.set(normalizeKey(sheet), contact);
    }
    for (const [sheet, contact] of configuredAgentContacts.entries()) {
      this.agentContacts.set(normalizeKey(sheet), contact);
    }
  }

  async sendReplyForLeadAssignment(payload: ReplyPayload): Promise<void> {
    if (!payload.leadEmail.trim()) return;
    if (!this.forcedTo) {
      log.warn("LEAD_REPLY_FORCE_TO vuoto: risposta non inviata");
      return;
    }

    const normalizedSheet = normalizeKey(payload.sheetTitle);
    const agencyContactBySheet = AGENCY_CONTACTS_BY_SHEET[normalizedSheet];
    const isAgencySheet = Boolean(agencyContactBySheet);
    const contact = isAgencySheet ? agencyContactBySheet : this.agentContacts.get(normalizedSheet);
    if (!contact) {
      log.warn(
        { sheet: payload.sheetTitle },
        "Nessun contatto risposta configurato per il foglio: skip invio",
      );
      return;
    }

    const cleanSubject = payload.originalSubject.trim() || "Richiesta informazioni immobile";
    const subject = `Re: ${cleanSubject}`;
    const text = isAgencySheet
      ? [
          "Grazie per averci contattato.",
          `Per informazioni puoi contattare l'agenzia al numero ${contact.phone} e alla mail ${contact.email}.`,
          contact.address
            ? `L'agenzia si trova in ${contact.address}.`
            : "",
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
