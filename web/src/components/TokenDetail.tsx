import { useCallback, useEffect, useState } from "react";
import type { AlertRule, CandleSeries, Snapshot, TokenView, TradePlan, WalletTrade } from "../../../shared/types";
import { ago, api, del, fmtAge, fmtNum, fmtPct, fmtPrice, fmtUsd, pctClass, post, short, useNow } from "../lib";
import { CandleChart } from "./CandleChart";
import { Empty, Freshness, RiskBadge, ScoreCard, SourceChip, Stat } from "./ui";

interface Detail {
  token: TokenView; history: Snapshot[]; trades: WalletTrade[];
  holders: { address: string; pct: number; usd?: number; tags: string[]; suspicious: boolean; name?: string }[]; holdersAt?: number;
  watched: boolean; rules: AlertRule[]; notes: string[];
}
const TFS = ["1m", "5m", "15m", "1h", "4h", "1d"];
const CHART_POLL_SEC = 60;

export function TokenDetail({ mint, onClose, onChanged }: { mint: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tf, setTf] = useState("5m");
  const [series, setSeries] = useState<CandleSeries | null>(null);
  const [plan, setPlan] = useState<TradePlan | null>(null);
  const [chartErr, setChartErr] = useState<string | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [size, setSize] = useState(100);
  const now = useNow();

  const load = useCallback((enrich = true) => api<Detail>(`/token/${mint}${enrich ? "" : "?enrich=0"}`).then((x) => { setD(x); setErr(null); }).catch((e) => setErr(e.message)), [mint]);
  const loadChart = useCallback(() => {
    setChartLoading(true);
    api<{ series: CandleSeries; plan: TradePlan }>(`/candles/${mint}?tf=${tf}&size=${size}`)
      .then((r) => { setSeries(r.series); setPlan(r.plan); setChartErr(null); })
      .catch((e) => setChartErr(e.message))
      .finally(() => setChartLoading(false));
  }, [mint, tf, size]);

  const [enriching, setEnriching] = useState(false);
  useEffect(() => {
    // Fast path first (already-merged provider data), then GMGN enrichment via its slow, rate-limited queue.
    load(false).then(() => { setEnriching(true); return load(true); }).finally(() => setEnriching(false));
  }, [load]);
  useEffect(() => { loadChart(); const t = setInterval(loadChart, CHART_POLL_SEC * 1000); return () => clearInterval(t); }, [loadChart]);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);

  const t = d?.token;
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/70 backdrop-blur-sm sm:p-4" onClick={onClose}>
      <div className="panel flex w-full max-w-7xl flex-col overflow-hidden shadow-glow animate-fadeIn" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="flex min-w-0 items-center gap-3">
            {t?.logo && <img src={t.logo} alt="" className="h-8 w-8 rounded-full bg-ink-700" />}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-bold text-slate-50 glow-text">{t?.symbol ?? "…"}</span>
                <span className="truncate text-xs text-slate-400">{t?.name}</span>
                {t && <RiskBadge level={t.derived.riskLevel} />}
                {t?.demo && <span className="chip border-amber-400/60 bg-amber-400/10 text-amber-300">DEMO DATA</span>}
                {t?.stale && <span className="chip border-amber-400/50 text-amber-300">STALE {t.dataAgeSec}s</span>}
              </div>
              <button className="font-mono text-[10px] text-slate-500 hover:text-cyan-300" title="Copy mint" onClick={() => navigator.clipboard?.writeText(mint)}>{mint} ⧉</button>
              {enriching && <span className="ml-2 font-mono text-[10px] text-cyan-400/80 animate-pulseDot">fetching GMGN security &amp; holders (rate-limited queue)…</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {d && (
              <button className={d.watched ? "btn" : "btn btn-primary"} onClick={async () => { d.watched ? await del(`/watchlist/${mint}`) : await post("/watchlist", { mint }); await load(false); onChanged(); }}>
                {d.watched ? "★ Watching" : "☆ Watch"}
              </button>
            )}
            <button className="btn" onClick={() => { load(); loadChart(); }}>↻ Refresh</button>
            <button className="btn" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {err && <div className="mb-2 rounded border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-200">{err}</div>}
          {!t ? <Empty>Loading token analysis…</Empty> : (
            <div className="grid gap-3 xl:grid-cols-[1fr_380px]">
              <div className="min-w-0 space-y-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                  <Stat label="Price" value={fmtPrice(t.priceUsd)} sub={<span className={pctClass(t.priceChange.h1)}>1h {fmtPct(t.priceChange.h1)}</span>} />
                  <Stat label="Market cap" value={fmtUsd(t.marketCap)} sub={t.fdv ? `FDV ${fmtUsd(t.fdv)}` : undefined} />
                  <Stat label="Liquidity" value={fmtUsd(t.liquidityUsd)} sub={t.derived.liqChangePct !== undefined ? <span className={pctClass(t.derived.liqChangePct)}>Δscan {fmtPct(t.derived.liqChangePct)}</span> : "Δscan —"} />
                  <Stat label="Volume 1h / 24h" value={fmtUsd(t.volume.h1)} sub={fmtUsd(t.volume.h24)} />
                  <Stat label="Tx 1h buy/sell" value={t.txns.h1 ? `${fmtNum(t.txns.h1.buys)} / ${fmtNum(t.txns.h1.sells)}` : "—"} sub={t.derived.buyRatio1h !== undefined ? `buy ratio ${(t.derived.buyRatio1h * 100).toFixed(0)}%` : undefined} />
                  <Stat label="Holders · top10" value={fmtNum(t.holders)} sub={t.top10HolderPct !== undefined ? `top10 ${t.top10HolderPct.toFixed(1)}%` : "top10 —"} tone={(t.top10HolderPct ?? 0) > 40 ? "text-rose-300" : ""} />
                  <Stat label="Age" value={fmtAge(t.derived.ageMinutes)} sub={t.createdAt ? new Date(t.createdAt).toLocaleString() : undefined} />
                  <Stat label="Launchpad" value={t.launchpad ?? "—"} />
                  <Stat label="DEX / pool" value={t.dex ?? "—"} sub={t.poolAddress ? short(t.poolAddress, 5) : undefined} />
                  <Stat label="Smart $ / KOL" value={`${t.smartMoneyCount ?? "—"} / ${t.kolCount ?? "—"}`} sub="GMGN counts" />
                  <Stat label="Vol pace 5m×12/1h" value={t.derived.volAccel !== undefined ? `${t.derived.volAccel}×` : "—"} />
                  <Stat label="Avg buy 5m" value={fmtUsd(t.derived.avgBuyUsd5m)} />
                </div>

                <div className="panel">
                  <div className="panel-head">
                    <div className="flex items-center gap-2"><span className="panel-title">Live candlestick chart</span>
                      <span className="text-[10px] text-slate-500">polled every {CHART_POLL_SEC}s · not a stream</span></div>
                    <div className="flex items-center gap-1">
                      {TFS.map((x) => <button key={x} onClick={() => setTf(x)} className={`btn !px-1.5 !py-0.5 ${tf === x ? "btn-primary" : ""}`}>{x}</button>)}
                    </div>
                  </div>
                  <div className="relative p-2">
                    {chartLoading && <div className="absolute inset-x-0 top-0 h-px overflow-hidden"><div className="h-px w-1/4 animate-scan bg-cyan-400" /></div>}
                    {series?.candles.length ? <CandleChart candles={series.candles} plan={plan} /> : <Empty>{chartErr ?? series?.note ?? "Loading candles…"}</Empty>}
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
                      <span>{series?.provenance ? <>Source <SourceChip p={series.provenance.provider} /> {series.provenance.endpoint}{series.pool ? ` · pool ${short(series.pool)}` : ""} · {series.candles.length} candles · <Freshness at={series.provenance.fetchedAt} now={now} staleAfterSec={CHART_POLL_SEC * 3} label="fetched" /></> : "No source"}</span>
                      {series?.note && series.candles.length > 0 && <span className="text-amber-400/80">{series.note}</span>}
                      {series?.provenance?.provider === "geckoterminal" && <span>Data by GeckoTerminal</span>}
                    </div>
                  </div>
                </div>

                <TradePlanView plan={plan} size={size} setSize={setSize} />
                <HoldersView d={d!} now={now} />
              </div>

              <div className="min-w-0 space-y-3">
                <div className="panel p-2">
                  <div className="mb-2 flex items-center justify-between"><span className="panel-title">Signal &amp; risk engine</span><span className="text-[10px] text-slate-500">click a score for formula</span></div>
                  <div className="space-y-1.5">{t.derived.scores.map((s) => <ScoreCard key={s.key} s={s} />)}</div>
                  <div className="mt-2 space-y-1">
                    {t.derived.anomalies.length ? t.derived.anomalies.map((a, i) => (
                      <div key={i} className={`rounded border px-2 py-1 text-[11px] ${a.severity === "high" ? "border-rose-500/50 bg-rose-500/10 text-rose-200" : a.severity === "warn" ? "border-amber-400/40 bg-amber-400/5 text-amber-200" : "border-cyan-400/30 bg-cyan-400/5 text-cyan-200"}`}>
                        <span className="font-mono uppercase">{a.type.replace("_", " ")}</span> · {a.message} <span className="text-slate-500">(threshold {a.threshold})</span>
                      </div>
                    )) : <div className="text-[11px] text-slate-500">No anomalies detected on current data.</div>}
                  </div>
                  <div className="mt-2 text-[10px] text-amber-300/70">Scores are transparent screening heuristics, not predictions or advice.</div>
                </div>
                <SecurityView t={t} />
                <PaperBox mint={mint} t={t} onDone={onChanged} />
                <RuleBox mint={mint} rules={d!.rules} onDone={() => { load(false); onChanged(); }} />
                <ProvenanceView t={t} now={now} notes={d!.notes} />
                <TradesMini trades={d!.trades} now={now} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TradePlanView({ plan, size, setSize }: { plan: TradePlan | null; size: number; setSize: (n: number) => void }) {
  return (
    <div className="panel p-2">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="panel-title">Hypothetical scenario levels</span>
        <label className="flex items-center gap-1 text-[10px] text-slate-400">paper size $<input type="number" className="input w-20" value={size} min={1} onChange={(e) => setSize(Math.max(1, Number(e.target.value) || 1))} /></label>
      </div>
      {!plan ? <Empty>Waiting for candles…</Empty> : !plan.available ? (
        <div className="rounded border border-ink-600 bg-ink-850 p-2 text-xs text-slate-400">Not computed: <span className="text-amber-300">{plan.reason}</span>. Levels are only shown when sufficient market data exists — nothing is estimated or filled in.</div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Entry zone" value={<span className="text-cyan-300">{fmtPrice(plan.entryZone![0])}–{fmtPrice(plan.entryZone![1])}</span>} />
            <Stat label="Invalidation (swing low)" value={fmtPrice(plan.invalidation)} />
            <Stat label="Stop-loss scenario" value={<span className="text-rose-300">{fmtPrice(plan.stopLoss)}</span>} sub={`risk/unit ${fmtPrice(plan.riskPerUnit)}`} />
            <Stat label={`Est. slippage @ $${size}`} value={`${plan.slippageEstimatePct}%`} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {plan.takeProfits!.map((tp) => <Stat key={tp.label} label={`${tp.label} · R:R ${tp.rMultiple}:1`} value={<span className="text-emerald-300">{fmtPrice(tp.price)}</span>} />)}
          </div>
          <details className="text-[10px] text-slate-400">
            <summary className="cursor-pointer text-cyan-300/80">Formulas &amp; inputs</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 font-mono">{plan.formulas.map((f) => <li key={f}>{f}</li>)}</ul>
            {plan.basis && <div className="mt-1 font-mono">lastClose={plan.basis.lastClose.toPrecision(6)} ATR={plan.basis.atr.toPrecision(4)} swingLow={plan.basis.swingLow.toPrecision(6)} candles={plan.basis.candles} tf={plan.basis.timeframe}</div>}
          </details>
        </div>
      )}
      <div className="mt-2 rounded border border-amber-400/30 bg-amber-400/5 p-1.5 text-[10px] text-amber-200/80">{plan?.disclaimer ?? "HYPOTHETICAL — not advice."}</div>
    </div>
  );
}

function SecurityView({ t }: { t: TokenView }) {
  const s = t.security;
  const row = (label: string, v: boolean | number | undefined, good: (x: any) => boolean, fmt: (x: any) => string = (x) => String(x)) => {
    const known = v !== undefined;
    const ok = known && good(v);
    return (
      <div className="flex items-center justify-between border-t border-ink-700/50 py-1 text-[11px]">
        <span className="text-slate-400">{label}</span>
        <span className={`num ${!known ? "text-slate-600" : ok ? "text-emerald-300" : "text-rose-300"}`}>{!known ? "unknown" : `${ok ? "✓" : "✗"} ${fmt(v)}`}</span>
      </div>
    );
  };
  return (
    <div className="panel p-2">
      <div className="mb-1 flex items-center justify-between"><span className="panel-title">Token security analysis</span>{t.provenance.security && <SourceChip p={t.provenance.security.provider} />}</div>
      {row("Mint authority renounced", s.mintRenounced, (x) => x === true, (x) => (x ? "yes" : "NO"))}
      {row("Freeze authority renounced", s.freezeRenounced, (x) => x === true, (x) => (x ? "yes" : "NO"))}
      {row("Honeypot", s.honeypot, (x) => !x, (x) => (x ? "YES" : "no"))}
      {row("Rug ratio (GMGN)", s.rugRatio, (x) => x <= 0.3, (x) => x.toFixed(2))}
      {row("Bundler rate", s.bundlerRate, (x) => x <= 0.3, (x) => `${(x * 100).toFixed(0)}%`)}
      {row("Wash trading", s.washTrading, (x) => !x, (x) => (x ? "flagged" : "no"))}
      {row("Sell tax", s.sellTax, (x) => x <= 0.1, (x) => `${(x * 100).toFixed(1)}%`)}
      {row("Jupiter verified", s.jupVerified, (x) => x === true, (x) => (x ? "yes" : "no"))}
      {row("Jupiter organic score", s.organicScore, (x) => x >= 40, (x) => x.toFixed(0))}
      {row("Snipers (GMGN)", s.sniperCount, (x) => x < 20, (x) => String(x))}
      {s.flags?.length ? <div className="mt-1 text-[10px] text-rose-300">Flags: {s.flags.join(", ")}</div> : null}
      <div className="mt-1 text-[10px] text-slate-500">“unknown” = no provider returned that field. Unknown is never treated as safe.</div>
    </div>
  );
}

function HoldersView({ d, now }: { d: Detail; now: number }) {
  return (
    <div className="panel">
      <div className="panel-head"><span className="panel-title">Holder concentration (GMGN top holders)</span>{d.holdersAt && <Freshness at={d.holdersAt} now={now} staleAfterSec={900} />}</div>
      {!d.holders.length ? <Empty>{d.token.demo ? "Holder list not available for DEMO DATA." : "Holder list unavailable (GMGN demo-key budget or cooldown). Top-10 % from other sources is shown above when available."}</Empty> : (
        <div className="max-h-64 overflow-auto">
          <table className="w-full">
            <thead><tr><th className="th">#</th><th className="th">Wallet</th><th className="th text-right">% supply</th><th className="th text-right">USD</th><th className="th">Tags</th></tr></thead>
            <tbody>
              {d.holders.map((h, i) => (
                <tr key={h.address} className="border-t border-ink-700/50">
                  <td className="td num text-slate-500">{i + 1}</td>
                  <td className="td font-mono text-[11px]">{h.name ? <span className="text-cyan-200">{h.name} </span> : null}{short(h.address, 5)}{h.suspicious && <span className="ml-1 chip border-rose-400/50 text-rose-300">suspicious</span>}</td>
                  <td className="td num text-right">
                    <span className="inline-flex items-center gap-1.5"><span className="h-1 w-14 rounded bg-ink-600"><span className="block h-1 rounded bg-cyan-400" style={{ width: `${Math.min(100, h.pct * 2)}%` }} /></span>{h.pct.toFixed(2)}%</span>
                  </td>
                  <td className="td num text-right">{fmtUsd(h.usd)}</td>
                  <td className="td"><span className="flex flex-wrap gap-0.5">{h.tags.slice(0, 3).map((x) => <span key={x} className="chip border-ink-500 text-slate-400">{x}</span>)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PaperBox({ mint, t, onDone }: { mint: string; t: TokenView; onDone: () => void }) {
  const [amt, setAmt] = useState(100);
  const [frac, setFrac] = useState(100);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const go = async (side: "buy" | "sell") => {
    try {
      const r = await post<{ trade: { fillPriceUsd: number; slippagePct: number; feeUsd: number; realizedPnlUsd?: number } }>("/paper/order", { mint, side, amountUsd: amt, fraction: frac / 100 });
      setMsg({ ok: true, text: `Paper ${side} filled @ ${fmtPrice(r.trade.fillPriceUsd)} (slip ${r.trade.slippagePct}%, fee $${r.trade.feeUsd.toFixed(2)})${r.trade.realizedPnlUsd !== undefined ? ` · P&L $${r.trade.realizedPnlUsd.toFixed(2)}` : ""}` });
      onDone();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  return (
    <div className="panel p-2">
      <div className="mb-1 flex items-center justify-between"><span className="panel-title">Paper trade</span><span className="chip border-amber-400/50 text-amber-300">virtual only</span></div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] text-slate-400">$</span><input type="number" className="input w-20" value={amt} min={1} onChange={(e) => setAmt(Number(e.target.value))} />
        <button className="btn btn-green" disabled={t.priceUsd === undefined} onClick={() => go("buy")}>Paper buy</button>
        <input type="number" className="input w-14" value={frac} min={1} max={100} onChange={(e) => setFrac(Number(e.target.value))} /><span className="text-[10px] text-slate-400">%</span>
        <button className="btn btn-red" disabled={t.priceUsd === undefined} onClick={() => go("sell")}>Paper sell</button>
      </div>
      <div className="mt-1 text-[10px] text-slate-500">Fills at last provider price ({t.provenance.market?.provider ?? "n/a"}, {t.dataAgeSec}s old) + modelled slippage &amp; fee. No wallet, no order API.</div>
      {msg && <div className={`mt-1 text-[11px] ${msg.ok ? "text-emerald-300" : "text-rose-300"}`}>{msg.text}</div>}
    </div>
  );
}

function RuleBox({ mint, rules, onDone }: { mint: string; rules: AlertRule[]; onDone: () => void }) {
  const [type, setType] = useState<AlertRule["type"]>("price_above");
  const [value, setValue] = useState("");
  return (
    <div className="panel p-2">
      <div className="mb-1 panel-title">Alert rules</div>
      <div className="flex flex-wrap gap-1.5">
        <select className="input" value={type} onChange={(e) => setType(e.target.value as AlertRule["type"])}>
          <option value="price_above">Price ≥</option><option value="price_below">Price ≤</option>
          <option value="liquidity_drop_pct">Liquidity drop ≥ %</option><option value="volume_spike">Volume pace ≥ ×</option>
          <option value="score_above">Composite score ≥</option><option value="risk_change">Risk level changes</option>
        </select>
        <input className="input w-24" placeholder="value" value={value} onChange={(e) => setValue(e.target.value)} />
        <button className="btn btn-primary" onClick={async () => { await post("/rules", { mint, type, value: type === "risk_change" ? 0 : Number(value) }); setValue(""); onDone(); }}>Add</button>
      </div>
      <div className="mt-1 space-y-0.5">
        {rules.map((r) => (
          <div key={r.id} className="flex items-center justify-between text-[11px] text-slate-300">
            <span className="font-mono">{r.type} {r.type !== "risk_change" ? r.value : ""}{r.lastTriggeredAt ? <span className="text-amber-300"> · fired {ago(r.lastTriggeredAt)}</span> : ""}</span>
            <button className="text-slate-500 hover:text-rose-300" onClick={async () => { await del(`/rules/${r.id}`); onDone(); }}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProvenanceView({ t, now, notes }: { t: TokenView; now: number; notes: string[] }) {
  return (
    <div className="panel p-2">
      <div className="mb-1 panel-title">Data provenance (raw provider data)</div>
      <table className="w-full">
        <tbody>
          {Object.entries(t.provenance).map(([g, p]) => (
            <tr key={g} className="border-t border-ink-700/50 text-[10px]">
              <td className="py-0.5 font-mono text-slate-400">{g}</td>
              <td className="py-0.5"><SourceChip p={p.provider} /></td>
              <td className="py-0.5 font-mono text-slate-500">{p.endpoint}</td>
              <td className="py-0.5 text-right"><Freshness at={p.fetchedAt} now={now} label="" /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-1 text-[10px] text-slate-500">Seen in {t.scanCount} scans · first {ago(t.firstSeen, now)} · categories: {t.categories.join(", ")}. Scores, anomalies and levels are DERIVED locally.</div>
      {notes.length > 0 && <div className="mt-1 text-[10px] text-amber-300/80">{notes.join(" · ")}</div>}
    </div>
  );
}

function TradesMini({ trades, now }: { trades: WalletTrade[]; now: number }) {
  if (!trades.length) return null;
  return (
    <div className="panel p-2">
      <div className="mb-1 panel-title">Smart money / KOL trades in this token</div>
      {trades.slice(0, 12).map((x) => (
        <div key={x.id} className="flex justify-between border-t border-ink-700/50 py-0.5 text-[11px]">
          <span><span className={x.side === "buy" ? "text-emerald-300" : "text-rose-300"}>{x.side}</span> <span className="text-slate-400">{x.walletName ?? short(x.wallet)}</span> <span className="chip border-ink-500 text-slate-400">{x.kind}</span></span>
          <span className="num">{fmtUsd(x.amountUsd)} · {ago(x.timestamp, now)}</span>
        </div>
      ))}
    </div>
  );
}
