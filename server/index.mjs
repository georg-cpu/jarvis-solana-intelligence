import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openStore } from "./store.mjs";
import {
	analyze,
	spreads,
	distributionGroups,
	portfolioMarks,
	settingsUpdate,
	numeric,
} from "./analytics.mjs";
import { discover, health, gmgn, quoteRoundtrip } from "./providers.mjs";
import { inspectWallet, inspectMint, validAddress } from "./chain.mjs";

import { inspectProtocol } from "./protocol.mjs";
function address(v) {
	if (!validAddress(v)) throw Error("Enter a 32-byte public Solana address");
	return v;
}
const dist = fileURLToPath(new URL("../dist/", import.meta.url));
export function terminal(store = openStore()) {
	const pending = new Map();
	function once(key, fn) {
		if (!pending.has(key))
			pending.set(
				key,
				Promise.resolve()
					.then(fn)
					.finally(() => pending.delete(key)),
			);
		return pending.get(key);
	}
	const pools = () => store.all("pool", 500);
	const opportunities = () => spreads(pools(), store.settings());
	const refresh = () =>
		once("discover", async () => {
			const rows = await discover();
			store.ingest(rows);
			for (const c of opportunities())
				store.put("candidate", c.id + "/" + c.ts, c, c.ts);
			return { observed: rows.length };
		});
	const scanWallet = (a) =>
		once("wallet/" + a, async () => {
			const report = await inspectWallet(a, store.all("history", 4000));
			store.transact(() => {
				store.put("walletReport", a, report);
				for (const e of report.protocolEvents ?? [])
					store.put("protocol", e.id, e, e.ts);
				for (const e of report.events ?? [])
					store.put(
						"event",
						e.id ??
							[e.signature, e.source, e.destination, e.mint, e.amount].join(
								"/",
							),
						e,
						e.ts,
					);
			});
			return report;
		});
	const scanProtocol = (mint) =>
		once("protocol/" + mint, async () => {
			const report = await inspectProtocol(mint);
			store.transact(() => {
				store.put("protocolReport", mint, report);
				for (const e of report.events) store.put("protocol", e.id, e, e.ts);
			});
			return report;
		});
	let protocolIndex = 0;
	let walletIndex = 0;
	async function background() {
		await refresh().catch(() => {});
		const recent = pools().filter(
			(r) => /pump/i.test(r.venue) && Date.now() - r.ts < 120000,
		);
		if (recent.length)
			await scanProtocol(recent[protocolIndex++ % recent.length].mint).catch(
				() => {},
			);
		const wallets = store.all("wallet");
		if (wallets.length)
			await scanWallet(wallets[walletIndex++ % wallets.length]).catch(() => {});
	}
	function state() {
		const history = store.all("history", 4000),
			settings = store.settings(),
			rows = pools().map((r) => analyze(r, history, settings));
		return {
			rows,
			health,
			history,
			trades: store.all("trade"),
			cash: store.cash(),
			...portfolioMarks(store.all("position"), rows, store.cash()),
			wallets: store.all("wallet"),
			walletReports: store.all("walletReport", 32),
			events: store.all("event"),
			opportunities: opportunities(),
			journal: store.all("journal"),
			settings,
			watchlist: store.all("watch"),
			protocolEvents: store.all("protocol", 200),
			quoteHistory: store
				.all("quote", 50)
				.map((q) => ({
					...q,
					status:
						q.status === "QUOTE VERIFIED" && Date.now() > q.expires
							? "EXPIRED"
							: q.status,
				})),
			candidateHistory: store.all("candidate", 100),
		};
	}
	async function action(name, b) {
		switch (name) {
			case "refresh":
				return refresh();
			case "search": {
				if (
					typeof b.query !== "string" ||
					b.query.trim().length < 2 ||
					b.query.length > 80
				)
					throw Error("Enter 2–80 characters");
				const rows = await discover(b.query.trim());
				store.ingest(rows);
				return { observed: rows.length };
			}
			case "wallet": {
				const a = address(b.address);
				if (b.remove) {
					store.remove("wallet", a);
					store.remove("walletReport", a);
					return { removed: a };
				}
				if (!store.get("wallet", a) && store.all("wallet", 32).length >= 32)
					throw Error("Watchlist limit is 32 wallets");
				store.put("wallet", a, a);
				return scanWallet(a);
			}
			case "protocol":
				return scanProtocol(address(b.mint));
			case "security": {
				const mint = address(b.mint),
					report = await inspectMint(mint);
				const firstPoolAt = pools().find(
					(r) => r.mint === mint && Number.isFinite(r.firstPoolAt),
				)?.firstPoolAt;
				return {
					...report,
					launchDistributionGroups: distributionGroups(
						store.all("event"),
						mint,
						firstPoolAt,
					),
					coordinationCoverage:
						"Only finalized transfers in the local wallet sample during the first hour after Jupiter first-pool time. Common ownership UNKNOWN.",
				};
			}
			case "gmgn":
				return gmgn(b.kind, b.address ? address(b.address) : undefined);
			case "paper":
				return store.paper(b);
			case "settings": {
				const next = settingsUpdate(store.settings(), b);
				store.put("config", "settings", next);
				return next;
			}
			case "watch": {
				const mint = address(b.mint);
				if (store.get("watch", mint)) store.remove("watch", mint);
				else store.put("watch", mint, mint);
				return { watchlist: store.all("watch") };
			}
			case "quote": {
				const c = opportunities().find(
					(x) =>
						x.mint === b.mint &&
						x.buyPool === b.buyPool &&
						x.sellPool === b.sellPool,
				);
				if (!c) throw Error("Candidate expired or outside filters");
				const size = numeric(b.size, 1, 1000000),
					s = store.settings();
				const buy = store.get("pool", c.buyPool),
					sell = store.get("pool", c.sellPool);
				const q = await quoteRoundtrip({ buy, sell }, size, {
					...s,
					slippageBps: s.slippage,
				});
				const result = { ...c, ...q, id: crypto.randomUUID(), size };
				store.put("quote", result.id, result);
				return result;
			}
			case "simulate":
				return store.transact(() => {
					const q = store.get("quote", String(b.id));
					if (
						!q ||
						q.status !== "QUOTE VERIFIED" ||
						Date.now() > (q.expires ?? q.ts + 15000) ||
						!Number.isFinite(q.netUsd)
					)
						throw Error("Fresh verified round-trip quote required");
					if (store.get("journal", q.id))
						throw Error("Quote already journaled");
					if (q.size > store.cash() || store.cash() + q.netUsd < 0)
						throw Error("Insufficient paper cash");
					const entry = { ...q, status: "SIMULATED", ts: Date.now() };
					store.put("journal", q.id, entry);
					store.put("account", "cash", store.cash() + q.netUsd);
					return entry;
				});
			default:
				throw Error("Unknown API action");
		}
	}
	const server = http.createServer(async (req, res) => {
		const send = (status, data) => {
			res.writeHead(status, {
				"content-type": "application/json",
				"cache-control": "no-store",
				"x-content-type-options": "nosniff",
			});
			res.end(JSON.stringify(data));
		};
		try {
			const host = req.headers.host ?? "";
			if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host))
				return send(403, { error: "Loopback host required" });
			const u = new URL(req.url, "http://" + host);
			if (u.pathname === "/api/state" && req.method === "GET")
				return send(200, state());
			if (u.pathname === "/api/export" && req.method === "GET") {
				const fields = [
					"id",
					"ts",
					"side",
					"mint",
					"pool",
					"size",
					"units",
					"price",
					"fee",
					"realized",
					"status",
				];
				const rows = store
					.all("trade", 1000000)
					.map((r) => fields.map((k) => r[k]).join(","));
				res.writeHead(200, {
					"content-type": "text/csv",
					"content-disposition": 'attachment; filename="paper-trades.csv"',
				});
				return res.end([fields.join(","), ...rows].join("\r\n"));
			}
			if (u.pathname.startsWith("/api/") && req.method === "POST") {
				if (
					req.headers.origin &&
					req.headers.origin !== "http://" + host &&
					req.headers.origin !== "http://127.0.0.1:5173"
				)
					return send(403, { error: "Origin rejected" });
				if (req.headers["content-type"]?.split(";")[0] !== "application/json")
					return send(415, { error: "JSON required" });
				let body = "";
				for await (const buf of req) {
					body += buf;
					if (body.length > 8192)
						return send(413, { error: "Request too large" });
				}
				const input = JSON.parse(body || "{}");
				if (!input || typeof input !== "object" || Array.isArray(input))
					throw Error("JSON object required");
				return send(200, await action(u.pathname.slice(5), input));
			}
			if (req.method !== "GET" || u.pathname.startsWith("/api/"))
				return send(404, { error: "Unknown route" });
			const target = path.resolve(
				dist,
				"." +
					decodeURIComponent(u.pathname === "/" ? "/index.html" : u.pathname),
			);
			if (!target.startsWith(path.resolve(dist) + path.sep))
				return send(403, { error: "Invalid path" });
			const types = {
				".js": "text/javascript",
				".html": "text/html",
				".css": "text/css",
				".svg": "image/svg+xml",
				".woff2": "font/woff2",
			};
			const data = await readFile(target).catch(() => null);
			if (!data)
				return send(404, { error: "Asset unavailable. Run npm run build." });
			res.writeHead(200, {
				"content-type":
					types[path.extname(target)] ?? "application/octet-stream",
				"x-content-type-options": "nosniff",
				"content-security-policy":
					"default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
			});
			res.end(data);
		} catch (e) {
			send(400, { error: String(e.message ?? "Request failed").slice(0, 220) });
		}
	});
	return { server, background, state, action };
}
if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const { server, background } = terminal();
	server.listen(Number(process.env.PORT ?? 4317), "127.0.0.1", () => {
		console.log(
			"JARVIS local terminal http://127.0.0.1:" + server.address().port,
		);
		const loop = async () => {
			try {
				await background();
			} finally {
				setTimeout(loop, 60000).unref();
			}
		};
		void loop();
	});
}
