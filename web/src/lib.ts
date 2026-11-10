import { useEffect, useRef, useState } from "react";
import type { DashboardState, Filters, TokenView } from "../../shared/types";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as T;
}
export const post = <T,>(path: string, body?: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });
export const put = <T,>(path: string, body?: unknown) => api<T>(path, { method: "PUT", body: JSON.stringify(body ?? {}) });
export const del = <T,>(path: string) => api<T>(path, { method: "DELETE" });

export type Conn = "connecting" | "live" | "reconnecting" | "offline";

/** Subscribes to the local SSE push (polled provider data). Falls back to HTTP polling if SSE fails. */
export function useDashboard() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [conn, setConn] = useState<Conn>("connecting");
  const [lastMsg, setLastMsg] = useState<number>(0);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let closed = false;
    let fallback: number | null = null;
    const connect = () => {
      const es = new EventSource("/api/events");
      esRef.current = es;
      es.addEventListener("state", (e) => {
        setState(JSON.parse((e as MessageEvent).data));
        setConn("live");
        setLastMsg(Date.now());
      });
      es.addEventListener("ping", () => { setConn("live"); setLastMsg(Date.now()); });
      es.onerror = () => {
        if (closed) return;
        setConn("reconnecting");
        if (!fallback) fallback = window.setInterval(() => api<DashboardState>("/state").then((s) => { setState(s); setLastMsg(Date.now()); }).catch(() => setConn("offline")), 15_000);
      };
      es.onopen = () => { if (fallback) { clearInterval(fallback); fallback = null; } };
    };
    connect();
    return () => { closed = true; esRef.current?.close(); if (fallback) clearInterval(fallback); };
  }, []);

  const refresh = () => api<DashboardState>("/state").then((s) => { setState(s); setLastMsg(Date.now()); });
  return { state, conn, lastMsg, refresh, setState };
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(t); }, [intervalMs]);
  return now;
}

export function useLocal<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try { const s = localStorage.getItem(key); return s ? (JSON.parse(s) as T) : initial; } catch { return initial; }
  });
  const set = (nv: T) => { setV(nv); try { localStorage.setItem(key, JSON.stringify(nv)); } catch { /* storage unavailable */ } };
  return [v, set];
}

// ---------- formatting ----------
export const fmtUsd = (n?: number, compact = true) => {
  if (n === undefined || n === null || !Number.isFinite(n)) return "—";
  if (compact && Math.abs(n) >= 1000) return "$" + Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(n);
  return "$" + n.toLocaleString("en", { maximumFractionDigits: 2 });
};
export const fmtPrice = (n?: number) => {
  if (n === undefined || !Number.isFinite(n)) return "—";
  if (n === 0) return "$0";
  if (n >= 1) return "$" + n.toLocaleString("en", { maximumFractionDigits: 4 });
  const s = n.toExponential(3);
  const exp = Number(s.split("e")[1]);
  if (exp >= -4) return "$" + n.toFixed(Math.min(8, 3 - exp));
  const zeros = -exp - 1;
  const digits = n.toFixed(zeros + 4).slice(2 + zeros).replace(/0+$/, "");
  return `$0.0{${zeros}}${digits}`;
};
export const fmtNum = (n?: number) => (n === undefined || !Number.isFinite(n) ? "—" : Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n));
export const fmtPct = (n?: number, d = 1) => (n === undefined || !Number.isFinite(n) ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(d)}%`);
export const pctClass = (n?: number) => (n === undefined ? "text-slate-500" : n > 0 ? "text-emerald-400" : n < 0 ? "text-rose-400" : "text-slate-300");
export const fmtAge = (min?: number) => {
  if (min === undefined) return "—";
  if (min < 60) return `${Math.round(min)}m`;
  if (min < 48 * 60) return `${(min / 60).toFixed(1)}h`;
  return `${Math.round(min / 1440)}d`;
};
export const ago = (t?: number, now = Date.now()) => {
  if (!t) return "never";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
};
export const short = (a: string, n = 4) => (a.length > n * 2 + 1 ? `${a.slice(0, n)}…${a.slice(-n)}` : a);
export const score = (t: TokenView, key: string) => t.derived.scores.find((s) => s.key === key)?.value ?? null;

export const RISK_ORDER = { low: 0, medium: 1, high: 2, extreme: 3, unknown: 4 } as const;
export const riskClass: Record<string, string> = {
  low: "border-emerald-400/40 text-emerald-300 bg-emerald-400/10",
  medium: "border-amber-400/40 text-amber-300 bg-amber-400/10",
  high: "border-rose-400/40 text-rose-300 bg-rose-400/10",
  extreme: "border-rose-500/70 text-rose-200 bg-rose-600/25",
  unknown: "border-slate-500/40 text-slate-400 bg-slate-500/10",
};

export function applyFilters(tokens: TokenView[], f: Filters): TokenView[] {
  const q = f.query?.trim().toLowerCase();
  return tokens.filter((t) => {
    if (q && !(t.mint.toLowerCase() === q || t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q))) return false;
    if (f.maxAgeMinutes && (t.derived.ageMinutes === undefined || t.derived.ageMinutes > f.maxAgeMinutes)) return false;
    if (f.minVolume1h && (t.volume.h1 ?? 0) < f.minVolume1h) return false;
    if (f.minLiquidity && (t.liquidityUsd ?? 0) < f.minLiquidity) return false;
    if (f.minMarketCap && (t.marketCap ?? 0) < f.minMarketCap) return false;
    if (f.maxMarketCap && (t.marketCap ?? Infinity) > f.maxMarketCap) return false;
    if (f.maxRisk && RISK_ORDER[t.derived.riskLevel] > RISK_ORDER[f.maxRisk]) return false;
    return true;
  });
}
