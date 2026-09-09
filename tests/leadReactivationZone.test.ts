import { describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../src/config/loadEnv.js";
import type { GestimListingRow, LeadRowPayload } from "../src/domain/types.js";
import type { ListingRepository } from "../src/repositories/listingRepository.js";
import type { GoogleSheetsWriter } from "../src/sheets/googleSheetsWriter.js";
import type {
  LeadRecurrenceDecision,
  ReactivationPayload,
} from "../src/services/leadAssignmentCooldown.js";

vi.mock("../src/services/leadAiExtractor.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/leadAiExtractor.js")>();
  return {
    ...actual,
    extractLeadDataWithAi: vi.fn(async () => ({
      nome: "Luca",
      numeroTelefono: "3491745110",
      cognome: "Belli",
      idAnnuncio: "2024P088",
      email: "lucbel72@gmail.com",
      risposta: false,
    })),
  };
});

function buildEnv(): AppEnv {
  return {
    BLOCKED_EMAIL_SUBSTRINGS: "",
    DEFAULT_SHEET_TITLE: "AG-PISA",
    defaultSpreadsheetIdResolved: "spreadsheet-id",
    zoneSheetRules: [
      {
        name: "casciana_alta",
        pattern: "Casciana Alta",
        match: "contains",
        spreadsheetId: "spreadsheet-id",
        sheetTitle: "AG-PONTEDERA",
      },
    ],
    NO_ID_FOUND_SHEET_TITLE: "no-id-trovato",
  } as AppEnv;
}

function buildListing(): GestimListingRow {
  return {
    externalListingId: "2024P088",
    title: null,
    city: "Casciana Terme Lari",
    province: "Pisa",
    zone: "Casciana Alta",
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

describe("riattivazione contatto: zona dal nuovo annuncio", () => {
  it("non riusa Ponsacco: passa al DB zona e provincia di 2024P088", async () => {
    const { processInboundEmail } = await import("../src/services/leadProcessor.js");
    const appended: LeadRowPayload[] = [];
    const reactivations: ReactivationPayload[] = [];
    const sheets = {
      appendLead: vi.fn(async (payload: LeadRowPayload) => {
        appended.push(payload);
      }),
    } as unknown as GoogleSheetsWriter;

    const listings = {
      findLatestByExternalListingId: vi.fn(async () => buildListing()),
    } as unknown as ListingRepository;

    const existing: LeadRecurrenceDecision["existing"] = {
      assignedAt: new Date("2026-07-13T11:20:00Z"),
      status: "chiamato",
      rowRef: { spreadsheetId: "spreadsheet-id", sheetTitle: "fausto", rowNumber: 12 },
      snapshot: {
        leadEmail: "old@example.com",
        listingId: "2026P076",
        phone: "3491745110",
        zone: "Ponsacco",
        nome: "Mario",
        cognome: "Rossi",
        statusRaw: "Chiamato",
      },
      matchedOn: "phone",
      matchedValue: "3491745110",
    };

    const assignmentCooldown = {
      evaluateRecurrence: vi.fn(async () => ({
        action: "reactivate" as const,
        reason: "status_chiamato" as const,
        existing,
      })),
      reactivateExistingRow: vi.fn(async (_decision: LeadRecurrenceDecision, payload: ReactivationPayload) => {
        reactivations.push(payload);
        return { spreadsheetId: "spreadsheet-id", sheetTitle: "fausto", rowNumber: 12 };
      }),
    };

    await processInboundEmail(
      {
        messageId: "message-2024P088",
        from: "portal@example.com",
        subject: "2024P088",
        receivedAt: new Date("2026-09-08T07:00:00Z"),
        textBody: "Lead 2024P088",
      },
      {
        env: buildEnv(),
        listings,
        sheets,
        assignmentCooldown: assignmentCooldown as never,
      },
      new Date("2026-09-08T07:00:00Z"),
    );

    expect(appended).toHaveLength(0);
    expect(reactivations).toHaveLength(1);
    expect(reactivations[0]?.listingId).toBe("2024P088");
    expect(reactivations[0]?.zone).toBe("Casciana Alta");
    expect(reactivations[0]?.province).toBe("Pisa");
    expect(listings.findLatestByExternalListingId).toHaveBeenCalledWith("2024P088");
  });
});
