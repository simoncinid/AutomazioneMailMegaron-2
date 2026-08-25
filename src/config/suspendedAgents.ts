/**
 * Agenti in ferie — elenco centralizzato (backend Node).
 * Allineato a scripts/qz9-redistribuzione-lead.gs e src/services/leadAutoReply.ts.
 *
 * ═══ RIATTIVARE UN AGENTE AL 100% ═══
 * Sostituire <NOME> con il tab agente (es. STEFANIA, FAUSTO) e <code> con il codice
 * minuscolo (es. stefania, fausto).
 *
 * 1. src/config/loadEnv.ts — HARD_CODED_ZONE_SHEET_MAPPING
 *    Cercare "FERIE <NOME>": ripristinare il sheetTitle originale (es. "STEFANIA").
 * 2. src/config/resolveSheetForZone.ts
 *    Cercare "FERIE <NOME>": ripristinare i return dell'agente diretto.
 * 3. src/services/leadProcessor.ts
 *    Decommentare "<NOME>" in PISA_AGENT_SHEETS o PONTEDERA_AGENT_SHEETS.
 * 4. src/config/suspendedAgents.ts (questo file)
 *    Rimuovere "<code>" da SUSPENDED_PISA_AGENT_CODES o SUSPENDED_PONTEDERA_AGENT_CODES.
 * 5. src/services/leadAutoReply.ts
 *    Decommentare "<code>" in AGENT_OWNER_ZONE_BY_CODE e aggiungerlo a POOL_CODES_BY_ZONE.
 * 6. scripts/qz9-redistribuzione-lead.gs
 *    Rimuovere da qz9SuspendedAgentOwnerZone; aggiungere a qz9AgentOwnerZoneByCode
 *    e al pool qz9PoolsByZone corrispondente.
 *
 * Sospesi (ago 2026):
 * - Pisa:      valentina, stefania, massimo → zone su AG-PISA (pool random attivo)
 * - Pontedera: elisabetta → zone su AG-PONTEDERA (pool random attivo)
 */

export const SUSPENDED_PISA_AGENT_CODES = ["valentina", "stefania", "massimo"] as const;
export const SUSPENDED_PONTEDERA_AGENT_CODES = ["elisabetta"] as const;

export type SuspendedPisaAgentCode = (typeof SUSPENDED_PISA_AGENT_CODES)[number];
export type SuspendedPontederaAgentCode = (typeof SUSPENDED_PONTEDERA_AGENT_CODES)[number];

const SUSPENDED_PISA = new Set<string>(SUSPENDED_PISA_AGENT_CODES);
const SUSPENDED_PONTEDERA = new Set<string>(SUSPENDED_PONTEDERA_AGENT_CODES);

function normalizeAgentCode(value: string): string {
  return value.trim().toLowerCase();
}

export function isSuspendedPisaAgentSheet(sheetTitle: string): boolean {
  return SUSPENDED_PISA.has(normalizeAgentCode(sheetTitle));
}

export function isSuspendedPontederaAgentSheet(sheetTitle: string): boolean {
  return SUSPENDED_PONTEDERA.has(normalizeAgentCode(sheetTitle));
}

export function isSuspendedAgentSheet(sheetTitle: string): boolean {
  const code = normalizeAgentCode(sheetTitle);
  return SUSPENDED_PISA.has(code) || SUSPENDED_PONTEDERA.has(code);
}
