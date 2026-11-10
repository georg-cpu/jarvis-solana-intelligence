import type { Category, ProviderId, Provenance, TokenRecord } from "../../shared/types.js";

/** A partial token observation from one provider call, merged into TokenRecord by the scanner. */
export type TokenPartial = Partial<Omit<TokenRecord, "sources" | "categories" | "provenance" | "firstSeen" | "lastSeen" | "scanCount" | "security" | "volume" | "txns" | "priceChange">> & {
  mint: string;
  security?: TokenRecord["security"];
  volume?: TokenRecord["volume"];
  txns?: TokenRecord["txns"];
  priceChange?: TokenRecord["priceChange"];
  category?: Category;
  provenance: Provenance;
};

export const prov = (provider: ProviderId, endpoint: string, fetchedAt = Date.now()): Provenance => ({ provider, endpoint, fetchedAt });
