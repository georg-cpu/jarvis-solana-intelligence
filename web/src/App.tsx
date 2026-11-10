import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppConfig, CandleSeries, Filters, TokenView, TradePlan } from "../../shared/types";
import { CandleChart } from "./components/CandleChart";
import { ApiHealth, PaperModule, SecurityModule, SignalModule, TradesFeed, WatchAlerts, WhaleActivity } from "./components/modules";
import { TokenDetail } from "./components/TokenDetail";
import { TokenTable } from "./components/TokenTable";
import { Empty, Freshness, Panel, RiskBadge, SourceChip } from "./components/ui";
import { ago, api, applyFilters, del, fmtPrice, fmtUsd, post, put, score, short, useDashboard, useLocal, useNow } from "./lib";

const MODULES = [
  { id: "overview", label: "Command center", icon: "◎" },
  { id: "discovery", label: "Live token discovery", icon: "⌖" },
  { id: "launches", label: "New launches", icon: "✦" },
  { id: "trending", label: "Trending memecoins", icon: "▲" },
  { id: "smart", label: "Smart money radar", icon: "◉" },
  { id: "whales", label: "Whale activity", icon: "≋" },
  { id: "kol", label: "KOL tracker", icon: "☊" },
  { id: "security", label: "Token security", icon: "⛨" },
  { id: "chart", label: "Live candlestick chart", icon: "▥" },
  { id: "signals", label: "Signal & risk engine", icon: "∑" },
  { id: "paper", label: "Paper trading journal", icon: "▤" },
  { id: "watch", label: "Watchlist & alerts", icon: "★" },
  { id: "health", label: "API health & limits", icon: "♥" },
] as const;
type ModuleId = (typeof MODULES)[number]["id"];

export default function App() {
  const { state, conn, lastMsg, refresh } = useDashboard();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [view, setView] = useLocal<ModuleId>("jarvis.view", "overview");
  const [filters, setFilters] = useLocal<Filters>("jarvis.filters", {});
  const [open, setOpen] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [paperVersion, setPaperVersion] = useState(0);
  const [watchSet, setWatchSet] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const now = useNow();

  const loadConfig = useCallback(() => api<AppConfig>("/config").then(setConfig).catch(() => {}), []);
  const loadWatch = useCallback(() => api<{ items: { mint: string }[] }>("/watchlist").then((w) => setWatchSet(new Set(w.items.map((i) => i.mint)))).catch(() => {}), []);
  useEffect(() => { loadConfig(); loadWatch(); }, [loadConfig, loadWatch]);

  const onConfig = async (patch: Partial<AppConfig>) => { setConfig(await put<AppConfig>("/config", patch)); refresh(); };
  const toggleWatch = async (mint: string) => { watchSet.has(mint) ? await del(`/watchlist/${mint}`) : await post("/watchlist", { mint }); loadWatch(); };
  const onChanged = () => { setPaperVersion((v) => v + 1); loadWatch(); refresh(); };

  const tokens = state?.tokens ?? [];
  const filtered = useMemo(() => applyFilters(tokens, filters), [tokens, filters]);
  const launches = useMemo(() => filtered.filter((t) => t.categories.includes("new") || (t.derived.ageMinutes ?? Infinity) < 360).sort((a, b) => (a.derived.ageMinutes ?? 1e9) - (b.derived.ageMinutes ?? 1e9)), [filtered]);
  const trending = useMemo(() => filtered.filter((t) => t.categories.includes("trending") || t.categories.includes("boosted")), [filtered]);
  const staleCount = tokens.filter((t) => t.stale).length;
  const mode = state?.meta.mode ?? config?.mode ?? "live";
  const sseAge = (now - lastMsg) / 1000;

  const manualRefresh = async () => { setRefreshing(true); try { await post("/refresh"); setTimeout(() => setRefreshing(false), 1500); } catch { setRefreshing(false); } };

  const body = () => {
    if (!state) return <Empty>Connecting to local JARVIS API on 127.0.0.1:8787…</Empty>;
    const tbl = (list: TokenView[], def?: "score" | "age", compact = false) => <TokenTable tokens={list} onOpen={setOpen} watch={watchSet} onToggleWatch={toggleWatch} defaultSort={def} compact={compact} />;
    const thresholds = config?.thresholds.whaleTradeUsd ?? 5000;
    switch (view) {
      case "discovery": return <Panel title="Live token discovery" subtitle={`${filtered.length}/${tokens.length} tokens · merged by mint across providers`} className="h-full" right={<Freshness at={state.meta.lastScanAt} now={now} label="last scan" />}>{tbl(filtered)}</Panel>;
      case "launches": return <Panel title="New launches" subtitle="GMGN trenches · Jupiter recent · GeckoTerminal new pools" className="h-full">{tbl(launches, "age")}</Panel>;
      case "trending": return <Panel title="Trending memecoins" subtitle="GMGN · Jupiter · GeckoTerminal · DexScreener boosts" className="h-full">{tbl(trending)}</Panel>;
      case "smart": return <div className="h-full"><TradesFeed trades={state.trades} kind="smart" onOpen={setOpen} now={now} title="Smart money radar" /></div>;
      case "kol": return <div className="h-full"><TradesFeed trades={state.trades} kind="kol" onOpen={setOpen} now={now} title="KOL tracker" /></div>;
      case "whales": return <div className="h-full"><WhaleActivity tokens={filtered} trades={state.trades} threshold={thresholds} onOpen={setOpen} now={now} /></div>;
      case "security": return <div className="h-full"><SecurityModule tokens={filtered} onOpen={setOpen} /></div>;
      case "chart": return <div className="h-full"><ChartModule tokens={filtered} onOpen={setOpen} now={now} /></div>;
      case "signals": return <div className="h-full"><SignalModule tokens={filtered} config={config} onOpen={setOpen} onConfig={onConfig} /></div>;
      case "paper": return <div className="h-full"><PaperModule tokens={tokens} onOpen={setOpen} version={paperVersion} /></div>;
      case "watch": return <div className="h-full"><WatchAlerts tokens={tokens} alerts={state.alerts} onOpen={setOpen} onChanged={onChanged} now={now} /></div>;
      case "health": return <div className="h-full"><ApiHealth state={state} config={config} onConfig={onConfig} now={now} /></div>;
      default:
        return (
          <div className="grid gap-3 xl:grid-cols-12">
            <Panel title="Live token discovery" subtitle={`${filtered.length} tokens`} className="h-[520px] xl:col-span-8" right={<Freshness at={state.meta.lastScanAt} now={now} label="scan" />}>{tbl(filtered)}</Panel>
            <div className="h-[520px] xl:col-span-4"><ChartModule tokens={filtered} onOpen={setOpen} now={now} compact /></div>
            <Panel title="New launches" className="h-[380px] xl:col-span-4">{tbl(launches.slice(0, 40), "age", true)}</Panel>
            <Panel title="Trending memecoins" className="h-[380px] xl:col-span-4">{tbl(trending.slice(0, 40), "score", true)}</Panel>
            <div className="h-[380px] xl:col-span-4"><TradesFeed trades={state.trades} kind="smart" onOpen={setOpen} now={now} title="Smart money radar" /></div>
            <div className="h-[360px] xl:col-span-4"><TradesFeed trades={state.trades} kind="kol" onOpen={setOpen} now={now} title="KOL tracker" /></div>
            <div className="h-[360px] xl:col-span-4"><WhaleActivity tokens={filtered} trades={state.trades} threshold={thresholds} onOpen={setOpen} now={now} /></div>
            <div className="h-[360px] xl:col-span-4"><SecurityModule tokens={filtered} onOpen={setOpen} /></div>
            <div className="h-[420px] xl:col-span-6"><SignalModule tokens={filtered} config={config} onOpen={setOpen} onConfig={onConfig} /></div>
            <div className="h-[420px] xl:col-span-6"><WatchAlerts tokens={tokens} alerts={state.alerts} onOpen={setOpen} onChanged={onChanged} now={now} /></div>
            <div className="h-[420px] xl:col-span-12"><PaperModule tokens={tokens} onOpen={setOpen} version={paperVersion} /></div>
            <div className="xl:col-span-12"><ApiHealth state={state} config={config} onConfig={onConfig} now={now} /></div>
          </div>
        );
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* HEADER */}
      <header className="sticky top-0 z-40 border-b border-ink-600/70 bg-ink-950/85 backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
          <button className="btn lg:hidden" onClick={() => setNavOpen(!navOpen)} aria-label="Menu">☰</button>
          <div className="flex items-center gap-2">
            <div className="relative h-7 w-7">
              <span className="absolute inset-0 rounded-full border-2 border-cyan-400/80 shadow-[0_0_14px_rgba(34,211,238,.6)]" />
              <span className="absolute inset-[9px] rounded-full bg-emerald-400 shadow-[0_0_10px_#10b981]" />
            </div>
            <div className="leading-tight">
              <div className="font-mono text-[13px] font-bold tracking-[0.22em] text-cyan-300 glow-text">JARVIS</div>
              <div className="font-mono text-[9px] tracking-[0.3em] text-slate-500">SOLANA INTELLIGENCE</div>
            </div>
          </div>

          <SearchBox onOpen={setOpen} onQuery={(q) => setFilters({ ...filters, query: q })} />

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-ink-500 text-[10px] font-mono">
              {(["live", "demo"] as const).map((m) => (
                <button key={m} onClick={() => onConfig({ mode: m })} className={`px-2 py-1 uppercase tracking-wider ${mode === m ? (m === "demo" ? "bg-amber-400/20 text-amber-200" : "bg-emerald-400/15 text-emerald-200") : "text-slate-500 hover:text-slate-300"}`}>
                  {m === "demo" ? "Demo data" : "Live (polled)"}
                </button>
              ))}
            </div>
            <span className={`flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] ${conn === "live" && sseAge < 40 ? "border-emerald-400/40 text-emerald-300" : "border-amber-400/50 text-amber-300"}`} title="Local push connection to the JARVIS server (data itself is polled from providers)">
              <span className={`h-1.5 w-1.5 rounded-full ${conn === "live" && sseAge < 40 ? "bg-emerald-400 animate-pulseDot" : "bg-amber-400"}`} />
              {conn === "live" && sseAge < 40 ? "CONNECTED" : conn.toUpperCase()}
            </span>
            {state && (
              <span className="hidden items-center gap-1 sm:flex">
                {state.providers.map((p) => (
                  <span key={p.id} title={`${p.label}: ${p.state}${p.note ? ` — ${p.note}` : ""}`} className={`h-2 w-2 rounded-full ${p.state === "ok" ? "bg-emerald-400" : p.state === "idle" ? "bg-slate-500" : p.state === "degraded" || p.state === "cooldown" ? "bg-amber-400" : "bg-rose-500"}`} />
                ))}
              </span>
            )}
            <span className="hidden font-mono text-[10px] text-slate-500 md:inline">scan {ago(state?.meta.lastScanAt, now)}</span>
            <button className="btn btn-primary" onClick={manualRefresh} disabled={refreshing}>{refreshing ? "↻ …" : "↻ Refresh"}</button>
          </div>
        </div>
        {mode === "demo" && <div className="border-t border-amber-400/30 bg-amber-400/10 px-3 py-1 text-center font-mono text-[11px] text-amber-200">DEMO DATA MODE — synthetic tokens (mints start with “DEMo”). Nothing shown is real market data.</div>}
        {mode === "live" && staleCount > 0 && <div className="border-t border-amber-400/20 bg-amber-400/5 px-3 py-0.5 text-center text-[10px] text-amber-300/90">⚠ {staleCount} token(s) have market data older than {config?.staleAfterSec ?? 300}s — shown with a STALE tag.</div>}
      </header>

      <div className="flex min-h-0 flex-1">
        {/* NAV */}
        <nav className={`${navOpen ? "fixed inset-y-0 left-0 z-50 w-64 pt-14" : "hidden"} shrink-0 border-r border-ink-600/70 bg-ink-950/95 lg:static lg:block lg:w-56 lg:pt-0`}>
          <div className="space-y-0.5 p-2">
            {MODULES.map((m, i) => (
              <button key={m.id} onClick={() => { setView(m.id); setNavOpen(false); }} className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition ${view === m.id ? "bg-cyan-400/10 text-cyan-200 shadow-glow" : "text-slate-400 hover:bg-ink-800 hover:text-slate-200"}`}>
                <span className="w-4 text-center font-mono text-cyan-400/80">{m.icon}</span>
                <span className="truncate">{i > 0 ? `${i}. ` : ""}{m.label}</span>
              </button>
            ))}
          </div>
          <div className="m-2 rounded-md border border-ink-600/60 bg-ink-900 p-2 text-[10px] leading-relaxed text-slate-500">
            <div className="mb-1 font-mono uppercase tracking-wider text-emerald-400">Read-only</div>
            No wallet, signing, swap or order functionality exists. Paper trades are virtual. Data is polled from free public APIs on conservative intervals — not a real-time stream, not complete coverage.
          </div>
        </nav>
        {navOpen && <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setNavOpen(false)} />}

        {/* MAIN */}
        <main className="min-w-0 flex-1 overflow-auto p-3">
          {view !== "health" && view !== "paper" && view !== "watch" && <FiltersBar filters={filters} setFilters={setFilters} />}
          <div className={view === "overview" ? "" : "h-[calc(100vh-150px)] min-h-[480px]"}>{body()}</div>
          <footer className="mt-3 flex flex-wrap justify-between gap-2 border-t border-ink-700/60 pt-2 text-[10px] text-slate-600">
            <span>Sources: GMGN (official CLI, public demo key) · DexScreener API · Jupiter Tokens/Price API · GeckoTerminal API (data by GeckoTerminal). Attribution shown per value.</span>
            <span>Not financial advice. Speculative assets can lose 100% of value.</span>
          </footer>
        </main>
      </div>

      {open && <TokenDetail mint={open} onClose={() => setOpen(null)} onChanged={onChanged} />}
    </div>
  );
}

function FiltersBar({ filters, setFilters }: { filters: Filters; setFilters: (f: Filters) => void }) {
  const n = (v: string) => (v === "" ? undefined : Number(v));
  const field = (label: string, key: keyof Filters, ph: string, w = "w-24") => (
    <label className="flex items-center gap-1 text-[10px] text-slate-400">{label}
      <input className={`input ${w}`} type="number" placeholder={ph} value={(filters[key] as number | undefined) ?? ""} onChange={(e) => setFilters({ ...filters, [key]: n(e.target.value) })} />
    </label>
  );
  const active = Object.values(filters).some((v) => v !== undefined && v !== "");
  return (
    <div className="panel mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
      <span className="font-mono text-[10px] uppercase tracking-wider text-cyan-300">Filters</span>
      {field("max age (min)", "maxAgeMinutes", "any", "w-20")}
      {field("min vol 1h $", "minVolume1h", "0")}
      {field("min liq $", "minLiquidity", "0")}
      {field("min mcap $", "minMarketCap", "0")}
      {field("max mcap $", "maxMarketCap", "∞")}
      <label className="flex items-center gap-1 text-[10px] text-slate-400">max risk
        <select className="input" value={filters.maxRisk ?? ""} onChange={(e) => setFilters({ ...filters, maxRisk: (e.target.value || undefined) as Filters["maxRisk"] })}>
          <option value="">any (incl. unknown)</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="extreme">extreme</option>
        </select>
      </label>
      {filters.query && <span className="chip border-cyan-400/50 text-cyan-300">“{filters.query}”</span>}
      {active && <button className="btn" onClick={() => setFilters({})}>clear</button>}
    </div>
  );
}

function SearchBox({ onOpen, onQuery }: { onOpen: (m: string) => void; onQuery: (q: string) => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<TokenView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setRes(null); };
    window.addEventListener("mousedown", h); return () => window.removeEventListener("mousedown", h);
  }, []);
  const go = async () => {
    const query = q.trim();
    if (!query) { onQuery(""); return; }
    setBusy(true); setErr(null);
    try { const r = await api<{ results: TokenView[] }>(`/search?q=${encodeURIComponent(query)}`); setRes(r.results); }
    catch (e) { setErr((e as Error).message); setRes([]); }
    finally { setBusy(false); }
  };
  return (
    <div ref={boxRef} className="relative order-last w-full sm:order-none sm:w-auto sm:min-w-[320px] sm:flex-1 lg:max-w-xl">
      <div className="flex gap-1">
        <input className="input flex-1 !py-1.5" placeholder="Search token name, symbol or Solana mint address…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
        <button className="btn btn-primary" onClick={go} disabled={busy}>{busy ? "…" : "Search"}</button>
        <button className="btn" title="Filter the loaded tables by this text instead" onClick={() => onQuery(q.trim())}>Filter</button>
      </div>
      {res && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-96 overflow-auto rounded-md border border-cyan-400/30 bg-ink-900 shadow-glow">
          {err && <div className="p-2 text-[11px] text-rose-300">{err}</div>}
          {!res.length && !err && <div className="p-2 text-[11px] text-slate-500">No matches from Jupiter / DexScreener.</div>}
          {res.map((t) => (
            <button key={t.mint} onClick={() => { onOpen(t.mint); setRes(null); }} className="flex w-full items-center justify-between gap-2 border-b border-ink-700/50 px-2 py-1.5 text-left text-xs hover:bg-cyan-400/[0.06]">
              <span className="min-w-0"><b className="text-slate-100">{t.symbol}</b> <span className="text-slate-500">{t.name}</span><div className="font-mono text-[10px] text-slate-600">{short(t.mint, 6)}</div></span>
              <span className="flex shrink-0 items-center gap-2"><span className="num text-slate-300">{fmtPrice(t.priceUsd)}</span><span className="num text-slate-500">liq {fmtUsd(t.liquidityUsd)}</span>{t.sources.map((s) => <SourceChip key={s} p={s} />)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ChartModule({ tokens, onOpen, now, compact = false }: { tokens: TokenView[]; onOpen: (m: string) => void; now: number; compact?: boolean }) {
  const candidates = useMemo(() => [...tokens].filter((t) => t.priceUsd !== undefined).sort((a, b) => (score(b, "composite") ?? -1) - (score(a, "composite") ?? -1)).slice(0, 40), [tokens]);
  const [mint, setMint] = useLocal<string>("jarvis.chartMint", "");
  const [tf, setTf] = useLocal<string>("jarvis.chartTf", "5m");
  const [data, setData] = useState<{ series: CandleSeries; plan: TradePlan } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const sel = mint && tokens.some((t) => t.mint === mint) ? mint : candidates[0]?.mint ?? "";
  const tok = tokens.find((t) => t.mint === sel);
  useEffect(() => {
    if (!sel) return;
    let alive = true;
    const load = () => api<{ series: CandleSeries; plan: TradePlan }>(`/candles/${sel}?tf=${tf}`).then((d) => alive && (setData(d), setErr(null))).catch((e) => alive && setErr(e.message));
    setData(null); load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [sel, tf]);
  return (
    <Panel title="Live candlestick chart" subtitle="polled every 60s" className="h-full" right={data?.series.provenance ? <Freshness at={data.series.provenance.fetchedAt} now={now} staleAfterSec={180} /> : null} bodyClass="flex flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-ink-700/60 p-2">
        <select className="input max-w-[200px]" value={sel} onChange={(e) => setMint(e.target.value)}>
          {candidates.map((t) => <option key={t.mint} value={t.mint}>{t.symbol} · {short(t.mint)}</option>)}
        </select>
        {["1m", "5m", "15m", "1h", "4h"].map((x) => <button key={x} onClick={() => setTf(x)} className={`btn !px-1.5 !py-0.5 ${tf === x ? "btn-primary" : ""}`}>{x}</button>)}
        {tok && <button className="btn ml-auto" onClick={() => onOpen(tok.mint)}>Analyze →</button>}
      </div>
      <div className="min-h-0 flex-1 p-2">
        {!sel ? <Empty>No priced tokens yet.</Empty> : data?.series.candles.length ? (
          <>
            {tok && <div className="mb-1 flex items-center gap-2 text-xs"><b className="text-slate-100">{tok.symbol}</b><span className="num text-slate-300">{fmtPrice(tok.priceUsd)}</span><RiskBadge level={tok.derived.riskLevel} />{tok.demo && <span className="chip border-amber-400/60 text-amber-300">DEMO</span>}</div>}
            <CandleChart candles={data.series.candles} plan={data.plan} height={compact ? 360 : 520} />
            <div className="mt-1 text-[10px] text-slate-500">{data.series.provenance && <><SourceChip p={data.series.provenance.provider} /> {data.series.provenance.endpoint} · {data.series.candles.length} candles</>} {data.plan.available ? "· dashed lines = hypothetical levels" : `· levels not shown: ${data.plan.reason}`}</div>
          </>
        ) : <Empty>{err ?? data?.series.note ?? "Loading candles…"}</Empty>}
      </div>
    </Panel>
  );
}
