import type { GestimListingRow } from "../domain/types.js";
import pg, { type PoolConfig } from "pg";

/**
 * Astrazione: recupero annuncio per ID esterno Gestim.
 * Implementazioni: API HTTP esistente oppure PostgreSQL (gestim_listings).
 */
export interface ListingRepository {
  findLatestByExternalListingId(
    externalListingId: string,
  ): Promise<GestimListingRow | null>;
  /** Una sola query DB (o N richieste HTTP in modalità api). */
  findLatestByExternalListingIds(
    externalListingIds: string[],
  ): Promise<Map<string, GestimListingRow>>;
}

function mapApiJson(data: Record<string, unknown>): GestimListingRow {
  return {
    externalListingId: String(data.externalListingId ?? ""),
    title: (data.title as string) ?? null,
    city: (data.city as string) ?? null,
    zone: (data.zone as string) ?? null,
    address: (data.address as string) ?? null,
    price: (data.price as string | number) ?? null,
    propertyType: (data.propertyType as string) ?? null,
    contractType: (data.contractType as string) ?? null,
    surfaceM2: typeof data.surfaceM2 === "number" ? data.surfaceM2 : null,
    bedrooms: typeof data.bedrooms === "number" ? data.bedrooms : null,
    bathrooms: typeof data.bathrooms === "number" ? data.bathrooms : null,
    updatedAt: data.updatedAt
      ? new Date(String(data.updatedAt))
      : null,
  };
}

export class ApiListingRepository implements ListingRepository {
  constructor(private readonly baseUrl: string) {}

  async findLatestByExternalListingId(
    externalListingId: string,
  ): Promise<GestimListingRow | null> {
    const m = await this.findLatestByExternalListingIds([externalListingId]);
    return m.get(externalListingId) ?? null;
  }

  async findLatestByExternalListingIds(
    externalListingIds: string[],
  ): Promise<Map<string, GestimListingRow>> {
    const unique = [...new Set(externalListingIds)];
    const out = new Map<string, GestimListingRow>();
    await Promise.all(
      unique.map(async (id) => {
        const encoded = encodeURIComponent(id);
        const url = `${this.baseUrl.replace(/\/$/, "")}/api/gestim/listings/${encoded}`;
        const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
        if (res.status === 404) return;
        if (!res.ok) {
          throw new Error(`API listings ${res.status}: ${await res.text()}`);
        }
        const data = (await res.json()) as Record<string, unknown>;
        out.set(id, mapApiJson(data));
      }),
    );
    return out;
  }
}

function mapPgRowToGestim(row: Record<string, unknown>): GestimListingRow {
  return {
    externalListingId: String(row.externalListingId ?? ""),
    title: (row.title as string) ?? null,
    city: (row.city as string) ?? null,
    zone: (row.zone as string) ?? null,
    address: (row.address as string) ?? null,
    price: row.price as string | number | null,
    propertyType: (row.propertyType as string) ?? null,
    contractType: (row.contractType as string) ?? null,
    surfaceM2: row.surfaceM2 != null ? Number(row.surfaceM2) : null,
    bedrooms: row.bedrooms != null ? Number(row.bedrooms) : null,
    bathrooms: row.bathrooms != null ? Number(row.bathrooms) : null,
    updatedAt: row.updatedAt ? new Date(String(row.updatedAt)) : null,
  };
}

export class PostgresListingRepository implements ListingRepository {
  private pool: pg.Pool;

  constructor(config: string | PoolConfig) {
    this.pool =
      typeof config === "string"
        ? new pg.Pool({ connectionString: config })
        : new pg.Pool(config);
  }

  async findLatestByExternalListingId(
    externalListingId: string,
  ): Promise<GestimListingRow | null> {
    const m = await this.findLatestByExternalListingIds([externalListingId]);
    return m.get(externalListingId) ?? null;
  }

  async findLatestByExternalListingIds(
    externalListingIds: string[],
  ): Promise<Map<string, GestimListingRow>> {
    const unique = [...new Set(externalListingIds)];
    const out = new Map<string, GestimListingRow>();
    if (unique.length === 0) return out;

    const q = `
      SELECT DISTINCT ON (id_annuncio_gestim)
        id_annuncio_gestim AS "externalListingId",
        title,
        city,
        zone,
        address,
        price,
        property_type AS "propertyType",
        contract_type AS "contractType",
        surface_m2 AS "surfaceM2",
        bedrooms,
        bathrooms,
        updated_at AS "updatedAt"
      FROM gestim_listings
      WHERE id_annuncio_gestim = ANY($1::text[])
      ORDER BY id_annuncio_gestim, updated_at DESC NULLS LAST
    `;
    const r = await this.pool.query(q, [unique]);
    for (const row of r.rows as Record<string, unknown>[]) {
      const mapped = mapPgRowToGestim(row);
      out.set(mapped.externalListingId, mapped);
    }
    return out;
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}
