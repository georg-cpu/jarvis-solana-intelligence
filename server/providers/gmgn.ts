// Official GMGN CLI (gmgn-cli, installed globally) called with the PUBLIC DEMO KEY ONLY.
// Hard allow-list of read-only commands. No private key is ever passed; HOME/USERPROFILE point at an
// empty isolated folder so the CLI cannot load ~/.config/gmgn/.env or any keypair.
import { execFile, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Candle, WalletTrade } from "../../shared/types.js";
import { DATA_DIR } from "../config.js";
import { PlanRestrictedError, ProviderQueue, RateLimitError } from "../queue/ProviderQueue.js";
import { isMint, num } from "./http.js";
import { prov, type TokenPartial } from "./partial.js";

export const GMGN_DEMO_KEY = "gmgn_solbscbaseethmonadtron"; // public demo key published in the official README

export const gmgnQueue = new ProviderQueue({
  id: "gmgn",
  label: "GMGN (official CLI, demo key)",
  minIntervalMs: 9_000,
  maxConcurrent: 1,
  documentedLimit: "Leaky bucket per plan (Free 5/5); demo key observed as per-IP: bursts → 429, ban +5s per extra request up to 5 min",
  baseBackoffMs: 30_000,
  maxBackoffMs: 300_000,
  circuitThreshold: 3,
  circuitOpenMs: 10 * 60_000,
  maxQueue: 6,
  note: "Demo key: testing only, read-only commands only. Polling only.",
});

const ALLOWED: Record<string, string[]> = {
  market: ["trending", "trenches", "kline"],
  token: ["info", "security", "holders", "traders", "pool"],
  track: ["kol", "smartmoney"],
  portfolio: ["stats", "activity", "profits", "created-tokens"],
};
const FORBIDDEN = /^(swap|multi-swap|order|cooking|config|holdings|follow-wallet|create)$/i;
const SAFE_ARG = /^[A-Za-z0-9_.:-]{1,64}$/;

let cliPath: string | null | undefined;
export function locateCli(): string | null {
  if (cliPath !== undefined) return cliPath;
  try {
    const root = execSync("npm root -g", { encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "ignore"] }).trim();
    const p = path.join(root, "gmgn-cli", "dist", "index.js");
    cliPath = fs.existsSync(p) ? p : null;
  } catch {
    cliPath = null;
  }
  if (!cliPath) {
    gmgnQueue.disabled = true;
    gmgnQueue.disabledReason = "gmgn-cli not found in global npm modules";
  }
  return cliPath;
}

export function assertAllowed(args: string[]): void {
  const [group, sub] = args;
  if (!group || !sub || !ALLOWED[group]?.includes(sub)) throw new Error(`GMGN command not allowed: ${group} ${sub}`);
  for (const a of args) {
    if (FORBIDDEN.test(a)) throw new Error(`GMGN forbidden token in args: ${a}`);
    if (!SAFE_ARG.test(a)) throw new Error(`GMGN unsafe argument rejected`);
  }
}

const isolatedHome = path.join(DATA_DIR, "gmgn-isolated-home");

/** Classify CLI stderr into queue errors. Exported for tests. */
export function classifyGmgnError(stderr: string): Error {
  const m429 = stderr.match(/HTTP 429[^\n]*?error=(\w+)/);
  if (m429) {
    const secs = stderr.match(/~(\d+)s remaining/);
    const code = m429[1];
    const ms = code === "RATE_LIMIT_BANNED_MAX" ? 5 * 60_000 : secs ? Number(secs[1]) * 1000 + 2000 : 60_000;
    return new RateLimitError(`GMGN ${code}`, ms, code);
  }
  if (/PRO_PLAN_REQUIRED|PLAN_UPGRADE_REQUIRED/.test(stderr)) return new PlanRestrictedError("GMGN: feature not available on the demo/free plan");
  const http = stderr.match(/failed: (HTTP \d+[^\n]*)/);
  return new Error(`GMGN ${http ? http[1].slice(0, 200) : stderr.trim().split("\n").pop()?.slice(0, 200) || "unknown error"}`);
}

function runCli<T>(args: string[]): Promise<T> {
  assertAllowed(args);
  const cli = locateCli();
  if (!cli) return Promise.reject(new Error("gmgn-cli not installed"));
  fs.mkdirSync(isolatedHome, { recursive: true });
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    HOME: isolatedHome,
    USERPROFILE: isolatedHome,
    GMGN_API_KEY: GMGN_DEMO_KEY,
    GMGN_PRIVATE_KEY: "",
    GMGN_RATE_LIMIT_AUTO_RETRY_MAX_WAIT_MS: "0",
    LANG: "en_US.UTF-8",
  };
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [cli, ...args, "--raw"], { env, cwd: isolatedHome, timeout: 30_000, maxBuffer: 20 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(classifyGmgnError(String(stderr || err.message)));
      try {
        resolve(JSON.parse(stdout) as T);
      } catch {
        reject(new Error("GMGN returned non-JSON output"));
      }
    });
  });
}

const unwrap = (j: any) => (j && typeof j === "object" && "data" in j ? j.data : j);
const pct = (v: unknown) => { const n = num(v); return n === undefined ? undefined : n <= 1 ? n * 100 : n; };
const bool01 = (v: unknown) => (v === null || v === undefined ? undefined : v === true || v === 1 || v === "1");
const sec = (v: unknown) => { const n = num(v); return n ? (n > 1e12 ? n : n * 1000) : undefined; };

export function gmgnRankToPartial(t: any, endpoint: string, fetchedAt: number, category: TokenPartial["category"]): TokenPartial | null {
  if (!isMint(String(t.address))) return null;
  const is24 = t.volume_24h !== undefined;
  return {
    mint: t.address,
    symbol: t.symbol ?? "?",
    name: t.name ?? t.symbol ?? "?",
    logo: t.logo,
    createdAt: sec(t.open_timestamp) ?? sec(t.created_timestamp) ?? sec(t.creation_timestamp),
    launchpad: t.launchpad_platform || t.launchpad || undefined,
    dex: t.exchange || undefined,
    poolAddress: t.pool_address || undefined,
    priceUsd: num(t.price),
    marketCap: num(t.market_cap),
    liquidityUsd: num(t.liquidity),
    holders: num(t.holder_count),
    top10HolderPct: pct(t.top_10_holder_rate),
    devHoldPct: pct(t.dev_team_hold_rate),
    smartMoneyCount: num(t.smart_degen_count),
    kolCount: num(t.renowned_count),
    volume: is24 ? { h24: num(t.volume_24h) } : { h1: num(t.volume) },
    txns: is24
      ? { h24: t.buys_24h !== undefined ? { buys: num(t.buys_24h) ?? 0, sells: num(t.sells_24h) ?? 0 } : undefined }
      : { h1: t.buys !== undefined ? { buys: num(t.buys) ?? 0, sells: num(t.sells) ?? 0 } : undefined },
    priceChange: { m5: num(t.price_change_percent5m), h1: num(t.price_change_percent1h) },
    security: {
      mintRenounced: bool01(t.renounced_mint),
      freezeRenounced: bool01(t.renounced_freeze_account),
      honeypot: bool01(t.is_honeypot),
      rugRatio: num(t.rug_ratio),
      bundlerRate: num(t.bundler_rate ?? t.bundler_trader_amount_rate),
      sniperCount: num(t.sniper_count),
      washTrading: bool01(t.is_wash_trading),
      buyTax: num(t.buy_tax),
      sellTax: num(t.sell_tax),
    },
    links: { twitter: t.twitter_username || t.twitter || undefined, website: t.website || undefined, telegram: t.telegram || undefined },
    category,
    provenance: prov("gmgn", endpoint, fetchedAt),
  };
}

export async function gmgnTrending(): Promise<TokenPartial[]> {
  const r = await gmgnQueue.request("trending", 150_000, () => runCli<any>(["market", "trending", "--chain", "sol", "--interval", "1h", "--limit", "30"]));
  const rank = unwrap(r.data)?.rank ?? [];
  return rank.map((t: any) => gmgnRankToPartial(t, "market trending (1h)", r.storedAt, "trending")).filter(Boolean) as TokenPartial[];
}

export async function gmgnTrenches(): Promise<TokenPartial[]> {
  const r = await gmgnQueue.request("trenches", 200_000, () => runCli<any>(["market", "trenches", "--chain", "sol", "--type", "new_creation", "--limit", "30"]));
  const d = unwrap(r.data) ?? {};
  const all = [...(d.new_creation ?? []), ...(d.near_completion ?? []), ...(d.completed ?? [])];
  return all.map((t: any) => gmgnRankToPartial(t, "market trenches", r.storedAt, "new")).filter(Boolean) as TokenPartial[];
}

function toTrade(x: any, kind: "smart" | "kol", fetchedAt: number): WalletTrade | null {
  if (!isMint(String(x.base_address))) return null;
  const mi = x.maker_info ?? {};
  return {
    // one transaction can contain several swaps → make the id unique per maker/token/side/amount
    id: `${x.transaction_hash ?? x.timestamp}:${x.maker}:${x.base_address}:${x.side}:${x.amount_usd}`,
    wallet: String(x.maker),
    walletName: mi.twitter_name || mi.name || mi.twitter_username || undefined,
    walletTags: Array.isArray(mi.tags) ? mi.tags : undefined,
    mint: x.base_address,
    symbol: x.base_token?.symbol ?? "?",
    side: x.side === "sell" ? "sell" : "buy",
    amountUsd: num(x.amount_usd) ?? 0,
    priceUsd: num(x.price_usd) ?? 0,
    timestamp: sec(x.timestamp) ?? fetchedAt,
    kind,
    provenance: prov("gmgn", kind === "kol" ? "track kol" : "track smartmoney", fetchedAt),
  };
}

export async function gmgnWalletTrades(kind: "smart" | "kol"): Promise<WalletTrade[]> {
  const sub = kind === "kol" ? "kol" : "smartmoney";
  const r = await gmgnQueue.request(`track:${sub}`, 200_000, () => runCli<any>(["track", sub, "--chain", "sol", "--limit", "50"]));
  const d = unwrap(r.data);
  const list = Array.isArray(d) ? d : d?.list ?? [];
  return list.map((x: any) => toTrade(x, kind, r.storedAt)).filter(Boolean) as WalletTrade[];
}

export async function gmgnSecurity(mint: string): Promise<TokenPartial | null> {
  if (!isMint(mint)) return null;
  const r = await gmgnQueue.request(`sec:${mint}`, 10 * 60_000, () => runCli<any>(["token", "security", "--chain", "sol", "--address", mint]));
  const s = unwrap(r.data) ?? {};
  return {
    mint,
    top10HolderPct: pct(s.top_10_holder_rate),
    security: {
      mintRenounced: bool01(s.renounced_mint),
      freezeRenounced: bool01(s.renounced_freeze_account),
      honeypot: s.is_honeypot === null && !s.honeypot ? undefined : bool01(s.is_honeypot ?? s.honeypot),
      buyTax: num(s.buy_tax),
      sellTax: num(s.sell_tax),
      flags: Array.isArray(s.flags) && s.flags.length ? s.flags.map(String) : undefined,
    },
    provenance: prov("gmgn", "token security", r.storedAt),
  };
}

export interface HolderRow { address: string; pct: number; usd?: number; tags: string[]; suspicious: boolean; name?: string }
export async function gmgnHolders(mint: string): Promise<{ holders: HolderRow[]; fetchedAt: number }> {
  if (!isMint(mint)) return { holders: [], fetchedAt: Date.now() };
  const r = await gmgnQueue.request(`holders:${mint}`, 10 * 60_000, () => runCli<any>(["token", "holders", "--chain", "sol", "--address", mint, "--limit", "20"]));
  const d = unwrap(r.data);
  const list = Array.isArray(d) ? d : d?.list ?? [];
  return {
    fetchedAt: r.storedAt,
    holders: list.map((h: any) => ({
      address: String(h.address),
      pct: pct(h.amount_percentage) ?? 0,
      usd: num(h.usd_value),
      tags: [...(Array.isArray(h.tags) ? h.tags : []), ...(h.wallet_tag_v2 ? [String(h.wallet_tag_v2)] : [])].map(String),
      suspicious: !!h.is_suspicious,
      name: h.name || h.twitter_name || undefined,
    })),
  };
}

export async function gmgnKline(mint: string, tf: string): Promise<{ candles: Candle[]; storedAt: number }> {
  const map: Record<string, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 };
  const step = map[tf] ?? 300;
  const to = Math.floor(Date.now() / 1000 / step) * step;
  const from = to - step * 150;
  const r = await gmgnQueue.request(`kline:${mint}:${tf}:${to}`, 120_000, () =>
    runCli<any>(["market", "kline", "--chain", "sol", "--address", mint, "--resolution", tf, "--from", String(from), "--to", String(to)]),
  );
  const d = unwrap(r.data);
  const list = Array.isArray(d) ? d : d?.list ?? [];
  const candles = list
    .map((k: any) => ({ time: Math.floor((num(k.time) ?? 0) / (num(k.time)! > 1e12 ? 1000 : 1)), open: num(k.open)!, high: num(k.high)!, low: num(k.low)!, close: num(k.close)!, volume: num(k.volume) ?? 0 }))
    .filter((c: Candle) => [c.open, c.high, c.low, c.close].every((v) => Number.isFinite(v) && v > 0))
    .sort((a: Candle, b: Candle) => a.time - b.time);
  return { candles, storedAt: r.storedAt };
}
