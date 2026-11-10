import { createHash } from "node:crypto";
import layouts from "./pump-layouts.json" with { type: "json" };
import { rpc } from "./providers.mjs";

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const pubkey = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const pump = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
function discriminator(data) {
	if (typeof data !== "string" || data.length > 1700 || !data.length)
		return null;
	let n = 0n;
	for (const char of data) {
		const digit = alphabet.indexOf(char);
		if (digit < 0) return null;
		n = n * 58n + BigInt(digit);
	}
	const hex = n.toString(16),
		prefix = "00".repeat(data.match(/^1*/)[0].length);
	return (
		prefix + (n === 0n ? "" : hex.padStart(Math.ceil(hex.length / 2) * 2, "0"))
	).slice(0, 16);
}
function category(name) {
	if (name.startsWith("migrate")) return "MIGRATION INSTRUCTION";
	if (name === "create_pool") return "POOL CREATED";
	if (name.startsWith("create")) return "TOKEN CREATED";
	if (name === "deposit") return "LIQUIDITY DEPOSIT";
	if (name === "withdraw") return "LIQUIDITY WITHDRAWAL";
	return name.startsWith("buy") ? "BUY" : "SELL";
}
export function protocolEvents(tx) {
	const signature = tx?.transaction?.signatures?.[0];
	if (
		tx?.meta?.err !== null ||
		!Number.isSafeInteger(tx.slot) ||
		!Number.isSafeInteger(tx.blockTime) ||
		typeof signature !== "string" ||
		!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)
	)
		return [];
	const message = tx.transaction.message,
		events = [];
	if (
		!Array.isArray(message?.instructions) ||
		!Array.isArray(message.accountKeys)
	)
		return [];
	for (const [index, ix] of message.instructions.entries()) {
		if (
			!ix ||
			!Object.hasOwn(layouts, ix.programId) ||
			!Array.isArray(ix.accounts)
		)
			continue;
		const venue = layouts[ix.programId],
			layout = venue.instructions[discriminator(ix.data)];
		if (!layout) continue;
		const fields = Object.fromEntries(
			Object.entries(layout.accounts).map(([key, i]) => [key, ix.accounts[i]]),
		);
		if (
			Object.values(fields).some(
				(v) => typeof v !== "string" || !pubkey.test(v),
			)
		)
			continue;
		const mint = fields.base_mint ?? fields.mint;
		if (!mint) continue;
		let type = category(layout.name);
		const poolIndex = message.accountKeys.findIndex(
			(k) => (k.pubkey ?? k) === fields.pool,
		);
		if (
			type === "MIGRATION INSTRUCTION" &&
			poolIndex >= 0 &&
			tx.meta.preBalances?.[poolIndex] === 0 &&
			tx.meta.postBalances?.[poolIndex] > 0
		)
			type = "MIGRATED TO NEW POOL";
		events.push({
			id: signature + "/protocol/" + index,
			signature,
			slot: tx.slot,
			ts: tx.blockTime * 1000,
			type,
			venue: venue.venue === "pump" ? "Pump.fun" : "PumpSwap",
			instruction: layout.name,
			mint,
			pool: fields.pool ?? null,
			curve: fields.bonding_curve ?? null,
			actor: fields.user ?? fields.creator ?? null,
			confidence: "FINALIZED",
			source: "Solana RPC",
		});
	}
	return events;
}
const curveTag = createHash("sha256")
	.update("account:BondingCurve")
	.digest()
	.subarray(0, 8);
export function curveState(result) {
	const value = result?.value;
	if (
		value?.owner !== pump ||
		value.data?.[1] !== "base64" ||
		typeof value.data[0] !== "string"
	)
		return null;
	const bytes = Buffer.from(value.data[0], "base64");
	if (
		bytes.length < 49 ||
		!bytes.subarray(0, 8).equals(curveTag) ||
		bytes[48] > 1
	)
		return null;
	return {
		status: bytes[48] ? "COMPLETE" : "ACTIVE",
		slot: result.context?.slot,
		realTokenReservesRaw: bytes.readBigUInt64LE(24).toString(),
		realQuoteReservesRaw: bytes.readBigUInt64LE(32).toString(),
	};
}
export async function inspectProtocol(mint, request = rpc) {
	const signatures = await request("getSignaturesForAddress", [
		mint,
		{ commitment: "finalized", limit: 5 },
	]);
	if (!Array.isArray(signatures))
		throw Error("Invalid finalized signature list");
	const events = [],
		errors = [];
	for (const row of signatures.slice(0, 5)) {
		if (
			row?.err !== null ||
			typeof row.signature !== "string" ||
			!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(row.signature)
		)
			continue;
		try {
			const tx = await request("getTransaction", [
				row.signature,
				{
					commitment: "finalized",
					encoding: "jsonParsed",
					maxSupportedTransactionVersion: 0,
				},
			]);
			if (tx?.transaction?.signatures?.[0] !== row.signature) {
				errors.push("Transaction unavailable");
				continue;
			}
			events.push(...protocolEvents(tx).filter((e) => e.mint === mint));
		} catch (e) {
			errors.push(e.message);
		}
	}
	const curve = events.find((e) => e.curve)?.curve;
	let bondingCurve = null;
	if (curve) {
		try {
			bondingCurve = curveState(
				await request("getAccountInfo", [
					curve,
					{ encoding: "base64", commitment: "finalized" },
				]),
			);
		} catch (e) {
			errors.push(e.message);
		}
	}
	return {
		mint,
		ts: Date.now(),
		events,
		bondingCurve,
		errors: [...new Set(errors)],
		signatureCount: signatures.length,
	};
}
