import { describe, expect, it } from "vitest";
import { listingIdIndicatesLucca } from "../src/services/leadProcessor.js";

describe("listingIdIndicatesLucca", () => {
  it("riconosce LU in qualsiasi combinazione di maiuscole/minuscole", () => {
    expect(listingIdIndicatesLucca("2017LU194")).toBe(true);
    expect(listingIdIndicatesLucca("2022lu034")).toBe(true);
    expect(listingIdIndicatesLucca("2026Lu040")).toBe(true);
    expect(listingIdIndicatesLucca("2020lU028")).toBe(true);
  });

  it("esclude NO-ID e ID senza sotto-stringa lu", () => {
    expect(listingIdIndicatesLucca("NO-ID")).toBe(false);
    expect(listingIdIndicatesLucca("2024057")).toBe(false);
    expect(listingIdIndicatesLucca("2026LI025")).toBe(false);
    expect(listingIdIndicatesLucca("")).toBe(false);
  });
});
