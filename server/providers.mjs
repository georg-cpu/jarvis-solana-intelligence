import { setTimeout as sleep } from "node:timers/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isAbsolute } from "node:path";
import { mkdtemp, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = promisify(execFile);
const DEX = "DexScreener",
	GECKO = "GeckoTerminal",
	SOL = "Solana RPC",
	JUP = "Jupiter",
	GMGN = "GMGN";
const intervals = {
	[DEX]: 1200,
	[GECKO]: 6000,
	[SOL]: 1200,
	[JUP]: 2200,
	[GMGN]: 4000,
};
export const health = Object.fromEntries(
	Object.entries(intervals).map(([name, intervalMs]) => [
		name,
		{
			name,
			status: "idle",
			lastSuccess: null,
			error: null,
			cooldownUntil: 0,
			intervalMs,
		},
	]),
);
const queues = new Map(),
	lastStarted = new Map(),
	failures = new Map();
const inFlight = new Map(),
	cache = new Map();

export function retryDelay(value, now = Date.now()) {
	if (!value) return 0;
	const seconds = Number(value);
	return Number.isFinite(seconds)
		? Math.max(0, seconds * 1000)
		: Math.max(0, (Date.parse(value) || 0) - now);
}

function scheduled(name, key, ttl, operation) {
	const id = name + ":" + key,
		state = health[name];
	if (cache.get(id)?.until > Date.now())
		return Promise.resolve(cache.get(id).data);
	if (inFlight.has(id)) return inFlight.get(id);
	if (inFlight.size >= 64)
		return Promise.reject(new Error("Provider queue full"));
	const task = (queues.get(name) || Promise.resolve())
		.then(async () => {
			if (Date.now() < state.cooldownUntil)
				throw new Error(name + " cooling down");
			await sleep(
				Math.max(
					0,
					(lastStarted.get(name) || 0) + state.intervalMs - Date.now(),
				),
			);
			lastStarted.set(name, Date.now());
			try {
				const data = await operation();
				Object.assign(state, {
					status: "online",
					lastSuccess: Date.now(),
					error: null,
					cooldownUntil: 0,
				});
				failures.set(name, 0);
				if (ttl) {
					if (cache.size >= 256) cache.delete(cache.keys().next().value);
					cache.set(id, { data, until: Date.now() + ttl });
				}
				return data;
			} catch (error) {
				const count = (failures.get(name) || 0) + 1;
				failures.set(name, count);
				const delay = Math.max(
					error.retryMs || 0,
					Math.min(300000, 2000 * 2 ** Math.min(8, count)),
					error.http === 429 ? 60000 : 0,
				);
				Object.assign(state, {
					status: error.http === 429 ? "rate limited" : "unavailable",
					error: error.message,
					cooldownUntil: Date.now() + delay,
				});
				throw error;
			}
		})
		.finally(() => inFlight.delete(id));
	queues.set(
		name,
		task.catch(() => undefined),
	);
	inFlight.set(id, task);
	return task;
}

async function json(url, init = {}) {
	const response = await fetch(url, {
		...init,
		signal: AbortSignal.timeout(12000),
		redirect: "error",
	});
	if (!response.ok) {
		await response.body?.cancel();
		throw Object.assign(new Error("HTTP " + response.status), {
			http: response.status,
			retryMs: retryDelay(response.headers.get("retry-after")),
		});
	}
	let size = 0;
	const chunks = [];
	for await (const chunk of response.body) {
		size += chunk.length;
		if (size > 6_000_000)
			throw new Error("Provider response exceeds size limit");
		chunks.push(chunk);
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		throw new Error("Invalid provider JSON");
	}
}
const addressPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const valid = (a) => typeof a === "string" && addressPattern.test(a);
const num = (v, min = 0) =>
	(typeof v === "number" || (typeof v === "string" && v.trim())) &&
	Number.isFinite(Number(v)) &&
	Number(v) >= min
		? Number(v)
		: null;
const label = (v) => (typeof v === "string" ? v.slice(0, 100) : "");
function array(v) {
	if (!Array.isArray(v)) throw new Error("Unexpected provider schema");
	return v;
}
export function normalizeDex(p, ts) {
	if (
		p?.chainId !== "solana" ||
		!valid(p.baseToken?.address) ||
		!valid(p.pairAddress) ||
		!label(p.dexId)
	)
		return null;
	return {
		mint: p.baseToken.address,
		pool: p.pairAddress,
		symbol: label(p.baseToken.symbol),
		name: label(p.baseToken.name),
		venue: label(p.dexId),
		quoteMint: valid(p.quoteToken?.address) ? p.quoteToken.address : null,
		price: num(p.priceUsd),
		liquidity: num(p.liquidity?.usd),
		volume: num(p.volume?.h24),
		volume5m: num(p.volume?.m5),
		volume1h: num(p.volume?.h1),
		buys: num(p.txns?.h24?.buys),
		sells: num(p.txns?.h24?.sells),
		cap: num(p.marketCap),
		change: num(p.priceChange?.h24, -Infinity),
		created: num(p.pairCreatedAt, 1),
		ts,
		source: DEX,
	};
}
const dexUrl = "https://api.dexscreener.com";
function dexPairs(path, search = false) {
	return scheduled(DEX, path, 60000, async () => {
		const result = await json(dexUrl + path);
		return array(search ? (result.pairs ?? []) : result)
			.map((p) => normalizeDex(p, Date.now()))
			.filter(Boolean);
	});
}
async function profiles() {
	const ids = await scheduled(DEX, "profiles", 60000, async () =>
		array(await json(dexUrl + "/token-profiles/latest/v1"))
			.filter((p) => p?.chainId === "solana" && valid(p.tokenAddress))
			.map((p) => p.tokenAddress),
	);
	return ids.length
		? dexPairs("/tokens/v1/solana/" + [...new Set(ids)].slice(0, 30).join(","))
		: [];
}
function gecko(feed) {
	return scheduled(GECKO, feed, 65000, async () => {
		const result = await json(
			"https://api.geckoterminal.com/api/v2/networks/solana/" +
				feed +
				"?include=base_token,quote_token,dex",
			{ headers: { Accept: "application/json;version=20230203" } },
		);
		const included = new Map(
			array(result.included ?? []).map((x) => [x.id, x.attributes]),
		);
		return array(result.data).flatMap((p) => {
			const a = p?.attributes,
				r = p?.relationships,
				token = included.get(r?.base_token?.data?.id);
			if (
				!valid(a?.address) ||
				!valid(token?.address) ||
				!label(r?.dex?.data?.id)
			)
				return [];
			return [
				{
					mint: token.address,
					pool: a.address,
					name: label(token.name),
					symbol: label(token.symbol),
					venue: label(r.dex.data.id),
					quoteMint: included.get(r.quote_token?.data?.id)?.address ?? null,
					price: num(a.base_token_price_usd),
					liquidity: num(a.reserve_in_usd),
					volume: num(a.volume_usd?.h24),
					volume5m: num(a.volume_usd?.m5),
					volume1h: num(a.volume_usd?.h1),
					buys: num(a.transactions?.h24?.buys),
					sells: num(a.transactions?.h24?.sells),
					cap: num(a.market_cap_usd),
					change: num(a.price_change_percentage?.h24, -Infinity),
					created: num(Date.parse(a.pool_created_at), 1),
					ts: Date.now(),
					source: GECKO,
					feed,
				},
			];
		});
	});
}
async function recentJupiter() {
	const tokens = await scheduled(JUP, "recent", 65000, async () =>
		array(
			await json("https://api.jup.ag/tokens/v2/recent", {
				headers: process.env.JUP_API_KEY
					? { "x-api-key": process.env.JUP_API_KEY }
					: {},
			}),
		)
			.filter((t) => valid(t?.id))
			.slice(0, 30)
			.map((t) => ({
				mint: t.id,
				holders: num(t.holderCount),
				firstPool: t.firstPool?.id,
				firstPoolAt: num(Date.parse(t.firstPool?.createdAt), 1),
				tokenTs: num(Date.parse(t.updatedAt), 1),
			})),
	);
	if (!tokens.length) return [];
	const tokenMap = new Map(tokens.map((t) => [t.mint, t]));
	const rows = await dexPairs(
		"/tokens/v1/solana/" + tokens.map((t) => t.mint).join(","),
	);
	return rows
		.filter((r) => tokenMap.has(r.mint))
		.map((r) => ({
			...r,
			discoveredBy: JUP,
			holders: tokenMap.get(r.mint).holders,
			firstPool: tokenMap.get(r.mint).firstPool,
			firstPoolAt: tokenMap.get(r.mint).firstPoolAt,
			tokenTs: tokenMap.get(r.mint).tokenTs,
		}));
}
export async function discover(query) {
	const jobs = query
		? [
				dexPairs(
					"/latest/dex/search?q=" +
						encodeURIComponent(String(query).slice(0, 100)),
					true,
				),
			]
		: [
				profiles(),
				gecko("trending_pools"),
				gecko("new_pools"),
				recentJupiter(),
			];
	const results = await Promise.allSettled(jobs);
	if (results.every((r) => r.status === "rejected"))
		throw new Error("Market providers unavailable");
	const pools = new Map();
	for (const row of results.flatMap((r) =>
		r.status === "fulfilled" ? r.value : [],
	)) {
		const key = row.mint + "/" + row.pool;
		if (!pools.has(key) || pools.get(key).ts < row.ts) pools.set(key, row);
	}
	return [...pools.values()];
}

const rpcMethods = new Set([
	"getAccountInfo",
	"getTokenLargestAccounts",
	"getTokenSupply",
	"getBalance",
	"getTokenAccountsByOwner",
	"getSignaturesForAddress",
	"getTransaction",
	"getSlot",
]);
export function rpc(method, params = []) {
	if (!rpcMethods.has(method)) throw new Error("Unsupported RPC method");
	return scheduled(
		SOL,
		JSON.stringify([method, params]),
		method === "getTransaction" ? 600000 : 15000,
		async () => {
			const data = await json("https://api.mainnet-beta.solana.com", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
			});
			if (
				data?.jsonrpc !== "2.0" ||
				!Object.hasOwn(data, "result") ||
				data.error
			)
				throw new Error("RPC response unavailable");
			return data.result;
		},
	);
}
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const venues = {
	raydium: "Raydium,Raydium CLMM,Raydium CP",
	"raydium-clmm": "Raydium CLMM",
	"raydium-cp": "Raydium CP",
	orca: "Whirlpool",
	whirlpool: "Whirlpool",
	meteora: "Meteora,Meteora DLMM,Meteora DAMM v2",
	"meteora-dlmm": "Meteora DLMM",
	pumpswap: "Pump.fun Amm",
	"pump-fun-amm": "Pump.fun Amm",
};
async function quote(input, output, amount, row, slip) {
	const dexes = venues[row.venue.toLowerCase()];
	if (!dexes) throw new Error("Venue mapping unavailable");
	const query = new URLSearchParams({
		inputMint: input,
		outputMint: output,
		amount: String(amount),
		slippageBps: String(slip),
		onlyDirectRoutes: "true",
		dexes,
	});
	const q = await scheduled(JUP, String(query), 0, () =>
		json("https://api.jup.ag/swap/v1/quote?" + query, {
			headers: process.env.JUP_API_KEY
				? { "x-api-key": process.env.JUP_API_KEY }
				: {},
		}),
	);
	const leg = q?.routePlan?.[0]?.swapInfo;
	if (
		!leg ||
		q.inputMint !== input ||
		q.outputMint !== output ||
		q.inAmount !== String(amount) ||
		q.routePlan?.length !== 1 ||
		leg.ammKey !== row.pool ||
		leg.inputMint !== input ||
		leg.outputMint !== output ||
		![q.outAmount, q.otherAmountThreshold].every(
			(n) => typeof n === "string" && /^[1-9][0-9]{0,19}$/.test(n),
		) ||
		BigInt(q.otherAmountThreshold) > BigInt(q.outAmount)
	)
		throw new Error("Exact-pool quote unavailable");
	return {
		inputMint: input,
		outputMint: output,
		inAmount: q.inAmount,
		outAmount: q.outAmount,
		minOut: q.otherAmountThreshold,
		pool: leg.ammKey,
		venue: label(leg.label),
		impactPct: num(q.priceImpactPct),
		feeAmount: leg.feeAmount ?? null,
		feeMint: leg.feeMint ?? null,
		slot: q.contextSlot,
		ts: Date.now(),
	};
}
export async function quoteRoundtrip(
	{ buy, sell },
	size,
	{ networkFeeUsd = 0.02, priorityFeeUsd = 0.01, slippageBps = 50 } = {},
) {
	const ts = Date.now(),
		base = { ts, size, netUsd: null, status: "UNVERIFIED" };
	try {
		if (
			![size, networkFeeUsd, priorityFeeUsd].every(Number.isFinite) ||
			size < 0.01 ||
			size > 1e6 ||
			Math.min(networkFeeUsd, priorityFeeUsd) < 0 ||
			!Number.isInteger(slippageBps) ||
			slippageBps < 0 ||
			slippageBps > 1000
		)
			throw new Error("Invalid paper sizing or cost assumptions");
		if (
			!valid(buy?.mint) ||
			buy.mint !== sell?.mint ||
			buy.pool === sell.pool ||
			buy.venue === sell.venue
		)
			throw new Error("Distinct venues and identical mint required");
		if ([buy, sell].some((p) => !(p.ts <= ts && ts - p.ts <= 120000)))
			return {
				...base,
				status: "EXPIRED",
				reason: "Market observation expired",
			};
		if (
			[buy, sell].some(
				(p) => !(p.liquidity >= size * 10) || p.quoteMint !== USDC,
			)
		)
			throw new Error(
				"Direct USDC pool with at least 10× paper size liquidity required",
			);
		const mint = await rpc("getAccountInfo", [
			buy.mint,
			{ encoding: "jsonParsed", commitment: "finalized" },
		]);
		const parsed = mint?.value?.data?.parsed;
		if (
			mint?.value?.owner !== "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" ||
			parsed?.type !== "mint" ||
			parsed.info?.isInitialized !== true ||
			parsed.info.freezeAuthority !== null
		)
			throw new Error("Unsupported or unverified token restrictions");
		const amount = Math.round(size * 1e6);
		const buyQuote = await quote(USDC, buy.mint, amount, buy, slippageBps);
		const sellQuote = await quote(
			buy.mint,
			USDC,
			buyQuote.minOut,
			sell,
			slippageBps,
		);
		if (
			Date.now() - buyQuote.ts > 15000 ||
			Date.now() - Math.min(buy.ts, sell.ts) > 120000
		)
			return {
				...base,
				status: "EXPIRED",
				buyQuote,
				sellQuote,
				reason: "Quote or observation aged out",
			};
		return {
			...base,
			status: "QUOTE VERIFIED",
			buyQuote,
			sellQuote,
			expires: buyQuote.ts + 15000,
			networkFeeUsd,
			priorityFeeUsd,
			slippageBps,
			netUsd:
				Number(sellQuote.minOut) / 1e6 - size - networkFeeUsd - priorityFeeUsd,
			reason:
				"Two indicative direct USDC quotes. Slippage floors applied to both legs. USD parity and network costs assumed.",
		};
	} catch (error) {
		return { ...base, reason: error.message };
	}
}

const kinds = {
	token: ["token", "info"],
	security: ["token", "security"],
	wallet: ["portfolio", "holdings"],
	market: ["market", "trending"],
	demo: ["market", "trending"],
	smartmoney: ["track", "smartmoney"],
	kol: ["track", "kol"],
};
export function gmgn(kind, address) {
	if (!Object.hasOwn(kinds, kind))
		throw new Error("Unknown GMGN read operation");
	const needsAddress = ["wallet", "security", "token"].includes(kind);
	if (needsAddress && !valid(address))
		throw new Error("Invalid public address");
	return scheduled(
		GMGN,
		kind + (needsAddress ? address : ""),
		kind === "demo" ? 86400000 : 60000,
		async () => {
			const entry = process.env.GMGN_CLI_JS,
				key =
					kind === "demo"
						? "gmgn_solbscbaseethmonadtron"
						: process.env.GMGN_API_KEY;
			if (
				!entry ||
				!isAbsolute(entry) ||
				!/\.(?:m?js|cjs)$/i.test(entry) ||
				!key
			)
				throw new Error(
					"Optional official GMGN CLI or read credential unavailable",
				);
			const args = [...kinds[kind], "--chain", "sol", "--raw"];
			if (needsAddress)
				args.push(kind === "wallet" ? "--wallet" : "--address", address);
			else args.push("--limit", kind === "demo" ? "3" : "20");
			if (kind === "demo" || kind === "market") args.push("--interval", "1h");
			// Isolate CLI config discovery and pass only the authorized read credential.
			const isolated = await mkdtemp(join(tmpdir(), "jarvis-gmgn-"));
			const env = {
				GMGN_API_KEY: key,
				HOME: isolated,
				USERPROFILE: isolated,
				SystemRoot: process.env.SystemRoot || "",
			};
			try {
				const { stdout } = await run(process.execPath, [entry, ...args], {
					env,
					cwd: isolated,
					windowsHide: true,
					timeout: 12000,
					maxBuffer: 2_000_000,
				});
				const data = JSON.parse(stdout);
				if (!data || typeof data !== "object") throw new Error();
				return data;
			} catch {
				throw new Error("GMGN read operation unavailable");
			} finally {
				await rmdir(isolated).catch(() => undefined);
			}
		},
	);
}
