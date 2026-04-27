import { z } from "zod";
import type { AppEnv } from "../config/loadEnv.js";
import type { ParsedInboundEmail } from "../domain/types.js";

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 15_000;
/** Un solo blocco testo in prompt; ridotto vs duplicare text+html grezzo */
const MAX_COMBINED_BODY_CHARS = 16_000;

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

/** Rimuove base64, URL lunghi, commenti, poi tutti i tag: resta testo per il modello (meno token). */
export function htmlToVisibleText(html: string): string {
  if (!html.trim()) return "";
  const collapsedWhitespace = (s: string) => s.replace(/\s+/g, " ").trim();
  const decodeBasicEntities = (s: string) =>
    s
      .replace(/&nbsp;/gi, " ")
      .replace(/&ndash;|&mdash;/gi, "–")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_, d) => {
        const n = Number.parseInt(d, 10);
        return Number.isFinite(n) && n > 0 && n < 0x11_00_00 ? String.fromCodePoint(n) : "";
      })
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
        const n = Number.parseInt(h, 16);
        return Number.isFinite(n) && n > 0 && n < 0x11_00_00 ? String.fromCodePoint(n) : "";
      });

  let s = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<object[\s\S]*?<\/object>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<template[\s\S]*?<\/template>/gi, " ")
    .replace(/<meta\b[^>]*>/gi, " ")
    .replace(/<link\b[^>]*>/gi, " ")
    .replace(/<img\b[^>]*>/gi, " ");
  s = s.replace(/data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=\s]+/g, " ");
  s = s.replace(/https?:\/\/[^\s]{400,}/g, "[url]");
  s = s
    .replace(/<\/(p|div|tr|h[1-6]|li)\b[^>]*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  s = decodeBasicEntities(s);
  s = stripCssLikeResidue(s);
  return collapsedWhitespace(s);
}

/** Residui di CSS ancora in chiaro (es. &lt;style&gt; troncato o regole non tra tag). */
function stripCssLikeResidue(s: string): string {
  let out = s.replace(/\/\*[\s\S]*?\*\//g, " ");
  for (let i = 0; i < 30; i++) {
    const next = out.replace(/\{[^{}]{12,5000}\}/g, (bl) => {
      const inner = bl.slice(1, -1);
      if (inner.includes(":") && (inner.includes(";") || inner.includes("!important"))) return " ";
      return bl;
    });
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * Unisce text/plain e testo da HTML: evita di mandare due volte lo stesso contenuto (risparmio token).
 * Esposta perché viene riutilizzata anche per la colonna "corpo" sui fogli diagnostici (`no-id-trovato`,
 * `no-singolo-id`), così quanto scritto sul foglio è esattamente ciò che riceve OpenAI.
 */
export function buildCombinedBodyForModel(textBody: string, htmlBody: string): string {
  const t = (textBody ?? "").replace(/\s+/g, " ").trim();
  const h = htmlToVisibleText(htmlBody ?? "");
  if (!h && !t) return "";
  if (!h) return t;
  if (!t) return h;
  const tShort = t.length > 200 ? t.slice(0, 200) : t;
  const hShort = h.length > 200 ? h.slice(0, 200) : h;
  if (h.includes(tShort) || t.includes(hShort)) {
    return t.length >= h.length ? t : h;
  }
  return `${t}\n---\n${h}`;
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
  const combined = buildCombinedBodyForModel(
    email.textBody ?? "",
    email.htmlBody ?? "",
  );
  const bodyForModel = truncate(combined, MAX_COMBINED_BODY_CHARS);

  const userPrompt = [
    "Estrarre i campi richiesti dalla mail seguente.",
    "Se un campo non è certo, lascia stringa vuota.",
    "Sotto: CORPO contiene testo in chiaro (eventualmente unione di parte testuale + estrazione da HTML, senza tag).",
    "",
    `FROM: ${email.from ?? ""}`,
    `SUBJECT: ${email.subject ?? ""}`,
    "",
    "CORPO:",
    bodyForModel || "(vuoto)",
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
