// Transparent, configurable scoring. Every score lists its formula and the exact inputs used.
// Scores are heuristics for screening, NOT predictions. Missing inputs are reported, never invented.
import type { AppConfig, Anomaly, Candle, DerivedAnalytics, Score, ScoreInput, Snapshot, TokenRecord, TradePlan, WalletTrade } from "../../shared/types.js";

/** Linear scale of x from [lo,hi] to [0,100], clamped. */
export const scale = (x: number, lo: number, hi: number) => Math.max(0, Math.min(100, ((x - lo) / (hi - lo)) * 100));
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const src = (rec: TokenRecord, group: string) => rec.provenance[group]?.provider ?? "n/a";

interface Term { name: string; weight: number; value: number | undefined; lo: number; hi: number; invert?: boolean; source: string }

function weighted(key: Score["key"], label: string, terms: Term[], note?: string): Score {
  const avail = terms.filter((t) => t.value !== undefined && Number.isFinite(t.value));
  const wSum = avail.reduce((s, t) => s + t.weight, 0);
  const total = terms.reduce((s, t) => s + t.weight, 0);
  const inputs: ScoreInput[] = terms.map((t) => ({ name: t.name, value: t.value === undefined ? null : round(t.value, 4), source: t.source }));
  const formula = terms
    .map((t) => `${t.weight}×${t.invert ? "(100−" : ""}S(${t.name}, ${t.lo}..${t.hi})${t.invert ? ")" : ""}`)
    .join(" + ") + `  ÷ Σweights of available inputs;  S(x,lo,hi)=clamp((x−lo)/(hi−lo)×100, 0, 100)`;
  const coverage = total ? wSum / total : 0;
  if (!avail.length || coverage < 0.4) return { key, label, value: null, formula, inputs, coverage, note: "Insufficient data (coverage < 40%)" };
  const v = avail.reduce((s, t) => {
    const sc = scale(t.value!, t.lo, t.hi);
    return s + t.weight * (t.invert ? 100 - sc : sc);
  }, 0) / wSum;
  return { key, label, value: round(v, 1), formula, inputs, coverage: round(coverage, 2), note };
}

export function derive(rec: TokenRecord, history: Snapshot[], trades: WalletTrade[], cfg: AppConfig, now = Date.now()): DerivedAnalytics {
  const h1 = rec.txns.h1;
  const buyRatio1h = h1 && h1.buys + h1.sells > 0 ? h1.buys / (h1.buys + h1.sells) : undefined;
  const volAccel = rec.volume.m5 !== undefined && rec.volume.h1 ? (rec.volume.m5 * 12) / rec.volume.h1 : undefined;
  const avgBuyUsd5m = rec.buyVolume5m !== undefined && rec.txns.m5?.buys ? rec.buyVolume5m / rec.txns.m5.buys : undefined;
  const liqToMcap = rec.liquidityUsd && rec.marketCap ? rec.liquidityUsd / rec.marketCap : undefined;
  const ageMinutes = rec.createdAt ? Math.max(0, (now - rec.createdAt) / 60_000) : undefined;
  const prev = history.length >= 2 ? history[history.length - 2] : undefined;
  const last = history[history.length - 1];
  const liqChangePct = prev?.liquidityUsd && last?.liquidityUsd ? ((last.liquidityUsd - prev.liquidityUsd) / prev.liquidityUsd) * 100 : undefined;
  const first = history.find((s) => s.priceUsd);
  const priceChangeSinceFirstSeenPct = first?.priceUsd && rec.priceUsd ? ((rec.priceUsd - first.priceUsd) / first.priceUsd) * 100 : undefined;

  const momentum = weighted("momentum", "Momentum", [
    { name: "priceChange1h%", weight: 0.35, value: rec.priceChange.h1, lo: -50, hi: 100, source: src(rec, "priceChange") },
    { name: "priceChange5m%", weight: 0.25, value: rec.priceChange.m5, lo: -20, hi: 40, source: src(rec, "priceChange") },
    { name: "buyRatio1h", weight: 0.25, value: buyRatio1h, lo: 0.3, hi: 0.7, source: src(rec, "txns") },
    { name: "volAccel(5m×12/1h)", weight: 0.15, value: volAccel, lo: 0.5, hi: 3, source: src(rec, "volume") },
  ]);
  const liquidity = weighted("liquidity", "Liquidity", [
    { name: "log10(liquidityUSD)", weight: 0.6, value: rec.liquidityUsd ? Math.log10(rec.liquidityUsd) : undefined, lo: 3, hi: 6, source: src(rec, "market") },
    { name: "liquidity/mcap", weight: 0.4, value: liqToMcap, lo: 0.02, hi: 0.2, source: src(rec, "market") },
  ]);

  // Security: 100 minus explicit penalties; only known fields count; coverage reported.
  const s = rec.security;
  const checks: { name: string; known: boolean; penalty: number; value: ScoreInput["value"] }[] = [
    { name: "mintAuthorityRenounced", known: s.mintRenounced !== undefined, penalty: s.mintRenounced === false ? 30 : 0, value: s.mintRenounced ?? null },
    { name: "freezeAuthorityRenounced", known: s.freezeRenounced !== undefined, penalty: s.freezeRenounced === false ? 30 : 0, value: s.freezeRenounced ?? null },
    { name: "honeypot", known: s.honeypot !== undefined, penalty: s.honeypot ? 100 : 0, value: s.honeypot ?? null },
    { name: "rugRatio>0.3", known: s.rugRatio !== undefined, penalty: (s.rugRatio ?? 0) > 0.3 ? 30 : 0, value: s.rugRatio ?? null },
    { name: "bundlerRate>0.3", known: s.bundlerRate !== undefined, penalty: (s.bundlerRate ?? 0) > 0.3 ? 15 : 0, value: s.bundlerRate ?? null },
    { name: "washTrading", known: s.washTrading !== undefined, penalty: s.washTrading ? 20 : 0, value: s.washTrading ?? null },
    { name: "sellTax>10%", known: s.sellTax !== undefined, penalty: (s.sellTax ?? 0) > 0.1 ? 25 : 0, value: s.sellTax ?? null },
    { name: "jupiterSuspicious", known: s.flags !== undefined, penalty: s.flags?.includes("jupiter:suspicious") ? 25 : 0, value: s.flags?.join(",") ?? null },
  ];
  const known = checks.filter((c) => c.known);
  const secCoverage = known.length / checks.length;
  const secValue = known.length >= 2 ? Math.max(0, 100 - known.reduce((a, c) => a + c.penalty, 0)) : null;
  const security: Score = {
    key: "security", label: "Security (higher = safer)",
    value: secValue, coverage: round(secCoverage, 2),
    formula: "100 − Σpenalties: mint not renounced 30, freeze not renounced 30, honeypot 100, rugRatio>0.3 30, bundler>0.3 15, wash 20, sellTax>10% 25, Jupiter suspicious 25. Unknown checks are excluded (see coverage).",
    inputs: checks.map((c) => ({ name: c.name, value: c.value, source: c.known ? src(rec, "security") : "unknown" })),
    note: secValue === null ? "Fewer than 2 security fields available" : secCoverage < 0.5 ? "Low coverage: unknown checks are NOT treated as passing" : undefined,
  };
  const holderRisk = weighted("holderRisk", "Holder risk (higher = riskier)", [
    { name: "top10Holder%", weight: 0.6, value: rec.top10HolderPct, lo: 15, hi: 60, source: src(rec, "holders") },
    { name: "devHold%", weight: 0.2, value: rec.devHoldPct, lo: 0, hi: 20, source: src(rec, "holders") },
    { name: "bundlerRate%", weight: 0.2, value: s.bundlerRate !== undefined ? s.bundlerRate * 100 : undefined, lo: 0, hi: 50, source: src(rec, "security") },
  ]);

  const w = cfg.weights;
  const parts = [
    { v: momentum.value, w: w.momentum, n: "momentum" },
    { v: liquidity.value, w: w.liquidity, n: "liquidity" },
    { v: security.value, w: w.security, n: "security" },
    { v: holderRisk.value === null ? null : 100 - holderRisk.value, w: w.holderRisk, n: "(100−holderRisk)" },
  ];
  const ok = parts.filter((p) => p.v !== null);
  const wsum = ok.reduce((a, p) => a + p.w, 0);
  const composite: Score = {
    key: "composite", label: "Composite screen score",
    value: ok.length >= 3 && wsum > 0 ? round(ok.reduce((a, p) => a + p.w * (p.v as number), 0) / wsum, 1) : null,
    formula: parts.map((p) => `${p.w}×${p.n}`).join(" + ") + " ÷ Σweights (available components only; needs ≥3)",
    inputs: parts.map((p) => ({ name: p.n, value: p.v, source: "derived" })),
    coverage: round(ok.length / parts.length, 2),
    note: "Screening heuristic only — not a prediction, not advice.",
  };

  // Risk level from security + holder risk; unknown if both missing.
  let riskLevel: DerivedAnalytics["riskLevel"] = "unknown";
  if (s.honeypot) riskLevel = "extreme";
  else if (security.value !== null || holderRisk.value !== null) {
    const r = Math.max(security.value !== null ? 100 - security.value : 0, holderRisk.value ?? 0);
    riskLevel = r >= 70 ? "extreme" : r >= 45 ? "high" : r >= 25 ? "medium" : "low";
  }

  const anomalies = detectAnomalies(rec, { volAccel, liqChangePct, avgBuyUsd5m }, trades, cfg, now);
  return {
    ageMinutes: ageMinutes === undefined ? undefined : round(ageMinutes, 1),
    buyRatio1h: buyRatio1h === undefined ? undefined : round(buyRatio1h, 3),
    volAccel: volAccel === undefined ? undefined : round(volAccel, 2),
    avgBuyUsd5m: avgBuyUsd5m === undefined ? undefined : round(avgBuyUsd5m, 2),
    liqToMcap: liqToMcap === undefined ? undefined : round(liqToMcap, 4),
    liqChangePct: liqChangePct === undefined ? undefined : round(liqChangePct, 2),
    priceChangeSinceFirstSeenPct: priceChangeSinceFirstSeenPct === undefined ? undefined : round(priceChangeSinceFirstSeenPct, 2),
    scores: [composite, momentum, liquidity, security, holderRisk],
    anomalies,
    riskLevel,
    computedAt: now,
  };
}

export function detectAnomalies(
  rec: TokenRecord,
  d: { volAccel?: number; liqChangePct?: number; avgBuyUsd5m?: number },
  trades: WalletTrade[],
  cfg: AppConfig,
  now: number,
): Anomaly[] {
  const t = cfg.thresholds;
  const out: Anomaly[] = [];
  if (d.volAccel !== undefined && d.volAccel >= t.volumeSpikeRatio && (rec.volume.m5 ?? 0) > 1000)
    out.push({ type: "volume_spike", severity: d.volAccel >= t.volumeSpikeRatio * 2 ? "high" : "warn", message: `5m volume pace ${d.volAccel.toFixed(1)}× the 1h average`, value: d.volAccel, threshold: t.volumeSpikeRatio, at: now });
  if (d.liqChangePct !== undefined && d.liqChangePct <= -t.liquidityDropPct)
    out.push({ type: "liquidity_drop", severity: d.liqChangePct <= -2 * t.liquidityDropPct ? "high" : "warn", message: `Liquidity ${d.liqChangePct.toFixed(1)}% since previous scan`, value: d.liqChangePct, threshold: -t.liquidityDropPct, at: now });
  if (d.liqChangePct !== undefined && d.liqChangePct >= t.liquidityDropPct * 2)
    out.push({ type: "liquidity_add", severity: "info", message: `Liquidity +${d.liqChangePct.toFixed(1)}% since previous scan`, value: d.liqChangePct, threshold: t.liquidityDropPct * 2, at: now });
  const m5 = rec.priceChange.m5, h1 = rec.priceChange.h1;
  if (m5 !== undefined && h1 !== undefined && m5 > 2 && h1 > 0) {
    const ratio = m5 / Math.max(h1 / 12, 0.1);
    if (ratio >= t.momentumAccelRatio)
      out.push({ type: "momentum_accel", severity: "info", message: `5m move ${m5.toFixed(1)}% vs 1h pace ${(h1 / 12).toFixed(2)}%/5m`, value: ratio, threshold: t.momentumAccelRatio, at: now });
  }
  if (d.avgBuyUsd5m !== undefined && d.avgBuyUsd5m >= t.whaleAvgBuyUsd)
    out.push({ type: "whale_buy", severity: "warn", message: `Avg buy size $${d.avgBuyUsd5m.toFixed(0)} over last 5m (potential whale)`, value: d.avgBuyUsd5m, threshold: t.whaleAvgBuyUsd, at: now });
  for (const tr of trades) {
    if (tr.mint !== rec.mint || tr.amountUsd < t.whaleTradeUsd || now - tr.timestamp > 60 * 60_000) continue;
    out.push({ type: tr.side === "buy" ? "whale_buy" : "whale_sell", severity: "warn", message: `${tr.kind === "kol" ? "KOL" : "Smart money"} ${tr.side} $${tr.amountUsd.toFixed(0)} (${tr.walletName ?? tr.wallet.slice(0, 4) + "…"})`, value: tr.amountUsd, threshold: t.whaleTradeUsd, at: tr.timestamp });
  }
  const m5tx = rec.txns.m5;
  if (m5tx && m5tx.sells >= 20 && m5tx.sells > m5tx.buys * 2)
    out.push({ type: "sell_pressure", severity: "warn", message: `Sells ${m5tx.sells} vs buys ${m5tx.buys} in last 5m`, value: m5tx.sells / Math.max(1, m5tx.buys), threshold: 2, at: now });
  return out;
}

/** Average True Range over `period` candles. */
export function atr(candles: Candle[], period = 14): number | undefined {
  if (candles.length < period + 1) return undefined;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

const DISCLAIMER = "HYPOTHETICAL scenario computed mechanically from recent candles. Not a recommendation, not a prediction, not financial advice. Memecoins can go to zero; stops may not fill at the stated price.";

/** Mechanical, hypothetical levels. Returns available:false (with reason) whenever inputs are insufficient. */
export function tradePlan(candles: Candle[], timeframe: string, liquidityUsd: number | undefined, sizeUsd = 100, lookback = 20, atrPeriod = 14): TradePlan {
  const formulas = [
    `ATR(${atrPeriod}) = mean of last ${atrPeriod} true ranges; TR = max(H−L, |H−Cprev|, |L−Cprev|)`,
    `entryZone = [close − 0.5×ATR, close]`,
    `invalidation = lowest low of last ${lookback} candles (swing low)`,
    `stopLoss = invalidation − 0.25×ATR`,
    `R = entryMid − stopLoss;  TPk = entryMid + k×R for k ∈ {1.5, 3, 5}`,
    `slippage ≈ size / liquidity × 100% × 2 (rough constant-product impact estimate)`,
  ];
  const base: TradePlan = { available: false, hypothetical: true, formulas, disclaimer: DISCLAIMER };
  if (candles.length < Math.max(lookback, atrPeriod + 1)) return { ...base, reason: `Need ≥ ${Math.max(lookback, atrPeriod + 1)} candles, have ${candles.length}` };
  if (!liquidityUsd || liquidityUsd <= 0) return { ...base, reason: "Liquidity unknown — cannot assess executability" };
  const a = atr(candles, atrPeriod);
  if (!a || a <= 0) return { ...base, reason: "ATR could not be computed" };
  const last = candles[candles.length - 1];
  const swingLow = Math.min(...candles.slice(-lookback).map((c) => c.low));
  const entryZone: [number, number] = [last.close - 0.5 * a, last.close];
  const entryMid = (entryZone[0] + entryZone[1]) / 2;
  const stopLoss = swingLow - 0.25 * a;
  const R = entryMid - stopLoss;
  if (!(R > 0) || stopLoss <= 0) return { ...base, reason: "Price is at/below the recent swing low; no valid invalidation level" };
  const ks = [1.5, 3, 5];
  return {
    available: true,
    hypothetical: true,
    basis: { lastClose: last.close, atr: a, atrPeriod, swingLow, lookback, candles: candles.length, timeframe },
    entryZone,
    invalidation: swingLow,
    stopLoss,
    takeProfits: ks.map((k) => ({ label: `TP ${k}R`, price: entryMid + k * R, rMultiple: k })),
    riskPerUnit: R,
    rewardRisk: ks.map((k) => ({ label: `TP ${k}R`, ratio: k })),
    slippageEstimatePct: round((sizeUsd / liquidityUsd) * 100 * 2, 3),
    formulas,
    disclaimer: DISCLAIMER,
  };
}
