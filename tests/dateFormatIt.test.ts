import { describe, expect, it } from "vitest";
import { formatTempoDaInvioMail } from "../src/services/dateFormatIt.js";

describe("formatTempoDaInvioMail", () => {
  it("formatta minuti sotto un'ora", () => {
    expect(formatTempoDaInvioMail(45 * 60_000)).toBe("45 min");
  });

  it("formatta ore e minuti", () => {
    expect(formatTempoDaInvioMail((2 * 60 + 15) * 60_000)).toBe("2 h 15 min");
  });

  it("non va in negativo", () => {
    expect(formatTempoDaInvioMail(-1000)).toBe("0 min");
  });
});
