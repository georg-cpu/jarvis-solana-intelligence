import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { protocolEvents, curveState } from "../server/protocol.mjs";
import { analyze, defaults, portfolioMarks } from "../server/analytics.mjs";
const program = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
	mint = "So11111111111111111111111111111111111111112";
function encode(bytes) {
	let n = BigInt("0x" + bytes.toString("hex")),
		s = "";
	while (n) {
		s =
			"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"[
				Number(n % 58n)
			] + s;
		n /= 58n;
	}
	return s;
}
test("offline finalized direct migrate instruction distinguishes a replay from new pool funding", () => {
	const accounts = Array(24).fill(mint);
	accounts[9] = program;
	const tx = {
		slot: 1,
		blockTime: 123,
		transaction: {
			signatures: ["1".repeat(64)],
			message: {
				accountKeys: [program],
				instructions: [
					{
						programId: program,
						accounts,
						data: encode(
							createHash("sha256")
								.update("global:migrate")
								.digest()
								.subarray(0, 8),
						),
					},
				],
			},
		},
		meta: { err: null, preBalances: [10], postBalances: [10] },
	};
	assert.equal(protocolEvents(tx)[0].type, "MIGRATION INSTRUCTION");
	tx.meta.preBalances = [0];
	assert.equal(protocolEvents(tx)[0].type, "MIGRATED TO NEW POOL");
	tx.meta.err = {};
	assert.deepEqual(protocolEvents(tx), []);
});
test("curve completion requires matching owner, discriminator and boolean byte", () => {
	const bytes = Buffer.alloc(49);
	createHash("sha256")
		.update("account:BondingCurve")
		.digest()
		.copy(bytes, 0, 0, 8);
	bytes[48] = 1;
	const account = {
		value: { owner: program, data: [bytes.toString("base64"), "base64"] },
		context: { slot: 2 },
	};
	assert.equal(curveState(account).status, "COMPLETE");
	account.value.owner = mint;
	assert.equal(curveState(account), null);
});
test("volume spike requires real, consistent overlapping windows; missing marks suppress total equity", () => {
	const now = Date.now(),
		row = {
			mint,
			price: 2,
			liquidity: 50000,
			ts: now,
			volume5m: 50,
			volume1h: 150,
		};
	assert.equal(analyze(row, [], defaults, now).volumeRatio, 5.5);
	assert.equal(
		analyze({ ...row, volume1h: 50 }, [], defaults, now).volumeSpike,
		false,
	);
	const positions = [{ mint, units: 2, basis: 3 }];
	assert.equal(portfolioMarks(positions, [row], 100, now).equity, 104);
	assert.equal(
		portfolioMarks(positions, [row], 100, now + 200000).equity,
		null,
	);
});
