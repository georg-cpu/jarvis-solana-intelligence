import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig, CoverageRow } from "../shared/types.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = path.join(ROOT, "data");
export const API_PORT = Number(process.env.API_PORT || 8787);

// Conservative defaults. Every interval is configurable from the dashboard.
export const DEFAULT_CONFIG: AppConfig = {
  mode: process.env.DATA_MODE === "demo" ? "demo" : "live",
  feeds: {
    "dexscreener.profiles": { intervalSec: 120, enabled: true },
    "jupiter.recent": { intervalSec: 90, enabled: true },
    "jupiter.trending": { intervalSec: 180, enabled: true },
    "gecko.newPools": { intervalSec: 120, enabled: true },
    "gecko.trendingPools": { intervalSec: 180, enabled: true },
    "dexscreener.refresh": { intervalSec: 90, enabled: true },
    "gmgn.trending": { intervalSec: 300, enabled: true },
    "gmgn.trenches": { intervalSec: 420, enabled: true },
    "gmgn.smartmoney": { intervalSec: 360, enabled: true },
    "gmgn.kol": { intervalSec: 360, enabled: true },
    "demo.tick": { intervalSec: 5, enabled: true },
  },
  staleAfterSec: 300,
  weights: { momentum: 0.3, liquidity: 0.2, security: 0.3, holderRisk: 0.2 },
  thresholds: { volumeSpikeRatio: 3, liquidityDropPct: 20, momentumAccelRatio: 4, whaleTradeUsd: 5000, whaleAvgBuyUsd: 1500 },
  maxTokens: 400,
};

export const MIN_INTERVAL_SEC: Record<string, number> = {
  dexscreener: 30, jupiter: 45, gecko: 60, gmgn: 180, demo: 2,
};

export const COVERAGE: CoverageRow[] = [
  { venue: "Pump.fun (bonding curve)", status: "indirect", via: "GMGN trenches, Jupiter recent (launchpad field), GeckoTerminal dex=pump-fun", notes: "No documented public Pump.fun read API reachable (pump.fun returned 403). Not scraped." },
  { venue: "PumpSwap AMM", status: "partial", via: "DexScreener / GeckoTerminal pairs (dex id pumpswap)", notes: "Only pools that appear in provider lists or that are looked up by mint." },
  { venue: "Raydium (AMM / CLMM / LaunchLab)", status: "partial", via: "DexScreener & GeckoTerminal pairs", notes: "Raydium's own API v3 evaluated, not integrated (pool data already available via aggregators)." },
  { venue: "Meteora (DLMM / DAMM / DBC)", status: "partial", via: "DexScreener & GeckoTerminal pairs", notes: "Meteora public APIs evaluated, not integrated." },
  { venue: "Orca Whirlpools", status: "partial", via: "DexScreener & GeckoTerminal pairs", notes: "Orca public API evaluated, not integrated." },
  { venue: "LetsBonk / Bags / Moonshot / other launchpads", status: "indirect", via: "Jupiter launchpad field, GMGN launchpad_platform, GeckoTerminal dex id", notes: "Coverage depends on what upstream providers list." },
  { venue: "Jupiter (routing / price)", status: "covered", via: "Jupiter Tokens v2 + Price v3 (keyless lite-api)", notes: "30 RPM keyless limit; polled conservatively." },
  { venue: "GMGN analytics (smart money, KOL, security, holders)", status: "partial", via: "Official gmgn-cli with public demo key", notes: "Demo key: testing only, per-IP rate limit, 1s candles Pro-only, callout/follow features unavailable." },
  { venue: "Real-time streaming (WebSocket)", status: "unsupported", via: "—", notes: "No official free WebSocket used. All data is POLLED; dashboard push is local SSE of polled results." },
  { venue: "Every Solana token / DEX", status: "unsupported", via: "—", notes: "Coverage is limited to tokens surfaced by the providers above. This is NOT a complete index." },
];
