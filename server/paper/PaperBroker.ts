// PAPER TRADING ONLY. Virtual balances in a local JSON file.
// This module imports NO provider, wallet, signing or order code and makes NO network calls.
import type { PaperState, PaperTrade } from "../../shared/types.js";

export interface Quote { priceUsd: number; liquidityUsd?: number; source: string; ageSec: number; symbol: string }

export const DEFAULT_PAPER: PaperState = {
  isolated: true,
  startingBalanceUsd: 10_000,
  cashUsd: 10_000,
  feeBps: 100, // 1% assumed DEX + priority fee
  baseSlippageBps: 50, // 0.5% base slippage
  impactFactor: 2, // impact% ≈ impactFactor × notional / liquidity × 100
  positions: [],
  journal: [],
};

export class PaperError extends Error {}

const r = (n: number, d = 8) => Math.round(n * 10 ** d) / 10 ** d;
const id = () => `pt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export class PaperBroker {
  constructor(public state: PaperState, private maxQuoteAgeSec = 300) {}

  slippagePct(notionalUsd: number, liquidityUsd?: number): number {
    const base = this.state.baseSlippageBps / 100;
    if (!liquidityUsd || liquidityUsd <= 0) throw new PaperError("Liquidity unknown — paper fill refused (no fabricated execution)");
    return r(base + this.state.impactFactor * (notionalUsd / liquidityUsd) * 100, 4);
  }

  private checkQuote(q: Quote) {
    if (!(q.priceUsd > 0)) throw new PaperError("No valid price — paper fill refused");
    if (q.ageSec > this.maxQuoteAgeSec) throw new PaperError(`Price is stale (${Math.round(q.ageSec)}s old) — refresh before paper trading`);
  }

  buy(mint: string, notionalUsd: number, q: Quote, note?: string, now = Date.now()): PaperTrade {
    this.checkQuote(q);
    if (!(notionalUsd > 0)) throw new PaperError("Amount must be positive");
    const feeUsd = (notionalUsd * this.state.feeBps) / 10_000;
    if (notionalUsd + feeUsd > this.state.cashUsd + 1e-9) throw new PaperError("Insufficient virtual cash");
    const slip = this.slippagePct(notionalUsd, q.liquidityUsd);
    const fill = q.priceUsd * (1 + slip / 100);
    const qty = notionalUsd / fill;
    this.state.cashUsd = r(this.state.cashUsd - notionalUsd - feeUsd, 6);
    const pos = this.state.positions.find((p) => p.mint === mint);
    if (pos) {
      pos.costUsd += notionalUsd + feeUsd;
      pos.qty += qty;
      pos.avgPriceUsd = pos.costUsd / pos.qty;
    } else {
      this.state.positions.push({ mint, symbol: q.symbol, qty, avgPriceUsd: (notionalUsd + feeUsd) / qty, costUsd: notionalUsd + feeUsd, openedAt: now });
    }
    const t: PaperTrade = { id: id(), mint, symbol: q.symbol, side: "buy", qty: r(qty), quotePriceUsd: q.priceUsd, fillPriceUsd: fill, notionalUsd, feeUsd: r(feeUsd, 6), slippagePct: slip, priceSource: q.source, priceAgeSec: Math.round(q.ageSec), at: now, note };
    this.state.journal.unshift(t);
    return t;
  }

  sell(mint: string, fraction: number, q: Quote, note?: string, now = Date.now()): PaperTrade {
    this.checkQuote(q);
    const pos = this.state.positions.find((p) => p.mint === mint);
    if (!pos) throw new PaperError("No paper position in this token");
    const f = Math.min(1, Math.max(0, fraction));
    if (f <= 0) throw new PaperError("Fraction must be > 0");
    const qty = pos.qty * f;
    const grossAtQuote = qty * q.priceUsd;
    const slip = this.slippagePct(grossAtQuote, q.liquidityUsd);
    const fill = q.priceUsd * (1 - slip / 100);
    const gross = qty * fill;
    const feeUsd = (gross * this.state.feeBps) / 10_000;
    const costPart = pos.costUsd * f;
    const realized = gross - feeUsd - costPart;
    this.state.cashUsd = r(this.state.cashUsd + gross - feeUsd, 6);
    pos.qty -= qty;
    pos.costUsd -= costPart;
    if (f >= 1 || pos.qty <= 1e-12) this.state.positions = this.state.positions.filter((p) => p.mint !== mint);
    const t: PaperTrade = { id: id(), mint, symbol: pos.symbol, side: "sell", qty: r(qty), quotePriceUsd: q.priceUsd, fillPriceUsd: fill, notionalUsd: r(gross, 6), feeUsd: r(feeUsd, 6), slippagePct: slip, realizedPnlUsd: r(realized, 6), priceSource: q.source, priceAgeSec: Math.round(q.ageSec), at: now, note };
    this.state.journal.unshift(t);
    return t;
  }

  reset(startingBalanceUsd = DEFAULT_PAPER.startingBalanceUsd) {
    this.state = { ...structuredClone(DEFAULT_PAPER), startingBalanceUsd, cashUsd: startingBalanceUsd, feeBps: this.state.feeBps, baseSlippageBps: this.state.baseSlippageBps, impactFactor: this.state.impactFactor };
  }
}
