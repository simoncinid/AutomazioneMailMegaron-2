import type { ResolvedSheetTarget, ZoneSheetRule } from "../domain/types.js";

/**
 * Risolve spreadsheet + tab in base al testo `zone` e alle regole ordinate.
 * Prima regola che matcha vince.
 */
export function resolveSheetForZone(
  zone: string | null | undefined,
  rules: ZoneSheetRule[],
  defaultSpreadsheetId: string,
  defaultSheetTitle: string,
): ResolvedSheetTarget {
  const z = (zone ?? "").trim();
  if (!z) {
    return {
      spreadsheetId: defaultSpreadsheetId,
      sheetTitle: defaultSheetTitle,
      matchedRule: null,
      fallback: true,
    };
  }

  for (const rule of rules) {
    if (matchesZone(z, rule)) {
      return {
        spreadsheetId: rule.spreadsheetId,
        sheetTitle: rule.sheetTitle,
        matchedRule: rule,
        fallback: false,
      };
    }
  }

  return {
    spreadsheetId: defaultSpreadsheetId,
    sheetTitle: defaultSheetTitle,
    matchedRule: null,
    fallback: true,
  };
}

export function matchesZone(zone: string, rule: ZoneSheetRule): boolean {
  const z = zone.trim();
  const p = rule.pattern;
  switch (rule.match) {
    case "equals":
      return z.toLowerCase() === p.toLowerCase();
    case "contains":
      return z.toLowerCase().includes(p.toLowerCase());
    case "regex": {
      const re = new RegExp(p, "i");
      return re.test(z);
    }
    default:
      return false;
  }
}
