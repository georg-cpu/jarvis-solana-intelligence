// Jupiter Tokens API v2 + Price API v3 on the keyless lite-api host. Read-only GETs.
// Documented keyless limit: 0.5 RPS / 30 RPM (60s sliding window). We run at ~20 RPM.
import { ProviderQueue } from "../queue/ProviderQueue.js";
import { getJson, isMint, num } from "./http.js";
import { prov, type TokenPartial } from "./partial.js";

const BASE = "https://lite-api.jup.ag";

export const jupiterQueue = new ProviderQueue({
  id: "jupiter",
  label: "Jupiter Tokens/Price",
  minIntervalMs: 3_000,
  maxConcurrent: 1,
  documentedLimit: "Keyless: 0.5 RPS / 30 RPM, 60s sliding window (developers.jup.ag/docs/api-rate-limit)",
  note: "Polling only. lite-api keyless host.",
});

interface JupStats { priceChange?: number; liquidityChange?: number; volumeChange?: number; buyVolume?: number; sellVolume?: number; numBuys?: number; numSells?: number; numTraders?: number }
export interface JupToken {
  id: string; name: string; symbol: string; icon?: string; decimals?: number; dev?: string;
  launchpad?: string; holderCount?: number; fdv?: number; mcap?: number; usdPrice?: number; liquidity?: number;
  stats5m?: JupStats; stats1h?: JupStats; stats6h?: JupStats; stats24h?: JupStats;
  firstPool?: { id?: string; createdAt?: string };
  audit?: { mintAuthorityDisabled?: boolean; freezeAuthorityDisabled?: boolean; topHoldersPercentage?: number; devBalancePercentage?: number; devMints?: number; isSus?: boolean };
  organicScore?: number; organicScoreLabel?: string; isVerified?: boolean; tags?: string[];
  createdAt?: string; twitter?: string; website?: string; telegram?: string;
}

/** Inspect Jupiter's x-ratelimit headers and pre-emptively pause when the window is exhausted. */
function respectHeaders(h: Headers) {
  const remaining = num(h.get("x-ratelimit-remaining"));
  const reset = num(h.get("x-ratelimit-reset"));
  if (remaining !== undefined && remaining <= 0 && reset) {
    const ms = reset * 1000 - Date.now();
    if (ms > 0) jupiterQueue.setCooldown(ms + 1000, "x-ratelimit-remaining reached 0");
  }
}

async function jget<T>(path: string): Promise<T> {
  const r = await getJson<T>(`${BASE}${path}`, { fallbackRetryMs: 60_000 });
  respectHeaders(r.headers);
  return r.data;
}

const vol = (s?: JupStats) => (s && (s.buyVolume !== undefined || s.sellVolume !== undefined) ? (s.buyVolume ?? 0) + (s.sellVolume ?? 0) : undefined);
const tx = (s?: JupStats) => (s && s.numBuys !== undefined ? { buys: s.numBuys ?? 0, sells: s.numSells ?? 0 } : undefined);

export function jupToPartial(t: JupToken, endpoint: string, fetchedAt: number, category?: TokenPartial["category"]): TokenPartial {
  const created = t.firstPool?.createdAt ?? t.createdAt;
  return {
    mint: t.id,
    symbol: t.symbol,
    name: t.name,
    logo: t.icon,
    launchpad: t.launchpad,
    poolAddress: t.firstPool?.id,
    createdAt: created ? Date.parse(created) : undefined,
    priceUsd: num(t.usdPrice),
    marketCap: num(t.mcap),
    fdv: num(t.fdv),
    liquidityUsd: num(t.liquidity),
    holders: num(t.holderCount),
    top10HolderPct: num(t.audit?.topHoldersPercentage),
    devHoldPct: num(t.audit?.devBalancePercentage),
    volume: { m5: vol(t.stats5m), h1: vol(t.stats1h), h6: vol(t.stats6h), h24: vol(t.stats24h) },
    txns: { m5: tx(t.stats5m), h1: tx(t.stats1h), h24: tx(t.stats24h) },
    priceChange: { m5: num(t.stats5m?.priceChange), h1: num(t.stats1h?.priceChange), h6: num(t.stats6h?.priceChange), h24: num(t.stats24h?.priceChange) },
    buyVolume5m: num(t.stats5m?.buyVolume),
    sellVolume5m: num(t.stats5m?.sellVolume),
    security: {
      mintRenounced: t.audit?.mintAuthorityDisabled,
      freezeRenounced: t.audit?.freezeAuthorityDisabled,
      jupVerified: t.isVerified ?? (t.tags ? t.tags.includes("verified") : undefined),
      organicScore: num(t.organicScore),
      devMints: num(t.audit?.devMints),
      flags: t.audit?.isSus ? ["jupiter:suspicious"] : undefined,
    },
    links: { twitter: t.twitter, website: t.website, telegram: t.telegram },
    category,
    provenance: prov("jupiter", endpoint, fetchedAt),
  };
}

export async function recentTokens(limit = 30): Promise<TokenPartial[]> {
  const r = await jupiterQueue.request(`recent:${limit}`, 45_000, () => jget<JupToken[]>(`/tokens/v2/recent?limit=${limit}`));
  return r.data.filter((t) => isMint(t.id)).map((t) => jupToPartial(t, "/tokens/v2/recent", r.storedAt, "new"));
}

export async function topTrending(interval: "5m" | "1h" | "6h" | "24h" = "1h", limit = 30): Promise<TokenPartial[]> {
  const r = await jupiterQueue.request(`trend:${interval}:${limit}`, 90_000, () => jget<JupToken[]>(`/tokens/v2/toptrending/${interval}?limit=${limit}`));
  return r.data.filter((t) => isMint(t.id)).map((t) => jupToPartial(t, `/tokens/v2/toptrending/${interval}`, r.storedAt, "trending"));
}

/** Search by name/symbol or up to 100 comma-separated mints. */
export async function searchTokens(query: string): Promise<TokenPartial[]> {
  const r = await jupiterQueue.request(`search:${query}`, 30_000, () => jget<JupToken[]>(`/tokens/v2/search?query=${encodeURIComponent(query)}`));
  return r.data.filter((t) => isMint(t.id)).map((t) => jupToPartial(t, "/tokens/v2/search", r.storedAt, "search"));
}

export async function prices(mints: string[]): Promise<Record<string, { usdPrice: number; liquidity?: number }>> {
  const ids = [...new Set(mints.filter(isMint))].slice(0, 50);
  if (!ids.length) return {};
  const r = await jupiterQueue.request(`price:${ids.join(",")}`, 15_000, () => jget<Record<string, { usdPrice: number; liquidity?: number }>>(`/price/v3?ids=${ids.join(",")}`));
  return r.data;
}
