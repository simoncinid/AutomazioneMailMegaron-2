/**
 * Euristiche per nome e telefono da corpo mail / mittente.
 */

const PHONE_PATTERN = /(?:\+\d{10,16}|\d{10,16})/g;
const BODY_EMAIL_PATTERN = /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/gi;
const FILE_LIKE_EMAIL_TLDS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "bmp",
  "ico",
  "tif",
  "tiff",
  "css",
  "js",
]);

export function extractFirstPhone(text: string): string {
  const t = text.replace(/\s+/g, " ");
  PHONE_PATTERN.lastIndex = 0;
  const m = PHONE_PATTERN.exec(t);
  if (m) return m[0].trim();
  return "";
}

export function nomeFromEmailAddress(fromHeader: string): string {
  const m = /^"?([^"<]+)"?\s*<[^>]+>\s*$/.exec(fromHeader.trim());
  if (m) return m[1].trim();
  return "";
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

export function isLikelyLeadEmail(email: string): boolean {
  const candidate = email.trim().toLowerCase();
  if (!candidate) return false;
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(candidate)) return false;
  const parts = candidate.split("@");
  if (parts.length !== 2) return false;
  const domain = parts[1] ?? "";
  const domainParts = domain.split(".");
  const tld = domainParts[domainParts.length - 1] ?? "";
  if (FILE_LIKE_EMAIL_TLDS.has(tld)) return false;
  return true;
}

export function extractFirstBodyEmail(
  textBody: string,
  htmlBody: string | undefined,
  blockedSubstrings: string[],
): string {
  const blob = [textBody, htmlBody ?? "", htmlBody ? stripHtml(htmlBody) : ""].join("\n");
  BODY_EMAIL_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BODY_EMAIL_PATTERN.exec(blob)) !== null) {
    const candidate = (m[1] ?? "").trim();
    if (!candidate) continue;
    const lowered = candidate.toLowerCase();
    if (blockedSubstrings.some((s) => lowered.includes(s.toLowerCase()))) continue;
    if (!isLikelyLeadEmail(candidate)) continue;
    return candidate;
  }
  return "";
}
