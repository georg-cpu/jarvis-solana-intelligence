import type { ReactNode } from "react";
import type { ProviderId, Score } from "../../../shared/types";
import { ago, riskClass } from "../lib";

export function Panel({ title, right, children, className = "", bodyClass = "", subtitle }: { title: string; right?: ReactNode; children: ReactNode; className?: string; bodyClass?: string; subtitle?: ReactNode }) {
  return (
    <section className={`panel flex min-h-0 min-w-0 flex-col animate-fadeIn ${className}`}>
      <div className="panel-head">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee]" />
          <h2 className="panel-title truncate">{title}</h2>
          {subtitle && <span className="hidden truncate text-[10px] text-slate-500 sm:inline">{subtitle}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-2">{right}</div>
      </div>
      <div className={`min-h-0 flex-1 ${bodyClass}`}>{children}</div>
    </section>
  );
}

const PROVIDER_STYLE: Record<ProviderId, string> = {
  gmgn: "border-emerald-400/40 text-emerald-300",
  dexscreener: "border-sky-400/40 text-sky-300",
  jupiter: "border-lime-400/40 text-lime-300",
  geckoterminal: "border-violet-400/40 text-violet-300",
  demo: "border-amber-400/60 text-amber-300 bg-amber-400/10",
};
const PROVIDER_SHORT: Record<ProviderId, string> = { gmgn: "GMGN", dexscreener: "DEXS", jupiter: "JUP", geckoterminal: "GECKO", demo: "DEMO" };

export function SourceChip({ p, title }: { p: ProviderId; title?: string }) {
  return <span title={title ?? p} className={`chip ${PROVIDER_STYLE[p]}`}>{PROVIDER_SHORT[p]}</span>;
}

export function RiskBadge({ level }: { level: string }) {
  return <span className={`chip ${riskClass[level] ?? riskClass.unknown}`}>{level}</span>;
}

export function ScoreBar({ value, invert = false, w = "w-16" }: { value: number | null; invert?: boolean; w?: string }) {
  if (value === null) return <span className="num text-[11px] text-slate-500" title="Insufficient data">n/a</span>;
  const good = invert ? 100 - value : value;
  const color = good >= 66 ? "bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,.7)]" : good >= 40 ? "bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,.6)]" : "bg-rose-400 shadow-[0_0_8px_rgba(244,63,94,.6)]";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`relative h-1.5 ${w} overflow-hidden rounded-full bg-ink-600`}>
        <span className={`absolute inset-y-0 left-0 rounded-full ${color} transition-[width] duration-700`} style={{ width: `${Math.max(3, value)}%` }} />
      </span>
      <span className="num w-7 text-right text-[11px] text-slate-300">{value.toFixed(0)}</span>
    </span>
  );
}

export function Freshness({ at, now, staleAfterSec = 300, label = "updated" }: { at?: number; now: number; staleAfterSec?: number; label?: string }) {
  const age = at ? (now - at) / 1000 : Infinity;
  const stale = age > staleAfterSec;
  return (
    <span className={`num text-[10px] ${stale ? "text-amber-400" : "text-slate-500"}`} title={at ? new Date(at).toLocaleString() : "no data yet"}>
      {stale && at ? "⚠ STALE · " : ""}{label} {ago(at, now)}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="flex h-full min-h-[80px] items-center justify-center p-4 text-center text-xs text-slate-500">{children}</div>;
}

export function Stat({ label, value, sub, tone = "" }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="rounded-md border border-ink-600/60 bg-ink-850/70 px-2.5 py-1.5">
      <div className="font-mono text-[9px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`num text-sm font-semibold ${tone}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}

export function ScoreCard({ s }: { s: Score }) {
  const invert = s.key === "holderRisk";
  return (
    <details className="group rounded-md border border-ink-600/60 bg-ink-850/60 open:border-cyan-400/30">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2.5 py-1.5">
        <span className="text-xs text-slate-300">{s.label}</span>
        <span className="flex items-center gap-2">
          <span className="num text-[10px] text-slate-500">cov {(s.coverage * 100).toFixed(0)}%</span>
          <ScoreBar value={s.value} invert={invert} />
          <span className="text-[10px] text-slate-500 transition group-open:rotate-90">▶</span>
        </span>
      </summary>
      <div className="space-y-1.5 border-t border-ink-600/50 px-2.5 py-2">
        <div className="font-mono text-[10px] leading-relaxed text-cyan-200/80">{s.formula}</div>
        <table className="w-full">
          <tbody>
            {s.inputs.map((i) => (
              <tr key={i.name} className="border-t border-ink-700/60">
                <td className="py-0.5 font-mono text-[10px] text-slate-400">{i.name}</td>
                <td className={`num py-0.5 text-right text-[10px] ${i.value === null ? "text-slate-600" : "text-slate-200"}`}>{i.value === null ? "missing" : String(i.value)}</td>
                <td className="py-0.5 pl-2 text-right font-mono text-[9px] uppercase text-slate-500">{i.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {s.note && <div className="text-[10px] text-amber-300/80">{s.note}</div>}
      </div>
    </details>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className="inline-flex items-center gap-1.5 text-[11px] text-slate-400" aria-pressed={on}>
      <span className={`relative h-3.5 w-6 rounded-full transition ${on ? "bg-emerald-500/70" : "bg-ink-600"}`}>
        <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all ${on ? "left-3" : "left-0.5"}`} />
      </span>
      {label}
    </button>
  );
}
