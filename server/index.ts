// JARVIS SOLANA INTELLIGENCE — local read-only API server.
// No trading, swap, order, signing or wallet functionality exists in this codebase.
import express, { type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { API_PORT, COVERAGE, DATA_DIR, ROOT } from "./config.js";
import { DEFAULT_PAPER, PaperBroker, PaperError } from "./paper/PaperBroker.js";
import { locateCli } from "./providers/gmgn.js";
import { Scanner } from "./scanner/Scanner.js";
import { tradePlan } from "./signals/engine.js";
import { JsonStore } from "./store/jsonStore.js";
import type { AlertRule, PaperState } from "../shared/types.js";

fs.mkdirSync(DATA_DIR, { recursive: true });
const scanner = new Scanner();
const paperStore = new JsonStore<PaperState>(path.join(DATA_DIR, "paper.json"), DEFAULT_PAPER);
const paper = new PaperBroker(paperStore.load());
locateCli();

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));
// Local-only: reject requests that do not originate from this machine.
app.use((req, res, next) => {
  const ip = req.socket.remoteAddress ?? "";
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip)) return res.status(403).json({ error: "local access only" });
  next();
});

const wrap = (fn: (req: Request, res: Response) => Promise<unknown> | unknown) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(fn(req, res)).catch(next);

app.get("/api/health", (_req, res) => res.json({ ok: true, mode: scanner.config.mode, readOnly: true, tradingEnabled: false, serverTime: Date.now() }));
app.get("/api/state", (_req, res) => res.json(scanner.state()));
app.get("/api/coverage", (_req, res) => res.json(COVERAGE));
app.get("/api/config", (_req, res) => res.json(scanner.config));
app.put("/api/config", (req, res) => { scanner.updateConfig(req.body ?? {}); res.json(scanner.config); });
app.post("/api/refresh", (_req, res) => { scanner.refreshNow(); res.json({ ok: true, note: "Eligible feeds triggered; cached data, queues and cooldowns still apply." }); });

app.get("/api/search", wrap(async (req, res) => {
  const q = String(req.query.q ?? "");
  res.json({ q, results: await scanner.search(q) });
}));
app.get("/api/token/:mint", wrap(async (req, res) => res.json(await scanner.detail(req.params.mint, req.query.enrich !== "0"))));
app.get("/api/candles/:mint", wrap(async (req, res) => {
  const tf = String(req.query.tf ?? "5m");
  const series = await scanner.candles(req.params.mint, tf);
  const rec = scanner.records.get(req.params.mint);
  const size = Math.max(1, Math.min(1_000_000, Number(req.query.size ?? 100)));
  res.json({ series, plan: tradePlan(series.candles, tf, rec?.liquidityUsd, size) });
}));

// watchlist & alerts
app.get("/api/watchlist", (_req, res) => res.json(scanner.watch));
app.post("/api/watchlist", (req, res) => { scanner.addWatch(String(req.body?.mint ?? ""), req.body?.note); res.json(scanner.watch); });
app.delete("/api/watchlist/:mint", (req, res) => { scanner.removeWatch(req.params.mint); res.json(scanner.watch); });
const RULE_TYPES: AlertRule["type"][] = ["price_above", "price_below", "liquidity_drop_pct", "volume_spike", "score_above", "risk_change"];
app.post("/api/rules", (req, res) => {
  const { mint, type, value } = req.body ?? {};
  if (!RULE_TYPES.includes(type) || typeof mint !== "string" || !Number.isFinite(Number(value))) return res.status(400).json({ error: "invalid rule" });
  res.json(scanner.addRule({ mint, type, value: Number(value) }));
});
app.delete("/api/rules/:id", (req, res) => { scanner.removeRule(req.params.id); res.json(scanner.watch); });
app.delete("/api/alerts", (_req, res) => { scanner.clearAlerts(); res.json({ ok: true }); });

// PAPER TRADING (virtual only)
app.get("/api/paper", (_req, res) => res.json(paper.state));
app.post("/api/paper/order", (req, res) => {
  const { mint, side, amountUsd, fraction, note } = req.body ?? {};
  try {
    const q = scanner.quote(String(mint));
    if (!q) throw new PaperError("No price available for this token — paper fill refused");
    const t = side === "sell" ? paper.sell(String(mint), Number(fraction ?? 1), q, note) : paper.buy(String(mint), Number(amountUsd), q, note);
    paperStore.save(paper.state);
    res.json({ trade: t, state: paper.state });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});
app.put("/api/paper/settings", (req, res) => {
  const { feeBps, baseSlippageBps, impactFactor } = req.body ?? {};
  if (Number.isFinite(Number(feeBps))) paper.state.feeBps = Math.max(0, Math.min(1000, Number(feeBps)));
  if (Number.isFinite(Number(baseSlippageBps))) paper.state.baseSlippageBps = Math.max(0, Math.min(5000, Number(baseSlippageBps)));
  if (Number.isFinite(Number(impactFactor))) paper.state.impactFactor = Math.max(0, Math.min(20, Number(impactFactor)));
  paperStore.save(paper.state);
  res.json(paper.state);
});
app.post("/api/paper/reset", (req, res) => { paper.reset(Number(req.body?.startingBalanceUsd) || undefined); paperStore.save(paper.state); res.json(paper.state); });

// Local push of POLLED data (Server-Sent Events). Not a provider stream.
const clients = new Set<Response>();
app.get("/api/events", (req, res) => {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  res.write(`event: state\ndata: ${JSON.stringify(scanner.state())}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(`event: ping\ndata: ${Date.now()}\n\n`), 15_000);
  req.on("close", () => { clearInterval(ping); clients.delete(res); });
});
let pushTimer: NodeJS.Timeout | null = null;
scanner.onChange(() => {
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    const payload = `event: state\ndata: ${JSON.stringify(scanner.state())}\n\n`;
    for (const c of clients) c.write(payload);
  }, 1500);
});

// Serve the production build if present.
const dist = path.join(ROOT, "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  res.status(502).json({ error: err.message });
});

const server = app.listen(API_PORT, "127.0.0.1", () => {
  console.log(`[jarvis] API on http://127.0.0.1:${API_PORT}  mode=${scanner.config.mode}  read-only, trading disabled`);
  scanner.start();
});
server.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EADDRINUSE") {
    console.error(`[jarvis] Port ${API_PORT} is already in use (another JARVIS instance?). Stop it or set API_PORT=<port>.`);
    process.exit(1);
  }
  throw e;
});
const shutdown = () => { scanner.stop(); server.close(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
