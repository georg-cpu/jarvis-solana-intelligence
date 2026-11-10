# JARVIS Solana Intelligence

Local, **read-only** Solana memecoin intelligence dashboard. Separate from every other JARVIS project.

> **No trading.** This codebase contains no wallet, signing, swap, order or transaction code. Paper trading is virtual and isolated. Nothing here is financial advice.

## Run

```bash
npm install
npm run dev          # API http://127.0.0.1:8787 + dashboard http://127.0.0.1:5173
npm run demo         # same, starting in DEMO DATA mode (synthetic fixtures)
npm test             # 32 unit tests (queue/429, scoring, merge, trade plan, paper broker, GMGN allow-list)
```

Open **http://127.0.0.1:5173**. Both servers bind to 127.0.0.1 only.

## Data sources (all keyless, read-only GET / read-only CLI)

| Provider | Used for | Applied pacing | Documented limit |
|---|---|---|---|
| GMGN official `gmgn-cli` + **public demo key** | trending, trenches (new launches), smart money, KOL, token security, top holders, kline fallback | 1 call / 9 s, concurrency 1, polls every 5–7 min | Free 5/5 leaky bucket; demo key is per-IP and testing-only |
| DexScreener API | latest profiles/boosts, pair market data, search | 1 / 1.5 s | 60 req/min for profiles/boosts |
| Jupiter Tokens v2 + Price v3 (lite-api) | recent launches, trending, verification, organic score, audit | 1 / 3 s + honours `x-ratelimit-*` | Keyless 0.5 RPS / 30 RPM |
| GeckoTerminal API v2 | new / trending pools across Solana DEXes, OHLCV candles | 1 / 10 s | Not documented (keep low). Data by GeckoTerminal |

GMGN safety: commands pass a hard allow-list (`market trending|trenches|kline`, `token info|security|holders|traders|pool`, `track kol|smartmoney`, `portfolio stats|activity|profits|created-tokens`). `swap`, `order`, `cooking`, `config`, `holdings`, `follow-wallet` are rejected. The CLI runs with `GMGN_PRIVATE_KEY=""` and `HOME/USERPROFILE` pointed at an empty folder (`data/gmgn-isolated-home`) so it cannot read `~/.config/gmgn/.env` or any key pair.

## Coverage — honest limits

- **Polling only.** No official free WebSocket is used; the dashboard's live updates are a local Server-Sent-Events push of *polled* data.
- **Pump.fun:** no documented public read API reachable → covered indirectly (GMGN trenches, Jupiter launchpad field, GeckoTerminal `pump-fun` pools). Not scraped.
- **Raydium / Meteora / Orca / PumpSwap:** partial, via DexScreener and GeckoTerminal pair data.
- **Not a complete index** of Solana tokens or DEXes — only what these providers surface.
- GMGN demo key: 1-second candles are Pro-only (shown as unavailable), callout/follow features unavailable, frequent use may trigger per-IP cooldowns (handled automatically).

## Rate-limit behaviour

Every outbound call goes through a per-provider `ProviderQueue`: minimum spacing, concurrency 1, response cache, in-flight de-duplication, HTTP 429 → cooldown from `Retry-After` / `X-RateLimit-Reset` / GMGN's reset message (no retries during cooldown, stale cache served instead), exponential backoff on errors, circuit breaker after repeated failures, and 4xx not-found errors never trigger backoff. Feeds skip their tick while a provider is cooling down. Interval minimums are enforced server-side even if you lower them in the UI.

## Signal engine

All scores are 0–100 with the exact formula, inputs, source and coverage shown in the token view. Missing inputs are reported, never invented; a score needs ≥40 % input coverage. Hypothetical entry/stop/TP levels are only computed with ≥20 candles and known liquidity (ATR-based, formulas displayed). Configure weights and anomaly thresholds in the dashboard.

## Local state

`data/` (git-ignored): `config.json`, `watchlist.json`, `alerts.json`, `paper.json`, and the empty GMGN isolated home. No secrets are stored.
