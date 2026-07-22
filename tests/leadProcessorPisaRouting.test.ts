import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../src/config/loadEnv.js";
import type { GestimListingRow, LeadRowPayload } from "../src/domain/types.js";
import type { ListingRepository } from "../src/repositories/listingRepository.js";
import type { GoogleSheetsWriter } from "../src/sheets/googleSheetsWriter.js";

vi.mock("../src/services/leadAiExtractor.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/leadAiExtractor.js")>();
  return {
    ...actual,
    extractLeadDataWithAi: vi.fn(async (email: { subject: string }) => ({
      nome: "Mario",
      numeroTelefono: "3331234567",
      cognome: "Rossi",
      idAnnuncio: email.subject,
      email: `lead-${email.subject}@example.com`,
      risposta: false,
    })),
  };
});

let testStateDir = "";

function buildEnv(): AppEnv {
  return {
    BLOCKED_EMAIL_SUBSTRINGS: "",
    DEFAULT_SHEET_TITLE: "AG-PISA",
    defaultSpreadsheetIdResolved: "spreadsheet-id",
    zoneSheetRules: [
      {
        name: "i_passi",
        pattern: "I PASSI",
        match: "contains",
        spreadsheetId: "spreadsheet-id",
        sheetTitle: "AG-PISA",
      },
      {
        name: "calambrone",
        pattern: "CALAMBRONE",
        match: "contains",
        spreadsheetId: "spreadsheet-id",
        sheetTitle: "AG-PISA",
      },
      {
        name: "capannoli",
        pattern: "Capannoli",
        match: "contains",
        spreadsheetId: "spreadsheet-id",
        sheetTitle: "AG-PISA",
      },
      {
        name: "darsena",
        pattern: "Darsena",
        match: "contains",
        spreadsheetId: "spreadsheet-id",
        sheetTitle: "AG-VIAREGGIO",
      },
      {
        name: "san_marco_lucca",
        pattern: "SAN MARCO",
        match: "contains",
        spreadsheetId: "spreadsheet-id",
        sheetTitle: "AG-LUCCA",
      },
      {
        name: "montebello",
        pattern: "MONTEBELLO",
        match: "contains",
        spreadsheetId: "spreadsheet-id",
        sheetTitle: "AG-LIVORNO",
      },
      {
        name: "barbaricina",
        pattern: "BARBARICINA",
        match: "contains",
        spreadsheetId: "spreadsheet-id",
        sheetTitle: "LUIGI",
      },
      {
        name: "venezia_pontino",
        pattern: "VENEZIA - PONTINO",
        match: "contains",
        spreadsheetId: "spreadsheet-id",
        sheetTitle: "LISA",
      },
    ],
  } as AppEnv;
}

function buildListing(id: string): GestimListingRow {
  const isViareggio = id.startsWith("viareggio");
  const isCapannoli = id.startsWith("capannoli");
  const isLivorno = id.startsWith("livorno");
  return {
    externalListingId: id,
    title: null,
    city: isViareggio ? "Viareggio" : isCapannoli ? "Capannoli" : isLivorno ? "Livorno" : "Pisa",
    province: isViareggio ? "Lucca" : isLivorno ? "Livorno" : "Pisa",
    zone: isViareggio
      ? "Darsena"
      : isCapannoli
        ? "Capannoli"
        : id.startsWith("livorno-lisa")
          ? "VENEZIA - PONTINO"
          : isLivorno
            ? "MONTEBELLO"
            : id.startsWith("luigi")
              ? "BARBARICINA"
              : id.startsWith("passi")
                ? "I PASSI"
                : "CALAMBRONE",
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

describe("processInboundEmail AG-PISA routing", () => {
  beforeEach(async () => {
    testStateDir = await mkdtemp(join(tmpdir(), "pisa-round-robin-"));
    process.env.PISA_ROUND_ROBIN_STATE_PATH = join(testStateDir, "pisa-state.json");
    process.env.VIAREGGIO_ROUND_ROBIN_STATE_PATH = join(testStateDir, "viareggio-state.json");
    process.env.LIVORNO_ROUND_ROBIN_STATE_PATH = join(testStateDir, "livorno-state.json");
  });

  afterEach(async () => {
    delete process.env.PISA_ROUND_ROBIN_STATE_PATH;
    delete process.env.VIAREGGIO_ROUND_ROBIN_STATE_PATH;
    delete process.env.LIVORNO_ROUND_ROBIN_STATE_PATH;
    await rm(testStateDir, { force: true, recursive: true });
  });

  it("assegna AG-PISA solo agli agenti del pool Pisa", async () => {
    const { processInboundEmail } = await import("../src/services/leadProcessor.js");
    const appended: LeadRowPayload[] = [];
    const sheets = {
      appendLead: vi.fn(async (payload: LeadRowPayload) => {
        appended.push(payload);
      }),
    } as unknown as GoogleSheetsWriter;
    const listings = {
      findLatestByExternalListingId: vi.fn(async (id: string) => buildListing(id)),
    } as unknown as ListingRepository;

    const env = buildEnv();
    for (let i = 0; i < 10; i += 1) {
      const id = i % 2 === 0 ? `passi-${i}` : `calambrone-${i}`;
      await processInboundEmail(
        {
          messageId: `message-${i}`,
          from: "portal@example.com",
          subject: id,
          receivedAt: new Date("2026-05-25T10:00:00Z"),
          textBody: `Lead per ${id}`,
        },
        { env, listings, sheets },
        new Date("2026-05-25T10:00:00Z"),
      );
    }

    expect(appended.map((row) => row.sheetTitle)).toEqual([
      "MASSIMO",
      "DAVIDE",
      "EROS",
      "SAMUELE",
      "TOMMASO",
      "MATTIA",
      "STEFANIA",
      "VALENTINA",
      "MARCO",
      "MARTA",
    ]);
    expect(appended.map((row) => row.sheetTitle)).not.toContain("ELISABETTA");
    expect(appended.map((row) => row.sheetTitle)).not.toContain("FAUSTO");
    expect(appended.map((row) => row.sheetTitle)).not.toContain("LUIS");
  });

  it("assegna AG-VIAREGGIO solo agli agenti del pool Lucca", async () => {
    const { processInboundEmail } = await import("../src/services/leadProcessor.js");
    const appended: LeadRowPayload[] = [];
    const sheets = {
      appendLead: vi.fn(async (payload: LeadRowPayload) => {
        appended.push(payload);
      }),
    } as unknown as GoogleSheetsWriter;
    const listings = {
      findLatestByExternalListingId: vi.fn(async (id: string) => buildListing(id)),
    } as unknown as ListingRepository;

    const env = buildEnv();
    for (let i = 0; i < 6; i += 1) {
      const id = `viareggio-${i}`;
      await processInboundEmail(
        {
          messageId: `message-viareggio-${i}`,
          from: "portal@example.com",
          subject: id,
          receivedAt: new Date("2026-05-25T10:00:00Z"),
          textBody: `Lead per ${id}`,
        },
        { env, listings, sheets },
        new Date("2026-05-25T10:00:00Z"),
      );
    }

    expect(appended.map((row) => row.sheetTitle)).toEqual([
      "ALFREDO",
      "MARY",
      "ALFREDO",
      "MARY",
      "ALFREDO",
      "MARY",
    ]);
  });

  it("assegna AG-LIVORNO senza EROS nel pool Livorno", async () => {
    const { processInboundEmail } = await import("../src/services/leadProcessor.js");
    const appended: LeadRowPayload[] = [];
    const sheets = {
      appendLead: vi.fn(async (payload: LeadRowPayload) => {
        appended.push(payload);
      }),
    } as unknown as GoogleSheetsWriter;
    const listings = {
      findLatestByExternalListingId: vi.fn(async (id: string) => buildListing(id)),
    } as unknown as ListingRepository;

    const env = buildEnv();
    for (let i = 0; i < 8; i += 1) {
      const id = `livorno-${i}`;
      await processInboundEmail(
        {
          messageId: `message-livorno-${i}`,
          from: "portal@example.com",
          subject: id,
          receivedAt: new Date("2026-05-25T10:00:00Z"),
          textBody: `Lead per ${id}`,
        },
        { env, listings, sheets },
        new Date("2026-05-25T10:00:00Z"),
      );
    }

    expect(appended.map((row) => row.sheetTitle)).toEqual([
      "MATTEO",
      "VIVIANA",
      "MASSIMILIANO",
      "GUIDO",
      "MATTEO",
      "VIVIANA",
      "MASSIMILIANO",
      "GUIDO",
    ]);
    expect(appended.map((row) => row.sheetTitle)).not.toContain("EROS");
  });

  it("mantiene LUIGI e LISA come assegnazioni dirette fuori dai pool AG", async () => {
    const { processInboundEmail } = await import("../src/services/leadProcessor.js");
    const appended: LeadRowPayload[] = [];
    const sheets = {
      appendLead: vi.fn(async (payload: LeadRowPayload) => {
        appended.push(payload);
      }),
    } as unknown as GoogleSheetsWriter;
    const listings = {
      findLatestByExternalListingId: vi.fn(async (id: string) => buildListing(id)),
    } as unknown as ListingRepository;

    await processInboundEmail(
      {
        messageId: "message-luigi-0",
        from: "portal@example.com",
        subject: "luigi-0",
        receivedAt: new Date("2026-05-25T10:00:00Z"),
        textBody: "Lead per luigi-0",
      },
      { env: buildEnv(), listings, sheets },
      new Date("2026-05-25T10:00:00Z"),
    );
    await processInboundEmail(
      {
        messageId: "message-livorno-lisa-0",
        from: "portal@example.com",
        subject: "livorno-lisa-0",
        receivedAt: new Date("2026-05-25T10:00:00Z"),
        textBody: "Lead per livorno-lisa-0",
      },
      { env: buildEnv(), listings, sheets },
      new Date("2026-05-25T10:00:00Z"),
    );

    expect(appended.map((row) => row.sheetTitle)).toEqual(["LUIGI", "LISA"]);
  });

  it("assegna randomicamente le zone ex Patrizia sul pool Pisa", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.2);
    const { processInboundEmail } = await import("../src/services/leadProcessor.js");
    const appended: LeadRowPayload[] = [];
    const sheets = {
      appendLead: vi.fn(async (payload: LeadRowPayload) => {
        appended.push(payload);
      }),
    } as unknown as GoogleSheetsWriter;
    const listings = {
      findLatestByExternalListingId: vi.fn(async (id: string) => buildListing(id)),
    } as unknown as ListingRepository;

    try {
      await processInboundEmail(
        {
          messageId: "message-capannoli-0",
          from: "portal@example.com",
          subject: "capannoli-0",
          receivedAt: new Date("2026-05-25T10:00:00Z"),
          textBody: "Lead per capannoli-0",
        },
        { env: buildEnv(), listings, sheets },
        new Date("2026-05-25T10:00:00Z"),
      );
    } finally {
      randomSpy.mockRestore();
    }

    expect(appended).toHaveLength(1);
    expect(appended[0]?.sheetTitle).toBe("EROS");
  });

  it("assegna AG-LUCCA solo agli agenti del pool Lucca", async () => {
    const { processInboundEmail } = await import("../src/services/leadProcessor.js");
    const appended: LeadRowPayload[] = [];
    const sheets = {
      appendLead: vi.fn(async (payload: LeadRowPayload) => {
        appended.push(payload);
      }),
    } as unknown as GoogleSheetsWriter;
    const listings = {
      findLatestByExternalListingId: vi.fn(async (id: string) => ({
        ...buildListing(id),
        city: "Lucca",
        province: "Lucca",
        zone: "SAN MARCO",
      })),
    } as unknown as ListingRepository;

    const env = buildEnv();
    for (let i = 0; i < 6; i += 1) {
      const id = `lucca-${i}`;
      await processInboundEmail(
        {
          messageId: `message-lucca-${i}`,
          from: "portal@example.com",
          subject: id,
          receivedAt: new Date("2026-05-25T10:00:00Z"),
          textBody: `Lead per ${id}`,
        },
        { env, listings, sheets },
        new Date("2026-05-25T10:00:00Z"),
      );
    }

    expect(appended.map((row) => row.sheetTitle)).toEqual([
      "ALFREDO",
      "MARY",
      "ALFREDO",
      "MARY",
      "ALFREDO",
      "MARY",
    ]);
  });
});
