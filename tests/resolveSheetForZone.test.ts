import { describe, expect, it } from "vitest";
import {
  matchesZone,
  resolveSheetForZone,
} from "../src/config/resolveSheetForZone.js";
import type { ZoneSheetRule } from "../src/domain/types.js";

const rules: ZoneSheetRule[] = [
  {
    name: "prati",
    pattern: "Prati",
    match: "contains",
    spreadsheetId: "sheet-prati",
    sheetTitle: "Lead",
  },
  {
    name: "eur",
    pattern: "^EUR",
    match: "regex",
    spreadsheetId: "sheet-eur",
    sheetTitle: "Lead",
  },
];

describe("resolveSheetForZone", () => {
  it("sceglie la prima regola che matcha (contains)", () => {
    const r = resolveSheetForZone(
      "Roma Prati Fiamma",
      rules,
      "def-id",
      "Default",
    );
    expect(r.spreadsheetId).toBe("sheet-prati");
    expect(r.fallback).toBe(false);
  });

  it("usa regex per EUR", () => {
    const r = resolveSheetForZone("EUR — Magliana", rules, "def-id", "Default");
    expect(r.spreadsheetId).toBe("sheet-eur");
    expect(r.fallback).toBe(false);
  });

  it("fallback su default se nessuna regola", () => {
    const r = resolveSheetForZone("Ostia", rules, "def-id", "DefaultTab");
    expect(r.spreadsheetId).toBe("def-id");
    expect(r.sheetTitle).toBe("DefaultTab");
    expect(r.fallback).toBe(true);
  });

  it("zona vuota → fallback", () => {
    const r = resolveSheetForZone("   ", rules, "def-id", "DefaultTab");
    expect(r.fallback).toBe(true);
  });

  it("disambigua CAPOLUOGO usando city", () => {
    const capRules: ZoneSheetRule[] = [
      {
        pattern: "Capoluogo",
        match: "contains",
        spreadsheetId: "sid",
        sheetTitle: "GIUSEPPE",
      },
      {
        pattern: "Capoluogo",
        match: "contains",
        spreadsheetId: "sid",
        sheetTitle: "AG-PISA",
      },
      {
        pattern: "Capoluogo",
        match: "contains",
        spreadsheetId: "sid",
        sheetTitle: "TOMMASO",
      },
    ];

    const r = resolveSheetForZone("Capoluogo", capRules, "sid", "DefaultTab", {
      city: "San Giuliano Terme",
    });
    expect(r.sheetTitle).toBe("DAVIDE");
    expect(r.fallback).toBe(false);
  });

  it("disambigua LORENZANA usando city prima di province", () => {
    const lorenzanaRules: ZoneSheetRule[] = [
      {
        pattern: "Lorenzana",
        match: "contains",
        spreadsheetId: "sid",
        sheetTitle: "AG-PISA",
      },
      {
        pattern: "Lorenzana",
        match: "contains",
        spreadsheetId: "sid",
        sheetTitle: "FAUSTO",
      },
    ];

    const r = resolveSheetForZone("Lorenzana", lorenzanaRules, "sid", "DefaultTab", {
      city: "Crespina Lorenzana",
      province: "Pisa",
    });
    expect(r.sheetTitle).toBe("AG-PONTEDERA");
    expect(r.fallback).toBe(false);
  });

  it("disambigua PORTA A MARE su GUIDO per city Livorno", () => {
    const portaRules: ZoneSheetRule[] = [
      {
        pattern: "PORTA A MARE",
        match: "contains",
        spreadsheetId: "sid",
        sheetTitle: "VALENTINA",
      },
      {
        pattern: "PORTA A MARE",
        match: "contains",
        spreadsheetId: "sid",
        sheetTitle: "GUIDO",
      },
    ];

    const r = resolveSheetForZone("PORTA A MARE", portaRules, "sid", "DefaultTab", {
      city: "Livorno",
    });
    expect(r.sheetTitle).toBe("GUIDO");
    expect(r.fallback).toBe(false);
  });

  it("disambigua QUATRO STRADE su AG-PONTEDERA per city Casciana Terme Lari", () => {
    const quattroRules: ZoneSheetRule[] = [
      {
        pattern: "Quatro strade",
        match: "contains",
        spreadsheetId: "sid",
        sheetTitle: "AG-PONTEDERA",
      },
      {
        pattern: "Quattro strade",
        match: "contains",
        spreadsheetId: "sid",
        sheetTitle: "FAUSTO",
      },
    ];

    const r = resolveSheetForZone("Quatro strade", quattroRules, "sid", "DefaultTab", {
      city: "Casciana Terme Lari",
    });
    expect(r.sheetTitle).toBe("AG-PONTEDERA");
    expect(r.fallback).toBe(false);
  });

  it("forza SAN ROMANO su AG-PONTEDERA anche con varianti", () => {
    const sanRomanoRules: ZoneSheetRule[] = [
      {
        pattern: "Montopoli in Val d'Arno",
        match: "contains",
        spreadsheetId: "sid",
        sheetTitle: "AG-PISA",
      },
      {
        pattern: "San Romano",
        match: "contains",
        spreadsheetId: "sid",
        sheetTitle: "AG-PONTEDERA",
      },
    ];

    const r = resolveSheetForZone(
      "San Romano (Montopoli in Val d'Arno)",
      sanRomanoRules,
      "sid",
      "DefaultTab",
    );
    expect(r.sheetTitle).toBe("AG-PONTEDERA");
    expect(r.fallback).toBe(false);
  });
});

describe("matchesZone", () => {
  it("equals ignora maiuscole", () => {
    const rule: ZoneSheetRule = {
      pattern: "prati",
      match: "equals",
      spreadsheetId: "x",
      sheetTitle: "L",
    };
    expect(matchesZone("PRATI", rule)).toBe(true);
  });

  it("equals gestisce apostrofi tipografici", () => {
    const rule: ZoneSheetRule = {
      pattern: "Sant'Ermete",
      match: "equals",
      spreadsheetId: "x",
      sheetTitle: "L",
    };
    expect(matchesZone("Sant’Ermete", rule)).toBe(true);
    expect(matchesZone("SantʼErmete", rule)).toBe(true);
  });

  it("contains gestisce apostrofi tipografici", () => {
    const rule: ZoneSheetRule = {
      pattern: "Sant'Ermete",
      match: "contains",
      spreadsheetId: "x",
      sheetTitle: "L",
    };
    expect(matchesZone("Zona Sant’Ermete lato sud", rule)).toBe(true);
    expect(matchesZone("Zona SantʼErmete lato sud", rule)).toBe(true);
  });
});
