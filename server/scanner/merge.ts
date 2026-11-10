// Merge provider observations into one TokenRecord per mint (dedupe by mint address).
// Each field group keeps provenance. Higher-priority provider wins unless its value is stale.
import type { ProviderId, TokenRecord } from "../../shared/types.js";
import type { TokenPartial } from "../providers/partial.js";

type Group = "identity" | "market" | "volume" | "txns" | "priceChange" | "holders" | "security" | "launchpad" | "createdAt" | "social" | "flow" | "links";

// Higher number = preferred source for that field group.
export const PRIORITY: Record<Group, Partial<Record<ProviderId, number>>> = {
  identity: { jupiter: 4, dexscreener: 3, geckoterminal: 2, gmgn: 1, demo: 5 },
  market: { dexscreener: 4, geckoterminal: 3, jupiter: 2, gmgn: 1, demo: 5 },
  volume: { dexscreener: 4, geckoterminal: 3, jupiter: 2, gmgn: 1, demo: 5 },
  txns: { dexscreener: 4, geckoterminal: 3, jupiter: 2, gmgn: 1, demo: 5 },
  priceChange: { dexscreener: 4, geckoterminal: 3, jupiter: 2, gmgn: 1, demo: 5 },
  holders: { gmgn: 4, jupiter: 3, demo: 5 },
  security: { gmgn: 4, jupiter: 3, demo: 5 },
  launchpad: { jupiter: 4, gmgn: 3, geckoterminal: 2, demo: 5 },
  createdAt: { jupiter: 4, dexscreener: 3, geckoterminal: 3, gmgn: 2, demo: 5 },
  social: { gmgn: 4, demo: 5 },
  flow: { jupiter: 4, demo: 5 },
  links: { dexscreener: 4, jupiter: 3, gmgn: 2, demo: 5 },
};

const defined = (o: Record<string, unknown> | undefined) => !!o && Object.values(o).some((v) => v !== undefined && v !== null);

export function emptyRecord(mint: string, now: number): TokenRecord {
  return {
    mint, symbol: "?", name: "?", volume: {}, txns: {}, priceChange: {}, security: {},
    sources: [], categories: [], provenance: {}, firstSeen: now, lastSeen: now, scanCount: 0,
  };
}

function shouldTake(rec: TokenRecord, group: Group, p: TokenPartial, staleMs: number): boolean {
  const cur = rec.provenance[group];
  if (!cur) return true;
  const pri = PRIORITY[group];
  const newP = pri[p.provenance.provider] ?? 0;
  const curP = pri[cur.provider] ?? 0;
  if (newP >= curP) return true;
  return p.provenance.fetchedAt - cur.fetchedAt > staleMs; // current source is stale -> accept fresher lower-priority data
}

/** Merge one observation into a record (mutates and returns it). */
export function mergePartial(rec: TokenRecord, p: TokenPartial, staleMs = 180_000): TokenRecord {
  const src = p.provenance.provider;
  const take = (g: Group, has: boolean, apply: () => void) => {
    if (!has) return;
    if (shouldTake(rec, g, p, staleMs)) {
      apply();
      rec.provenance[g] = p.provenance;
    }
  };

  take("identity", !!(p.symbol || p.name || p.logo), () => {
    if (p.symbol) rec.symbol = p.symbol;
    if (p.name) rec.name = p.name;
    if (p.logo) rec.logo = p.logo;
  });
  if (!rec.logo && p.logo) rec.logo = p.logo;

  const hasMarket = [p.priceUsd, p.liquidityUsd, p.marketCap, p.fdv].some((v) => v !== undefined);
  take("market", hasMarket, () => {
    // atomic: market fields come together from one provider observation (same pool/time)
    rec.priceUsd = p.priceUsd ?? rec.priceUsd;
    rec.liquidityUsd = p.liquidityUsd ?? rec.liquidityUsd;
    rec.marketCap = p.marketCap ?? rec.marketCap;
    rec.fdv = p.fdv ?? rec.fdv;
    if (p.dex) rec.dex = p.dex;
    if (p.poolAddress) rec.poolAddress = p.poolAddress;
  });
  if (!rec.dex && p.dex) rec.dex = p.dex;
  if (!rec.poolAddress && p.poolAddress) rec.poolAddress = p.poolAddress;

  take("volume", defined(p.volume), () => { rec.volume = { ...rec.volume, ...strip(p.volume!) }; });
  take("txns", defined(p.txns as Record<string, unknown>), () => { rec.txns = { ...rec.txns, ...strip(p.txns as Record<string, unknown>) }; });
  take("priceChange", defined(p.priceChange), () => { rec.priceChange = { ...rec.priceChange, ...strip(p.priceChange!) }; });
  take("holders", [p.holders, p.top10HolderPct, p.devHoldPct].some((v) => v !== undefined), () => {
    rec.holders = p.holders ?? rec.holders;
    rec.top10HolderPct = p.top10HolderPct ?? rec.top10HolderPct;
    rec.devHoldPct = p.devHoldPct ?? rec.devHoldPct;
  });
  if (p.security && defined(p.security as Record<string, unknown>)) {
    const prevHoneypot = rec.security.honeypot;
    if (shouldTake(rec, "security", p, staleMs)) {
      rec.security = { ...rec.security, ...strip(p.security as Record<string, unknown>) };
      rec.provenance.security = p.provenance;
    } else {
      // lower priority source only fills gaps
      for (const [k, v] of Object.entries(p.security)) if (v !== undefined && (rec.security as any)[k] === undefined) (rec.security as any)[k] = v;
    }
    if (prevHoneypot === true) rec.security.honeypot = true; // a honeypot flag from any source is never silently cleared
    if (p.security.flags?.length) rec.security.flags = [...new Set([...(rec.security.flags ?? []), ...p.security.flags])];
  }
  take("launchpad", !!p.launchpad, () => { rec.launchpad = p.launchpad; });
  if (p.createdAt && Number.isFinite(p.createdAt)) {
    if (!rec.createdAt || p.createdAt < rec.createdAt) { rec.createdAt = p.createdAt; rec.provenance.createdAt = p.provenance; }
  }
  take("social", p.smartMoneyCount !== undefined || p.kolCount !== undefined, () => {
    rec.smartMoneyCount = p.smartMoneyCount ?? rec.smartMoneyCount;
    rec.kolCount = p.kolCount ?? rec.kolCount;
  });
  take("flow", p.buyVolume5m !== undefined, () => { rec.buyVolume5m = p.buyVolume5m; rec.sellVolume5m = p.sellVolume5m; });
  if (p.links && defined(p.links as Record<string, unknown>)) {
    rec.links = { ...(p.links ? strip(p.links as Record<string, unknown>) : {}), ...(rec.links ?? {}) };
    if (p.provenance.provider === "dexscreener" && p.links.url) rec.links.url = p.links.url;
  }

  if (!rec.sources.includes(src)) rec.sources.push(src);
  if (p.category && !rec.categories.includes(p.category)) rec.categories.push(p.category);
  rec.lastSeen = Math.max(rec.lastSeen, p.provenance.fetchedAt);
  if (p.demo) rec.demo = true;
  return rec;
}

function strip<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) (out as any)[k] = v;
  return out;
}
