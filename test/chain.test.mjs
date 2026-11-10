// Offline synthetic RPC fixtures used exclusively by the test runner.
import test from "node:test";
import assert from "node:assert/strict";
import {
	inspectMint,
	inspectWallet,
	transferEvidence,
	validAddress,
} from "../server/chain.mjs";

const address = (n) => "1".repeat(31) + "23456789ABCDEFGH"[n];
const [wallet, other, src, dest, mint] = [0, 1, 2, 3, 4].map(address);
const signature = "1".repeat(63) + "2";
const program = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const now = 1000000;
const transfer = {
	programId: program,
	parsed: {
		type: "transfer",
		info: { source: src, destination: dest, amount: "42" },
	},
};
function fixture() {
	const entry = (accountIndex, owner) => ({
		accountIndex,
		owner,
		mint,
		uiTokenAmount: { decimals: 1 },
	});
	return {
		slot: 100,
		blockTime: now / 1000,
		transaction: {
			signatures: [signature],
			message: {
				accountKeys: [wallet, src, dest],
				instructions: [{ programId: address(6) }],
			},
		},
		meta: {
			err: null,
			innerInstructions: [{ index: 0, instructions: [transfer] }],
			preTokenBalances: [entry(1, wallet)],
			postTokenBalances: [entry(2, other)],
			preBalances: [9000],
			postBalances: [4000],
		},
	};
}
test("decode public addresses to exactly 32 bytes", () => {
	assert.ok(validAddress(wallet));
	assert.ok(validAddress(program));
	assert.equal(validAddress("1".repeat(44)), false);
	assert.equal(validAddress(signature), false);
});
test("CPI token transfers retain raw amount, owners, instruction identity and contemporaneous mark", () => {
	const tx = fixture();
	const data = { mint, price: 2, ts: now - 1000, source: "offline test" };
	const [e] = transferEvidence(tx, wallet, [data]);
	assert.equal(e.id, signature + ":0.0");
	assert.equal(e.destination, other);
	assert.equal(e.source, wallet);
	assert.equal(e.sourceAccount, src);
	assert.equal(e.amount, 4.2);
	assert.equal(e.usd, 8.4);
	assert.equal(e.type, "TRANSFER");
	for (const ts of [now + 1, now - 120001])
		assert.equal(transferEvidence(tx, wallet, [{ ...data, ts }])[0].usd, null);
	assert.deepEqual(transferEvidence(tx, address(7)), []);
	tx.meta.err = { InstructionError: [0, "error"] };
	assert.deepEqual(transferEvidence(tx, wallet), []);
});
test("unknown program instructions and ambiguous mints cannot create SPL transfer events", () => {
	const tx = fixture();
	tx.meta.innerInstructions[0].instructions = [
		{ ...transfer, programId: address(8) },
	];
	assert.deepEqual(transferEvidence(tx, wallet), []);
	tx.meta.innerInstructions[0].instructions = [transfer];
	tx.meta.postTokenBalances[0].mint = address(8);
	assert.deepEqual(transferEvidence(tx, wallet), []);
});
test("native SOL transfer is evidence even with USD coverage missing", () => {
	const tx = fixture();
	tx.transaction.message.instructions = [
		{
			programId: "1".repeat(32),
			parsed: {
				type: "transfer",
				info: { source: wallet, destination: other, lamports: 1000000000 },
			},
		},
	];
	delete tx.meta.innerInstructions;
	const [e] = transferEvidence(tx, wallet, []);
	assert.equal(e.amount, 1);
	assert.equal(e.asset, "SOL");
	assert.equal(e.mint, null);
	assert.equal(e.usd, null);
});
test("mint account concentration uses integer raw units; incomplete owner data stays UNKNOWN", async () => {
	const info = { mintAuthority: null, supply: "1000", decimals: 0 };
	const account = {
		context: { slot: 20 },
		value: { owner: program, data: { parsed: { type: "mint", info } } },
	};
	const largest = {
		context: { slot: 21 },
		value: [
			{ address: src, amount: "300" },
			{ address: dest, amount: "20" },
		],
	};
	const query = (method) => (method === "getAccountInfo" ? account : largest);
	const result = await inspectMint(mint, query);
	assert.equal(result.mintAuthority, null);
	assert.equal(result.freezeAuthority, "UNKNOWN");
	assert.equal(result.topTenAccountPercent, 32);
	assert.equal(result.topAccountPercent, 30);
	largest.context.slot = 100;
	assert.equal((await inspectMint(mint, query)).topAccountPercent, null);
	account.value.owner = address(8);
	assert.equal((await inspectMint(mint, query)).mintAuthority, "UNKNOWN");
});
test("wallet inspection deduplicates signatures and exposes partially unavailable holdings", async () => {
	const tx = fixture();
	const query = (method) => {
		if (method === "getBalance") return { value: 1e9 };
		if (method === "getSignaturesForAddress")
			return Array(2).fill({ signature, err: null });
		if (method === "getTransaction") return tx;
		throw new Error("offline");
	};
	const result = await inspectWallet(wallet, [], query);
	assert.equal(result.events.length, 1);
	assert.equal(result.examinedSignatures, 1);
	assert.equal(result.balanceSol, 1);
	assert.equal(result.balanceChanges[0].deltaSol, -0.000005);
	assert.equal(result.netFlows[0].amount, -4.2);
	assert.ok(result.errors.length);
});
