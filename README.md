# JARVIS Solana Intelligence

Local, paper-only market research terminal. Node serves the React production build and the JSON API on loopback. No account or API key is required for the default market feeds.

## Free download

[Download JARVIS as a ZIP](https://github.com/georg-cpu/jarvis-solana-intelligence/archive/refs/heads/main.zip). Extract the archive, then open PowerShell in the extracted folder containing package.json.

## Buy me a coffee with SOL

JARVIS is free to download and use. Optional tips are welcome in native SOL on Solana mainnet. Copy this public receiving address into your own wallet:

`CYmGyR3E2rEheJiG48t9LNPjCU9dxGG6sBeUh9mJB9Fy`

## Windows startup

Install Node.js 24 LTS with npm. From the extracted folder run:

```powershell
npm.cmd ci --ignore-scripts --no-fund
npm.cmd run build
npm.cmd start
```

Open **http://127.0.0.1:4317**. Stop the foreground server with Ctrl+C. To choose another port, run `$env:PORT='4318'` before starting. The first market poll runs at startup. Each completed cycle is followed by a sixty-second delay. The browser reads cached state every fifteen seconds. Use Node and npm on Linux with the same scripts and the appropriate checkout path. Development uses the default backend port with `npm run dev` in a second shell.

## Operating the terminal

- Select a pool to see its mint, venue, source, local observation time, sampled candles, signal and virtual fill controls. Filters operate on locally observed pools. **Search providers** performs a separate remote query.
- Inspect a public address in Wallet watchlist to start bounded monitoring. The background worker rotates through one watched wallet per market cycle. Timeline entries link to finalized transactions. The large transfer view filters deduplicated evidence by the selected USD threshold.
- Arbitrage Hunter filters fresh same-mint pool marks by liquidity, time alignment and gross spread. A quote can be simulated only after matching both exact pools. Settings control notional, slippage and assumed costs. The paper quote journal shares the portfolio cash ledger.
- Token security uses parsed mint accounts and largest token-account balances. The distribution heuristic looks for at least three recipients from a single sender in one finalized slot within an hour of the first reported pool, using local watched-wallet evidence. Its confidence is low. Unknown first-pool times or unsampled transfers leave coverage incomplete.
- Paper trading starts with 10,000 virtual USD. Session data is in `data/terminal.sqlite`. Purchases debit notional plus fees. Sales credit notional less fees. Simulated fill prices apply adverse slippage to the pool mark. Fees model 0.30% plus configured network and priority costs. Single fills are capped at 1% of reported pool liquidity. Realized P&L uses weighted average cost basis. Trade history is available from the portfolio and `/api/export`.

## Research definitions

A fresh observation has a local receipt time within two minutes. Paired pool receipts must be within 45 seconds. Provider-side latency can be longer. Market history and candidate observations are retained for seven days, with bounded recent windows sent to the browser. Candle bars summarize sampled prices by five-minute bucket. Unobserved intervals are omitted. The current bucket is incomplete.

The signal engine compares the latest observation with earlier observations of the same pool in the preceding hour. Imbalance is (24h buys − 24h sells) / (24h buys + 24h sells). Fresh pools below the configured minimum liquidity receive HIGH RISK. Three previous samples, sufficient liquidity, positive price movement and imbalance above the configured threshold produce BUY WATCH. The symmetric negative condition produces SELL WATCH. Other observations produce WAIT. Price momentum, liquidity change and rolling 24h volume change are percentage changes from the previous sample. Volume acceleration compares successive rates of change in rolling volume, in USD per minute squared. Volatility is the population standard deviation of sampled log returns, without annualization. A long scenario uses the current observation as entry, the sample low as invalidation and twice the difference as the target. These are hypothetical rules and sampled historical inputs.

## Verification and coverage

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

Tests use synthetic, explicitly offline inputs, mocked provider responses and an in-memory SQLite database. The HTTP integration test requires local loopback access. Runtime ingestion never loads fixtures. The production server uses built-in Node HTTP, fetch, crypto and SQLite. The dependency lock pins the React/Tailwind/Vite toolchain. Installation disables package lifecycle scripts. React, React DOM, Vite and Tailwind are MIT licensed, TypeScript is Apache-2.0 and Biome is MIT or Apache-2.0. Installed dependencies retain their individual license files.

See [provider audit](PROVIDERS.md) for API access, quotas, licenses, optional GMGN configuration and observed live results. See [on-chain coverage](CHAIN.md) for transfer evidence, valuation, mint checks and sampling limitations. Supported sources do not establish complete mint-launch, migration or bonding-curve histories, complete wallet P&L, chain-wide whale coverage, common ownership, or guaranteed executable profits. Direct finalized Pump.fun and PumpSwap instructions cover sampled buys, sells, pool creation, migration calls, deposits and withdrawals. Other venues and routed inner instructions remain outside this decoder. The default application never signs or submits a transaction.

## License

The application code is available under the [MIT License](LICENSE). Third-party dependencies and provider data retain their respective licenses and terms.
