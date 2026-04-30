import { describe, expect, it } from "vitest";
import { extractFirstBodyEmail, isLikelyLeadEmail } from "../src/services/contactExtractor.js";

describe("isLikelyLeadEmail", () => {
  it("accetta una mail standard", () => {
    expect(isLikelyLeadEmail("mario.rossi@gmail.com")).toBe(true);
  });

  it("rifiuta mail che sembrano asset", () => {
    expect(isLikelyLeadEmail("icon-calendar@2x.png")).toBe(false);
  });
});

describe("extractFirstBodyEmail", () => {
  it("ignora email fake da asset e prende una mail reale successiva", () => {
    const text = "icona icon-calendar@2x.png contatto mario.rossi@gmail.com";
    const found = extractFirstBodyEmail(text, undefined, []);
    expect(found).toBe("mario.rossi@gmail.com");
  });
});

