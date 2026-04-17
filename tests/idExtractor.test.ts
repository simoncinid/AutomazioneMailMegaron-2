import { describe, expect, it } from "vitest";
import { extractExternalListingIds } from "../src/services/idExtractor.js";

describe("extractExternalListingIds", () => {
  it("estrae ID da query string in URL", () => {
    const html = `<a href="https://portale.it/immobile?id=GESTIM12345">Vedi</a>`;
    const ids = extractExternalListingIds("", html);
    expect(ids).toContain("GESTIM12345");
  });

  it("estrae ID da path /annunci/", () => {
    const text = "Link https://example.com/annunci/ABC-999/foto";
    const ids = extractExternalListingIds(text, undefined);
    expect(ids).toContain("ABC-999");
  });

  it("estrae da etichetta Codice:", () => {
    const text = "Codice: XK-2024-001 interessante";
    const ids = extractExternalListingIds(text, "");
    expect(ids).toContain("XK-2024-001");
  });

  it("deduplica e mantiene ordine", () => {
    const text = "id=AAA111 id=AAA111 codice: BBB222";
    const ids = extractExternalListingIds(text, undefined);
    expect(ids).toEqual(["AAA111", "BBB222"]);
  });

  it("applica regex extra con gruppo di cattura", () => {
    const text = "Riferimento interno GESTIM-XYZ999 fine";
    const ids = extractExternalListingIds(text, undefined, {
      extraRegexStrings: ["GESTIM-([A-Z0-9]+)"],
    });
    expect(ids).toContain("XYZ999");
  });
});
