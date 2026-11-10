// GeckoTerminal public API v2 (CoinGecko on-chain). Read-only GETs, no key.
// No calls/min figure was retrievable from the current docs; we stay far below the commonly cited ~30/min.
import type { Candle } from "../../shared/types.js";
import { ProviderQueue } from "../queue/ProviderQueue.js";
import { getJson, isMint, num } from "./http.js";
import { prov, type TokenPartial } from "./partial.js";

const BASE = "https://api.geckoterminal.com/api/v2";
const HEADERS = { accept: "application/json;version=20230302" };

export const geckoQueue = new ProviderQueue({
  id: "geckoterminal",
  label: "GeckoTerminal",
  minIntervalMs: 10_000, // ≤6 req/min: limit is undocumented and a 429 was observed at higher pace
  maxConcurrent: 1,
  documentedLimit: "Public keyless API; exact calls/min not retrievable from current docs (commonly cited ~30/min). Attribution: data by GeckoTerminal.",
  note: "Polling only. Used for new/trending pools across Solana DEXes and OHLCV candles.",
});

interface GtPool {
  id: string;
  attributes: {
    address: string; name: string; pool_created_at?: string; base_token_price_usd?: string;
    fdv_usd?: string; market_cap_usd?: string | null; reserve_in_usd?: string;
    price_change_percentage?: Record<string, string>;
    transactions?: Record<string, { buys: number; sells: number }>;
    volume_usd?: Record<string, string>;
  };
  relationships: { base_token: { data: { id: string } }; dex: { data: { id: string } } };
}
interface GtIncluded { id: string; type: string; attributes: { address: string; name: string; symbol: string; image_url?: string | null } }
interface GtList { data: GtPool[]; included?: GtIncluded[] }

export function poolToPartial(p: GtPool, inc: Map<string, GtIncluded>, endpoint: string, fetchedAt: number, category?: TokenPartial["category"]): TokenPartial | null {
  const baseId = p.relationships?.base_token?.data?.id ?? "";
  const mint = baseId.replace(/^solana_/, "");
  if (!isMint(mint)) return null;
  const tok = inc.get(baseId)?.attributes;
  const a = p.attributes;
  const tx = (k: string) => (a.transactions?.[k] ? { buys: a.transactions[k].buys, sells: a.transactions[k].sells } : undefined);
  const dex = p.relationships?.dex?.data?.id;
  return {
    mint,
    symbol: tok?.symbol ?? a.name.split(" / ")[0] ?? "?",
    name: tok?.name ?? a.name,
    logo: tok?.image_url && tok.image_url !== "missing.png" ? tok.image_url : undefined,
    dex,
    launchpad: dex === "pump-fun" ? "pump.fun" : dex === "raydium-launchlab" || dex === "letsbonk-fun" ? dex : dex === "meteora-dbc" ? "meteora-dbc" : undefined,
    poolAddress: a.address,
    createdAt: a.pool_created_at ? Date.parse(a.pool_created_at) : undefined,
    priceUsd: num(a.base_token_price_usd),
    marketCap: num(a.market_cap_usd),
    fdv: num(a.fdv_usd),
    liquidityUsd: num(a.reserve_in_usd),
    volume: { m5: num(a.volume_usd?.m5), h1: num(a.volume_usd?.h1), h6: num(a.volume_usd?.h6), h24: num(a.volume_usd?.h24) },
    txns: { m5: tx("m5"), h1: tx("h1"), h24: tx("h24") },
    priceChange: { m5: num(a.price_change_percentage?.m5), h1: num(a.price_change_percentage?.h1), h6: num(a.price_change_percentage?.h6), h24: num(a.price_change_percentage?.h24) },
    category,
    provenance: prov("geckoterminal", endpoint, fetchedAt),
  };
}

async function poolList(path: string, category: TokenPartial["category"], ttl: number): Promise<TokenPartial[]> {
  const r = await geckoQueue.request(path, ttl, () => getJson<GtList>(`${BASE}${path}`, { headers: HEADERS }).then((x) => x.data));
  const inc = new Map((r.data.included ?? []).map((i) => [i.id, i]));
  return r.data.data.map((p) => poolToPartial(p, inc, path.split("?")[0], r.storedAt, category)).filter((x): x is TokenPartial => !!x);
}

export const newPools = () => poolList("/networks/solana/new_pools?include=base_token&page=1", "new", 60_000);
export const trendingPools = () => poolList("/networks/solana/trending_pools?include=base_token&page=1", "trending", 90_000);

/** Most liquid pool for a mint, used when no pool is known for candles. */
export async function topPoolForMint(mint: string): Promise<string | undefined> {
  if (!isMint(mint)) return undefined;
  const r = await geckoQueue.request(`tokpools:${mint}`, 10 * 60_000, () =>
    getJson<GtList>(`${BASE}/networks/solana/tokens/${mint}/pools?page=1`, { headers: HEADERS }).then((x) => x.data),
  );
  return r.data.data[0]?.attributes.address;
}

export const TIMEFRAMES: Record<string, { unit: "minute" | "hour" | "day"; aggregate: number; ttl: number }> = {
  "1m": { unit: "minute", aggregate: 1, ttl: 45_000 },
  "5m": { unit: "minute", aggregate: 5, ttl: 60_000 },
  "15m": { unit: "minute", aggregate: 15, ttl: 120_000 },
  "1h": { unit: "hour", aggregate: 1, ttl: 300_000 },
  "4h": { unit: "hour", aggregate: 4, ttl: 600_000 },
  "1d": { unit: "day", aggregate: 1, ttl: 900_000 },
};

export async function poolOhlcv(pool: string, tf: string): Promise<{ candles: Candle[]; storedAt: number; endpoint: string }> {
  const t = TIMEFRAMES[tf] ?? TIMEFRAMES["5m"];
  if (!isMint(pool)) throw new Error("invalid pool address");
  const path = `/networks/solana/pools/${pool}/ohlcv/${t.unit}?aggregate=${t.aggregate}&limit=200&currency=usd&token=base`;
  const r = await geckoQueue.request(path, t.ttl, () =>
    getJson<{ data: { attributes: { ohlcv_list: number[][] } } }>(`${BASE}${path}`, { headers: HEADERS }).then((x) => x.data),
  );
  const candles = (r.data.data?.attributes?.ohlcv_list ?? [])
    .map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }))
    .filter((c) => [c.open, c.high, c.low, c.close].every((v) => Number.isFinite(v) && v > 0))
    .sort((a, b) => a.time - b.time);
  return { candles, storedAt: r.storedAt, endpoint: `/networks/solana/pools/{pool}/ohlcv/${t.unit}` };
}
