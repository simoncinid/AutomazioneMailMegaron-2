/**
 * Logica pura di routing QZ9 (mirror di scripts/qz9-redistribuzione-lead.gs).
 * Usata dai test per verificare redistribuzione senza Apps Script.
 */

export type Qz9RouteResult =
  | { mode: "keep" }
  | { mode: "skip"; reason: string }
  | {
      mode: "move";
      sourceType: "agency" | "agent";
      destPoolCodes: string[];
      routeKey: string;
      routeZone: string;
      routeReason: string;
    };

export const QZ9_AGENCY_ZONE_BY_SHEET: Record<string, string> = {
  "AG-PONTEDERA": "pontedera",
  "AG-LIVORNO": "livorno",
  "AG-PISA": "pisa",
  "AG-LUCCA": "lucca",
  "AG-VIAREGGIO": "viareggio",
};

export const QZ9_KEEP_AGENCY_SHEETS = new Set(["AG-PISA", "AG-LUCCA", "AG-VIAREGGIO"]);

export const QZ9_POOLS_BY_ZONE: Record<string, string[]> = {
  pontedera: ["luis", "rebecca", "fausto", "elisabetta"],
  livorno: ["matteo", "viviana", "massimiliano", "guido"],
  lucca: ["alfredo", "mary"],
  pisa: [
    "massimo",
    "davide",
    "eros",
    "samuele",
    "giuseppe",
    "tommaso",
    "mattia",
    "stefania",
    "marco",
    "luigi",
    "morgan",
  ],
  viareggio: [],
};

export const QZ9_AGENT_OWNER_ZONE_BY_CODE: Record<string, string> = {
  matteo: "livorno",
  viviana: "livorno",
  massimiliano: "livorno",
  guido: "livorno",
  lisa: "livorno",
  alfredo: "lucca",
  mary: "lucca",
  massimo: "pisa",
  davide: "pisa",
  eros: "pisa",
  samuele: "pisa",
  giuseppe: "pisa",
  tommaso: "pisa",
  mattia: "pisa",
  marco: "pisa",
  luigi: "pisa",
  stefania: "pisa",
  morgan: "pisa",
  luis: "pontedera",
  rebecca: "pontedera",
  fausto: "pontedera",
  elisabetta: "pontedera",
};

/** Sospesi: tab sorgente, fuori pool. */
export const QZ9_SUSPENDED_AGENT_OWNER_ZONE: Record<string, string> = {
  valentina: "pisa",
  antonio: "pontedera",
  giovanni: "lucca",
};

export const QZ9_AGENT_TAB_BY_CODE: Record<string, string> = {
  luis: "luis",
  rebecca: "rebecca",
  fausto: "fausto",
  elisabetta: "elisabetta",
  antonio: "antonio",
  matteo: "matteo",
  viviana: "viviana",
  massimiliano: "massimiliano",
  guido: "guido",
  lisa: "lisa",
  alfredo: "alfredo",
  mary: "mary",
  giovanni: "giovanni",
  massimo: "massimo",
  davide: "davide",
  eros: "eros",
  samuele: "samuele",
  giuseppe: "giuseppe",
  tommaso: "TOMMASO",
  mattia: "mattia",
  luigi: "luigi",
  stefania: "stefania",
  morgan: "morgan",
  valentina: "valentina",
  marco: "marco",
};

export const QZ9_PROVINCE_TO_ZONE: Record<string, string> = {
  pi: "pisa",
  pisa: "pisa",
  li: "livorno",
  livorno: "livorno",
  lu: "lucca",
  lucca: "lucca",
  pt: "pontedera",
  pontedera: "pontedera",
  viareggio: "viareggio",
  versilia: "viareggio",
};

export function qz9Norm(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[’‘‛`´ʼʹʻ＇]/g, "'")
    .replace(/\s+/g, " ");
}

export function qz9BuildAgentCodeBySheetNorm(
  tabByCode: Record<string, string> = QZ9_AGENT_TAB_BY_CODE,
): Map<string, string> {
  const m = new Map<string, string>();
  for (const [code, tab] of Object.entries(tabByCode)) {
    m.set(qz9Norm(tab), code);
  }
  return m;
}

export function qz9ResolveOwnerZone(sourceCode: string): string {
  return (
    QZ9_AGENT_OWNER_ZONE_BY_CODE[sourceCode] ||
    QZ9_SUSPENDED_AGENT_OWNER_ZONE[sourceCode] ||
    ""
  );
}

export function qz9ResolveZoneFromProvince(rawProvince: string): string {
  const raw = qz9Norm(rawProvince)
    .replace(/^provincia di\s+/, "")
    .replace(/^prov\.\s*/, "")
    .trim();
  if (!raw) return "";
  return QZ9_PROVINCE_TO_ZONE[raw] || "";
}

/**
 * Mirror di qz9ComputeRouteForSource nel .gs.
 */
export function qz9ComputeRouteForSource(
  sourceSheetName: string,
  agentCodeBySheetNorm: Map<string, string> = qz9BuildAgentCodeBySheetNorm(),
  provinceRaw = "",
  provinceRoutedAgents: Set<string> = new Set(),
): Qz9RouteResult {
  const agencyZone = QZ9_AGENCY_ZONE_BY_SHEET[sourceSheetName];
  if (agencyZone) {
    if (QZ9_KEEP_AGENCY_SHEETS.has(sourceSheetName)) return { mode: "keep" };

    const pool = (QZ9_POOLS_BY_ZONE[agencyZone] || []).slice();
    if (!pool.length) return { mode: "skip", reason: "pool_vuoto_" + agencyZone };

    return {
      mode: "move",
      sourceType: "agency",
      destPoolCodes: pool,
      routeKey: "agency_" + sourceSheetName,
      routeZone: agencyZone,
      routeReason: "agency_pool",
    };
  }

  const sourceCode = agentCodeBySheetNorm.get(qz9Norm(sourceSheetName));
  if (!sourceCode) return { mode: "skip", reason: "sorgente_non_mappata" };

  const ownerZone = qz9ResolveOwnerZone(sourceCode);
  if (!ownerZone) return { mode: "skip", reason: "owner_zone_mancante_" + sourceCode };

  let routeZone = ownerZone;
  let routeReason = "owner_zone";

  if (provinceRoutedAgents.has(sourceCode)) {
    const zoneFromProvince = qz9ResolveZoneFromProvince(provinceRaw);
    if (zoneFromProvince) {
      routeZone = zoneFromProvince;
      routeReason = "province_col_J";
    } else {
      routeReason = "province_unmapped_fallback_owner_zone";
    }
  }

  let zonePool = QZ9_POOLS_BY_ZONE[routeZone] || [];
  let destPool = zonePool.filter((code) => qz9Norm(code) !== qz9Norm(sourceCode));

  if (!destPool.length && routeZone !== ownerZone) {
    zonePool = QZ9_POOLS_BY_ZONE[ownerZone] || [];
    destPool = zonePool.filter((code) => qz9Norm(code) !== qz9Norm(sourceCode));
    routeZone = ownerZone;
    routeReason = routeReason + "_fallback";
  }

  if (!destPool.length) return { mode: "skip", reason: "no_altri_agenti_in_" + routeZone };

  return {
    mode: "move",
    sourceType: "agent",
    destPoolCodes: destPool,
    routeKey: "agent_" + sourceCode + "_" + routeZone,
    routeZone,
    routeReason,
  };
}

/** Round-robin: prossima destinazione nel pool (mirror cursore QZ9). */
export function qz9PickRoundRobinDest(
  destPoolCodes: string[],
  cursorByRouteKey: Map<string, number>,
  routeKey: string,
): string {
  if (!destPoolCodes.length) throw new Error("pool vuoto");
  const cursor = cursorByRouteKey.get(routeKey) ?? 0;
  const idx = cursor % destPoolCodes.length;
  cursorByRouteKey.set(routeKey, cursor + 1);
  return destPoolCodes[idx]!;
}
