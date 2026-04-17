import type { AppEnv } from "../config/loadEnv.js";
import { resolvePgPoolConfig } from "../config/pgPool.js";
import type { ListingRepository } from "./listingRepository.js";
import { ApiListingRepository, PostgresListingRepository } from "./listingRepository.js";

export function createListingRepository(env: AppEnv): ListingRepository {
  if (env.LISTING_SOURCE === "database") {
    return new PostgresListingRepository(resolvePgPoolConfig(env));
  }
  const base = env.GESTIM_API_BASE_URL;
  if (!base) {
    throw new Error("GESTIM_API_BASE_URL mancante (LISTING_SOURCE=api)");
  }
  return new ApiListingRepository(base);
}
