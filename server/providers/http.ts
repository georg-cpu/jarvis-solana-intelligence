import { RateLimitError, retryAfterFromHeaders } from "../queue/ProviderQueue.js";

export const USER_AGENT = "jarvis-solana-intelligence/0.1 (local read-only dashboard)";

export class HttpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** GET JSON with timeout. Maps HTTP 429 to RateLimitError carrying the documented reset wait. Read-only: GET only. */
export async function getJson<T>(url: string, opts: { timeoutMs?: number; fallbackRetryMs?: number; headers?: Record<string, string> } = {}): Promise<{ data: T; headers: Headers }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json", "user-agent": USER_AGENT, ...(opts.headers ?? {}) },
      signal: ctrl.signal,
    });
    if (res.status === 429) {
      throw new RateLimitError(`HTTP 429 from ${new URL(url).host}`, retryAfterFromHeaders(res.headers, Date.now(), opts.fallbackRetryMs ?? 60_000));
    }
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 200);
      throw new HttpError(`HTTP ${res.status} from ${new URL(url).host}${body ? `: ${body}` : ""}`, res.status);
    }
    const data = (await res.json()) as T;
    return { data, headers: res.headers };
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error(`timeout fetching ${new URL(url).host}`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export const num = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export const SOLANA_MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const isMint = (s: string) => SOLANA_MINT_RE.test(s);
