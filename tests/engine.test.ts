import { describe, expect, it } from "vitest";
import type { Candle, TokenRecord } from "../shared/types.js";
import { DEFAULT_CONFIG } from "../server/config.js";
import { emptyRecord, mergePartial } from "../server/scanner/merge.js";
import { prov } from "../server/providers/partial.js";
import { atr, derive, scale, tradePlan } from "../server/signals/engine.js";

const MINT = "So11111111111111111111111111111111111111112";

function rec(over: Partial<TokenRecord> = {}): TokenRecord {
  return { ...emptyRecord(MINT, 0), symbol: "T", name: "T", provenance: { market: prov("dexscreener", "x", 0) }, ...over };
}

describe("scale", () => {
  it("clamps to 0..100", () => {
    expect(scale(-10, 0, 10)).toBe(0);
    expect(scale(5, 0, 10)).toBe(50);
    expect(scale(99, 0, 10)).toBe(100);
  });
});

describe("derive", () => {
  it("returns null scores with explicit note when data is missing (never invents)", () => {
    const d = derive(rec(), [], [], DEFAULT_CONFIG, 1000);
    for (const s of d.scores) expect(s.value).toBeNull();
    expect(d.riskLevel).toBe("unknown");
  });

  it("computes momentum from documented formula and lists inputs", () => {
    const r = rec({ priceChange: { h1: 25, m5: 10 }, txns: { h1: { buys: 60, sells: 40 } }, volume: { m5: 1000, h1: 6000 } });
    const m = derive(r, [], [], DEFAULT_CONFIG, 0).scores.find((s) => s.key === "momentum")!;
    // S(25,-50,100)=50, S(10,-20,40)=50, S(0.6,0.3,0.7)=75, S(2,0.5,3)=60
    const expected = (0.35 * 50 + 0.25 * 50 + 0.25 * 75 + 0.15 * 60) / 1;
    expect(m.value).toBeCloseTo(expected, 1);
    expect(m.inputs.map((i) => i.name)).toContain("buyRatio1h");
    expect(m.coverage).toBe(1);
  });

  it("security score penalises honeypot to 0 and marks risk extreme", () => {
    const r = rec({ security: { honeypot: true, mintRenounced: true, freezeRenounced: true } });
    const d = derive(r, [], [], DEFAULT_CONFIG, 0);
    expect(d.scores.find((s) => s.key === "security")!.value).toBe(0);
    expect(d.riskLevel).toBe("extreme");
  });

  it("does not treat unknown security checks as passing (coverage reported)", () => {
    const r = rec({ security: { mintRenounced: true, freezeRenounced: true } });
    const s = derive(r, [], [], DEFAULT_CONFIG, 0).scores.find((x) => x.key === "security")!;
    expect(s.value).toBe(100);
    expect(s.coverage).toBeLessThan(0.5);
    expect(s.note).toMatch(/NOT treated as passing/);
  });

  it("detects volume spike and liquidity drop anomalies", () => {
    const r = rec({ volume: { m5: 5000, h1: 6000 }, liquidityUsd: 7000 });
    const hist = [{ t: 0, liquidityUsd: 10_000 }, { t: 1, liquidityUsd: 7000 }];
    const d = derive(r, hist, [], DEFAULT_CONFIG, 2);
    expect(d.anomalies.map((a) => a.type)).toEqual(expect.arrayContaining(["volume_spike", "liquidity_drop"]));
  });
});

describe("merge", () => {
  it("dedupes by mint and keeps provenance per field group", () => {
    const r = emptyRecord(MINT, 0);
    mergePartial(r, { mint: MINT, symbol: "A", priceUsd: 1, liquidityUsd: 100, provenance: prov("jupiter", "/recent", 10), category: "new" });
    mergePartial(r, { mint: MINT, priceUsd: 2, liquidityUsd: 200, provenance: prov("dexscreener", "/tokens", 11), category: "profile" });
    mergePartial(r, { mint: MINT, priceUsd: 3, liquidityUsd: 300, provenance: prov("jupiter", "/recent", 12) });
    expect(r.priceUsd).toBe(2); // dexscreener has higher priority for market data and is fresh
    expect(r.provenance.market.provider).toBe("dexscreener");
    expect(r.sources).toEqual(["jupiter", "dexscreener"]);
    expect(r.categories).toEqual(["new", "profile"]);
  });

  it("accepts lower-priority data when the preferred source is stale", () => {
    const r = emptyRecord(MINT, 0);
    mergePartial(r, { mint: MINT, priceUsd: 2, provenance: prov("dexscreener", "/tokens", 0) });
    mergePartial(r, { mint: MINT, priceUsd: 5, provenance: prov("jupiter", "/recent", 400_000) }, 180_000);
    expect(r.priceUsd).toBe(5);
  });

  it("never clears a honeypot flag reported by any source", () => {
    const r = emptyRecord(MINT, 0);
    mergePartial(r, { mint: MINT, security: { honeypot: true }, provenance: prov("jupiter", "x", 0) });
    mergePartial(r, { mint: MINT, security: { honeypot: false }, provenance: prov("gmgn", "x", 1) });
    expect(r.security.honeypot).toBe(true);
  });
});

describe("tradePlan", () => {
  const candles = (n: number): Candle[] => Array.from({ length: n }, (_, i) => ({ time: i, open: 1 + i * 0.01, high: 1.05 + i * 0.01, low: 0.95 + i * 0.01, close: 1 + i * 0.01, volume: 10 }));

  it("refuses when there are too few candles", () => {
    const p = tradePlan(candles(5), "5m", 10_000);
    expect(p.available).toBe(false);
    expect(p.reason).toMatch(/Need/);
  });

  it("refuses when liquidity is unknown", () => {
    expect(tradePlan(candles(30), "5m", undefined).available).toBe(false);
  });

  it("computes levels from the documented formulas", () => {
    const c = candles(30);
    const p = tradePlan(c, "5m", 50_000, 100);
    expect(p.available).toBe(true);
    const a = atr(c, 14)!;
    const last = c[c.length - 1].close;
    expect(p.entryZone![1]).toBeCloseTo(last);
    expect(p.entryZone![0]).toBeCloseTo(last - 0.5 * a);
    const swing = Math.min(...c.slice(-20).map((x) => x.low));
    expect(p.stopLoss).toBeCloseTo(swing - 0.25 * a);
    const mid = (p.entryZone![0] + p.entryZone![1]) / 2;
    expect(p.takeProfits![1].price).toBeCloseTo(mid + 3 * (mid - p.stopLoss!));
    expect(p.hypothetical).toBe(true);
    expect(p.disclaimer).toMatch(/HYPOTHETICAL/);
  });
});
