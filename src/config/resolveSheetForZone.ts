import type { ResolvedSheetTarget, ZoneSheetRule } from "../domain/types.js";

export interface ZoneResolutionContext {
  city?: string | null;
  province?: string | null;
}

function normalizeKey(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[’‘‛`´ʼʹʻ＇]/g, "'")
    .replace(/\s+/g, " ");
}

function isUnassignedZone(zone: string | null | undefined): boolean {
  const z = normalizeKey(zone);
  return z === "nessuno" || z === "nessuna" || z === "nessuna zona" || z === "no zona";
}

/**
 * Disambiguazione zone ambigue (city/province).
 * RIATTIVARE agente in ferie: cercare "FERIE <NOME>" e ripristinare il return originale.
 * Checklist: src/config/suspendedAgents.ts
 */
function pickSheetByZoneCityProvince(
  zone: string,
  city: string | null | undefined,
  province: string | null | undefined,
): string | null {
  const z = normalizeKey(zone);
  const c = normalizeKey(city);
  const p = normalizeKey(province);

  const cityIn = (...candidates: string[]) => candidates.some((x) => c === normalizeKey(x));
  const provinceIn = (...candidates: string[]) => candidates.some((x) => p === normalizeKey(x));

  // Evita che varianti "San Romano (...)" finiscano nel cluster AG-PISA:
  // per il territorio Pisa/Pontedera devono andare su AG-PONTEDERA.
  // Manteniamo esclusa Garfagnana, che ha routing dedicato.
  if ((z === "san romano" || z.includes("san romano")) && !z.includes("garfagnana")) {
    return "AG-PONTEDERA";
  }

  switch (z) {
    case "capoluogo":
      if (cityIn("calci")) return "GIUSEPPE";
      if (cityIn("san giuliano terme")) return "DAVIDE";
      if (cityIn("castelfranco di sotto")) return "AG-PONTEDERA";
      if (cityIn("vicopisano")) return "LUIS";
      if (cityIn("cascina")) return "TOMMASO";
      if (cityIn("vecchiano")) return "DAVIDE";
      return null;
    case "centro":
      if (cityIn("viareggio")) return "AG-VIAREGGIO";
      if (cityIn("pontedera")) return "AG-PONTEDERA"; // FERIE ELISABETTA: era "ELISABETTA"
      return null;
    case "centro storico":
      if (cityIn("livorno")) return "GUIDO";
      if (cityIn("ponsacco")) return "AG-PONTEDERA";
      return null;
    case "cevoli":
      if (cityIn("vicopisano")) return "LUIS";
      if (cityIn("casciana terme lari")) return "FAUSTO";
      return null;
    case "darsena":
      if (cityIn("livorno")) return "AG-LIVORNO";
      if (cityIn("viareggio")) return "AG-VIAREGGIO";
      return null;
    case "gello":
      if (cityIn("montecatini val di cecina")) return "AG-PONTEDERA";
      if (cityIn("pontedera")) return "AG-PONTEDERA";
      if (cityIn("palaia")) return "AG-PONTEDERA";
      if (cityIn("san giuliano terme")) return "DAVIDE";
      return null;
    case "la pieve":
      if (cityIn("calci")) return "GIUSEPPE";
      if (cityIn("chianni")) return "AG-PONTEDERA";
      return null;
    case "lorenzana":
      if (cityIn("crespina lorenzana")) return "FAUSTO";
      if (provinceIn("pisa")) return "AG-PISA";
      return null;
    case "marciana":
      if (cityIn("cascina")) return "TOMMASO";
      if (provinceIn("livorno")) return "AG-LIVORNO";
      return null;
    case "montecchio":
      if (cityIn("calcinaia")) return "AG-PONTEDERA";
      if (cityIn("peccioli")) return "AG-PONTEDERA";
      return null;
    case "pardossi":
      if (cityIn("calcinaia")) return "AG-PONTEDERA";
      if (cityIn("pontedera")) return "AG-PONTEDERA";
      return null;
    case "porta a mare":
      if (cityIn("pisa")) return "MARCO";
      if (cityIn("livorno")) return "GUIDO";
      return null;
    case "quattro strade":
      if (cityIn("casciana terme lari")) return "FAUSTO";
      if (cityIn("bientina")) return "AG-PONTEDERA";
      return null;
    case "quatro strade":
      if (cityIn("casciana terme lari")) return "AG-PONTEDERA";
      if (cityIn("bientina")) return "AG-PONTEDERA";
      return null;
    case "san donato":
      if (cityIn("santa maria a monte")) return "AG-PONTEDERA";
      if (cityIn("lucca")) return "AG-LUCCA";
      return null;
    case "san marco":
      if (cityIn("pisa")) return "AG-PISA";
      if (cityIn("lucca")) return "AG-LUCCA";
      return null;
    case "san giusto":
      if (cityIn("pisa")) return "AG-PISA";
      if (cityIn("lucca")) return "AG-LUCCA";
      return null;
    case "sant'anna":
      if (cityIn("lucca")) return "AG-LUCCA";
      if (cityIn("cascina")) return "TOMMASO";
      return null;
    case "santa lucia":
      if (cityIn("calci")) return "GIUSEPPE";
      if (cityIn("pontedera")) return "AG-PONTEDERA";
      return null;
    case "stazione":
      if (cityIn("pontedera")) return "AG-PONTEDERA"; // FERIE ELISABETTA: era "ELISABETTA"
      // FERIE SAMUELE: ripristinato — era "AG-PISA" in ferie
      if (cityIn("pisa")) return "SAMUELE";
      return null;
    case "usigliano":
      if (cityIn("palaia")) return "AG-PONTEDERA";
      if (cityIn("casciana terme lari")) return "FAUSTO";
      return null;
    default:
      return null;
  }
}

function resolveByExplicitSheetTitle(
  zone: string,
  explicitSheetTitle: string,
  rules: ZoneSheetRule[],
  defaultSpreadsheetId: string,
): ResolvedSheetTarget {
  const z = normalizeKey(zone);
  const t = normalizeKey(explicitSheetTitle);

  const exactRule = rules.find(
    (r) => normalizeKey(r.pattern) === z && normalizeKey(r.sheetTitle) === t,
  );
  if (exactRule) {
    return {
      spreadsheetId: exactRule.spreadsheetId,
      sheetTitle: exactRule.sheetTitle,
      matchedRule: exactRule,
      fallback: false,
    };
  }

  const sameSheetRule = rules.find((r) => normalizeKey(r.sheetTitle) === t);
  return {
    spreadsheetId: sameSheetRule?.spreadsheetId ?? defaultSpreadsheetId,
    sheetTitle: explicitSheetTitle,
    matchedRule: sameSheetRule ?? null,
    fallback: false,
  };
}

/**
 * Risolve spreadsheet + tab in base al testo `zone` e alle regole ordinate.
 * Prima regola che matcha vince.
 */
export function resolveSheetForZone(
  zone: string | null | undefined,
  rules: ZoneSheetRule[],
  defaultSpreadsheetId: string,
  defaultSheetTitle: string,
  context?: ZoneResolutionContext,
): ResolvedSheetTarget {
  const z = (zone ?? "").trim();
  if (!z) {
    return {
      spreadsheetId: defaultSpreadsheetId,
      sheetTitle: defaultSheetTitle,
      matchedRule: null,
      fallback: true,
      resolutionSource: "default_fallback",
    };
  }

  const disambiguatedSheet = pickSheetByZoneCityProvince(z, context?.city, context?.province);
  if (disambiguatedSheet) {
    const resolved = resolveByExplicitSheetTitle(
      z,
      disambiguatedSheet,
      rules,
      defaultSpreadsheetId,
    );
    return {
      ...resolved,
      resolutionSource: "disambiguation",
      disambiguationHint: `zone="${z}" city="${(context?.city ?? "").trim()}" province="${(context?.province ?? "").trim()}" -> sheet="${disambiguatedSheet}"`,
    };
  }

  if (isUnassignedZone(z)) {
    const city = (context?.city ?? "").trim();
    if (city) {
      for (const rule of rules) {
        if (matchesZone(city, rule)) {
          return {
            spreadsheetId: rule.spreadsheetId,
            sheetTitle: rule.sheetTitle,
            matchedRule: rule,
            fallback: false,
            resolutionSource: "mapping_rule",
          };
        }
      }
    }
  }

  for (const rule of rules) {
    if (matchesZone(z, rule)) {
      return {
        spreadsheetId: rule.spreadsheetId,
        sheetTitle: rule.sheetTitle,
        matchedRule: rule,
        fallback: false,
        resolutionSource: "mapping_rule",
      };
    }
  }

  return {
    spreadsheetId: defaultSpreadsheetId,
    sheetTitle: defaultSheetTitle,
    matchedRule: null,
    fallback: true,
    resolutionSource: "default_fallback",
  };
}

export function matchesZone(zone: string, rule: ZoneSheetRule): boolean {
  const z = normalizeKey(zone);
  const p = normalizeKey(rule.pattern);
  switch (rule.match) {
    case "equals":
      return z === p;
    case "contains":
      return z.includes(p);
    case "regex": {
      const re = new RegExp(rule.pattern, "i");
      return re.test(zone.trim());
    }
    default:
      return false;
  }
}
