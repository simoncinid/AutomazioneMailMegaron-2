import nodemailer from "nodemailer";
import { resolve, dirname } from "node:path";
import type { Transporter } from "nodemailer";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import type { AppEnv } from "../config/loadEnv.js";
import { logger } from "../logging/logger.js";

const log = logger.child({ module: "leadAutoReply" });
const LOGO_CID = "megaron-logo";

function resolveLogoPath(): string | undefined {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(currentDir, "../public/logo.png"),
    resolve(process.cwd(), "dist/public/logo.png"),
    resolve(process.cwd(), "src/public/logo.png"),
    resolve(process.cwd(), "public/logo.png"),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

interface ReplyContact {
  fullName?: string;
  phone?: string;
  email: string;
  address?: string;
}

interface ReplyPayload {
  leadEmail: string;
  leadPhone?: string;
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function plainTextToHtml(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      if (!line.trim()) return '<p style="margin: 0 0 12px 0;">&nbsp;</p>';
      return `<p style="margin: 0 0 12px 0;">${escapeHtml(line)}</p>`;
    })
    .join("");
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
    const fullName = String((value as Record<string, unknown>).fullName ?? "").trim();
    const phone = String((value as Record<string, unknown>).phone ?? "").trim();
    const email = String((value as Record<string, unknown>).email ?? "").trim().toLowerCase();
    if (!email) continue;
    out.set(normalizeKey(sheet), { fullName: fullName || undefined, phone: phone || undefined, email });
  }
  return out;
}

const DEFAULT_PERSON_CONTACTS: Record<string, ReplyContact> = {
  rebecca: { fullName: "Rebecca Romiti", phone: "3407280036", email: "rebecca.romiti@megaronimmobiliare.it" },
  patrizia: { fullName: "Patrizia Forte", phone: "3888030328", email: "patrizia.forte@megaronimmobiliare.it" },
  fausto: { fullName: "Fausto Nassi", phone: "3664674898", email: "fausto.nassi@megaronimmobiliare.it" },
  elisabetta: { fullName: "Elisabetta Tinucci", phone: "3756116954", email: "elisabetta.tinucci@megaronimmobiliare.it" },
  attilio: { fullName: "Attilio Chinello", phone: "3478180313", email: "attiliochinello@megaronimmobiliare.it" },
  luis: { fullName: "Luis Cela", phone: "3270190216", email: "luis.cela@megaronimmobiliare.it" },
  matteo: { fullName: "Matteo Angelini", phone: "3355369662", email: "matteo.angelini@megaronimmobiliare.it" },
  viviana: { fullName: "Viviana Dagati", phone: "3200447626", email: "viviana.dagati@megaronimmobiliare.it" },
  massimiliano: { fullName: "Massimiliano Mencacci", phone: "3772500544", email: "massimiliano.mencacci@megaronimmobiliare.it" },
  guido: { fullName: "Guido Radicchi", phone: "3803746906", email: "guido.radicchi@megaronimmobiliare.it" },
  eros: { fullName: "Eros Nieri", phone: "3283787523", email: "eros.nieri@megaronimmobiliare.it" },
  alfredo: { fullName: "Alfredo Bertucci", phone: "3311231722", email: "alfredo.bertucci@megaronimmobiliare.it" },
  fernando: { fullName: "Fernando Satti", phone: "3311231721", email: "fernando.satti@megaronimmobiliare.it" },
  mary: { fullName: "Maryluz Sarvabui", phone: "3279396775", email: "maryluz.sarvabui@megaronimmobiliare.it" },
  davide: { fullName: "Davide Pedalà", phone: "3476756493", email: "davide.pedala@megaronimmobiliare.it" },
  samuele: { fullName: "Samuele Logli", phone: "3534667306", email: "samuele.logli@megaronimmobiliare.it" },
  giuseppe: { fullName: "Giuseppe Mililli", phone: "3341708218", email: "giuseppe.mililli@megaronimmobiliare.it" },
  tommaso: { fullName: "Tommaso Pasquini", phone: "3287555205", email: "tommaso.pasquini@megaronimmobiliare.it" },
  mattia: { fullName: "Mattia Pellegrini", phone: "3534667302", email: "mattia.pellegrini@megaronimmobiliare.it" },
  stefania: { fullName: "Stefania Lupo", phone: "3804137182", email: "stefania.lupo@megaronimmobiliare.it" },
  valentina: { fullName: "Valentina Foà", phone: "3395063633", email: "valentina.foa@megaronimmobiliare.it" },
  marco: { fullName: "Marco Rossi", phone: "3703124895", email: "marco.rossi@megaronimmobiliare.ot" },
  massimo: { fullName: "Massimo Nieri", phone: "3341488711", email: "massimo.nieri@megaronimmobiliare.it" },
  marta: { fullName: "Marta Genovesi", phone: "3333506005", email: "marta.genovesi@megaronimmobiliare.it" },
};

const AGENCY_PISA_CONTACT: ReplyContact = {
  phone: "050.500227",
  email: "pisa@megaronimmobiliare.it",
  address: "via Carlo Cattaneo n.59, Pisa",
};

const AGENCY_CONTACTS_BY_SHEET: Record<string, ReplyContact> = {
  ag: AGENCY_PISA_CONTACT,
  "ag-pisa": AGENCY_PISA_CONTACT,
  "ag-lucca": AGENCY_PISA_CONTACT,
  "ag-viareggio": {
    phone: "05841840552",
    email: "viareggio@megaronimmobiliare.it",
  },
  "ag-livorno": {
    email: "matteo.angelini@megaronimmobiliare.it",
  },
  "ag-pontedera": {
    email: "elisabetta.tinucci@megaronimmobiliare.it",
  },
};

function isAgencySheet(sheetTitle: string): boolean {
  return sheetTitle === "ag" || sheetTitle.startsWith("ag-");
}

export class LeadAutoReplyService {
  private readonly transporter: Transporter;
  private readonly agentContacts: Map<string, ReplyContact>;
  private readonly agencyFallbackContact: ReplyContact;

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
    const configuredAgentContacts = parseAgentContacts(this.env.AGENT_REPLY_CONTACTS_JSON);
    this.agencyFallbackContact = {
      phone: this.env.AGENCY_REPLY_PHONE?.trim() || AGENCY_PISA_CONTACT.phone,
      email: this.env.AGENCY_REPLY_EMAIL?.trim().toLowerCase() || AGENCY_PISA_CONTACT.email,
      address: AGENCY_PISA_CONTACT.address,
    };
    this.agentContacts = new Map<string, ReplyContact>();
    for (const [sheet, contact] of configuredAgentContacts.entries()) {
      this.agentContacts.set(normalizeKey(sheet), contact);
    }
    for (const [sheet, contact] of Object.entries(DEFAULT_PERSON_CONTACTS)) {
      this.agentContacts.set(normalizeKey(sheet), contact);
    }
  }

  private deriveFullName(contact: ReplyContact, sheetTitle: string): string {
    if (contact.fullName?.trim()) return contact.fullName.trim();
    const normalized = normalizeKey(sheetTitle);
    return normalized
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  async sendReplyForLeadAssignment(payload: ReplyPayload): Promise<void> {
    if (!payload.leadEmail.trim()) return;

    const normalizedSheet = normalizeKey(payload.sheetTitle);
    const agencyContactBySheet = AGENCY_CONTACTS_BY_SHEET[normalizedSheet] ?? this.agencyFallbackContact;
    const sheetIsAgency = isAgencySheet(normalizedSheet);
    const contact = sheetIsAgency ? agencyContactBySheet : this.agentContacts.get(normalizedSheet);
    if (!contact) {
      log.warn(
        { sheet: payload.sheetTitle },
        "Nessun contatto risposta configurato per il foglio: skip invio",
      );
      return;
    }

    const cleanSubject = payload.originalSubject.trim() || "Richiesta informazioni immobile";
    const subject = `Re: ${cleanSubject}`;
    const agentName = this.deriveFullName(contact, payload.sheetTitle);
    const customerPhone = payload.leadPhone?.trim() || "indicato nella richiesta";
    const logoPath = !sheetIsAgency ? resolveLogoPath() : undefined;
    const text = sheetIsAgency
      ? [
          "Grazie per averci contattato.",
          contact.phone
            ? `Per informazioni puoi contattare l'agenzia al numero ${contact.phone} e alla mail ${contact.email}.`
            : `Per informazioni puoi contattare l'agenzia alla mail ${contact.email}.`,
          contact.address
            ? `L'agenzia si trova in ${contact.address}.`
            : "",
        ].join("\n")
      : [
          "Grazie per averci contattato.",
          `La tua richiesta e' stata presa in carico dall'agente ${agentName} che la contattera' al numero ${customerPhone}.`,
          "",
          agentName,
          contact.phone ?? "",
          contact.email,
        ].join("\n");
    const html = !sheetIsAgency
      ? [
          '<div style="font-family: Arial, sans-serif; font-size: 14px; color: #111827;">',
          plainTextToHtml(text),
          logoPath
            ? `<img src="cid:${LOGO_CID}" alt="Megaron Immobiliare" style="display: block; width: 60px; height: auto; margin-top: 8px;" />`
            : "",
          "</div>",
        ].join("")
      : undefined;
    if (!sheetIsAgency && !logoPath) {
      log.warn({ sheet: payload.sheetTitle }, "Logo mail non trovato: invio senza logo inline");
    }

    const forcedRecipient = this.env.LEAD_REPLY_FORCE_TO.trim().toLowerCase();
    const recipient = forcedRecipient || payload.leadEmail.trim().toLowerCase();
    const replyToMessageId = maybeReplyMessageId(payload.originalMessageId);
    await this.transporter.sendMail({
      from: this.env.SMTP_FROM,
      to: recipient,
      subject,
      text,
      html,
      attachments: html && logoPath
        ? [
            {
              filename: "logo.png",
              path: logoPath,
              cid: LOGO_CID,
            },
          ]
        : undefined,
      inReplyTo: replyToMessageId,
      references: replyToMessageId ? [replyToMessageId] : undefined,
    });

    log.info(
      {
        sheet: payload.sheetTitle,
        leadEmail: payload.leadEmail,
        recipient,
      },
      "Risposta lead inviata",
    );
  }
}
