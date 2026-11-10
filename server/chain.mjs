import { protocolEvents } from "./protocol.mjs";
import { rpc } from "./providers.mjs";

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const system = "11111111111111111111111111111111";
const tokenPrograms = [
	"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
	"TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
];
const wrappedSol = "So11111111111111111111111111111111111111112";
const finalized = { commitment: "finalized" };
const parsed = { ...finalized, encoding: "jsonParsed" };
const unknown = "UNKNOWN";

function validBase58(value, bytes) {
	if (
		typeof value !== "string" ||
		value.length < bytes ||
		value.length > Math.ceil(bytes * 1.37)
	)
		return false;
	let n = 0n;
	for (const c of value) {
		const digit = alphabet.indexOf(c);
		if (digit < 0) return false;
		n = n * 58n + BigInt(digit);
	}
	const zeros = value.match(/^1*/)[0].length;
	return zeros + (n === 0n ? 0 : Math.ceil(n.toString(2).length / 8)) === bytes;
}

export function validAddress(value) {
	return validBase58(value, 32);
}

function requireAddress(value) {
	if (!validAddress(value))
		throw new Error("A 32-byte public Solana address is required");
}

function rawAmount(v) {
	return (
		typeof v === "string" &&
		/^\d{1,20}$/.test(v) &&
		BigInt(v) <= 18446744073709551615n
	);
}

function quantity(raw, decimals) {
	if (
		!rawAmount(raw) ||
		!Number.isInteger(decimals) ||
		decimals < 0 ||
		decimals > 255
	)
		return null;
	return Number(raw) / 10 ** decimals;
}

function marketMark(rows, mint, ts) {
	const eligible = rows.filter(
		(r) =>
			r.mint === mint &&
			Number.isFinite(r.price) &&
			r.price > 0 &&
			Number.isFinite(r.ts) &&
			r.ts <= ts &&
			ts - r.ts <= 120000,
	);
	return eligible.sort(
		(a, b) => b.ts - a.ts || (b.liquidity || 0) - (a.liquidity || 0),
	)[0];
}

function accountsAt(tx, phase) {
	const accounts = new Map();
	const keys = tx.transaction.message.accountKeys;
	for (const balance of Array.isArray(tx.meta[phase]) ? tx.meta[phase] : []) {
		if (!Number.isInteger(balance?.accountIndex)) continue;
		const key = keys[balance.accountIndex];
		const address = typeof key === "string" ? key : key?.pubkey;
		if (validAddress(address) && validAddress(balance.mint))
			accounts.set(address, balance);
	}
	return accounts;
}

// One event per parsed instruction, including inner instructions (CPI).
export function transferEvidence(tx, address, rows = []) {
	const message = tx?.transaction?.message;
	const signature = tx?.transaction?.signatures?.[0];
	if (
		!validBase58(signature, 64) ||
		tx?.meta?.err !== null ||
		!Array.isArray(message?.instructions) ||
		!Array.isArray(message.accountKeys) ||
		!Number.isSafeInteger(tx.blockTime) ||
		tx.blockTime <= 0
	)
		return [];
	const before = accountsAt(tx, "preTokenBalances");
	const after = accountsAt(tx, "postTokenBalances");
	const inner = new Map(
		(Array.isArray(tx.meta.innerInstructions) ? tx.meta.innerInstructions : [])
			.filter(
				(g) => Number.isInteger(g?.index) && Array.isArray(g.instructions),
			)
			.map((g) => [g.index, g.instructions]),
	);
	const ts = tx.blockTime * 1000;
	const events = [];
	function inspect(ix, index) {
		const info = ix?.parsed?.info;
		const type = ix?.parsed?.type;
		if (
			!info ||
			!["transfer", "transferChecked"].includes(type) ||
			!validAddress(info.source) ||
			!validAddress(info.destination)
		)
			return;
		let source = info.source;
		let destination = info.destination;
		let mint, raw, decimals, asset;
		if (
			ix.programId === system &&
			type === "transfer" &&
			Number.isSafeInteger(info.lamports) &&
			info.lamports > 0
		) {
			raw = String(info.lamports);
			decimals = 9;
			asset = "SOL";
			mint = null;
		} else if (tokenPrograms.includes(ix.programId)) {
			const input = before.get(info.source) ?? after.get(info.source);
			const output =
				after.get(info.destination) ?? before.get(info.destination);
			mint = info.mint ?? input?.mint ?? output?.mint;
			if (
				!validAddress(mint) ||
				[input, output].some((b) => b && b.mint !== mint)
			)
				return;
			decimals =
				info.tokenAmount?.decimals ??
				input?.uiTokenAmount?.decimals ??
				output?.uiTokenAmount?.decimals;
			raw = info.tokenAmount?.amount ?? info.amount;
			source = validAddress(input?.owner) ? input.owner : null;
			destination = validAddress(output?.owner) ? output.owner : null;
			asset = "SPL";
		} else return;
		if (![source, destination, info.source, info.destination].includes(address))
			return;
		const amount = quantity(raw, decimals);
		if (!(amount > 0)) return;
		const mark = marketMark(rows, mint ?? wrappedSol, ts);
		const usd = mark ? amount * mark.price : null;
		events.push({
			id: signature + ":" + index,
			signature,
			instruction: index,
			source,
			destination,
			sourceAccount: info.source,
			destinationAccount: info.destination,
			mint,
			asset,
			raw,
			decimals,
			amount,
			ts,
			slot: tx.slot,
			type: "TRANSFER",
			confidence: "FINALIZED",
			usd: Number.isFinite(usd) ? usd : null,
			priceSource: mark?.source ?? null,
			priceTimestamp: mark?.ts ?? null,
			explorer: "https://explorer.solana.com/tx/" + signature,
		});
	}
	message.instructions.forEach((ix, i) => {
		inspect(ix, String(i));
		(inner.get(i) ?? []).forEach((item, j) => inspect(item, i + "." + j));
	});
	return events;
}

async function attempt(label, errors, task) {
	try {
		return await task();
	} catch {
		errors.push(label + " unavailable");
		return null;
	}
}

function authority(info, field) {
	return info?.[field] === null
		? null
		: validAddress(info?.[field])
			? info[field]
			: unknown;
}

export async function inspectMint(mint, request = rpc) {
	requireAddress(mint);
	const errors = [];
	const account = await attempt("Mint account", errors, () =>
		request("getAccountInfo", [mint, parsed]),
	);
	const data = account?.value?.data?.parsed;
	const info =
		tokenPrograms.includes(account?.value?.owner) && data?.type === "mint"
			? data.info
			: null;
	const mintAuthority = authority(info, "mintAuthority");
	const freezeAuthority = authority(info, "freezeAuthority");
	const riskIndicators = [];
	if (validAddress(mintAuthority))
		riskIndicators.push("Active mint authority can issue additional tokens");
	if (validAddress(freezeAuthority))
		riskIndicators.push("Active freeze authority can freeze token accounts");
	const extensions = (Array.isArray(info?.extensions) ? info.extensions : [])
		.map((e) => e?.extension)
		.filter((e) => typeof e === "string" && e.length <= 80);
	for (const name of [
		"transferFeeConfig",
		"transferHook",
		"permanentDelegate",
		"defaultAccountState",
		"nonTransferable",
		"pausableConfig",
	]) {
		if (extensions.includes(name))
			riskIndicators.push("Token-2022 extension: " + name);
	}
	let topAccountPercent = null,
		topTenAccountPercent = null,
		concentrationSlot = null;
	if (info && rawAmount(info.supply) && BigInt(info.supply) > 0n) {
		const largest = await attempt("Largest accounts", errors, () =>
			request("getTokenLargestAccounts", [mint, finalized]),
		);
		if (
			Array.isArray(largest?.value) &&
			largest.value.length > 0 &&
			largest.value.length <= 20 &&
			largest.value.every(
				(row) => validAddress(row.address) && rawAmount(row.amount),
			) &&
			new Set(largest.value.map((row) => row.address)).size ===
				largest.value.length &&
			Number.isSafeInteger(largest.context?.slot) &&
			Number.isSafeInteger(account.context?.slot) &&
			Math.abs(largest.context.slot - account.context.slot) <= 40
		) {
			const amounts = largest.value
				.map((row) => BigInt(row.amount))
				.sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
			const supply = BigInt(info.supply);
			if (amounts.reduce((a, b) => a + b, 0n) <= supply) {
				const percent = (n) => Number((n * 1000000n) / supply) / 10000;
				concentrationSlot = largest.context.slot;
				topAccountPercent = percent(amounts[0]);
				topTenAccountPercent = percent(
					amounts.slice(0, 10).reduce((a, b) => a + b, 0n),
				);
				if (topAccountPercent >= 20)
					riskIndicators.push(
						"One token account holds at least 20% of supply; vault ownership unknown",
					);
			}
		}
	}
	if (!info && !errors.length) errors.push("Parsed SPL mint data unavailable");
	const metadataState = Array.isArray(info?.extensions)
		? info.extensions.find((e) => e?.extension === "tokenMetadata")?.state
		: null;
	const metadata =
		metadataState?.mint === mint
			? Object.fromEntries(
					["name", "symbol", "uri"].map((k) => [
						k,
						typeof metadataState[k] === "string"
							? metadataState[k].slice(0, 512)
							: null,
					]),
				)
			: null;
	return {
		mint,
		ts: Date.now(),
		source: "Solana RPC",
		slot: account?.context?.slot ?? null,
		metadata,
		mintAuthority,
		freezeAuthority,
		topAccountPercent,
		topTenAccountPercent,
		concentrationSlot,
		extensions,
		riskIndicators,
		errors,
		supplyRaw: info && rawAmount(info.supply) ? info.supply : null,
		decimals: Number.isInteger(info?.decimals) ? info.decimals : null,
		holderCount: null,
		developerBehavior: unknown,
		insiderOwnership: unknown,
	};
}

export async function inspectWallet(address, rows = [], request = rpc) {
	requireAddress(address);
	const errors = [],
		holdings = [],
		events = [],
		observedInstructions = [],
		balanceChanges = [],
		seen = new Set();
	const balance = await attempt("SOL balance", errors, () =>
		request("getBalance", [address, finalized]),
	);
	for (const programId of tokenPrograms) {
		const result = await attempt(
			"Token accounts " + programId.slice(0, 6),
			errors,
			() =>
				request("getTokenAccountsByOwner", [address, { programId }, parsed]),
		);
		for (const item of Array.isArray(result?.value) ? result.value : []) {
			const info = item?.account?.data?.parsed?.info;
			if (
				!validAddress(item.pubkey) ||
				!validAddress(info?.mint) ||
				info.owner !== address
			)
				continue;
			const amount = quantity(
				info.tokenAmount?.amount,
				info.tokenAmount?.decimals,
			);
			if (amount > 0)
				holdings.push({
					account: item.pubkey,
					mint: info.mint,
					amount,
					raw: info.tokenAmount.amount,
					decimals: info.tokenAmount.decimals,
					slot: result.context?.slot,
				});
		}
	}
	const signatures = await attempt("Finalized signatures", errors, () =>
		request("getSignaturesForAddress", [address, { ...finalized, limit: 5 }]),
	);
	if (signatures !== null && !Array.isArray(signatures))
		errors.push("Invalid signature list");
	for (const row of Array.isArray(signatures) ? signatures.slice(0, 5) : []) {
		if (
			row?.err !== null ||
			!validBase58(row.signature, 64) ||
			seen.has(row.signature)
		)
			continue;
		seen.add(row.signature);
		const tx = await attempt("Transaction history", errors, () =>
			request("getTransaction", [
				row.signature,
				{ ...parsed, maxSupportedTransactionVersion: 0 },
			]),
		);
		if (tx?.transaction?.signatures?.[0] !== row.signature) {
			errors.push("Transaction payload missing or mismatched");
			continue;
		}
		observedInstructions.push(
			...protocolEvents(tx).filter((e) => e.actor === address),
		);
		events.push(...transferEvidence(tx, address, rows));
		if (
			tx.meta?.err !== null ||
			!Array.isArray(tx.transaction.message?.accountKeys)
		)
			continue;
		const index = tx.transaction.message.accountKeys.findIndex(
			(k) => (k?.pubkey ?? k) === address,
		);
		const pre = tx.meta.preBalances?.[index],
			post = tx.meta.postBalances?.[index];
		if (
			index >= 0 &&
			Number.isSafeInteger(pre) &&
			Number.isSafeInteger(post) &&
			pre !== post
		) {
			balanceChanges.push({
				signature: row.signature,
				slot: tx.slot,
				deltaSol: (post - pre) / 1e9,
				ts: Number.isSafeInteger(tx.blockTime) ? tx.blockTime * 1000 : null,
			});
		}
	}
	const flows = new Map();
	for (const event of events) {
		const key = event.mint ?? "SOL";
		const direction =
			Number(
				event.destination === address || event.destinationAccount === address,
			) - Number(event.source === address || event.sourceAccount === address);
		flows.set(key, (flows.get(key) ?? 0) + direction * event.amount);
	}
	const lamports = balance?.value;
	return {
		address,
		source: "Solana RPC",
		ts: Date.now(),
		events,
		holdings,
		balanceChanges,
		protocolEvents: observedInstructions,
		examinedSignatures: seen.size,
		balanceSol:
			Number.isSafeInteger(lamports) && lamports >= 0 ? lamports / 1e9 : null,
		netFlows: [...flows].map(([mint, amount]) => ({ mint, amount })),
		errors: [...new Set(errors)],
		realizedPnl: null,
		label: "Public watchlist",
		roleConfidence: unknown,
	};
}
