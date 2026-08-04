import { describe, expect, it } from "vitest";
import {
  listingIdIndicatesLucca,
  resolveDirectAgentSheetForListingId,
} from "../src/services/leadProcessor.js";

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

describe("resolveDirectAgentSheetForListingId", () => {
  it("instrada 2026181 su MATTEO", () => {
    expect(resolveDirectAgentSheetForListingId("2026181")).toBe("MATTEO");
    expect(resolveDirectAgentSheetForListingId(" 2026181 ")).toBe("MATTEO");
  });

  it("non applica override ad altri ID", () => {
    expect(resolveDirectAgentSheetForListingId("2024057")).toBeUndefined();
    expect(resolveDirectAgentSheetForListingId("")).toBeUndefined();
    expect(resolveDirectAgentSheetForListingId("NO-ID")).toBeUndefined();
  });
});
