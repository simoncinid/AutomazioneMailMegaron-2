import { describe, expect, it } from "vitest";
import { rowsToAppendForCapacity } from "../src/sheets/googleSheetsWriter.js";

describe("rowsToAppendForCapacity", () => {
  it("non espande se c'è già spazio", () => {
    expect(rowsToAppendForCapacity(353, 353)).toBe(0);
    expect(rowsToAppendForCapacity(400, 354)).toBe(0);
  });

  it("espande del delta + buffer quando la griglia è corta", () => {
    // Caso MARY: max 353, scrivere riga 354 → 1 + 200 buffer
    expect(rowsToAppendForCapacity(353, 354, 200)).toBe(201);
  });

  it("gestisce più righe in un unico flush", () => {
    expect(rowsToAppendForCapacity(100, 105, 50)).toBe(55);
  });
});
