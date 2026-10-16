import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SUSPENDED_LUCCA_AGENT_CODES,
  SUSPENDED_PISA_AGENT_CODES,
  SUSPENDED_PONTEDERA_AGENT_CODES,
} from "../src/config/suspendedAgents.js";
import {
  QZ9_AGENT_OWNER_ZONE_BY_CODE,
  QZ9_AGENT_TAB_BY_CODE,
  QZ9_KEEP_AGENCY_SHEETS,
  QZ9_POOLS_BY_ZONE,
  QZ9_SUSPENDED_AGENT_OWNER_ZONE,
  qz9BuildAgentCodeBySheetNorm,
  qz9ComputeRouteForSource,
  qz9PickRoundRobinDest,
} from "../src/config/qz9RedistribuzioneRouting.js";

const GS_PATH = resolve(process.cwd(), "scripts/qz9-redistribuzione-lead.gs");

function extractGsArrayBlock(source: string, constName: string): string {
  const re = new RegExp(`const ${constName}\\s*=\\s*\\{([\\s\\S]*?)\\n\\};`);
  const m = source.match(re);
  if (!m) throw new Error(`Blocco ${constName} non trovato in qz9 .gs`);
  return m[1]!;
}

function parseGsStringArrayField(block: string, key: string): string[] {
  const re = new RegExp(`${key}\\s*:\\s*\\[([^\\]]*)\\]`);
  const m = block.match(re);
  if (!m) throw new Error(`Campo array ${key} non trovato`);
  return [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
}

function parseGsStringMapKeys(block: string): string[] {
  return [...block.matchAll(/^\s*([a-z0-9_]+)\s*:/gim)].map((x) => x[1]!.toLowerCase());
}

describe("QZ9 config allineata al .gs", () => {
  const gs = readFileSync(GS_PATH, "utf8");

  it("pool Pisa/Pontedera/Lucca coincidono col mirror TS", () => {
    const poolsBlock = extractGsArrayBlock(gs, "qz9PoolsByZone");
    expect(parseGsStringArrayField(poolsBlock, "pisa")).toEqual(QZ9_POOLS_BY_ZONE.pisa);
    expect(parseGsStringArrayField(poolsBlock, "pontedera")).toEqual(QZ9_POOLS_BY_ZONE.pontedera);
    expect(parseGsStringArrayField(poolsBlock, "lucca")).toEqual(QZ9_POOLS_BY_ZONE.lucca);
  });

  it("sospesi allineati tra .gs e backend", () => {
    const suspendedBlock = extractGsArrayBlock(gs, "qz9SuspendedAgentOwnerZone");
    const suspendedKeys = parseGsStringMapKeys(suspendedBlock);
    expect(suspendedKeys).toEqual(
      expect.arrayContaining(["valentina", "antonio", "giovanni"]),
    );
    expect(suspendedKeys).not.toContain("marco");
    expect(QZ9_SUSPENDED_AGENT_OWNER_ZONE.valentina).toBe("pisa");
    expect(QZ9_SUSPENDED_AGENT_OWNER_ZONE.marco).toBeUndefined();
    expect(QZ9_SUSPENDED_AGENT_OWNER_ZONE.antonio).toBe("pontedera");
    expect(QZ9_SUSPENDED_AGENT_OWNER_ZONE.giovanni).toBe("lucca");
    expect([...SUSPENDED_PISA_AGENT_CODES]).toEqual(["valentina"]);
    expect([...SUSPENDED_PONTEDERA_AGENT_CODES]).toEqual(["antonio"]);
    expect([...SUSPENDED_LUCCA_AGENT_CODES]).toEqual(["giovanni"]);
  });

  it("valentina/antonio/giovanni fuori dai pool attivi; marco nel pool Pisa", () => {
    expect(QZ9_POOLS_BY_ZONE.pisa).not.toContain("valentina");
    expect(QZ9_POOLS_BY_ZONE.pisa).toContain("marco");
    expect(QZ9_POOLS_BY_ZONE.pontedera).not.toContain("antonio");
    expect(QZ9_POOLS_BY_ZONE.lucca).not.toContain("giovanni");
    expect(QZ9_AGENT_OWNER_ZONE_BY_CODE.valentina).toBeUndefined();
    expect(QZ9_AGENT_OWNER_ZONE_BY_CODE.marco).toBe("pisa");
    expect(QZ9_AGENT_OWNER_ZONE_BY_CODE.antonio).toBeUndefined();
    expect(QZ9_AGENT_OWNER_ZONE_BY_CODE.giovanni).toBeUndefined();
  });

  it("morgan/marco attivi; antonio/giovanni solo in tab map sospesi", () => {
    expect(QZ9_POOLS_BY_ZONE.pisa).toContain("morgan");
    expect(QZ9_AGENT_TAB_BY_CODE.morgan).toBe("morgan");
    expect(QZ9_AGENT_TAB_BY_CODE.marco).toBe("marco");
    expect(QZ9_AGENT_TAB_BY_CODE.antonio).toBe("antonio");
    expect(QZ9_AGENT_TAB_BY_CODE.giovanni).toBe("giovanni");
  });
});

describe("QZ9 routing redistribuzione", () => {
  const agentMap = qz9BuildAgentCodeBySheetNorm();

  it("AG-PISA / AG-LUCCA / AG-VIAREGGIO restano KEEP", () => {
    for (const sheet of QZ9_KEEP_AGENCY_SHEETS) {
      expect(qz9ComputeRouteForSource(sheet, agentMap)).toEqual({ mode: "keep" });
    }
  });

  it("AG-PONTEDERA muove sul pool Pontedera attivo (senza antonio)", () => {
    const r = qz9ComputeRouteForSource("AG-PONTEDERA", agentMap);
    expect(r.mode).toBe("move");
    if (r.mode !== "move") return;
    expect(r.routeZone).toBe("pontedera");
    expect(r.destPoolCodes).toEqual(["luis", "rebecca", "fausto", "elisabetta"]);
    expect(r.destPoolCodes).not.toContain("antonio");
  });

  it("AG-LIVORNO muove sul pool Livorno", () => {
    const r = qz9ComputeRouteForSource("AG-LIVORNO", agentMap);
    expect(r.mode).toBe("move");
    if (r.mode !== "move") return;
    expect(r.destPoolCodes).toEqual(QZ9_POOLS_BY_ZONE.livorno);
  });

  it("tab valentina (sospesa) redistribuisce al pool Pisa esclusa se stessa", () => {
    const r = qz9ComputeRouteForSource("valentina", agentMap);
    expect(r.mode).toBe("move");
    if (r.mode !== "move") return;
    expect(r.routeZone).toBe("pisa");
    expect(r.destPoolCodes).not.toContain("valentina");
    expect(r.destPoolCodes).toContain("marco");
    expect(r.destPoolCodes).toContain("morgan");
  });

  it("tab marco (attivo) redistribuisce agli altri Pisa (senza marco)", () => {
    const r = qz9ComputeRouteForSource("marco", agentMap);
    expect(r.mode).toBe("move");
    if (r.mode !== "move") return;
    expect(r.routeZone).toBe("pisa");
    expect(r.destPoolCodes).not.toContain("marco");
    expect(r.destPoolCodes).toContain("morgan");
  });

  it("tab morgan redistribuisce agli altri Pisa (senza morgan)", () => {
    const r = qz9ComputeRouteForSource("morgan", agentMap);
    expect(r.mode).toBe("move");
    if (r.mode !== "move") return;
    expect(r.destPoolCodes).not.toContain("morgan");
    expect(r.destPoolCodes).toContain("massimo");
  });

  it("tab antonio (sospeso) redistribuisce al pool Pontedera", () => {
    const r = qz9ComputeRouteForSource("antonio", agentMap);
    expect(r.mode).toBe("move");
    if (r.mode !== "move") return;
    expect(r.routeZone).toBe("pontedera");
    expect(r.destPoolCodes).not.toContain("antonio");
    expect(r.destPoolCodes).toEqual(["luis", "rebecca", "fausto", "elisabetta"]);
  });

  it("tab giovanni (sospeso) redistribuisce al pool Lucca", () => {
    const r = qz9ComputeRouteForSource("giovanni", agentMap);
    expect(r.mode).toBe("move");
    if (r.mode !== "move") return;
    expect(r.routeZone).toBe("lucca");
    expect(r.destPoolCodes).not.toContain("giovanni");
    expect(r.destPoolCodes).toEqual(["alfredo", "mary"]);
  });

  it("TOMMASO (casing tab) è riconosciuto come tommaso", () => {
    const r = qz9ComputeRouteForSource("TOMMASO", agentMap);
    expect(r.mode).toBe("move");
    if (r.mode !== "move") return;
    expect(r.routeKey).toBe("agent_tommaso_pisa");
  });

  it("round-robin su lead da valentina cicla il pool Pisa", () => {
    const r = qz9ComputeRouteForSource("valentina", agentMap);
    expect(r.mode).toBe("move");
    if (r.mode !== "move") return;

    const cursor = new Map<string, number>();
    const picks: string[] = [];
    for (let i = 0; i < r.destPoolCodes.length + 2; i += 1) {
      picks.push(qz9PickRoundRobinDest(r.destPoolCodes, cursor, r.routeKey));
    }

    expect(picks[0]).toBe("massimo");
    expect(picks[1]).toBe("davide");
    expect(picks[r.destPoolCodes.length - 1]).toBe("morgan");
    expect(picks[r.destPoolCodes.length]).toBe("massimo");
    expect(picks).not.toContain("valentina");
  });

  it("sorgente sconosciuta → skip", () => {
    expect(qz9ComputeRouteForSource("inesistente", agentMap)).toEqual({
      mode: "skip",
      reason: "sorgente_non_mappata",
    });
  });
});
