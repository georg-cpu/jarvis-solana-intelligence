// Normalized data model shared by server and dashboard.
// RAW fields come straight from a provider (with provenance). DERIVED fields are computed locally.

export type ProviderId = "gmgn" | "dexscreener" | "jupiter" | "geckoterminal" | "demo";
export type Category = "new" | "trending" | "boosted" | "profile" | "search" | "watch" | "smart" | "kol";

export interface Provenance {
  provider: ProviderId;
  endpoint: string;
  fetchedAt: number; // ms epoch
}

export interface TxCount { buys: number; sells: number }

export interface TokenSecurity {
  mintRenounced?: boolean;
  freezeRenounced?: boolean;
  honeypot?: boolean;
  rugRatio?: number; // 0..1 (GMGN)
  bundlerRate?: number; // 0..1
  sniperCount?: number;
  washTrading?: boolean;
  jupVerified?: boolean;
  organicScore?: number; // 0..100 (Jupiter)
  buyTax?: number;
  sellTax?: number;
  devMints?: number;
  flags?: string[];
}

/** Raw, provider-sourced token data after merge. Every field group carries provenance. */
export interface TokenRecord {
  mint: string;
  symbol: string;
  name: string;
  logo?: string;
  createdAt?: number; // ms epoch (pool open / token creation)
  launchpad?: string;
  dex?: string;
  poolAddress?: string;
  priceUsd?: number;
  marketCap?: number;
  fdv?: number;
  liquidityUsd?: number;
  volume: { m5?: number; h1?: number; h6?: number; h24?: number };
  txns: { m5?: TxCount; h1?: TxCount; h24?: TxCount };
  priceChange: { m5?: number; h1?: number; h6?: number; h24?: number };
  buyVolume5m?: number; // Jupiter stats5m
  sellVolume5m?: number;
  holders?: number;
  top10HolderPct?: number; // 0..100
  devHoldPct?: number; // 0..100
  smartMoneyCount?: number;
  kolCount?: number;
  security: TokenSecurity;
  links?: { url?: string; twitter?: string; website?: string; telegram?: string };
  sources: ProviderId[];
  categories: Category[];
  provenance: Record<string, Provenance>; // field-group -> provenance
  firstSeen: number;
  lastSeen: number;
  scanCount: number;
  demo?: boolean;
}

export interface Snapshot {
  t: number;
  priceUsd?: number;
  liquidityUsd?: number;
  marketCap?: number;
  vol5m?: number;
  buys5m?: number;
  sells5m?: number;
}

export interface ScoreInput { name: string; value: number | string | boolean | null; source: string }

export interface Score {
  key: "momentum" | "liquidity" | "security" | "holderRisk" | "composite";
  label: string;
  value: number | null; // 0..100, null when insufficient data
  formula: string;
  inputs: ScoreInput[];
  coverage: number; // 0..1 share of inputs that were available
  note?: string;
}

export interface Anomaly {
  type: "volume_spike" | "liquidity_drop" | "liquidity_add" | "momentum_accel" | "whale_buy" | "whale_sell" | "sell_pressure";
  severity: "info" | "warn" | "high";
  message: string;
  value: number;
  threshold: number;
  at: number;
}

export interface DerivedAnalytics {
  ageMinutes?: number;
  buyRatio1h?: number;
  volAccel?: number; // vol5m*12 / vol1h
  avgBuyUsd5m?: number;
  liqToMcap?: number;
  liqChangePct?: number; // vs previous snapshot
  priceChangeSinceFirstSeenPct?: number;
  scores: Score[];
  anomalies: Anomaly[];
  riskLevel: "low" | "medium" | "high" | "extreme" | "unknown";
  computedAt: number;
}

export interface TokenView extends TokenRecord {
  derived: DerivedAnalytics;
  stale: boolean;
  dataAgeSec: number;
}

export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }

export interface CandleSeries {
  mint: string;
  pool?: string;
  timeframe: string;
  candles: Candle[];
  provenance: Provenance | null;
  note?: string;
}

export interface TradePlan {
  available: boolean;
  reason?: string;
  hypothetical: true;
  basis?: { lastClose: number; atr: number; atrPeriod: number; swingLow: number; lookback: number; candles: number; timeframe: string };
  entryZone?: [number, number];
  invalidation?: number;
  stopLoss?: number;
  takeProfits?: { label: string; price: number; rMultiple: number }[];
  riskPerUnit?: number;
  rewardRisk?: { label: string; ratio: number }[];
  slippageEstimatePct?: number;
  formulas: string[];
  disclaimer: string;
}

export interface WalletTrade {
  id: string;
  wallet: string;
  walletName?: string;
  walletTags?: string[];
  mint: string;
  symbol: string;
  side: "buy" | "sell";
  amountUsd: number;
  priceUsd: number;
  timestamp: number; // ms
  kind: "smart" | "kol";
  provenance: Provenance;
}

export type ProviderState = "ok" | "degraded" | "cooldown" | "down" | "disabled" | "idle";

export interface ProviderHealth {
  id: ProviderId;
  label: string;
  state: ProviderState;
  documentedLimit: string;
  appliedLimit: string;
  requests: number;
  successes: number;
  errors: number;
  rateLimited: number;
  cacheHits: number;
  inFlight: number;
  queued: number;
  lastLatencyMs?: number;
  lastSuccessAt?: number;
  lastErrorAt?: number;
  lastError?: string;
  cooldownUntil?: number;
  consecutiveFailures: number;
  streaming: false;
  note?: string;
}

export interface FeedStatus {
  id: string;
  provider: ProviderId;
  label: string;
  intervalSec: number;
  enabled: boolean;
  lastRunAt?: number;
  lastOkAt?: number;
  lastCount?: number;
  lastError?: string;
  skippedReason?: string;
}

export interface CoverageRow {
  venue: string;
  status: "covered" | "partial" | "indirect" | "unsupported";
  via: string;
  notes: string;
}

export interface Filters {
  maxAgeMinutes?: number;
  minVolume1h?: number;
  minLiquidity?: number;
  minMarketCap?: number;
  maxMarketCap?: number;
  maxRisk?: "low" | "medium" | "high" | "extreme";
  query?: string;
}

export interface ScoreWeights {
  momentum: number;
  liquidity: number;
  security: number;
  holderRisk: number;
}

export interface AppConfig {
  mode: "live" | "demo";
  feeds: Record<string, { intervalSec: number; enabled: boolean }>;
  staleAfterSec: number;
  weights: ScoreWeights;
  thresholds: {
    volumeSpikeRatio: number;
    liquidityDropPct: number;
    momentumAccelRatio: number;
    whaleTradeUsd: number;
    whaleAvgBuyUsd: number;
  };
  maxTokens: number;
}

export interface AlertRule {
  id: string;
  mint: string;
  type: "price_above" | "price_below" | "liquidity_drop_pct" | "volume_spike" | "score_above" | "risk_change";
  value: number;
  createdAt: number;
  lastTriggeredAt?: number;
}

export interface AlertEvent {
  id: string;
  mint: string;
  symbol: string;
  message: string;
  at: number;
  severity: "info" | "warn" | "high";
  source: "rule" | "anomaly";
}

export interface WatchItem { mint: string; symbol?: string; addedAt: number; note?: string }

export interface PaperPosition { mint: string; symbol: string; qty: number; avgPriceUsd: number; costUsd: number; openedAt: number }

export interface PaperTrade {
  id: string;
  mint: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  quotePriceUsd: number;
  fillPriceUsd: number;
  notionalUsd: number;
  feeUsd: number;
  slippagePct: number;
  realizedPnlUsd?: number;
  priceSource: string;
  priceAgeSec: number;
  at: number;
  note?: string;
}

export interface PaperState {
  isolated: true;
  startingBalanceUsd: number;
  cashUsd: number;
  feeBps: number;
  baseSlippageBps: number;
  impactFactor: number;
  positions: PaperPosition[];
  journal: PaperTrade[];
}

export interface ScanMeta {
  mode: "live" | "demo";
  lastScanAt?: number;
  tokenCount: number;
  scans: number;
}

export interface DashboardState {
  meta: ScanMeta;
  tokens: TokenView[];
  providers: ProviderHealth[];
  feeds: FeedStatus[];
  alerts: AlertEvent[];
  trades: WalletTrade[];
  serverTime: number;
}
