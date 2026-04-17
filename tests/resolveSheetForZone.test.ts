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
});
