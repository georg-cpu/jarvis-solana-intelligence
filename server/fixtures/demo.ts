// DEMO DATA — synthetic, deterministic fixtures for offline testing. NOT real tokens, NOT real prices.
// All mints start with "DEMo" so they can never be confused with live data.
import type { Candle, WalletTrade } from "../../shared/types.js";
import { prov, type TokenPartial } from "../providers/partial.js";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const mintFor = (i: number) => {
  const r = rng(1000 + i);
  let m = "DEMo";
  while (m.length < 44) m += B58[Math.floor(r() * B58.length)];
  return m;
};

const NAMES = ["NEON CAT", "Quantum Pepe", "Laser Doge", "Solar Frog", "Cyber Bonk", "Hyper Shiba", "Moon Otter", "Glitch Ape", "Plasma Duck", "Vector Wif", "Nova Hamster", "Pixel Whale", "Rocket Gecko", "Turbo Panda", "Zen Koala", "Ghost Llama", "Echo Fox", "Static Owl"];
const LAUNCHPADS = ["pump.fun", "letsbonk.fun", "meteora-dbc", "raydium-launchlab", undefined];
const DEXES = ["pumpswap", "raydium", "meteora", "orca", "raydium-clmm"];

interface DemoToken { mint: string; symbol: string; name: string; price: number; liq: number; supply: number; created: number; seed: number; drift: number }

let tokens: DemoToken[] | null = null;
function init(now: number) {
  tokens = NAMES.map((n, i) => {
    const r = rng(i + 7);
    return {
      mint: mintFor(i),
      symbol: n.split(" ").map((w) => w[0]).join("") + "DEMO",
      name: `${n} (DEMO DATA)`,
      price: 0.00001 + r() * 0.002,
      liq: 5_000 + r() * 400_000,
      supply: 1_000_000_000,
      created: now - Math.floor(r() * 72 * 3600_000),
      seed: i,
      drift: (r() - 0.45) * 0.02,
    };
  });
}

let tick = 0;
/** Advance the synthetic random walk and return partial observations labeled DEMO. */
export function demoTick(now = Date.now()): TokenPartial[] {
  if (!tokens) init(now);
  tick++;
  return tokens!.map((t, i) => {
    const r = rng(t.seed * 9973 + tick);
    const shock = (r() - 0.5) * 0.08 + t.drift;
    t.price = Math.max(1e-8, t.price * (1 + shock));
    t.liq = Math.max(500, t.liq * (1 + (r() - 0.5) * 0.04 - (i === 3 && tick % 12 === 0 ? 0.35 : 0)));
    const vol1h = t.liq * (0.2 + r() * 3);
    const vol5m = (vol1h / 12) * (i === 1 && tick % 6 < 2 ? 6 : 0.4 + r() * 1.6);
    const buys5 = Math.floor(5 + r() * 120), sells5 = Math.floor(5 + r() * 110);
    const ageH = (now - t.created) / 3600_000;
    return {
      mint: t.mint,
      symbol: t.symbol,
      name: t.name,
      createdAt: t.created,
      launchpad: LAUNCHPADS[i % LAUNCHPADS.length],
      dex: DEXES[i % DEXES.length],
      poolAddress: mintFor(i + 500),
      priceUsd: t.price,
      marketCap: t.price * t.supply,
      fdv: t.price * t.supply,
      liquidityUsd: t.liq,
      volume: { m5: vol5m, h1: vol1h, h24: vol1h * 14 },
      txns: { m5: { buys: buys5, sells: sells5 }, h1: { buys: buys5 * 10, sells: sells5 * 10 }, h24: { buys: buys5 * 200, sells: sells5 * 190 } },
      priceChange: { m5: shock * 100, h1: (r() - 0.4) * 60, h24: (r() - 0.4) * 200 },
      buyVolume5m: vol5m * (buys5 / (buys5 + sells5)),
      sellVolume5m: vol5m * (sells5 / (buys5 + sells5)),
      holders: Math.floor(50 + r() * 5000),
      top10HolderPct: 10 + ((i * 7) % 60),
      devHoldPct: (i * 3) % 15,
      smartMoneyCount: i % 5,
      kolCount: i % 3,
      security: {
        mintRenounced: i % 6 !== 0,
        freezeRenounced: i % 7 !== 0,
        honeypot: i === 11,
        rugRatio: (i % 9) / 20,
        bundlerRate: (i % 8) / 20,
        washTrading: i % 10 === 4,
        organicScore: (i * 13) % 100,
      },
      category: ageH < 6 ? "new" : i % 2 ? "trending" : "boosted",
      demo: true,
      provenance: prov("demo", "fixtures/demo.ts (synthetic)", now),
    } satisfies TokenPartial;
  });
}

export function demoTrades(now = Date.now()): WalletTrade[] {
  if (!tokens) init(now);
  const r = rng(tick * 31 + 5);
  return Array.from({ length: 24 }, (_, k) => {
    const t = tokens![Math.floor(r() * tokens!.length)];
    const kind = k % 2 ? "kol" : "smart";
    return {
      id: `demo-${tick}-${k}`,
      wallet: mintFor(900 + k),
      walletName: kind === "kol" ? `DEMO_KOL_${k}` : undefined,
      walletTags: [kind === "kol" ? "kol" : "smart_degen", "demo"],
      mint: t.mint,
      symbol: t.symbol,
      side: r() > 0.4 ? "buy" : "sell",
      amountUsd: Math.round(50 + r() * 12_000),
      priceUsd: t.price,
      timestamp: now - Math.floor(r() * 40 * 60_000),
      kind,
      provenance: prov("demo", "fixtures/demo.ts (synthetic)", now),
    } satisfies WalletTrade;
  }).sort((a, b) => b.timestamp - a.timestamp);
}

export function demoCandles(mint: string, tf: string, now = Date.now()): Candle[] {
  const step = ({ "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 } as Record<string, number>)[tf] ?? 300;
  const t = tokens?.find((x) => x.mint === mint);
  const r = rng([...mint].reduce((a, c) => a + c.charCodeAt(0), 0));
  const end = Math.floor(now / 1000 / step) * step;
  let p = (t?.price ?? 0.001) * 0.6;
  const out: Candle[] = [];
  for (let i = 150; i >= 0; i--) {
    const o = p;
    const c = Math.max(1e-9, o * (1 + (r() - 0.47) * 0.06));
    const h = Math.max(o, c) * (1 + r() * 0.03), l = Math.min(o, c) * (1 - r() * 0.03);
    out.push({ time: end - i * step, open: o, high: h, low: l, close: c, volume: 1000 + r() * 50_000 });
    p = c;
  }
  if (t) {
    const k = t.price / out[out.length - 1].close; // anchor last close to the current demo price
    for (const c of out) { c.open *= k; c.high *= k; c.low *= k; c.close *= k; }
  }
  return out;
}

export const isDemoMint = (m: string) => m.startsWith("DEMo");
