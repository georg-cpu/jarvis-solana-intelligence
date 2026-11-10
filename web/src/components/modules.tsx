import { useEffect, useMemo, useState } from "react";
import type { AlertEvent, AppConfig, CoverageRow, DashboardState, PaperState, TokenView, WalletTrade, WatchItem } from "../../../shared/types";
import { ago, api, del, fmtPct, fmtPrice, fmtUsd, pctClass, post, put, score, short } from "../lib";
import { Empty, Freshness, Panel, RiskBadge, ScoreBar, SourceChip, Stat, Toggle } from "./ui";

// ---------------- SMART MONEY / KOL ----------------
export function TradesFeed({ trades, kind, onOpen, now, title }: { trades: WalletTrade[]; kind: "smart" | "kol"; onOpen: (m: string) => void; now: number; title: string }) {
  const list = trades.filter((t) => t.kind === kind);
  const byToken = useMemo(() => {
    const m = new Map<string, { mint: string; symbol: string; buys: number; sells: number; buyUsd: number; sellUsd: number; wallets: Set<string> }>();
    for (const t of list) {
      const e = m.get(t.mint) ?? { mint: t.mint, symbol: t.symbol, buys: 0, sells: 0, buyUsd: 0, sellUsd: 0, wallets: new Set<string>() };
      t.side === "buy" ? (e.buys++, (e.buyUsd += t.amountUsd)) : (e.sells++, (e.sellUsd += t.amountUsd));
      e.wallets.add(t.wallet);
      m.set(t.mint, e);
    }
    return [...m.values()].sort((a, b) => b.wallets.size - a.wallets.size || b.buyUsd - a.buyUsd).slice(0, 8);
  }, [list]);
  const latest = list[0]?.provenance.fetchedAt;
  return (
    <Panel title={title} subtitle={kind === "kol" ? "GMGN track kol · demo key" : "GMGN track smartmoney · demo key"} right={<Freshness at={latest} now={now} staleAfterSec={900} />} bodyClass="flex flex-col">
      {!list.length ? <Empty>No {kind === "kol" ? "KOL" : "Smart Money"} trades yet. GMGN demo key is polled every few minutes; data may be unavailable during cooldowns.</Empty> : (
        <>
          <div className="flex flex-wrap gap-1 border-b border-ink-700/60 p-2">
            {byToken.map((e) => (
              <button key={e.mint} onClick={() => onOpen(e.mint)} className="rounded border border-ink-600 bg-ink-850 px-1.5 py-0.5 text-[10px] hover:border-cyan-400/50">
                <span className="font-semibold text-slate-100">{e.symbol}</span> <span className="text-slate-500">{e.wallets.size}w</span> <span className="text-emerald-400">{fmtUsd(e.buyUsd)}</span>/<span className="text-rose-400">{fmtUsd(e.sellUsd)}</span>
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {list.slice(0, 60).map((t) => (
              <div key={t.id} onClick={() => onOpen(t.mint)} className="flex cursor-pointer items-center justify-between gap-2 border-b border-ink-700/40 px-2 py-1 text-[11px] hover:bg-cyan-400/[0.04]">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className={`chip ${t.side === "buy" ? "border-emerald-400/50 text-emerald-300" : "border-rose-400/50 text-rose-300"}`}>{t.side}</span>
                  <span className="font-semibold text-slate-100">{t.symbol}</span>
                  <span className="truncate text-slate-500">{t.walletName ?? short(t.wallet)}</span>
                </span>
                <span className="num shrink-0 text-slate-300">{fmtUsd(t.amountUsd)} <span className="text-slate-600">{ago(t.timestamp, now)}</span></span>
              </div>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}

// ---------------- WHALES ----------------
export function WhaleActivity({ tokens, trades, threshold, onOpen, now }: { tokens: TokenView[]; trades: WalletTrade[]; threshold: number; onOpen: (m: string) => void; now: number }) {
  const bigTrades = trades.filter((t) => t.amountUsd >= threshold).slice(0, 30);
  const heuristics = tokens.flatMap((t) => t.derived.anomalies.filter((a) => a.type === "whale_buy" && !a.message.includes("(")).map((a) => ({ t, a }))).slice(0, 20);
  const heur2 = tokens.flatMap((t) => t.derived.anomalies.filter((a) => a.type === "whale_buy" || a.type === "whale_sell").map((a) => ({ t, a }))).sort((x, y) => y.a.value - x.a.value).slice(0, 25);
  return (
    <Panel title="Whale activity" subtitle={`trades ≥ ${fmtUsd(threshold)} + avg-buy-size heuristic`} bodyClass="overflow-auto">
      {!bigTrades.length && !heur2.length && !heuristics.length ? <Empty>No whale-sized activity detected in current data. Threshold is configurable in API Health → thresholds.</Empty> : (
        <div>
          {bigTrades.map((t) => (
            <div key={t.id} onClick={() => onOpen(t.mint)} className="flex cursor-pointer items-center justify-between border-b border-ink-700/40 px-2 py-1 text-[11px] hover:bg-cyan-400/[0.04]">
              <span>🐋 <span className={t.side === "buy" ? "text-emerald-300" : "text-rose-300"}>{t.side}</span> <b className="text-slate-100">{t.symbol}</b> <span className="text-slate-500">{t.walletName ?? short(t.wallet)} · {t.kind}</span></span>
              <span className="num">{fmtUsd(t.amountUsd)} <span className="text-slate-600">{ago(t.timestamp, now)}</span></span>
            </div>
          ))}
          {heur2.map(({ t, a }, i) => (
            <div key={`${t.mint}-${i}`} onClick={() => onOpen(t.mint)} className="flex cursor-pointer items-center justify-between border-b border-ink-700/40 px-2 py-1 text-[11px] hover:bg-cyan-400/[0.04]">
              <span><span className="chip border-amber-400/40 text-amber-300">potential</span> <b className="text-slate-100">{t.symbol}</b> <span className="text-slate-400">{a.message}</span></span>
              {t.demo && <span className="chip border-amber-400/60 text-amber-300">DEMO</span>}
            </div>
          ))}
          <div className="p-2 text-[10px] text-slate-500">“Potential” = derived from aggregate 5m buy volume ÷ buy count (Jupiter) or tracked wallet trades (GMGN). It is an inference, not a confirmed single wallet.</div>
        </div>
      )}
    </Panel>
  );
}

// ---------------- SECURITY ----------------
export function SecurityModule({ tokens, onOpen }: { tokens: TokenView[]; onOpen: (m: string) => void }) {
  const flagged = tokens
    .map((t) => {
      const s = t.security; const issues: string[] = [];
      if (s.honeypot) issues.push("HONEYPOT");
      if (s.mintRenounced === false) issues.push("mint authority");
      if (s.freezeRenounced === false) issues.push("freeze authority");
      if ((s.rugRatio ?? 0) > 0.3) issues.push(`rug ${(s.rugRatio! * 100).toFixed(0)}%`);
      if ((s.bundlerRate ?? 0) > 0.3) issues.push(`bundlers ${(s.bundlerRate! * 100).toFixed(0)}%`);
      if (s.washTrading) issues.push("wash trading");
      if ((t.top10HolderPct ?? 0) > 50) issues.push(`top10 ${t.top10HolderPct!.toFixed(0)}%`);
      if (s.flags?.length) issues.push(...s.flags);
      return { t, issues };
    })
    .filter((x) => x.issues.length)
    .sort((a, b) => b.issues.length - a.issues.length)
    .slice(0, 60);
  const unknown = tokens.filter((t) => score(t, "security") === null).length;
  return (
    <Panel title="Token security analysis" subtitle={`${flagged.length} flagged · ${unknown} with insufficient security data`} bodyClass="overflow-auto">
      {!flagged.length ? <Empty>No security flags in current data. Tokens with unknown security fields are NOT considered safe.</Empty> : flagged.map(({ t, issues }) => (
        <div key={t.mint} onClick={() => onOpen(t.mint)} className="flex cursor-pointer items-center justify-between gap-2 border-b border-ink-700/40 px-2 py-1 text-[11px] hover:bg-rose-500/[0.04]">
          <span className="flex min-w-0 items-center gap-1.5"><RiskBadge level={t.derived.riskLevel} /><b className="text-slate-100">{t.symbol}</b>{t.demo && <span className="chip border-amber-400/60 text-amber-300">DEMO</span>}</span>
          <span className="flex flex-wrap justify-end gap-0.5">{issues.map((i) => <span key={i} className="chip border-rose-400/40 text-rose-300">{i}</span>)}</span>
        </div>
      ))}
    </Panel>
  );
}

// ---------------- SIGNAL ENGINE ----------------
export function SignalModule({ tokens, config, onOpen, onConfig }: { tokens: TokenView[]; config: AppConfig | null; onOpen: (m: string) => void; onConfig: (c: Partial<AppConfig>) => void }) {
  const ranked = tokens.filter((t) => score(t, "composite") !== null).sort((a, b) => (score(b, "composite") ?? 0) - (score(a, "composite") ?? 0)).slice(0, 40);
  const [w, setW] = useState(config?.weights);
  useEffect(() => setW(config?.weights), [config?.weights]);
  return (
    <Panel title="Signal & risk engine" subtitle="transparent scores · configurable weights" bodyClass="flex flex-col">
      {w && (
        <div className="flex flex-wrap items-end gap-2 border-b border-ink-700/60 p-2">
          {(Object.keys(w) as (keyof typeof w)[]).map((k) => (
            <label key={k} className="text-[10px] text-slate-400">{k}<input type="number" step="0.05" min={0} max={1} className="input ml-1 w-14" value={w[k]} onChange={(e) => setW({ ...w, [k]: Number(e.target.value) })} /></label>
          ))}
          <button className="btn btn-primary" onClick={() => onConfig({ weights: w })}>Apply weights</button>
          <span className="text-[10px] text-slate-500">composite = Σ wᵢ·componentᵢ ÷ Σ wᵢ (holder risk inverted)</span>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {!ranked.length ? <Empty>Not enough data to score any token yet (each score needs ≥40% input coverage).</Empty> : (
          <table className="w-full border-separate border-spacing-0">
            <thead><tr><th className="th">Token</th><th className="th">Composite</th><th className="th">Momentum</th><th className="th">Liquidity</th><th className="th">Security</th><th className="th">Holder risk</th><th className="th">Risk</th></tr></thead>
            <tbody>
              {ranked.map((t) => (
                <tr key={t.mint} onClick={() => onOpen(t.mint)} className="cursor-pointer hover:bg-cyan-400/[0.04]">
                  <td className="td border-b border-ink-700/40"><b className="text-slate-100">{t.symbol}</b> {t.demo && <span className="chip border-amber-400/60 text-amber-300">DEMO</span>}</td>
                  <td className="td border-b border-ink-700/40"><ScoreBar value={score(t, "composite")} /></td>
                  <td className="td border-b border-ink-700/40"><ScoreBar value={score(t, "momentum")} w="w-10" /></td>
                  <td className="td border-b border-ink-700/40"><ScoreBar value={score(t, "liquidity")} w="w-10" /></td>
                  <td className="td border-b border-ink-700/40"><ScoreBar value={score(t, "security")} w="w-10" /></td>
                  <td className="td border-b border-ink-700/40"><ScoreBar value={score(t, "holderRisk")} invert w="w-10" /></td>
                  <td className="td border-b border-ink-700/40"><RiskBadge level={t.derived.riskLevel} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="border-t border-ink-700/60 p-1.5 text-[10px] text-amber-300/70">Speculative screening only. A high score is not a buy signal and never implies certainty. Open a token for formulas, inputs and hypothetical levels.</div>
    </Panel>
  );
}

// ---------------- PAPER TRADING ----------------
export function PaperModule({ tokens, onOpen, version }: { tokens: TokenView[]; onOpen: (m: string) => void; version: number }) {
  const [p, setP] = useState<PaperState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => api<PaperState>("/paper").then(setP).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [version]);
  if (!p) return <Panel title="Paper trading journal"><Empty>{err ?? "Loading…"}</Empty></Panel>;
  const priceOf = (m: string) => tokens.find((t) => t.mint === m)?.priceUsd;
  const mtm = p.positions.reduce((a, pos) => a + (priceOf(pos.mint) !== undefined ? pos.qty * priceOf(pos.mint)! : 0), 0);
  const unpriced = p.positions.filter((pos) => priceOf(pos.mint) === undefined).length;
  const equity = p.cashUsd + mtm;
  const realized = p.journal.reduce((a, t) => a + (t.realizedPnlUsd ?? 0), 0);
  const sellAll = async (mint: string) => { try { await post("/paper/order", { mint, side: "sell", fraction: 1 }); load(); } catch (e) { setErr((e as Error).message); } };
  return (
    <Panel title="Paper trading journal" subtitle="virtual balance · isolated from wallets & order APIs" right={<span className="chip border-amber-400/60 bg-amber-400/10 text-amber-300">PAPER</span>} bodyClass="flex flex-col">
      <div className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-4">
        <Stat label="Virtual cash" value={fmtUsd(p.cashUsd, false)} />
        <Stat label="Equity (mark-to-market)" value={fmtUsd(equity, false)} sub={unpriced ? `${unpriced} position(s) unpriced — excluded` : undefined} />
        <Stat label="Return" value={<span className={pctClass(equity - p.startingBalanceUsd)}>{fmtPct(((equity - p.startingBalanceUsd) / p.startingBalanceUsd) * 100, 2)}</span>} />
        <Stat label="Realized P&L" value={<span className={pctClass(realized)}>{fmtUsd(realized, false)}</span>} />
      </div>
      <div className="flex flex-wrap items-center gap-2 border-y border-ink-700/60 px-2 py-1.5 text-[10px] text-slate-400">
        <span>Fee {p.feeBps / 100}% · base slippage {p.baseSlippageBps / 100}% · impact {p.impactFactor}×(size/liquidity)</span>
        <button className="btn" onClick={async () => { const fee = prompt("Fee in bps", String(p.feeBps)); const slip = prompt("Base slippage in bps", String(p.baseSlippageBps)); if (fee !== null && slip !== null) setP(await put("/paper/settings", { feeBps: Number(fee), baseSlippageBps: Number(slip) })); }}>Assumptions</button>
        <button className="btn btn-red" onClick={async () => { if (confirm("Reset the virtual paper account? Journal will be cleared.")) setP(await post("/paper/reset", {})); }}>Reset</button>
        {err && <span className="text-rose-300">{err}</span>}
      </div>
      <div className="grid min-h-0 flex-1 gap-2 overflow-auto p-2 lg:grid-cols-2">
        <div>
          <div className="mb-1 font-mono text-[10px] uppercase text-slate-500">Open positions</div>
          {!p.positions.length ? <div className="text-[11px] text-slate-500">None. Open a token and use “Paper buy”.</div> : p.positions.map((pos) => {
            const px = priceOf(pos.mint);
            const pnl = px !== undefined ? pos.qty * px - pos.costUsd : undefined;
            return (
              <div key={pos.mint} className="flex items-center justify-between border-b border-ink-700/40 py-1 text-[11px]">
                <button className="font-semibold text-slate-100 hover:text-cyan-300" onClick={() => onOpen(pos.mint)}>{pos.symbol}</button>
                <span className="num text-slate-400">avg {fmtPrice(pos.avgPriceUsd)} · now {fmtPrice(px)}</span>
                <span className={`num ${pctClass(pnl)}`}>{pnl === undefined ? "unpriced" : fmtUsd(pnl, false)}</span>
                <button className="btn btn-red !py-0" onClick={() => sellAll(pos.mint)}>close</button>
              </div>
            );
          })}
        </div>
        <div>
          <div className="mb-1 font-mono text-[10px] uppercase text-slate-500">Trade journal</div>
          {!p.journal.length ? <div className="text-[11px] text-slate-500">No paper trades yet.</div> : p.journal.slice(0, 80).map((t) => (
            <div key={t.id} className="border-b border-ink-700/40 py-1 text-[10px]">
              <div className="flex justify-between"><span><span className={t.side === "buy" ? "text-emerald-300" : "text-rose-300"}>{t.side.toUpperCase()}</span> <b className="text-slate-100">{t.symbol}</b> {fmtUsd(t.notionalUsd, false)}</span><span className="text-slate-500">{new Date(t.at).toLocaleString()}</span></div>
              <div className="num text-slate-500">quote {fmtPrice(t.quotePriceUsd)} → fill {fmtPrice(t.fillPriceUsd)} · slip {t.slippagePct}% · fee ${t.feeUsd.toFixed(2)}{t.realizedPnlUsd !== undefined && <span className={pctClass(t.realizedPnlUsd)}> · P&L ${t.realizedPnlUsd.toFixed(2)}</span>} · src {t.priceSource} ({t.priceAgeSec}s)</div>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

// ---------------- WATCHLIST & ALERTS ----------------
export function WatchAlerts({ tokens, alerts, onOpen, onChanged, now }: { tokens: TokenView[]; alerts: AlertEvent[]; onOpen: (m: string) => void; onChanged: () => void; now: number }) {
  const [w, setW] = useState<{ items: WatchItem[] } | null>(null);
  const [mintIn, setMintIn] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const load = () => api<{ items: WatchItem[] }>("/watchlist").then(setW);
  useEffect(() => { load(); }, [tokens.length]);
  const byMint = new Map(tokens.map((t) => [t.mint, t]));
  return (
    <Panel title="Watchlist & alerts" subtitle="rules evaluated on every scan" bodyClass="grid min-h-0 gap-2 overflow-auto p-2 lg:grid-cols-2">
      <div>
        <div className="mb-1 flex gap-1">
          <input className="input flex-1" placeholder="Add mint address…" value={mintIn} onChange={(e) => setMintIn(e.target.value.trim())} />
          <button className="btn btn-primary" onClick={async () => { try { await post("/watchlist", { mint: mintIn }); setMintIn(""); setErr(null); load(); onChanged(); } catch (e) { setErr((e as Error).message); } }}>Add</button>
        </div>
        {err && <div className="text-[10px] text-rose-300">{err}</div>}
        {!w?.items.length ? <div className="text-[11px] text-slate-500">Watchlist empty. Use ★ in any table or “Watch” in a token view. Watched tokens are re-scanned every DexScreener refresh cycle.</div> : w.items.map((it) => {
          const t = byMint.get(it.mint);
          return (
            <div key={it.mint} className="flex items-center justify-between gap-2 border-b border-ink-700/40 py-1 text-[11px]">
              <button onClick={() => onOpen(it.mint)} className="min-w-0 truncate text-left font-semibold text-slate-100 hover:text-cyan-300">{t?.symbol ?? it.symbol ?? short(it.mint)}</button>
              <span className="num text-slate-300">{fmtPrice(t?.priceUsd)}</span>
              <span className={`num ${pctClass(t?.priceChange.h1)}`}>{fmtPct(t?.priceChange.h1)}</span>
              {t ? <RiskBadge level={t.derived.riskLevel} /> : <span className="text-[10px] text-slate-500">not loaded</span>}
              <button className="text-slate-500 hover:text-rose-300" onClick={async () => { await del(`/watchlist/${it.mint}`); load(); onChanged(); }}>✕</button>
            </div>
          );
        })}
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between"><span className="font-mono text-[10px] uppercase text-slate-500">Alert feed</span>{alerts.length > 0 && <button className="btn !py-0" onClick={async () => { await del("/alerts"); onChanged(); }}>clear</button>}</div>
        {!alerts.length ? <div className="text-[11px] text-slate-500">No alerts. Anomalies on watched tokens and custom rules appear here.</div> : alerts.map((a) => (
          <div key={a.id} onClick={() => onOpen(a.mint)} className={`mb-1 cursor-pointer rounded border px-2 py-1 text-[11px] ${a.severity === "high" ? "border-rose-500/50 bg-rose-500/10" : a.severity === "warn" ? "border-amber-400/40 bg-amber-400/5" : "border-cyan-400/30 bg-cyan-400/5"}`}>
            <div className="flex justify-between"><b className="text-slate-100">{a.symbol}</b><span className="text-[10px] text-slate-500">{a.source} · {ago(a.at, now)}</span></div>
            <div className="text-slate-300">{a.message}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ---------------- API HEALTH ----------------
const STATE_STYLE: Record<string, string> = { ok: "text-emerald-300 border-emerald-400/50", idle: "text-slate-400 border-slate-500/50", degraded: "text-amber-300 border-amber-400/50", cooldown: "text-amber-300 border-amber-400/60", down: "text-rose-300 border-rose-500/60", disabled: "text-slate-500 border-slate-600" };

export function ApiHealth({ state, config, onConfig, now }: { state: DashboardState; config: AppConfig | null; onConfig: (c: Partial<AppConfig>) => void; now: number }) {
  const [coverage, setCoverage] = useState<CoverageRow[]>([]);
  useEffect(() => { api<CoverageRow[]>("/coverage").then(setCoverage).catch(() => {}); }, []);
  const [th, setTh] = useState(config?.thresholds);
  useEffect(() => setTh(config?.thresholds), [config?.thresholds]);
  return (
    <Panel title="API health & rate-limit monitor" subtitle="every request goes through a per-provider queue" bodyClass="overflow-auto p-2 space-y-3">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-4">
        {state.providers.map((p) => (
          <div key={p.id} className="min-w-0 break-words rounded-md border border-ink-600/70 bg-ink-850/70 p-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5"><SourceChip p={p.id} /><span className="text-xs font-semibold text-slate-100">{p.label}</span></span>
              <span className={`chip ${STATE_STYLE[p.state]}`}>{p.state}</span>
            </div>
            <div className="mt-1 grid grid-cols-4 gap-1 text-center">
              {[["req", p.requests], ["ok", p.successes], ["err", p.errors], ["429", p.rateLimited]].map(([k, v]) => (
                <div key={k as string} className="rounded bg-ink-800 py-0.5"><div className="font-mono text-[9px] uppercase text-slate-500">{k}</div><div className={`num text-xs ${k === "429" && Number(v) > 0 ? "text-amber-300" : ""}`}>{v}</div></div>
              ))}
            </div>
            <div className="mt-1 space-y-0.5 text-[10px] text-slate-400">
              <div>cache hits {p.cacheHits} · latency {p.lastLatencyMs ?? "—"}ms · queued {p.queued}</div>
              <div>last OK <Freshness at={p.lastSuccessAt} now={now} staleAfterSec={900} label="" /></div>
              {p.cooldownUntil && <div className="text-amber-300">⏸ paused {Math.max(0, Math.round((p.cooldownUntil - now) / 1000))}s — {p.note}</div>}
              {p.lastError && <div className="truncate text-rose-300/80" title={p.lastError}>last error: {p.lastError}</div>}
              <div className="text-slate-500" title={p.documentedLimit}>documented: {p.documentedLimit}</div>
              <div className="text-slate-500">applied: {p.appliedLimit}</div>
              <div className="text-slate-600">transport: polling (no provider stream)</div>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-md border border-ink-600/70">
        <div className="border-b border-ink-600/60 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-cyan-300">Polling feeds (configurable; provider-safe minimums enforced server-side)</div>
        <div className="overflow-auto">
          <table className="w-full">
            <thead><tr><th className="th">Feed</th><th className="th">On</th><th className="th">Interval s</th><th className="th">Last OK</th><th className="th text-right">Items</th><th className="th">Status</th></tr></thead>
            <tbody>
              {state.feeds.filter((f) => (state.meta.mode === "demo" ? f.provider === "demo" : f.provider !== "demo")).map((f) => (
                <tr key={f.id} className="border-t border-ink-700/50">
                  <td className="td"><SourceChip p={f.provider} /> <span className="text-slate-300">{f.label}</span></td>
                  <td className="td"><Toggle on={f.enabled} onChange={(v) => onConfig({ feeds: { [f.id]: { intervalSec: f.intervalSec, enabled: v } } })} /></td>
                  <td className="td"><input type="number" className="input w-16" defaultValue={f.intervalSec} onBlur={(e) => onConfig({ feeds: { [f.id]: { intervalSec: Number(e.target.value), enabled: f.enabled } } })} /></td>
                  <td className="td"><Freshness at={f.lastOkAt} now={now} staleAfterSec={f.intervalSec * 3} label="" /></td>
                  <td className="td num text-right">{f.lastCount ?? "—"}</td>
                  <td className="td max-w-[280px] truncate text-[10px] text-slate-400" title={f.lastError ?? f.skippedReason}>{f.lastError ? <span className="text-rose-300">{f.lastError}</span> : f.skippedReason ?? "ok"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {th && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-ink-600/70 p-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-cyan-300">Anomaly thresholds</span>
          {(Object.keys(th) as (keyof typeof th)[]).map((k) => (
            <label key={k} className="text-[10px] text-slate-400">{k}<input type="number" className="input ml-1 w-20" value={th[k]} onChange={(e) => setTh({ ...th, [k]: Number(e.target.value) })} /></label>
          ))}
          <label className="text-[10px] text-slate-400">staleAfterSec<input type="number" className="input ml-1 w-16" defaultValue={config?.staleAfterSec} onBlur={(e) => onConfig({ staleAfterSec: Number(e.target.value) })} /></label>
          <button className="btn btn-primary" onClick={() => onConfig({ thresholds: th })}>Apply</button>
        </div>
      )}

      <div className="overflow-auto rounded-md border border-ink-600/70">
        <div className="border-b border-ink-600/60 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-cyan-300">Venue &amp; data coverage (honest)</div>
        <table className="w-full min-w-[560px]">
          <tbody>
            {coverage.map((c) => (
              <tr key={c.venue} className="border-t border-ink-700/50 align-top">
                <td className="td font-semibold text-slate-200">{c.venue}</td>
                <td className="td"><span className={`chip ${c.status === "covered" ? "border-emerald-400/50 text-emerald-300" : c.status === "partial" ? "border-cyan-400/50 text-cyan-300" : c.status === "indirect" ? "border-amber-400/50 text-amber-300" : "border-rose-400/50 text-rose-300"}`}>{c.status}</span></td>
                <td className="td whitespace-normal text-[10px] text-slate-400">{c.via}</td>
                <td className="td whitespace-normal text-[10px] text-slate-500">{c.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
