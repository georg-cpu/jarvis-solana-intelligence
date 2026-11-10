import test from "node:test";
import assert from "node:assert/strict";
import {
	analyze,
	defaults,
	spreads,
	settingsUpdate,
} from "../server/analytics.mjs";
import { openStore } from "../server/store.mjs";
import { terminal } from "../server/index.mjs";

// Synthetic offline fixtures. Never imported by the running server.
const sample = (fields = {}) => ({
	mint: "fixtureMint",
	pool: "fixturePool",
	symbol: "TEST",
	source: "offline fixture",
	ts: Date.now(),
	price: 2,
	liquidity: 50000,
	volume: 20000,
	buys: 80,
	sells: 20,
	venue: "a",
	...fields,
});
test("spreads demand fresh, sufficiently liquid pools, distinct venues and identical mints", () => {
	const row = sample(),
		sell = { ...row, pool: "second", venue: "b", price: 3 };
	assert.equal(spreads([row, sell], defaults)[0].gross, 50);
	for (const fields of [
		{ ts: row.ts - 130000 },
		{ ts: row.ts + 10000 },
		{ mint: "other" },
		{ liquidity: null },
		{ venue: "a" },
		{ price: null },
	])
		assert.deepEqual(spreads([row, { ...sell, ...fields }], defaults), []);
});
test("missing inputs and future observations never produce a buy signal", () => {
	const row = sample();
	const history = [1, 2, 3].map((i) => ({
		...row,
		price: 1 + i / 10,
		ts: row.ts - 60000 * i,
	}));
	assert.equal(analyze(row, history, defaults).signal, "BUY WATCH");
	assert.equal(
		analyze(row, [{ ...row, ts: row.ts + 60000 }], defaults).signal,
		"WAIT",
	);
	assert.equal(
		analyze({ ...row, buys: null }, history, defaults).signal,
		"WAIT",
	);
	assert.equal(analyze(row, history, defaults, row.ts + 200000).signal, "WAIT");
	assert.throws(() => settingsUpdate(defaults, { size: NaN }));
});
test("paper ledger atomically rejects invalid fills and preserves weighted cost basis", () => {
	const store = openStore(":memory:"),
		r = sample();
	store.ingest([r]);
	const input = {
		mint: r.mint,
		pool: r.pool,
		size: 100,
		slippage: 50,
		side: "buy",
	};
	const fill = store.paper(input);
	assert.equal(store.cash(), 10000 - 100 - fill.fee);
	assert.throws(() => store.paper({ ...input, side: "sell", size: 300 }));
	assert.equal(store.all("trade").length, 1);
	const sell = store.paper({ ...input, side: "sell", size: 50 });
	assert.ok(sell.realized < 0);
	assert.ok(store.get("position", r.mint).units > 0);
	assert.throws(() => store.paper({ ...input, size: 1000 }));
	store.db.close();
});
test("API persists settings, prevents cross-origin mutations and rejects duplicate paper arbitrage", async () => {
	const store = openStore(":memory:"),
		app = terminal(store);
	await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
	try {
		const base = "http://127.0.0.1:" + app.server.address().port;
		const post = (name, body, headers = {}) =>
			fetch(base + "/api/" + name, {
				method: "POST",
				headers: { "content-type": "application/json", ...headers },
				body: JSON.stringify(body),
			});
		assert.equal((await post("settings", { threshold: 50000 })).status, 200);
		assert.equal(
			(
				await post(
					"settings",
					{ threshold: 10000 },
					{ origin: "https://example.org" },
				)
			).status,
			403,
		);
		const state = await (await fetch(base + "/api/state")).json();
		assert.equal(state.settings.threshold, 50000);
		assert.deepEqual(state.rows, []);
		store.put("quote", "test", {
			id: "test",
			status: "QUOTE VERIFIED",
			size: 100,
			netUsd: 2,
			ts: Date.now(),
		});
		assert.equal((await post("simulate", { id: "test" })).status, 200);
		assert.equal((await post("simulate", { id: "test" })).status, 400);
		assert.equal(store.cash(), 10002);
	} finally {
		await new Promise((resolve) => app.server.close(resolve));
		store.db.close();
	}
});
