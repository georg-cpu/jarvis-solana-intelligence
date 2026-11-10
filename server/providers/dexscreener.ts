// DexScreener documented public API (https://docs.dexscreener.com/api/reference). Read-only GETs.
import { ProviderQueue } from "../queue/ProviderQueue.js";
import { getJson, isMint, num } from "./http.js";
import { prov, type TokenPartial } from "./partial.js";

const BASE = "https://api.dexscreener.com";

export const dexscreenerQueue = new ProviderQueue({
  id: "dexscreener",
  label: "DexScreener",
  minIntervalMs: 1_500,
  maxConcurrent: 1,
  documentedLimit: "token-profiles/boosts: 60 req/min (documented). Pair/token endpoints: not shown in rendered docs; treated conservatively.",
  note: "Polling only. No official public WebSocket.",
});

interface DsPair {
  chainId: string; dexId: string; url: string; pairAddress: string; labels?: string[];
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; symbol: string };
  priceUsd?: string;
  txns?: Record<string, { buys: number; sells: number }>;
  volume?: Record<string, number>;
  priceChange?: Record<string, number>;
  liquidity?: { usd?: number };
  fdv?: number; marketCap?: number; pairCreatedAt?: number;
  info?: { imageUrl?: string; websites?: { url: string }[]; socials?: { type: string; url: string }[] };
}
interface DsProfile { chainId: string; tokenAddress: string; url?: string; icon?: string }

export async function latestSolanaProfileMints(): Promise<{ mints: string[]; boosted: string[]; fetchedAt: number }> {
  const [profiles, boosts] = await Promise.all([
    dexscreenerQueue.request("profiles", 60_000, () => getJson<DsProfile[]>(`${BASE}/token-profiles/latest/v1`).then((r) => r.data)),
    dexscreenerQueue.request("boosts", 60_000, () => getJson<DsProfile[]>(`${BASE}/token-boosts/latest/v1`).then((r) => r.data)),
  ]);
  const sol = (arr: DsProfile[]) => arr.filter((p) => p.chainId === "solana" && isMint(p.tokenAddress)).map((p) => p.tokenAddress);
  return { mints: [...new Set(sol(profiles.data))], boosted: [...new Set(sol(boosts.data))], fetchedAt: Math.min(profiles.storedAt, boosts.storedAt) };
}

/** Pick the most liquid Solana pair per base token. */
export function bestPairs(pairs: DsPair[]): Map<string, DsPair> {
  const best = new Map<string, DsPair>();
  for (const p of pairs) {
    if (p.chainId !== "solana") continue;
    const mint = p.baseToken.address;
    const cur = best.get(mint);
    if (!cur || (p.liquidity?.usd ?? 0) > (cur.liquidity?.usd ?? 0)) best.set(mint, p);
  }
  return best;
}

export function pairToPartial(p: DsPair, endpoint: string, fetchedAt: number, category?: TokenPartial["category"]): TokenPartial {
  const tx = (k: string) => (p.txns?.[k] ? { buys: p.txns[k].buys, sells: p.txns[k].sells } : undefined);
  const socials = p.info?.socials ?? [];
  return {
    mint: p.baseToken.address,
    symbol: p.baseToken.symbol,
    name: p.baseToken.name,
    logo: p.info?.imageUrl,
    dex: p.dexId,
    poolAddress: p.pairAddress,
    createdAt: num(p.pairCreatedAt),
    priceUsd: num(p.priceUsd),
    marketCap: num(p.marketCap),
    fdv: num(p.fdv),
    liquidityUsd: num(p.liquidity?.usd),
    volume: { m5: num(p.volume?.m5), h1: num(p.volume?.h1), h6: num(p.volume?.h6), h24: num(p.volume?.h24) },
    txns: { m5: tx("m5"), h1: tx("h1"), h24: tx("h24") },
    priceChange: { m5: num(p.priceChange?.m5), h1: num(p.priceChange?.h1), h6: num(p.priceChange?.h6), h24: num(p.priceChange?.h24) },
    links: {
      url: p.url,
      website: p.info?.websites?.[0]?.url,
      twitter: socials.find((s) => s.type === "twitter")?.url,
      telegram: socials.find((s) => s.type === "telegram")?.url,
    },
    category,
    provenance: prov("dexscreener", endpoint, fetchedAt),
  };
}

/** Batch market data for up to 30 mints per call (documented tokens/v1 endpoint). */
export async function tokensMarketData(mints: string[], category?: TokenPartial["category"]): Promise<TokenPartial[]> {
  const valid = [...new Set(mints.filter(isMint))];
  const out: TokenPartial[] = [];
  for (let i = 0; i < valid.length; i += 30) {
    const chunk = valid.slice(i, i + 30);
    const key = `tokens:${chunk.join(",")}`;
    const r = await dexscreenerQueue.request(key, 30_000, () => getJson<DsPair[]>(`${BASE}/tokens/v1/solana/${chunk.join(",")}`).then((x) => x.data));
    for (const p of bestPairs(r.data).values()) out.push(pairToPartial(p, "/tokens/v1/solana", r.storedAt, category));
  }
  return out;
}

export async function searchPairs(q: string): Promise<TokenPartial[]> {
  const r = await dexscreenerQueue.request(`search:${q}`, 30_000, () =>
    getJson<{ pairs: DsPair[] | null }>(`${BASE}/latest/dex/search?q=${encodeURIComponent(q)}`).then((x) => x.data.pairs ?? []),
  );
  return [...bestPairs(r.data).values()].map((p) => pairToPartial(p, "/latest/dex/search", r.storedAt, "search"));
}
