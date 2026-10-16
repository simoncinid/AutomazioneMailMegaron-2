import { describe, expect, it } from "vitest";
import {
  isSuspendedAgentSheet,
  isSuspendedLuccaAgentSheet,
  isSuspendedPisaAgentSheet,
  isSuspendedPontederaAgentSheet,
  SUSPENDED_LUCCA_AGENT_CODES,
  SUSPENDED_PISA_AGENT_CODES,
  SUSPENDED_PONTEDERA_AGENT_CODES,
} from "../src/config/suspendedAgents.js";

describe("suspendedAgents", () => {
  it("elenca tutti gli agenti in ferie attesi", () => {
    expect([...SUSPENDED_PISA_AGENT_CODES]).toEqual(["valentina"]);
    expect([...SUSPENDED_PONTEDERA_AGENT_CODES]).toEqual(["antonio"]);
    expect([...SUSPENDED_LUCCA_AGENT_CODES]).toEqual(["giovanni"]);
  });

  it("riconosce i tab agente indipendentemente dal case", () => {
    expect(isSuspendedPisaAgentSheet("STEFANIA")).toBe(false);
    expect(isSuspendedPontederaAgentSheet("Elisabetta")).toBe(false);
    expect(isSuspendedPisaAgentSheet("Valentina")).toBe(true);
    expect(isSuspendedPisaAgentSheet("Massimo")).toBe(false);
    expect(isSuspendedAgentSheet("Rebecca")).toBe(false);
    expect(isSuspendedAgentSheet("LUIS")).toBe(false);
    expect(isSuspendedAgentSheet("MARCO")).toBe(false);
    expect(isSuspendedPontederaAgentSheet("Antonio")).toBe(true);
    expect(isSuspendedLuccaAgentSheet("GIOVANNI")).toBe(true);
    expect(isSuspendedAgentSheet("antonio")).toBe(true);
    expect(isSuspendedAgentSheet("giovanni")).toBe(true);
  });
});
