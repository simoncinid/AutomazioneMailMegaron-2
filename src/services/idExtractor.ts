/**
 * Estrae uno o più ID annuncio Gestim / esterni dal testo o HTML email.
 * I formati reali possono variare: qui usiamo euristiche configurabili + regex.
 */

const DEFAULT_EXTRA_PATTERNS: RegExp[] = [
  // id=ABC123 in URL (?id= o &id=) o in attributi HTML grezzi
  /[?&](?:id|listing|listingId|annuncio|codice)=([A-Za-z0-9._-]{4,64})/gi,
  // testo libero: "id=ABC123" (anche senza ?)
  /(?:^|[\s>])(?:id|listing|listingId|annuncio|codice)=([A-Za-z0-9._-]{4,64})/gim,
  // path .../annunci/ABC123 o /listing/ABC123
  /\/(?:annunci?|listings?|immobile|detail)\/([A-Za-z0-9._-]{4,64})(?:\/|\?|"|'|$)/gi,
  // Etichette tipo "Codice: XYZ" o "Rif. R123"
  /(?:codice|rif\.?|reference|id)\s*[:#]?\s*([A-Za-z0-9._-]{4,64})/gi,
];

export interface IdExtractorOptions {
  /** Regex aggiuntive (stringa pattern, flag i spesso utile) */
  extraRegexStrings?: string[];
}

function normalizeId(raw: string): string {
  return raw.trim();
}

/**
 * Raccoglie candidati unici, ordine di prima apparizione.
 */
export function extractExternalListingIds(
  text: string,
  html: string | undefined,
  options: IdExtractorOptions = {},
): string[] {
  const combined = [text, html ?? ""].join("\n");
  const rawHtml = html ?? "";
  const strippedHtml = rawHtml.replace(/<script[\s\S]*?<\/script>/gi, " ");
  const visibleApprox = strippedHtml.replace(/<[^>]+>/g, " ");
  // Includere HTML grezzo: negli href compaiono query ?id= che altrimenti si perdono togliendo i tag
  const blob = `${text}\n${rawHtml}\n${visibleApprox}`;

  const seen = new Set<string>();
  const out: string[] = [];

  const tryAdd = (s: string | undefined) => {
    const n = normalizeId(s ?? "");
    if (n.length < 4 || n.length > 80) return;
    if (seen.has(n)) return;
    seen.add(n);
    out.push(n);
  };

  for (const re of DEFAULT_EXTRA_PATTERNS) {
    let m: RegExpExecArray | null;
    const r = new RegExp(re.source, re.flags);
    while ((m = r.exec(blob)) !== null) {
      tryAdd(m[1]);
    }
  }

  if (options.extraRegexStrings) {
    for (const pat of options.extraRegexStrings) {
      const r = new RegExp(pat, "gi");
      let m: RegExpExecArray | null;
      while ((m = r.exec(combined)) !== null) {
        const cap = m[1] ?? m[0];
        tryAdd(cap);
      }
    }
  }

  return out;
}
