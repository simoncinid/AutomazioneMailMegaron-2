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
    expect([...SUSPENDED_PISA_AGENT_CODES]).toEqual(["valentina", "marta", "stefania"]);
    expect([...SUSPENDED_PONTEDERA_AGENT_CODES]).toEqual(["fausto", "elisabetta", "rebecca"]);
  });

  it("riconosce i tab agente indipendentemente dal case", () => {
    expect(isSuspendedPisaAgentSheet("STEFANIA")).toBe(true);
    expect(isSuspendedPontederaAgentSheet("Rebecca")).toBe(true);
    expect(isSuspendedAgentSheet("LUIS")).toBe(false);
    expect(isSuspendedAgentSheet("MARCO")).toBe(false);
  });
});
