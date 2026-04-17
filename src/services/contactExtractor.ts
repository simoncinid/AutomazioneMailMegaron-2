/**
 * Euristiche per nome e telefono da corpo mail / mittente.
 */

const PHONE_PATTERNS: RegExp[] = [
  /\+39\s?3\d{2}\s?\d{6,7}\b/g,
  /3\d{2}[\s.-]?\d{6,7}\b/g,
  /0\d{2,3}[\s.-]?\d{6,8}\b/g,
];

export function extractFirstPhone(text: string): string {
  const t = text.replace(/\s+/g, " ");
  for (const re of PHONE_PATTERNS) {
    re.lastIndex = 0;
    const m = re.exec(t);
    if (m) return m[0].replace(/\s+/g, " ").trim();
  }
  return "";
}

export function nomeFromEmailAddress(fromHeader: string): string {
  const m = /^"?([^"<]+)"?\s*<[^>]+>\s*$/.exec(fromHeader.trim());
  if (m) return m[1].trim();
  return "";
}
