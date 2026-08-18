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
    process.env.PONTEDERA_ROUND_ROBIN_STATE_PATH = join(testStateDir, "pontedera-state.json");
    process.env.VIAREGGIO_ROUND_ROBIN_STATE_PATH = join(testStateDir, "viareggio-state.json");
    process.env.LIVORNO_ROUND_ROBIN_STATE_PATH = join(testStateDir, "livorno-state.json");
  });

  afterEach(async () => {
    delete process.env.PISA_ROUND_ROBIN_STATE_PATH;
    delete process.env.PONTEDERA_ROUND_ROBIN_STATE_PATH;
    delete process.env.VIAREGGIO_ROUND_ROBIN_STATE_PATH;
    delete process.env.LIVORNO_ROUND_ROBIN_STATE_PATH;
    await rm(testStateDir, { force: true, recursive: true });
  });

  it("non assegna ad agenti Pisa in ferie se il mapping punta al tab diretto", async () => {
    const { processInboundEmail } = await import("../src/services/leadProcessor.js");
    const appended: LeadRowPayload[] = [];
    const sheets = {
      appendLead: vi.fn(async (payload: LeadRowPayload) => {
        appended.push(payload);
      }),
    } as unknown as GoogleSheetsWriter;

    const suspendedCases = [
      { id: "cisanello-0", zone: "CISANELLO", legacySheet: "STEFANIA" },
      { id: "donbosco-0", zone: "DON BOSCO", legacySheet: "VALENTINA" },
      { id: "sanmarco-0", zone: "SAN MARCO", legacySheet: "MARTA" },
    ] as const;

    for (const testCase of suspendedCases) {
      appended.length = 0;
      const listings = {
        findLatestByExternalListingId: vi.fn(async () => ({
          ...buildListing(testCase.id),
          zone: testCase.zone,
        })),
      } as unknown as ListingRepository;

      const env = buildEnv();
      env.zoneSheetRules.push({
        name: `legacy_${testCase.legacySheet.toLowerCase()}`,
        pattern: testCase.zone,
        match: "contains",
        spreadsheetId: "spreadsheet-id",
        sheetTitle: testCase.legacySheet,
      });

      await processInboundEmail(
        {
          messageId: `message-${testCase.id}`,
          from: "portal@example.com",
          subject: testCase.id,
          receivedAt: new Date("2026-08-17T10:00:00Z"),
          textBody: `Lead ${testCase.zone}`,
        },
        { env, listings, sheets },
        new Date("2026-08-17T10:00:00Z"),
      );

      expect(appended).toHaveLength(1);
      expect(appended[0]?.sheetTitle).not.toBe(testCase.legacySheet);
      expect([
        "MASSIMO",
        "DAVIDE",
        "EROS",
        "SAMUELE",
        "GIUSEPPE",
        "TOMMASO",
        "MATTIA",
        "MARCO",
        "LUIGI",
      ]).toContain(appended[0]?.sheetTitle);
    }
  });

  it("non assegna ad agenti Pontedera in ferie se il mapping punta al tab diretto", async () => {
    const { processInboundEmail } = await import("../src/services/leadProcessor.js");
    const appended: LeadRowPayload[] = [];
    const sheets = {
      appendLead: vi.fn(async (payload: LeadRowPayload) => {
        appended.push(payload);
      }),
    } as unknown as GoogleSheetsWriter;

    const listings = {
      findLatestByExternalListingId: vi.fn(async () => ({
        ...buildListing("pontedera-0"),
        zone: "CENTRO",
        city: "Pontedera",
      })),
    } as unknown as ListingRepository;

    const env = buildEnv();
    env.zoneSheetRules.push({
      name: "legacy_elisabetta",
      pattern: "CENTRO",
      match: "contains",
      spreadsheetId: "spreadsheet-id",
      sheetTitle: "ELISABETTA",
    });

    await processInboundEmail(
      {
        messageId: "message-elisabetta-centro",
        from: "portal@example.com",
        subject: "pontedera-0",
        receivedAt: new Date("2026-08-17T10:00:00Z"),
        textBody: "Lead CENTRO Pontedera",
      },
      { env, listings, sheets },
      new Date("2026-08-17T10:00:00Z"),
    );

    expect(appended).toHaveLength(1);
    expect(appended[0]?.sheetTitle).toBe("LUIS");
    expect(appended[0]?.sheetTitle).not.toBe("ELISABETTA");
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
    for (let i = 0; i < 9; i += 1) {
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
      "GIUSEPPE",
      "TOMMASO",
      "MATTIA",
      "MARCO",
      "LUIGI",
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

  it("assegna direttamente a MATTEO i lead con riferimento 2026181", async () => {
    const { processInboundEmail } = await import("../src/services/leadProcessor.js");
    const appended: LeadRowPayload[] = [];
    const noIdRows: unknown[] = [];
    const sheets = {
      appendLead: vi.fn(async (payload: LeadRowPayload) => {
        appended.push(payload);
      }),
      appendNoId: vi.fn(async (payload: unknown) => {
        noIdRows.push(payload);
      }),
    } as unknown as GoogleSheetsWriter;
    const listings = {
      findLatestByExternalListingId: vi.fn(async () => ({
        ...buildListing("livorno-0"),
        externalListingId: "2026181",
        zone: "MONTEBELLO",
      })),
    } as unknown as ListingRepository;

    await processInboundEmail(
      {
        messageId: "message-direct-matteo-2026181",
        from: "portal@example.com",
        subject: "2026181",
        receivedAt: new Date("2026-05-25T10:00:00Z"),
        textBody: "Lead Rif. 2026181",
      },
      { env: buildEnv(), listings, sheets },
      new Date("2026-05-25T10:00:00Z"),
    );

    // Anche senza zona in gestim, l'override deve comunque andare a MATTEO
    await processInboundEmail(
      {
        messageId: "message-direct-matteo-2026181-no-zone",
        from: "portal@example.com",
        subject: "2026181",
        receivedAt: new Date("2026-05-25T10:00:00Z"),
        textBody: "Lead Rif. 2026181 senza zona",
      },
      {
        env: buildEnv(),
        listings: {
          findLatestByExternalListingId: vi.fn(async () => null),
        } as unknown as ListingRepository,
        sheets,
      },
      new Date("2026-05-25T10:00:00Z"),
    );

    expect(appended).toHaveLength(2);
    expect(appended.every((row) => row.sheetTitle === "MATTEO")).toBe(true);
    expect(appended.every((row) => row.listingId === "2026181")).toBe(true);
    expect(noIdRows).toHaveLength(0);
  });

  it("mantiene LISA come assegnazione diretta e instrada BARBARICINA su LUIGI", async () => {
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
    expect(appended[0]?.sheetTitle).toBe("DAVIDE");
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

  it("instrada su AG-LUCCA se l'ID contiene LU e manca la zona in gestim", async () => {
    const { processInboundEmail } = await import("../src/services/leadProcessor.js");
    const appended: LeadRowPayload[] = [];
    const noIdRows: unknown[] = [];
    const sheets = {
      appendLead: vi.fn(async (payload: LeadRowPayload) => {
        appended.push(payload);
      }),
      appendNoId: vi.fn(async (payload: unknown) => {
        noIdRows.push(payload);
      }),
    } as unknown as GoogleSheetsWriter;
    const listings = {
      findLatestByExternalListingId: vi.fn(async () => ({
        externalListingId: "2022lu034",
        title: null,
        city: "Sillano Giuncugnano",
        province: "Lucca",
        zone: "",
        address: null,
        price: null,
        propertyType: null,
        contractType: null,
        surfaceM2: null,
        bedrooms: null,
        bathrooms: null,
        updatedAt: null,
      })),
    } as unknown as ListingRepository;

    await processInboundEmail(
      {
        messageId: "message-lu-no-zone",
        from: "portal@example.com",
        subject: "2022lu034",
        receivedAt: new Date("2026-05-25T10:00:00Z"),
        textBody: "Lead per 2022lu034",
      },
      { env: buildEnv(), listings, sheets },
      new Date("2026-05-25T10:00:00Z"),
    );

    expect(appended).toHaveLength(1);
    expect(appended[0]?.listingId).toBe("2022lu034");
    expect(["ALFREDO", "MARY"]).toContain(appended[0]?.sheetTitle);
    expect(noIdRows).toHaveLength(0);
  });

  it("resta su no-id-trovato se l'ID non contiene LU e manca la zona", async () => {
    const { processInboundEmail } = await import("../src/services/leadProcessor.js");
    const appended: LeadRowPayload[] = [];
    const noIdRows: unknown[] = [];
    const sheets = {
      appendLead: vi.fn(async (payload: LeadRowPayload) => {
        appended.push(payload);
      }),
      appendNoId: vi.fn(async (payload: unknown) => {
        noIdRows.push(payload);
      }),
    } as unknown as GoogleSheetsWriter;
    const listings = {
      findLatestByExternalListingId: vi.fn(async () => ({
        externalListingId: "2024057",
        title: null,
        city: "Sestriere",
        province: "Torino",
        zone: "",
        address: null,
        price: null,
        propertyType: null,
        contractType: null,
        surfaceM2: null,
        bedrooms: null,
        bathrooms: null,
        updatedAt: null,
      })),
    } as unknown as ListingRepository;

    const env = {
      ...buildEnv(),
      NO_ID_FOUND_SHEET_TITLE: "no-id-trovato",
    } as AppEnv;

    await processInboundEmail(
      {
        messageId: "message-no-lu-no-zone",
        from: "portal@example.com",
        subject: "2024057",
        receivedAt: new Date("2026-05-25T10:00:00Z"),
        textBody: "Lead per 2024057",
      },
      { env, listings, sheets },
      new Date("2026-05-25T10:00:00Z"),
    );

    expect(appended).toHaveLength(0);
    expect(noIdRows).toHaveLength(1);
  });
});
