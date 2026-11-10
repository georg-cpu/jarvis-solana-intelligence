import { memo, useMemo, useRef, useState } from "react";
import type { TokenView } from "../../../shared/types";
import { fmtAge, fmtNum, fmtPct, fmtPrice, fmtUsd, pctClass, score, short } from "../lib";
import { Empty, RiskBadge, ScoreBar, SourceChip } from "./ui";

type SortKey = "score" | "age" | "liq" | "vol" | "mc" | "chg1h" | "chg5m" | "txns" | "top10";
const getters: Record<SortKey, (t: TokenView) => number | undefined> = {
  score: (t) => score(t, "composite") ?? undefined,
  age: (t) => (t.derived.ageMinutes === undefined ? undefined : -t.derived.ageMinutes),
  liq: (t) => t.liquidityUsd,
  vol: (t) => t.volume.h1 ?? t.volume.h24,
  mc: (t) => t.marketCap,
  chg1h: (t) => t.priceChange.h1,
  chg5m: (t) => t.priceChange.m5,
  txns: (t) => (t.txns.h1 ? t.txns.h1.buys + t.txns.h1.sells : undefined),
  top10: (t) => (t.top10HolderPct === undefined ? undefined : -t.top10HolderPct),
};

const ANOMALY_ICON: Record<string, string> = { volume_spike: "⚡", liquidity_drop: "💧↓", liquidity_add: "💧↑", momentum_accel: "🚀", whale_buy: "🐋", whale_sell: "🐋↓", sell_pressure: "⬇" };

export const TokenTable = memo(function TokenTable({ tokens, onOpen, compact = false, defaultSort = "score", watch, onToggleWatch, empty }: {
  tokens: TokenView[]; onOpen: (mint: string) => void; compact?: boolean; defaultSort?: SortKey; watch?: Set<string>; onToggleWatch?: (mint: string) => void; empty?: string;
}) {
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: defaultSort, dir: -1 });
  const prevPrices = useRef(new Map<string, number>());
  const sorted = useMemo(() => {
    const g = getters[sort.k];
    return [...tokens].sort((a, b) => {
      const va = g(a), vb = g(b);
      if (va === undefined && vb === undefined) return 0;
      if (va === undefined) return 1;
      if (vb === undefined) return -1;
      return sort.dir === -1 ? vb - va : va - vb;
    });
  }, [tokens, sort]);

  const H = ({ k, children, className = "" }: { k: SortKey; children: string; className?: string }) => (
    <th className={`th cursor-pointer select-none hover:text-cyan-300 ${className}`} onClick={() => setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : -1 }))}>
      {children}{sort.k === k ? (sort.dir === -1 ? " ▼" : " ▲") : ""}
    </th>
  );

  if (!tokens.length) return <Empty>{empty ?? "No tokens match the current filters yet. Feeds poll on conservative intervals — first results appear within ~1–2 minutes."}</Empty>;

  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-separate border-spacing-0">
        <thead>
          <tr>
            <th className="th">Token</th>
            <H k="age">Age</H>
            <th className="th text-right">Price</th>
            {!compact && <H k="chg5m" className="text-right">5m</H>}
            <H k="chg1h" className="text-right">1h</H>
            <H k="liq" className="text-right">Liq</H>
            <H k="vol" className="text-right">Vol</H>
            {!compact && <H k="txns" className="text-right">Tx 1h B/S</H>}
            <H k="mc" className="text-right">MCap</H>
            {!compact && <H k="top10" className="text-right">Top10</H>}
            <th className="th">Risk</th>
            <H k="score">Score</H>
            {!compact && <th className="th">Signals</th>}
            {!compact && <th className="th">Src</th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => {
            const prev = prevPrices.current.get(t.mint);
            const flash = prev !== undefined && t.priceUsd !== undefined && prev !== t.priceUsd ? (t.priceUsd > prev ? "animate-flashUp" : "animate-flashDown") : "";
            if (t.priceUsd !== undefined) prevPrices.current.set(t.mint, t.priceUsd);
            const vol = t.volume.h1 ?? t.volume.h24;
            return (
              <tr key={`${t.mint}-${t.priceUsd}`} onClick={() => onOpen(t.mint)} className={`group cursor-pointer border-b border-ink-700/50 transition hover:bg-cyan-400/[0.04] ${flash}`}>
                <td className="td border-b border-ink-700/40">
                  <div className="flex items-center gap-2">
                    {onToggleWatch && (
                      <button title={watch?.has(t.mint) ? "Remove from watchlist" : "Add to watchlist"} onClick={(e) => { e.stopPropagation(); onToggleWatch(t.mint); }} className={`text-sm leading-none ${watch?.has(t.mint) ? "text-amber-300" : "text-slate-600 hover:text-amber-300"}`}>★</button>
                    )}
                    {t.logo ? <img src={t.logo} alt="" loading="lazy" className="h-5 w-5 rounded-full bg-ink-700 object-cover" onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} /> : <span className="h-5 w-5 rounded-full bg-ink-700" />}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="max-w-[110px] truncate font-semibold text-slate-100 group-hover:text-cyan-200">{t.symbol}</span>
                        {t.demo && <span className="chip border-amber-400/60 bg-amber-400/10 text-amber-300">DEMO</span>}
                        {t.stale && <span className="chip border-amber-400/40 text-amber-400" title={`Market data ${t.dataAgeSec}s old`}>stale</span>}
                      </div>
                      <div className="font-mono text-[10px] text-slate-500">{short(t.mint)}{t.launchpad ? ` · ${t.launchpad}` : t.dex ? ` · ${t.dex}` : ""}</div>
                    </div>
                  </div>
                </td>
                <td className="td num border-b border-ink-700/40 text-slate-400">{fmtAge(t.derived.ageMinutes)}</td>
                <td className="td num border-b border-ink-700/40 text-right text-slate-100">{fmtPrice(t.priceUsd)}</td>
                {!compact && <td className={`td num border-b border-ink-700/40 text-right ${pctClass(t.priceChange.m5)}`}>{fmtPct(t.priceChange.m5)}</td>}
                <td className={`td num border-b border-ink-700/40 text-right ${pctClass(t.priceChange.h1)}`}>{fmtPct(t.priceChange.h1)}</td>
                <td className="td num border-b border-ink-700/40 text-right">{fmtUsd(t.liquidityUsd)}</td>
                <td className="td num border-b border-ink-700/40 text-right" title={t.volume.h1 !== undefined ? "1h volume" : "24h volume"}>{fmtUsd(vol)}<span className="text-[9px] text-slate-600">{t.volume.h1 !== undefined ? "" : " 24h"}</span></td>
                {!compact && (
                  <td className="td num border-b border-ink-700/40 text-right">
                    {t.txns.h1 ? <><span className="text-emerald-400">{fmtNum(t.txns.h1.buys)}</span><span className="text-slate-600">/</span><span className="text-rose-400">{fmtNum(t.txns.h1.sells)}</span></> : "—"}
                  </td>
                )}
                <td className="td num border-b border-ink-700/40 text-right">{fmtUsd(t.marketCap)}</td>
                {!compact && <td className={`td num border-b border-ink-700/40 text-right ${(t.top10HolderPct ?? 0) > 40 ? "text-rose-300" : "text-slate-300"}`}>{t.top10HolderPct === undefined ? "—" : `${t.top10HolderPct.toFixed(0)}%`}</td>}
                <td className="td border-b border-ink-700/40"><RiskBadge level={t.derived.riskLevel} /></td>
                <td className="td border-b border-ink-700/40"><ScoreBar value={score(t, "composite")} w={compact ? "w-10" : "w-14"} /></td>
                {!compact && (
                  <td className="td border-b border-ink-700/40" title={t.derived.anomalies.map((a) => a.message).join("\n")}>
                    <span className="flex gap-0.5 text-[11px]">
                      {[...new Set(t.derived.anomalies.map((a) => a.type))].map((ty) => <span key={ty}>{ANOMALY_ICON[ty]}</span>)}
                      {t.categories.includes("smart") && <span className="chip border-emerald-400/40 text-emerald-300">SM</span>}
                      {t.categories.includes("kol") && <span className="chip border-fuchsia-400/40 text-fuchsia-300">KOL</span>}
                    </span>
                  </td>
                )}
                {!compact && <td className="td border-b border-ink-700/40"><span className="flex gap-0.5">{t.sources.map((s) => <SourceChip key={s} p={s} />)}</span></td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});
