import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { defaults, fresh, numeric } from "./analytics.mjs";
export function openStore(file) {
	if (!file) {
		mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
		file = new URL("../data/terminal.sqlite", import.meta.url);
	}
	const db = new DatabaseSync(file);
	db.exec(`PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS records (kind TEXT,id TEXT,ts INTEGER,body TEXT NOT NULL,PRIMARY KEY(kind,id));
  CREATE INDEX IF NOT EXISTS by_time ON records(kind,ts DESC);`);
	const write = db.prepare("INSERT OR REPLACE INTO records VALUES(?,?,?,?)");
	const list = db.prepare(
		"SELECT body FROM records WHERE kind=? ORDER BY ts DESC LIMIT ?",
	);
	const one = db.prepare("SELECT body FROM records WHERE kind=? AND id=?");
	const put = (kind, id, value, ts = Date.now()) =>
		write.run(kind, id, ts, JSON.stringify(value));
	const get = (kind, id) => JSON.parse(one.get(kind, id)?.body ?? "null");
	const all = (kind, limit = 2048) =>
		list.all(kind, limit).map((r) => JSON.parse(r.body));
	const remove = (kind, id) =>
		db.prepare("DELETE FROM records WHERE kind=? AND id=?").run(kind, id);
	const settings = () => ({ ...defaults, ...get("config", "settings") });
	const cash = () => get("account", "cash") ?? 10000;
	function transact(fn) {
		db.exec("BEGIN IMMEDIATE");
		try {
			const value = fn();
			db.exec("COMMIT");
			return value;
		} catch (e) {
			db.exec("ROLLBACK");
			throw e;
		}
	}
	function ingest(rows) {
		transact(() => {
			for (const r of rows) {
				if (!r?.pool || !r.mint || !Number.isFinite(r.ts)) continue;
				if ((get("pool", r.pool)?.ts ?? 0) > r.ts) continue;
				put("pool", r.pool, r, r.ts);
				put("history", r.pool + "/" + r.ts, r, r.ts);
			}
			db.prepare(
				"DELETE FROM records WHERE kind IN ('history','pool','candidate','event','protocol','protocolReport','quote') AND ts<?",
			).run(Date.now() - 7 * 86400000);
		});
	}
	function paper(input) {
		return transact(() => {
			const row = get("pool", input.pool);
			if (
				!fresh(row) ||
				row.mint !== input.mint ||
				!(row.price > 0 && row.liquidity > 0)
			)
				throw Error("A fresh priced pool with liquidity is required");
			const size = numeric(input.size, 1, Math.min(1e6, row.liquidity * 0.01));
			const slip = numeric(input.slippage, 0, 2000) / 10000;
			if (!["buy", "sell"].includes(input.side)) throw Error("Unknown side");
			const buy = input.side === "buy",
				price = row.price * (1 + (buy ? slip : -slip)),
				units = size / price;
			const fee =
				size * 0.003 + settings().networkFeeUsd + settings().priorityFeeUsd;
			const position = get("position", row.mint) ?? {
				mint: row.mint,
				symbol: row.symbol,
				units: 0,
				basis: 0,
				realized: 0,
			};
			if (buy && size + fee > cash()) throw Error("Insufficient virtual cash");
			if (!buy && units > position.units)
				throw Error("Insufficient virtual holdings");
			const basisUsed = buy ? 0 : (position.basis * units) / position.units;
			const realized = buy ? 0 : size - fee - basisUsed;
			put("position", row.mint, {
				...position,
				units: position.units + (buy ? units : -units),
				basis: position.basis + (buy ? size + fee : -basisUsed),
				realized: position.realized + realized,
			});
			put("account", "cash", cash() + (buy ? -size : size) - fee);
			const trade = {
				id: crypto.randomUUID(),
				status: "SIMULATED",
				side: input.side,
				symbol: row.symbol,
				mint: row.mint,
				pool: row.pool,
				ts: Date.now(),
				sourceTs: row.ts,
				size,
				price,
				units,
				fee,
				realized,
				slippage: input.slippage,
			};
			put("trade", trade.id, trade);
			return trade;
		});
	}
	return { db, all, get, put, remove, settings, cash, transact, ingest, paper };
}
