import { describe, expect, it } from "vitest";
import { getHardCodedZoneSheetMapping } from "../src/config/loadEnv.js";
import { resolveSheetForZone } from "../src/config/resolveSheetForZone.js";
import {
  isSuspendedLuccaAgentSheet,
  isSuspendedPontederaAgentSheet,
  isSuspendedPisaAgentSheet,
} from "../src/config/suspendedAgents.js";
import type { ZoneSheetRule } from "../src/domain/types.js";

function sheetsForZone(zone: string): string[] {
  const key = zone.trim().toLowerCase();
  return getHardCodedZoneSheetMapping()
    .filter(([z]) => z.trim().toLowerCase() === key)
    .map(([, sheet]) => sheet);
}

function rulesFromHardCoded(): ZoneSheetRule[] {
  return getHardCodedZoneSheetMapping().map(([zone, sheetTitle]) => ({
    pattern: zone,
    match: "contains" as const,
    spreadsheetId: "sid",
    sheetTitle,
  }));
}

describe("nuovi agenti — mapping zone (Antonio/Giovanni in ferie)", () => {
  it("Morgan riceve ancora Pisanova e Don Bosco", () => {
    expect(sheetsForZone("PISANOVA")).toEqual(["MORGAN"]);
    expect(sheetsForZone("DON BOSCO")).toEqual(["MORGAN"]);
  });

  it("Ponsacco va su AG-PONTEDERA (FERIE ANTONIO)", () => {
    expect(sheetsForZone("Ponsacco")).toEqual(["AG-PONTEDERA", "AG-PONTEDERA"]);
  });

  it("zone Lucca di Giovanni vanno su AG-LUCCA", () => {
    const exclusive = [
      "ANTRACCOLI",
      "ARANCIO",
      "PICCIONARA",
      "PICCIORANA",
      "SAN CASCIANO A VICO",
      "SAN CASSIANO A VICO",
      "SAN FILIPPO",
      "SAN MARO",
      "SAN PIETRO A VICO",
    ];
    for (const zone of exclusive) {
      expect(sheetsForZone(zone), zone).toEqual(["AG-LUCCA"]);
    }
    expect(sheetsForZone("SAN MARCO")).toEqual(["AG-PISA", "AG-LUCCA"]);
  });

  it("disambigua SAN MARCO Lucca → AG-LUCCA, Pisa → AG-PISA", () => {
    const rules = rulesFromHardCoded();
    expect(
      resolveSheetForZone("SAN MARCO", rules, "sid", "Default", { city: "Lucca" }).sheetTitle,
    ).toBe("AG-LUCCA");
    expect(
      resolveSheetForZone("SAN MARCO", rules, "sid", "Default", { city: "Pisa" }).sheetTitle,
    ).toBe("AG-PISA");
  });

  it("disambigua Centro Storico Ponsacco → AG-PONTEDERA", () => {
    const rules = rulesFromHardCoded();
    expect(
      resolveSheetForZone("Centro Storico", rules, "sid", "Default", {
        city: "Ponsacco",
      }).sheetTitle,
    ).toBe("AG-PONTEDERA");
  });
});

describe("agenti sospesi", () => {
  it("Valentina senza zone; Antonio e Giovanni sospesi", () => {
    const valentinaZones = getHardCodedZoneSheetMapping().filter(
      ([, sheet]) => sheet.trim().toLowerCase() === "valentina",
    );
    expect(valentinaZones).toEqual([]);
    expect(isSuspendedPisaAgentSheet("VALENTINA")).toBe(true);
    expect(isSuspendedPontederaAgentSheet("ANTONIO")).toBe(true);
    expect(isSuspendedLuccaAgentSheet("GIOVANNI")).toBe(true);
  });
});
