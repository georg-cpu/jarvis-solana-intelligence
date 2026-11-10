import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_PAPER, PaperBroker, PaperError } from "../server/paper/PaperBroker.js";
import { assertAllowed, classifyGmgnError } from "../server/providers/gmgn.js";
import { PlanRestrictedError, RateLimitError } from "../server/queue/ProviderQueue.js";

const fresh = () => new PaperBroker(structuredClone(DEFAULT_PAPER));
const q = { priceUsd: 1, liquidityUsd: 100_000, source: "test", ageSec: 1, symbol: "T" };
const MINT = "So11111111111111111111111111111111111111112";

describe("PaperBroker (virtual only)", () => {
  it("applies fees and slippage on buy", () => {
    const b = fresh();
    const t = b.buy(MINT, 1000, q);
    // slippage = 0.5% base + 2 × 1000/100000 × 100 = 2.5%
    expect(t.slippagePct).toBeCloseTo(2.5);
    expect(t.fillPriceUsd).toBeCloseTo(1.025);
    expect(t.feeUsd).toBeCloseTo(10);
    expect(b.state.cashUsd).toBeCloseTo(10_000 - 1010);
  });

  it("realizes P&L including fees on sell", () => {
    const b = fresh();
    b.buy(MINT, 1000, q);
    const t = b.sell(MINT, 1, { ...q, priceUsd: 2 });
    expect(t.realizedPnlUsd).toBeGreaterThan(0);
    expect(b.state.positions).toHaveLength(0);
    expect(b.state.journal).toHaveLength(2);
  });

  it("refuses stale prices, missing liquidity and insufficient cash", () => {
    const b = fresh();
    expect(() => b.buy(MINT, 100, { ...q, ageSec: 9999 })).toThrow(PaperError);
    expect(() => b.buy(MINT, 100, { ...q, liquidityUsd: undefined })).toThrow(/Liquidity unknown/);
    expect(() => b.buy(MINT, 1e9, q)).toThrow(/Insufficient/);
  });

  it("paper module contains no network, wallet, signing or provider imports", () => {
    const src = fs.readFileSync(path.resolve("server/paper/PaperBroker.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["'][^"']*(providers|gmgn|fetch|http|child_process|web3|@solana)/);
    expect(src).not.toMatch(/\bfetch\(/);
  });
});

describe("GMGN safety allow-list", () => {
  it("allows read-only commands", () => {
    expect(() => assertAllowed(["market", "trending", "--chain", "sol"])).not.toThrow();
    expect(() => assertAllowed(["token", "security", "--chain", "sol", "--address", MINT])).not.toThrow();
  });
  it("blocks every trading / signing / config command", () => {
    for (const bad of [["swap"], ["multi-swap"], ["order", "quote"], ["order", "strategy"], ["cooking", "create"], ["portfolio", "holdings"], ["track", "follow-wallet"], ["config"], ["market", "trending", "--x", "swap"]]) {
      expect(() => assertAllowed(bad)).toThrow();
    }
  });
  it("rejects shell metacharacters in arguments", () => {
    expect(() => assertAllowed(["token", "info", "--address", "abc;rm -rf"])).toThrow();
    expect(() => assertAllowed(["token", "info", "--address", "$(whoami)"])).toThrow();
  });
  it("classifies 429 with reset seconds and plan restrictions", () => {
    const e = classifyGmgnError("[gmgn-cli] GET /v1/market/rank failed: HTTP 429 code=429 error=RATE_LIMIT_EXCEEDED message=IP rate limit exceeded. Rate limit resets at x (~30s remaining).");
    expect(e).toBeInstanceOf(RateLimitError);
    expect((e as RateLimitError).retryAfterMs).toBe(32_000);
    expect(classifyGmgnError("HTTP 403 code=403 error=PRO_PLAN_REQUIRED")).toBeInstanceOf(PlanRestrictedError);
    expect((classifyGmgnError("HTTP 429 code=429 error=RATE_LIMIT_BANNED_MAX") as RateLimitError).retryAfterMs).toBe(300_000);
  });
  it("codebase never passes a private key to the CLI", () => {
    const src = fs.readFileSync(path.resolve("server/providers/gmgn.ts"), "utf8");
    expect(src).toMatch(/GMGN_PRIVATE_KEY:\s*""/);
    expect(src).toMatch(/USERPROFILE:\s*isolatedHome/);
  });
});
