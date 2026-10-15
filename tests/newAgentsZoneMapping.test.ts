import { describe, expect, it } from "vitest";
import { getHardCodedZoneSheetMapping } from "../src/config/loadEnv.js";
import { resolveSheetForZone } from "../src/config/resolveSheetForZone.js";
import { isSuspendedPisaAgentSheet } from "../src/config/suspendedAgents.js";
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

describe("nuovi agenti — mapping zone", () => {
  it("Morgan riceve Pisanova e Don Bosco", () => {
    expect(sheetsForZone("PISANOVA")).toEqual(["MORGAN"]);
    expect(sheetsForZone("DON BOSCO")).toEqual(["MORGAN"]);
  });

  it("Antonio riceve Ponsacco (tutte le entry)", () => {
    expect(sheetsForZone("Ponsacco")).toEqual(["ANTONIO", "ANTONIO"]);
  });

  it("Giovanni riceve le zone Lucca assegnate", () => {
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
      expect(sheetsForZone(zone), zone).toEqual(["GIOVANNI"]);
    }
    // SAN MARCO: entry Pisa (AG-PISA) + entry Lucca (GIOVANNI); city disambigua
    expect(sheetsForZone("SAN MARCO")).toEqual(["AG-PISA", "GIOVANNI"]);
  });

  it("disambigua SAN MARCO Lucca → GIOVANNI, Pisa → AG-PISA", () => {
    const rules = rulesFromHardCoded();
    expect(
      resolveSheetForZone("SAN MARCO", rules, "sid", "Default", { city: "Lucca" }).sheetTitle,
    ).toBe("GIOVANNI");
    expect(
      resolveSheetForZone("SAN MARCO", rules, "sid", "Default", { city: "Pisa" }).sheetTitle,
    ).toBe("AG-PISA");
  });

  it("disambigua Centro Storico Ponsacco → ANTONIO", () => {
    const rules = rulesFromHardCoded();
    expect(
      resolveSheetForZone("Centro Storico", rules, "sid", "Default", {
        city: "Ponsacco",
      }).sheetTitle,
    ).toBe("ANTONIO");
  });
});

describe("Valentina sospesa senza zone", () => {
  it("nessuna riga del mapping punta a VALENTINA", () => {
    const valentinaZones = getHardCodedZoneSheetMapping().filter(
      ([, sheet]) => sheet.trim().toLowerCase() === "valentina",
    );
    expect(valentinaZones).toEqual([]);
  });

  it("è riconosciuta come agente Pisa sospeso", () => {
    expect(isSuspendedPisaAgentSheet("VALENTINA")).toBe(true);
    expect(isSuspendedPisaAgentSheet("valentina")).toBe(true);
  });
});
