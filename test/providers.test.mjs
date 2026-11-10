import test from "node:test";
import assert from "node:assert/strict";

// Offline fixtures only. These invented amounts and accounts never enter the application database.
const mint = "So11111111111111111111111111111111111111112";
const usdc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const buy = {
	mint,
	pool: "A".repeat(44),
	venue: "orca",
	liquidity: 100000,
	quoteMint: usdc,
};
const sell = { ...buy, pool: "B".repeat(44), venue: "raydium" };
const fresh = () => ({
	buy: { ...buy, ts: Date.now() },
	sell: { ...sell, ts: Date.now() },
});
const instance = (key) => import("../server/providers.mjs?test=" + key);

test("missing observation fields stay unknown and invalid chain is rejected", async () => {
	const { normalizeDex } = await instance("schema");
	const row = {
		chainId: "solana",
		baseToken: { address: mint },
		dexId: "orca",
		pairAddress: buy.pool,
	};
	assert.equal(normalizeDex(row, 123).price, null);
	assert.equal(normalizeDex(row, 123).buys, null);
	assert.equal(normalizeDex({ ...row, chainId: "base" }, 123), null);
});
test("provider cooldown coalesces concurrent requests and respects Retry-After", async (t) => {
	const { rpc, health } = await instance("cooldown");
	const mock = t.mock.method(
		globalThis,
		"fetch",
		async () =>
			new Response("", { status: 429, headers: { "retry-after": "180" } }),
	);
	const start = Date.now();
	const reads = await Promise.allSettled([rpc("getSlot"), rpc("getSlot")]);
	assert.ok(reads.every((r) => r.status === "rejected"));
	await assert.rejects(rpc("getBalance", [mint]), /cooling down/);
	assert.equal(mock.mock.callCount(), 1);
	assert.ok(health["Solana RPC"].cooldownUntil >= start + 180000);
	assert.throws(() => rpc("sendTransaction", []), /Unsupported/);
});
test("stale observations expire before contacting a provider", async (t) => {
	const { quoteRoundtrip } = await instance("stale");
	const mock = t.mock.method(globalThis, "fetch", () => {
		throw new Error("Unexpected outbound call");
	});
	assert.equal(
		(
			await quoteRoundtrip(
				{ buy: { ...buy, ts: 1 }, sell: { ...sell, ts: 1 } },
				10,
			)
		).status,
		"EXPIRED",
	);
	assert.equal(mock.mock.callCount(), 0);
});
for (const correct of [false, true])
	test("roundtrip exact pool validation " + correct, async (t) => {
		const { quoteRoundtrip } = await instance(String(correct));
		t.mock.method(globalThis, "fetch", async (url) => {
			if (String(url).includes("mainnet-beta"))
				return Response.json({
					jsonrpc: "2.0",
					result: {
						value: {
							owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
							data: {
								parsed: {
									type: "mint",
									info: { freezeAuthority: null, isInitialized: true },
								},
							},
						},
					},
				});
			const p = new URL(url).searchParams,
				inputMint = p.get("inputMint"),
				outputMint = p.get("outputMint"),
				buying = inputMint === usdc;
			const pool = buying ? buy.pool : sell.pool;
			return Response.json({
				inputMint,
				outputMint,
				inAmount: p.get("amount"),
				outAmount: buying ? "1100000" : "11100000",
				otherAmountThreshold: buying ? "1000000" : "11000000",
				routePlan: [
					{
						swapInfo: {
							inputMint,
							outputMint,
							ammKey: correct ? pool : sell.pool,
						},
					},
				],
			});
		});
		const result = await quoteRoundtrip(fresh(), 10);
		assert.equal(result.status, correct ? "QUOTE VERIFIED" : "UNVERIFIED");
		if (correct) {
			assert.equal(result.sellQuote.inAmount, "1000000");
			assert.equal(result.netUsd, 0.97);
		}
	});
