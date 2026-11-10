// Centralized per-provider request queue: pacing, concurrency, caching, 429 cooldowns,
// exponential backoff and a circuit breaker. Every outbound call goes through one of these.
import type { ProviderHealth, ProviderId, ProviderState } from "../../shared/types.js";

export class RateLimitError extends Error {
  constructor(message: string, public retryAfterMs: number, public code = "RATE_LIMITED") {
    super(message);
  }
}
export class CooldownError extends Error {
  constructor(public provider: ProviderId, public until: number, public reason: string) {
    super(`${provider} cooling down until ${new Date(until).toISOString()} (${reason})`);
  }
}
export class PlanRestrictedError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export interface QueueOptions {
  id: ProviderId;
  label: string;
  minIntervalMs: number; // minimum spacing between request starts
  maxConcurrent: number;
  documentedLimit: string;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  circuitThreshold?: number; // consecutive failures before "down"
  circuitOpenMs?: number;
  maxQueue?: number;
  now?: () => number;
  note?: string;
}

interface CacheEntry { data: unknown; expires: number; storedAt: number }
interface Job { run: () => Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void }

export interface CachedResult<T> { data: T; fromCache: boolean; stale: boolean; storedAt: number }

export class ProviderQueue {
  private queue: Job[] = [];
  private inFlight = 0;
  private lastStart = 0;
  private timer: NodeJS.Timeout | null = null;
  private cache = new Map<string, CacheEntry>();
  private pending = new Map<string, Promise<unknown>>();
  private stats = { requests: 0, successes: 0, errors: 0, rateLimited: 0, cacheHits: 0 };
  private consecutiveFailures = 0;
  private cooldownUntil = 0;
  private cooldownReason = "";
  private lastLatencyMs?: number;
  private lastSuccessAt?: number;
  private lastErrorAt?: number;
  private lastError?: string;
  public disabled = false;
  public disabledReason = "";
  private readonly now: () => number;

  constructor(public readonly opts: QueueOptions) {
    this.now = opts.now ?? Date.now;
  }

  get id() { return this.opts.id; }

  isCoolingDown(): boolean { return this.now() < this.cooldownUntil; }
  getCooldownUntil(): number { return this.cooldownUntil; }

  /** Fetch through cache + queue. On cooldown, returns stale cache if present, otherwise throws CooldownError (never retries during cooldown). */
  async request<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<CachedResult<T>> {
    const t = this.now();
    const hit = this.cache.get(key);
    if (hit && hit.expires > t) {
      this.stats.cacheHits++;
      return { data: hit.data as T, fromCache: true, stale: false, storedAt: hit.storedAt };
    }
    if (this.disabled) {
      if (hit) return { data: hit.data as T, fromCache: true, stale: true, storedAt: hit.storedAt };
      throw new CooldownError(this.id, Number.MAX_SAFE_INTEGER, this.disabledReason || "disabled");
    }
    if (this.isCoolingDown()) {
      if (hit) return { data: hit.data as T, fromCache: true, stale: true, storedAt: hit.storedAt };
      throw new CooldownError(this.id, this.cooldownUntil, this.cooldownReason);
    }
    const existing = this.pending.get(key);
    if (existing) return existing as Promise<CachedResult<T>>;

    const p = this.enqueue(fn)
      .then((data) => {
        const storedAt = this.now();
        this.cache.set(key, { data, expires: storedAt + ttlMs, storedAt });
        if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value as string);
        return { data, fromCache: false, stale: false, storedAt } as CachedResult<T>;
      })
      .catch((err) => {
        if (hit && (err instanceof CooldownError || err instanceof RateLimitError)) {
          return { data: hit.data as T, fromCache: true, stale: true, storedAt: hit.storedAt };
        }
        throw err;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, p);
    return p;
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    if (this.queue.length >= (this.opts.maxQueue ?? 50)) {
      return Promise.reject(new Error(`${this.id} queue full; request dropped to protect rate limit`));
    }
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ run: fn, resolve: resolve as (v: unknown) => void, reject });
      this.pump();
    });
  }

  private pump() {
    if (this.timer) return;
    if (!this.queue.length || this.inFlight >= this.opts.maxConcurrent) return;
    if (this.isCoolingDown()) {
      // fail queued jobs fast instead of holding them through a cooldown
      const until = this.cooldownUntil;
      for (const job of this.queue.splice(0)) job.reject(new CooldownError(this.id, until, this.cooldownReason));
      return;
    }
    const wait = Math.max(0, this.lastStart + this.opts.minIntervalMs - this.now());
    if (wait > 0) {
      this.timer = setTimeout(() => { this.timer = null; this.pump(); }, wait);
      return;
    }
    const job = this.queue.shift()!;
    this.inFlight++;
    this.lastStart = this.now();
    this.stats.requests++;
    const started = this.now();
    job.run()
      .then((v) => {
        this.lastLatencyMs = this.now() - started;
        this.onSuccess();
        job.resolve(v);
      })
      .catch((e) => {
        this.lastLatencyMs = this.now() - started;
        this.onFailure(e);
        job.reject(e);
      })
      .finally(() => {
        this.inFlight--;
        this.pump();
      });
    this.pump();
  }

  private onSuccess() {
    this.stats.successes++;
    this.consecutiveFailures = 0;
    this.lastSuccessAt = this.now();
  }

  private onFailure(e: unknown) {
    this.lastErrorAt = this.now();
    this.lastError = e instanceof Error ? e.message.slice(0, 300) : String(e);
    if (e instanceof PlanRestrictedError) {
      // permanent for this plan; not a provider fault, never retried, no ban risk
      this.stats.errors++;
      return;
    }
    const status = (e as { status?: number }).status;
    if (typeof status === "number" && status >= 400 && status < 500) {
      // client-side / not-found (e.g. pool unknown to provider): not a provider outage, no backoff
      this.stats.errors++;
      return;
    }
    if (e instanceof RateLimitError) {
      this.stats.rateLimited++;
      this.setCooldown(Math.max(e.retryAfterMs, 1000), `HTTP 429 ${e.code}`);
      return;
    }
    this.stats.errors++;
    this.consecutiveFailures++;
    const threshold = this.opts.circuitThreshold ?? 4;
    if (this.consecutiveFailures >= threshold) {
      this.setCooldown(this.opts.circuitOpenMs ?? 5 * 60_000, `circuit open after ${this.consecutiveFailures} consecutive failures`);
    } else {
      const base = this.opts.baseBackoffMs ?? 5_000;
      const max = this.opts.maxBackoffMs ?? 120_000;
      const backoff = Math.min(max, base * 2 ** (this.consecutiveFailures - 1));
      this.setCooldown(backoff, `exponential backoff #${this.consecutiveFailures}`);
    }
  }

  setCooldown(ms: number, reason: string) {
    const until = this.now() + ms;
    if (until > this.cooldownUntil) {
      this.cooldownUntil = until;
      this.cooldownReason = reason;
    }
  }

  clearCache() { this.cache.clear(); }

  health(): ProviderHealth {
    let state: ProviderState = "idle";
    if (this.disabled) state = "disabled";
    else if (this.isCoolingDown()) state = this.cooldownReason.startsWith("circuit") ? "down" : "cooldown";
    else if (this.consecutiveFailures > 0) state = "degraded";
    else if (this.stats.successes > 0) state = "ok";
    return {
      id: this.id,
      label: this.opts.label,
      state,
      documentedLimit: this.opts.documentedLimit,
      appliedLimit: `max 1 request / ${(this.opts.minIntervalMs / 1000).toFixed(1)}s, concurrency ${this.opts.maxConcurrent}`,
      ...this.stats,
      inFlight: this.inFlight,
      queued: this.queue.length,
      lastLatencyMs: this.lastLatencyMs,
      lastSuccessAt: this.lastSuccessAt,
      lastErrorAt: this.lastErrorAt,
      lastError: this.disabled ? this.disabledReason : this.lastError,
      cooldownUntil: this.isCoolingDown() ? this.cooldownUntil : undefined,
      consecutiveFailures: this.consecutiveFailures,
      streaming: false,
      note: this.isCoolingDown() ? `${this.cooldownReason}` : this.opts.note,
    };
  }
}

/** Parse Retry-After (seconds or HTTP date) and X-RateLimit-Reset (unix seconds) into a wait in ms. */
export function retryAfterFromHeaders(headers: Headers, now = Date.now(), fallbackMs = 60_000): number {
  const ra = headers.get("retry-after");
  if (ra) {
    const secs = Number(ra);
    if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
    const date = Date.parse(ra);
    if (Number.isFinite(date)) return Math.max(0, date - now);
  }
  const reset = headers.get("x-ratelimit-reset");
  if (reset) {
    const n = Number(reset);
    if (Number.isFinite(n)) {
      const ms = n > 1e12 ? n : n * 1000;
      return Math.max(1000, ms - now);
    }
  }
  return fallbackMs;
}
