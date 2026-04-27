import { z } from "zod";
import type { AppEnv } from "../config/loadEnv.js";
import type { ParsedInboundEmail } from "../domain/types.js";

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_TEXT_BODY_CHARS = 20_000;
const MAX_HTML_BODY_CHARS = 60_000;

const aiLeadSchema = z.object({
  nome: z.string().default(""),
  numero_telefono: z.string().default(""),
  cognome: z.string().default(""),
  id_annuncio: z.string().default(""),
  email: z.string().default(""),
});

const SYSTEM_PROMPT = [
  "Sei un estrattore dati da email immobiliari.",
  "Devi rispondere solo con JSON valido (nessun testo extra).",
  "Output obbligatorio: {\"nome\":\"\",\"numero_telefono\":\"\",\"cognome\":\"\",\"id_annuncio\":\"\",\"email\":\"\"}.",
  "Regole estrazione ID annuncio:",
  "1) Cerca vicino a etichette come: \"Messaggio ricevuto per l’annuncio:\", \"Ref.\", \"Rif.\", \"Codice dell'annuncio:\", \"ID annuncio\".",
  "2) Esempi frequenti: trovatoimmobiliare -> \"Messaggio ricevuto per l’annuncio: <ID>\"; idealista/casa.it -> \"Ref. <ID>\".",
  "3) Non confondere ID con telefono, prezzo, CAP, civico, data/ora o codici email tecnici.",
  "4) Se trovi più candidati, scegli solo quello più chiaramente associato all'annuncio immobiliare (quando ce ne sono più di uno è quello vicino a 'Rif.' o 'Ref.', NON 'Codice dell'annuncio:')",
  "5) Se resta ambiguità, imposta id_annuncio a stringa vuota.",
  "Regole nome/cognome/email:",
  "- nome/cognome: del lead che scrive (non agente, non brand del portale).",
  "- email: indirizzo del lead, non noreply/indirizzi piattaforma se possibile.",
  "- Se un campo non è affidabile, usa stringa vuota.",
].join("\n");

export interface AiLeadExtraction {
  nome: string;
  numeroTelefono: string;
  cognome: string;
  idAnnuncio: string;
  email: string;
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n...[TRONCATO]`;
}

function sanitizeHtmlForModel(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=]+/g, "[image-removed]")
    .replace(/\s+/g, " ")
    .trim();
}

function parseJsonContent(content: string): z.infer<typeof aiLeadSchema> {
  const raw = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const parsed = JSON.parse(raw) as unknown;
  return aiLeadSchema.parse(parsed);
}

function normalizeName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeEmail(value: string): string {
  const lowered = value.trim().toLowerCase();
  const match = lowered.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return match?.[0] ?? "";
}

function normalizePhone(value: string): string {
  const compact = value.replace(/\s+/g, "").trim();
  const match = compact.match(/\+?\d{8,16}/);
  return match?.[0] ?? "";
}

function normalizeListingId(value: string): string {
  const clean = value
    .replace(/\s+/g, " ")
    .trim()
    .replace(
      /^(?:ref\.?|rif\.?|id(?:\s+dell['’]annuncio)?|codice(?:\s+dell['’]annuncio)?)\s*[:#.-]?\s*/i,
      "",
    )
    .trim();
  const token = clean.match(/[A-Za-z0-9][A-Za-z0-9._/-]{2,79}/)?.[0] ?? "";
  if (token.length < 4) return "";
  return token;
}

export async function extractLeadDataWithAi(
  email: ParsedInboundEmail,
  env: AppEnv,
): Promise<AiLeadExtraction> {
  const sanitizedHtml = sanitizeHtmlForModel(email.htmlBody ?? "");
  const textBody = truncate(email.textBody ?? "", MAX_TEXT_BODY_CHARS);
  const htmlBody = truncate(sanitizedHtml, MAX_HTML_BODY_CHARS);

  const userPrompt = [
    "Estrarre i campi richiesti dalla mail seguente.",
    "Se un campo non è certo, lascia stringa vuota.",
    "",
    `FROM: ${email.from ?? ""}`,
    `SUBJECT: ${email.subject ?? ""}`,
    "",
    "TEXT_BODY:",
    textBody || "(vuoto)",
    "",
    "HTML_BODY_SANITIZED:",
    htmlBody || "(vuoto)",
  ].join("\n");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let responseText = "";
  try {
    const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });

    responseText = await response.text();
    if (!response.ok) {
      throw new Error(`OpenAI ${response.status}: ${responseText.slice(0, 500)}`);
    }

    const payload = JSON.parse(responseText) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = payload.choices?.[0]?.message?.content ?? "";
    if (!content) {
      throw new Error("OpenAI response senza contenuto");
    }

    const parsed = parseJsonContent(content);
    return {
      nome: normalizeName(parsed.nome),
      numeroTelefono: normalizePhone(parsed.numero_telefono),
      cognome: normalizeName(parsed.cognome),
      idAnnuncio: normalizeListingId(parsed.id_annuncio),
      email: normalizeEmail(parsed.email),
    };
  } finally {
    clearTimeout(timeout);
  }
}
