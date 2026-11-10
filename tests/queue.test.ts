import { describe, expect, it } from "vitest";
import { CooldownError, PlanRestrictedError, ProviderQueue, RateLimitError, retryAfterFromHeaders } from "../server/queue/ProviderQueue.js";

const mk = (over: Partial<ConstructorParameters<typeof ProviderQueue>[0]> = {}) =>
  new ProviderQueue({ id: "dexscreener", label: "t", minIntervalMs: 0, maxConcurrent: 1, documentedLimit: "", baseBackoffMs: 1000, ...over });

describe("ProviderQueue", () => {
  it("caches responses within TTL", async () => {
    const q = mk();
    let calls = 0;
    const fn = async () => ++calls;
    await q.request("k", 10_000, fn);
    const r = await q.request("k", 10_000, fn);
    expect(calls).toBe(1);
    expect(r.fromCache).toBe(true);
    expect(q.health().cacheHits).toBe(1);
  });

  it("dedupes concurrent identical requests", async () => {
    const q = mk();
    let calls = 0;
    const fn = () => new Promise<number>((res) => setTimeout(() => res(++calls), 10));
    await Promise.all([q.request("a", 1000, fn), q.request("a", 1000, fn), q.request("a", 1000, fn)]);
    expect(calls).toBe(1);
  });

  it("enters cooldown on 429 and never calls the provider during cooldown", async () => {
    const q = mk();
    let calls = 0;
    await expect(q.request("x", 0, async () => { calls++; throw new RateLimitError("429", 60_000); })).rejects.toBeInstanceOf(RateLimitError);
    expect(q.isCoolingDown()).toBe(true);
    await expect(q.request("y", 0, async () => { calls++; return 1; })).rejects.toBeInstanceOf(CooldownError);
    expect(calls).toBe(1);
    expect(q.health().state).toBe("cooldown");
    expect(q.health().rateLimited).toBe(1);
  });

  it("serves stale cache during cooldown instead of failing", async () => {
    let t = 0;
    const q = mk({ now: () => t });
    await q.request("s", 100, async () => "v1");
    t = 1000; // cache expired
    q.setCooldown(60_000, "test");
    const r = await q.request("s", 100, async () => "v2");
    expect(r.data).toBe("v1");
    expect(r.stale).toBe(true);
  });

  it("applies exponential backoff and opens the circuit after repeated failures", async () => {
    let t = 0;
    const q = mk({ now: () => t, circuitThreshold: 3, circuitOpenMs: 300_000 });
    const fail = async () => { throw new Error("boom"); };
    await expect(q.request("1", 0, fail)).rejects.toThrow("boom");
    expect(q.getCooldownUntil()).toBe(1000);
    t = 2000;
    await expect(q.request("2", 0, fail)).rejects.toThrow("boom");
    expect(q.getCooldownUntil()).toBe(4000); // 2000 + 1000*2^1
    t = 5000;
    await expect(q.request("3", 0, fail)).rejects.toThrow("boom");
    expect(q.health().state).toBe("down");
    expect(q.getCooldownUntil()).toBe(305_000);
  });

  it("does not cooldown or ban on plan restrictions", async () => {
    const q = mk();
    await expect(q.request("p", 0, async () => { throw new PlanRestrictedError("pro only"); })).rejects.toBeInstanceOf(PlanRestrictedError);
    expect(q.isCoolingDown()).toBe(false);
  });

  it("does not back off on 4xx not-found errors", async () => {
    const q = mk();
    const err = Object.assign(new Error("HTTP 404"), { status: 404 });
    await expect(q.request("nf", 0, async () => { throw err; })).rejects.toThrow("404");
    expect(q.isCoolingDown()).toBe(false);
    expect(q.health().consecutiveFailures).toBe(0);
  });

  it("spaces request starts by minIntervalMs", async () => {
    const q = mk({ minIntervalMs: 50 });
    const starts: number[] = [];
    await Promise.all([1, 2, 3].map((i) => q.request(`k${i}`, 0, async () => { starts.push(Date.now()); return i; })));
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(45);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(45);
  });
});

describe("retryAfterFromHeaders", () => {
  it("parses Retry-After seconds", () => {
    expect(retryAfterFromHeaders(new Headers({ "retry-after": "12" }), 0)).toBe(12_000);
  });
  it("parses X-RateLimit-Reset unix seconds", () => {
    expect(retryAfterFromHeaders(new Headers({ "x-ratelimit-reset": "100" }), 40_000)).toBe(60_000);
  });
  it("falls back when no headers", () => {
    expect(retryAfterFromHeaders(new Headers(), 0, 30_000)).toBe(30_000);
  });
});
