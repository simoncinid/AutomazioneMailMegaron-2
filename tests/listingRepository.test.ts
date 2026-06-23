import { describe, expect, it } from "vitest";
import { indexListingsByRequestedIds } from "../src/repositories/listingRepository.js";
import type { GestimListingRow } from "../src/domain/types.js";

function row(id: string): GestimListingRow {
  return {
    externalListingId: id,
    title: null,
    city: null,
    province: null,
    zone: "Zona test",
    address: null,
    price: null,
    propertyType: null,
    contractType: null,
    surfaceM2: null,
    bedrooms: null,
    bathrooms: null,
    updatedAt: null,
  };
}

describe("indexListingsByRequestedIds", () => {
  it("associa il risultato all'ID richiesto anche con case diverso", () => {
    const indexed = indexListingsByRequestedIds(
      ["vi2021060", "2024li119"],
      [row("Vi2021060"), row("2024Li119")],
    );

    expect(indexed.get("vi2021060")?.externalListingId).toBe("Vi2021060");
    expect(indexed.get("2024li119")?.externalListingId).toBe("2024Li119");
  });

  it("non inserisce ID senza match", () => {
    const indexed = indexListingsByRequestedIds(["missing"], [row("Vi2021060")]);
    expect(indexed.has("missing")).toBe(false);
  });
});
