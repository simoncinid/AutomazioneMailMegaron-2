import { describe, expect, it } from "vitest";
import {
  isSuspendedAgentSheet,
  isSuspendedPisaAgentSheet,
  isSuspendedPontederaAgentSheet,
  SUSPENDED_PISA_AGENT_CODES,
  SUSPENDED_PONTEDERA_AGENT_CODES,
} from "../src/config/suspendedAgents.js";

describe("suspendedAgents", () => {
  it("elenca tutti gli agenti in ferie attesi", () => {
    expect([...SUSPENDED_PISA_AGENT_CODES]).toEqual(["valentina", "massimo"]);
    expect([...SUSPENDED_PONTEDERA_AGENT_CODES]).toEqual([]);
  });

  it("riconosce i tab agente indipendentemente dal case", () => {
    expect(isSuspendedPisaAgentSheet("STEFANIA")).toBe(false);
    expect(isSuspendedPontederaAgentSheet("Elisabetta")).toBe(false);
    expect(isSuspendedPisaAgentSheet("Valentina")).toBe(true);
    expect(isSuspendedPisaAgentSheet("Massimo")).toBe(true);
    expect(isSuspendedAgentSheet("Rebecca")).toBe(false);
    expect(isSuspendedAgentSheet("LUIS")).toBe(false);
    expect(isSuspendedAgentSheet("MARCO")).toBe(false);
  });
});
