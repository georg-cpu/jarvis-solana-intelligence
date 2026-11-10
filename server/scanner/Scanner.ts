import path from "node:path";
import type {
  AlertEvent, AlertRule, AppConfig, CandleSeries, DashboardState, FeedStatus, ProviderId, Snapshot, TokenRecord, TokenView, WalletTrade, WatchItem,
} from "../../shared/types.js";
import { DATA_DIR, DEFAULT_CONFIG, MIN_INTERVAL_SEC } from "../config.js";
import { demoCandles, demoTick, demoTrades, isDemoMint } from "../fixtures/demo.js";
import * as ds from "../providers/dexscreener.js";
import * as gt from "../providers/geckoterminal.js";
import * as gm from "../providers/gmgn.js";
import { isMint } from "../providers/http.js";
import * as jup from "../providers/jupiter.js";
import type { TokenPartial } from "../providers/partial.js";
import { CooldownError, PlanRestrictedError, type ProviderQueue } from "../queue/ProviderQueue.js";
import { derive } from "../signals/engine.js";
import { JsonStore } from "../store/jsonStore.js";
import { emptyRecord, mergePartial } from "./merge.js";

export const QUEUES: Record<Exclude<ProviderId, "demo">, ProviderQueue> = {
  dexscreener: ds.dexscreenerQueue,
  jupiter: jup.jupiterQueue,
  geckoterminal: gt.geckoQueue,
  gmgn: gm.gmgnQueue,
};

interface Feed { id: string; provider: ProviderId; label: string; mode: "live" | "demo"; run: () => Promise<number> }

const uid = () => Math.random().toString(36).slice(2, 10);

export class Scanner {
  records = new Map<string, TokenRecord>();
  history = new Map<string, Snapshot[]>();
  derivedCache = new Map<string, TokenView["derived"]>();
  trades: WalletTrade[] = [];
  alerts: AlertEvent[] = [];
  feedStatus = new Map<string, FeedStatus>();
  private running = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private scans = 0;
  private lastScanAt?: number;
  private listeners = new Set<() => void>();
  private recentAlertKeys = new Map<string, number>();

  private cfgStore = new JsonStore<AppConfig>(path.join(DATA_DIR, "config.json"), DEFAULT_CONFIG);
  private watchStore = new JsonStore<{ items: WatchItem[]; rules: AlertRule[] }>(path.join(DATA_DIR, "watchlist.json"), { items: [], rules: [] });
  private alertStore = new JsonStore<{ alerts: AlertEvent[] }>(path.join(DATA_DIR, "alerts.json"), { alerts: [] });
  config: AppConfig;
  watch: { items: WatchItem[]; rules: AlertRule[] };

  constructor(private feeds: Feed[] = []) {
    const stored = this.cfgStore.load();
    // env DATA_MODE overrides persisted mode; merge any new feed keys from defaults
    this.config = { ...stored, feeds: { ...DEFAULT_CONFIG.feeds, ...stored.feeds }, thresholds: { ...DEFAULT_CONFIG.thresholds, ...stored.thresholds }, weights: { ...DEFAULT_CONFIG.weights, ...stored.weights } };
    if (process.env.DATA_MODE === "demo" || process.env.DATA_MODE === "live") this.config.mode = process.env.DATA_MODE;
    this.watch = this.watchStore.load();
    this.alerts = this.alertStore.load().alerts ?? [];
    if (!feeds.length) this.feeds = this.defaultFeeds();
    for (const f of this.feeds) this.feedStatus.set(f.id, { id: f.id, provider: f.provider, label: f.label, intervalSec: this.config.feeds[f.id]?.intervalSec ?? 120, enabled: this.config.feeds[f.id]?.enabled ?? true });
  }

  onChange(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit() { for (const l of this.listeners) l(); }

  private defaultFeeds(): Feed[] {
    return [
      { id: "demo.tick", provider: "demo", label: "DEMO DATA synthetic tick", mode: "demo", run: async () => { const n = this.ingest(demoTick()); this.trades = demoTrades(); return n; } },
      { id: "dexscreener.profiles", provider: "dexscreener", label: "DexScreener latest profiles + boosts (Solana)", mode: "live", run: async () => {
        const { mints, boosted } = await ds.latestSolanaProfileMints();
        const a = await ds.tokensMarketData(mints.slice(0, 30), "profile");
        const b = await ds.tokensMarketData(boosted.filter((m) => !mints.includes(m)).slice(0, 30), "boosted");
        for (const p of b) p.category = "boosted";
        return this.ingest([...a, ...b]);
      } },
      { id: "dexscreener.refresh", provider: "dexscreener", label: "DexScreener re-scan of tracked + watchlist tokens", mode: "live", run: async () => {
        const watch = this.watch.items.map((w) => w.mint);
        const tracked = [...this.records.values()].filter((r) => !r.demo).sort((a, b) => b.lastSeen - a.lastSeen).map((r) => r.mint);
        const mints = [...new Set([...watch, ...tracked])].slice(0, 60);
        return this.ingest(await ds.tokensMarketData(mints));
      } },
      { id: "jupiter.recent", provider: "jupiter", label: "Jupiter recent tokens (new launches)", mode: "live", run: async () => this.ingest(await jup.recentTokens(30)) },
      { id: "jupiter.trending", provider: "jupiter", label: "Jupiter top trending 1h", mode: "live", run: async () => this.ingest(await jup.topTrending("1h", 30)) },
      { id: "gecko.newPools", provider: "geckoterminal", label: "GeckoTerminal new Solana pools", mode: "live", run: async () => this.ingest(await gt.newPools()) },
      { id: "gecko.trendingPools", provider: "geckoterminal", label: "GeckoTerminal trending Solana pools", mode: "live", run: async () => this.ingest(await gt.trendingPools()) },
      { id: "gmgn.trending", provider: "gmgn", label: "GMGN trending 1h (demo key)", mode: "live", run: async () => this.ingest(await gm.gmgnTrending()) },
      { id: "gmgn.trenches", provider: "gmgn", label: "GMGN trenches: new / near completion / completed (demo key)", mode: "live", run: async () => this.ingest(await gm.gmgnTrenches()) },
      { id: "gmgn.smartmoney", provider: "gmgn", label: "GMGN Smart Money trades (demo key)", mode: "live", run: async () => this.ingestTrades(await gm.gmgnWalletTrades("smart"), "smart") },
      { id: "gmgn.kol", provider: "gmgn", label: "GMGN KOL trades (demo key)", mode: "live", run: async () => this.ingestTrades(await gm.gmgnWalletTrades("kol"), "kol") },
    ];
  }

  start() {
    if (this.timer) return;
    // Stagger first runs so providers are not hit simultaneously at startup.
    let offset = 0;
    for (const f of this.feeds) {
      const st = this.feedStatus.get(f.id)!;
      st.lastRunAt = Date.now() - st.intervalSec * 1000 + offset;
      offset += f.provider === "gmgn" ? 20_000 : 2_500;
    }
    this.timer = setInterval(() => this.tick(), 1000);
    this.tick();
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  private tick(force = false) {
    const now = Date.now();
    for (const f of this.feeds) {
      const st = this.feedStatus.get(f.id)!;
      if (f.mode !== this.config.mode) { st.skippedReason = `inactive in ${this.config.mode} mode`; continue; }
      if (!st.enabled) { st.skippedReason = "disabled"; continue; }
      if (this.running.has(f.id)) continue;
      if (!force && st.lastRunAt && now - st.lastRunAt < st.intervalSec * 1000) continue;
      const q = f.provider !== "demo" ? QUEUES[f.provider] : null;
      if (q && (q.isCoolingDown() || q.disabled)) {
        st.skippedReason = q.disabled ? q.disabledReason : `provider cooling down until ${new Date(q.getCooldownUntil()).toLocaleTimeString()}`;
        continue; // polling paused while provider is unavailable — no retries during cooldown
      }
      st.skippedReason = undefined;
      this.runFeed(f, st);
    }
  }

  private async runFeed(f: Feed, st: FeedStatus) {
    this.running.add(f.id);
    st.lastRunAt = Date.now();
    try {
      st.lastCount = await f.run();
      st.lastOkAt = Date.now();
      st.lastError = undefined;
      this.scans++;
      this.lastScanAt = Date.now();
    } catch (e) {
      st.lastError = e instanceof CooldownError ? `skipped: ${e.reason}` : e instanceof PlanRestrictedError ? `plan restriction: ${e.message}` : (e as Error).message;
    } finally {
      this.running.delete(f.id);
      this.emit();
    }
  }

  /** Manual refresh: runs every eligible feed now, still subject to cache + queue + cooldown rules. */
  refreshNow() { this.tick(true); }

  ingest(partials: TokenPartial[]): number {
    const now = Date.now();
    const touched = new Set<string>();
    for (const p of partials) {
      if (!isMint(p.mint) && !isDemoMint(p.mint)) continue;
      let rec = this.records.get(p.mint);
      if (!rec) { rec = emptyRecord(p.mint, now); this.records.set(p.mint, rec); }
      mergePartial(rec, p, this.config.staleAfterSec * 1000);
      touched.add(p.mint);
    }
    for (const mint of touched) {
      const rec = this.records.get(mint)!;
      rec.scanCount++;
      if (this.watch.items.some((w) => w.mint === mint) && !rec.categories.includes("watch")) rec.categories.push("watch");
      this.snapshot(rec, now);
      this.recompute(rec, now);
    }
    this.prune();
    return touched.size;
  }

  private ingestTrades(list: WalletTrade[], kind: "smart" | "kol"): number {
    const seen = new Set(this.trades.map((t) => t.id));
    const fresh = list.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
    this.trades = [...fresh, ...this.trades].filter((t) => Date.now() - t.timestamp < 6 * 3600_000).sort((a, b) => b.timestamp - a.timestamp).slice(0, 400);
    // mark tokens touched by smart money / KOL
    for (const t of list) {
      const rec = this.records.get(t.mint);
      if (rec && !rec.categories.includes(kind)) rec.categories.push(kind);
      if (rec) this.recompute(rec, Date.now());
    }
    return fresh.length;
  }

  private snapshot(rec: TokenRecord, now: number) {
    const h = this.history.get(rec.mint) ?? [];
    const last = h[h.length - 1];
    if (last && now - last.t < 20_000 && last.priceUsd === rec.priceUsd) return;
    h.push({ t: now, priceUsd: rec.priceUsd, liquidityUsd: rec.liquidityUsd, marketCap: rec.marketCap, vol5m: rec.volume.m5, buys5m: rec.txns.m5?.buys, sells5m: rec.txns.m5?.sells });
    if (h.length > 240) h.shift();
    this.history.set(rec.mint, h);
  }

  private recompute(rec: TokenRecord, now: number) {
    const prevRisk = this.derivedCache.get(rec.mint)?.riskLevel;
    const d = derive(rec, this.history.get(rec.mint) ?? [], this.trades, this.config, now);
    this.derivedCache.set(rec.mint, d);
    this.evaluateAlerts(rec, d, prevRisk, now);
  }

  private prune() {
    if (this.records.size <= this.config.maxTokens) return;
    const keep = new Set(this.watch.items.map((w) => w.mint));
    const victims = [...this.records.values()].filter((r) => !keep.has(r.mint)).sort((a, b) => a.lastSeen - b.lastSeen);
    for (const r of victims.slice(0, this.records.size - this.config.maxTokens)) {
      this.records.delete(r.mint); this.history.delete(r.mint); this.derivedCache.delete(r.mint);
    }
  }

  private pushAlert(a: Omit<AlertEvent, "id">, dedupeKey: string, now: number) {
    const lastAt = this.recentAlertKeys.get(dedupeKey);
    if (lastAt && now - lastAt < 10 * 60_000) return;
    this.recentAlertKeys.set(dedupeKey, now);
    this.alerts.unshift({ ...a, id: uid() });
    this.alerts = this.alerts.slice(0, 200);
    this.alertStore.save({ alerts: this.alerts });
  }

  private evaluateAlerts(rec: TokenRecord, d: TokenView["derived"], prevRisk: string | undefined, now: number) {
    const watched = this.watch.items.some((w) => w.mint === rec.mint);
    if (watched) for (const an of d.anomalies) if (an.severity !== "info")
      this.pushAlert({ mint: rec.mint, symbol: rec.symbol, message: an.message, at: now, severity: an.severity, source: "anomaly" }, `${rec.mint}:${an.type}`, now);
    const composite = d.scores.find((s) => s.key === "composite")?.value ?? null;
    for (const rule of this.watch.rules.filter((r) => r.mint === rec.mint)) {
      let hit = false; let msg = "";
      if (rule.type === "price_above" && rec.priceUsd !== undefined && rec.priceUsd >= rule.value) { hit = true; msg = `Price ${rec.priceUsd} ≥ ${rule.value}`; }
      if (rule.type === "price_below" && rec.priceUsd !== undefined && rec.priceUsd <= rule.value) { hit = true; msg = `Price ${rec.priceUsd} ≤ ${rule.value}`; }
      if (rule.type === "liquidity_drop_pct" && d.liqChangePct !== undefined && d.liqChangePct <= -rule.value) { hit = true; msg = `Liquidity ${d.liqChangePct}% (rule −${rule.value}%)`; }
      if (rule.type === "volume_spike" && d.volAccel !== undefined && d.volAccel >= rule.value) { hit = true; msg = `Volume pace ${d.volAccel}× ≥ ${rule.value}×`; }
      if (rule.type === "score_above" && composite !== null && composite >= rule.value) { hit = true; msg = `Composite score ${composite} ≥ ${rule.value}`; }
      if (rule.type === "risk_change" && prevRisk && prevRisk !== d.riskLevel) { hit = true; msg = `Risk changed ${prevRisk} → ${d.riskLevel}`; }
      if (hit) {
        rule.lastTriggeredAt = now;
        this.pushAlert({ mint: rec.mint, symbol: rec.symbol, message: msg, at: now, severity: "warn", source: "rule" }, `rule:${rule.id}`, now);
      }
    }
  }

  view(rec: TokenRecord, now = Date.now()): TokenView {
    const derived = this.derivedCache.get(rec.mint) ?? derive(rec, this.history.get(rec.mint) ?? [], this.trades, this.config, now);
    const marketAt = rec.provenance.market?.fetchedAt ?? rec.lastSeen;
    const dataAgeSec = Math.round((now - marketAt) / 1000);
    return { ...rec, derived, dataAgeSec, stale: dataAgeSec > this.config.staleAfterSec };
  }

  tokens(): TokenView[] {
    const now = Date.now();
    return [...this.records.values()].filter((r) => (this.config.mode === "demo" ? r.demo : !r.demo)).map((r) => this.view(r, now));
  }

  providers() {
    return Object.values(QUEUES).map((q) => q.health());
  }

  state(): DashboardState {
    const tokens = this.tokens();
    return {
      meta: { mode: this.config.mode, lastScanAt: this.lastScanAt, tokenCount: tokens.length, scans: this.scans },
      tokens,
      providers: this.providers(),
      feeds: [...this.feedStatus.values()],
      alerts: this.alerts.slice(0, 100),
      trades: this.trades.filter((t) => (this.config.mode === "demo" ? t.provenance.provider === "demo" : t.provenance.provider !== "demo")).slice(0, 200),
      serverTime: Date.now(),
    };
  }

  setMode(mode: "live" | "demo") {
    this.config.mode = mode;
    if (mode === "live") this.trades = this.trades.filter((t) => t.provenance.provider !== "demo");
    this.saveConfig();
    this.refreshNow();
  }

  updateConfig(patch: Partial<AppConfig>) {
    if (patch.weights) this.config.weights = { ...this.config.weights, ...patch.weights };
    if (patch.thresholds) this.config.thresholds = { ...this.config.thresholds, ...patch.thresholds };
    if (patch.staleAfterSec) this.config.staleAfterSec = Math.max(30, patch.staleAfterSec);
    if (patch.feeds) {
      for (const [id, v] of Object.entries(patch.feeds)) {
        const st = this.feedStatus.get(id);
        if (!st) continue;
        const prefix = id.split(".")[0];
        const min = MIN_INTERVAL_SEC[prefix] ?? 60;
        const intervalSec = Math.max(min, Math.round(v.intervalSec ?? st.intervalSec)); // never below provider-safe floor
        this.config.feeds[id] = { intervalSec, enabled: v.enabled ?? st.enabled };
        st.intervalSec = intervalSec; st.enabled = this.config.feeds[id].enabled;
      }
    }
    if (patch.mode && patch.mode !== this.config.mode) this.setMode(patch.mode);
    for (const rec of this.records.values()) this.recompute(rec, Date.now());
    this.saveConfig();
    this.emit();
  }

  private saveConfig() { this.cfgStore.save(this.config); }

  // ---- watchlist & rules ----
  addWatch(mint: string, note?: string) {
    if (!this.watch.items.some((w) => w.mint === mint)) this.watch.items.push({ mint, symbol: this.records.get(mint)?.symbol, addedAt: Date.now(), note });
    const rec = this.records.get(mint);
    if (rec && !rec.categories.includes("watch")) rec.categories.push("watch");
    this.watchStore.save(this.watch); this.emit();
  }
  removeWatch(mint: string) {
    this.watch.items = this.watch.items.filter((w) => w.mint !== mint);
    this.watch.rules = this.watch.rules.filter((r) => r.mint !== mint);
    const rec = this.records.get(mint);
    if (rec) rec.categories = rec.categories.filter((c) => c !== "watch");
    this.watchStore.save(this.watch); this.emit();
  }
  addRule(rule: Omit<AlertRule, "id" | "createdAt">) {
    const r: AlertRule = { ...rule, id: uid(), createdAt: Date.now() };
    this.watch.rules.push(r);
    if (!this.watch.items.some((w) => w.mint === r.mint)) this.addWatch(r.mint);
    this.watchStore.save(this.watch); this.emit();
    return r;
  }
  removeRule(id: string) { this.watch.rules = this.watch.rules.filter((r) => r.id !== id); this.watchStore.save(this.watch); this.emit(); }
  clearAlerts() { this.alerts = []; this.alertStore.save({ alerts: [] }); this.emit(); }

  // ---- on-demand lookups ----
  async search(q: string): Promise<TokenView[]> {
    const query = q.trim().slice(0, 64);
    if (!query) return [];
    if (this.config.mode === "demo") {
      const ql = query.toLowerCase();
      return this.tokens().filter((t) => t.mint === query || t.symbol.toLowerCase().includes(ql) || t.name.toLowerCase().includes(ql));
    }
    const results: TokenPartial[] = [];
    const errors: string[] = [];
    const tasks = isMint(query) ? [ds.tokensMarketData([query], "search"), jup.searchTokens(query)] : [jup.searchTokens(query), ds.searchPairs(query)];
    for (const r of await Promise.allSettled(tasks)) r.status === "fulfilled" ? results.push(...r.value) : errors.push((r.reason as Error).message);
    if (!results.length && errors.length) throw new Error(errors.join("; "));
    this.ingest(results);
    const mints = new Set(results.map((r) => r.mint));
    return [...mints].map((m) => this.records.get(m)).filter(Boolean).map((r) => this.view(r!)).sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0)).slice(0, 25);
  }

  async detail(mint: string, enrich = true) {
    if (!isMint(mint) && !isDemoMint(mint)) throw new Error("Invalid Solana mint address");
    const notes: string[] = [];
    let holders: gm.HolderRow[] = [];
    let holdersAt: number | undefined;
    if (!this.records.has(mint) && !isDemoMint(mint)) {
      try { this.ingest(await ds.tokensMarketData([mint], "search")); } catch (e) { notes.push(`DexScreener: ${(e as Error).message}`); }
      if (!this.records.has(mint)) try { this.ingest(await jup.searchTokens(mint)); } catch (e) { notes.push(`Jupiter: ${(e as Error).message}`); }
    }
    if (enrich && !isDemoMint(mint) && this.config.mode === "live") {
      try { const sec = await gm.gmgnSecurity(mint); if (sec) this.ingest([sec]); } catch (e) { notes.push(`GMGN security: ${(e as Error).message}`); }
      try { const h = await gm.gmgnHolders(mint); holders = h.holders; holdersAt = h.fetchedAt; } catch (e) { notes.push(`GMGN holders: ${(e as Error).message}`); }
    }
    const rec = this.records.get(mint);
    if (!rec) throw new Error(`Token not found by any provider. ${notes.join(" | ")}`);
    return {
      token: this.view(rec),
      history: this.history.get(mint) ?? [],
      trades: this.trades.filter((t) => t.mint === mint).slice(0, 50),
      holders, holdersAt,
      watched: this.watch.items.some((w) => w.mint === mint),
      rules: this.watch.rules.filter((r) => r.mint === mint),
      notes,
    };
  }

  async candles(mint: string, tf: string): Promise<CandleSeries> {
    if (isDemoMint(mint)) return { mint, timeframe: tf, candles: demoCandles(mint, tf), provenance: { provider: "demo", endpoint: "fixtures/demo.ts (synthetic)", fetchedAt: Date.now() }, note: "DEMO DATA — synthetic candles" };
    if (!isMint(mint)) throw new Error("Invalid mint");
    if (tf === "1s") return { mint, timeframe: tf, candles: [], provenance: null, note: "1-second candles require a GMGN Pro plan; not available on the demo key." };
    const rec = this.records.get(mint);
    const notes: string[] = [];
    let pool = rec?.poolAddress;
    const tryGecko = async (p: string) => {
      const r = await gt.poolOhlcv(p, tf);
      return r.candles.length ? ({ mint, pool: p, timeframe: tf, candles: r.candles, provenance: { provider: "geckoterminal", endpoint: r.endpoint, fetchedAt: r.storedAt } } as CandleSeries) : null;
    };
    try {
      if (pool) { const s = await tryGecko(pool); if (s) return s; notes.push("no candles for known pool"); }
      const top = await gt.topPoolForMint(mint);
      if (top && top !== pool) { pool = top; const s = await tryGecko(top); if (s) return s; }
    } catch (e) { notes.push(`GeckoTerminal: ${(e as Error).message}`); }
    try {
      const k = await gm.gmgnKline(mint, tf);
      if (k.candles.length) return { mint, timeframe: tf, candles: k.candles, provenance: { provider: "gmgn", endpoint: "market kline (demo key)", fetchedAt: k.storedAt }, note: notes.join("; ") || undefined };
      notes.push("GMGN returned no candles");
    } catch (e) { notes.push(`GMGN kline: ${(e as Error).message}`); }
    return { mint, pool, timeframe: tf, candles: [], provenance: null, note: `No candle data available from free sources. ${notes.join("; ")}` };
  }

  /** Latest usable quote for paper trading: never invented. */
  quote(mint: string) {
    const rec = this.records.get(mint);
    if (!rec || rec.priceUsd === undefined) return null;
    const p = rec.provenance.market;
    return { priceUsd: rec.priceUsd, liquidityUsd: rec.liquidityUsd, symbol: rec.symbol, source: p ? `${p.provider} ${p.endpoint}` : "unknown", ageSec: p ? (Date.now() - p.fetchedAt) / 1000 : Infinity };
  }
}
