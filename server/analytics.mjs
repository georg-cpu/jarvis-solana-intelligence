export const defaults = {
	threshold: 10000,
	spread: 15,
	size: 100,
	slippage: 50,
	networkFeeUsd: 0.02,
	priorityFeeUsd: 0.01,
	minLiquidity: 25000,
	imbalance: 0.2,
	volumeMultiple: 3,
};
export const TTL = 120000;
export const fresh = (row, now = Date.now()) =>
	row && Number.isFinite(row.ts) && now >= row.ts && now - row.ts <= TTL;
export function numeric(value, min, max) {
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		value < min ||
		value > max
	)
		throw Error("Value outside permitted range");
	return value;
}
export function settingsUpdate(old, input) {
	const limits = {
		size: [1, 1000000],
		slippage: [0, 1000],
		minLiquidity: [1, 1e10],
		imbalance: [0.01, 1],
		volumeMultiple: [1, 1000],
		networkFeeUsd: [0, 100],
		priorityFeeUsd: [0, 100],
	};
	const next = { ...old };
	for (const [k, v] of Object.entries(input)) {
		if (k === "threshold" && [10000, 50000, 100000, 1000000].includes(v))
			next[k] = v;
		else if (k === "spread" && [15, 20, 25, 25.01].includes(v)) next[k] = v;
		else if (Object.hasOwn(limits, k)) next[k] = numeric(v, ...limits[k]);
		else throw Error("Unsupported setting");
	}
	return next;
}
export function analyze(row, history, settings, now = Date.now()) {
	const samples = history
		.filter(
			(h) =>
				h.pool === row.pool &&
				h.ts < row.ts &&
				h.ts >= row.ts - 3600000 &&
				h.price > 0,
		)
		.sort((a, b) => a.ts - b.ts);
	const prior = samples.at(-1);
	const imbalance =
		Number.isFinite(row.buys) &&
		Number.isFinite(row.sells) &&
		row.buys + row.sells > 0
			? (row.buys - row.sells) / (row.buys + row.sells)
			: null;
	const delta = (a, b) =>
		Number.isFinite(a) && b > 0 ? (a / b - 1) * 100 : null;
	const momentum = delta(row.price, prior?.price);
	const liquidityChange = delta(row.liquidity, prior?.liquidity);
	const volumeChange = delta(row.volume, prior?.volume);
	const volumeRatio =
		Number.isFinite(row.volume5m) &&
		row.volume5m >= 0 &&
		row.volume1h > row.volume5m
			? (11 * row.volume5m) / (row.volume1h - row.volume5m)
			: null;
	const previous = samples.at(-2);
	const rate = (a, b) =>
		a &&
		b &&
		Number.isFinite(a.volume) &&
		Number.isFinite(b.volume) &&
		a.ts > b.ts
			? ((a.volume - b.volume) * 60000) / (a.ts - b.ts)
			: null;
	const recentRate = rate(row, prior),
		priorRate = rate(prior, previous);
	const volumeAcceleration =
		recentRate !== null && priorRate !== null
			? ((recentRate - priorRate) * 60000) / (row.ts - prior.ts)
			: null;
	const prices = [...samples.map((h) => h.price), row.price].filter(
		(p) => p > 0,
	);
	const returns = prices.slice(1).map((p, i) => Math.log(p / prices[i]));
	const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
	const volatility =
		returns.length >= 3
			? Math.sqrt(
					returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length,
				)
			: null;
	let signal = "WAIT";
	if (fresh(row, now) && row.liquidity != null) {
		if (row.liquidity < settings.minLiquidity) signal = "HIGH RISK";
		else if (samples.length >= 3 && imbalance !== null && momentum !== null) {
			if (momentum > 0 && imbalance >= settings.imbalance) signal = "BUY WATCH";
			if (momentum < 0 && imbalance <= -settings.imbalance)
				signal = "SELL WATCH";
		}
	}
	const low = Math.min(...prices),
		risk = row.price - low;
	const scenario =
		signal === "BUY WATCH" && risk > 0
			? {
					entry: row.price,
					stop: low,
					target: row.price + 2 * risk,
					rewardRisk: 2,
				}
			: null;
	return {
		...row,
		volumeRatio,
		volumeSpike:
			fresh(row, now) &&
			volumeRatio !== null &&
			volumeRatio >= settings.volumeMultiple,
		signal,
		imbalance,
		momentum,
		liquidityChange,
		volumeChange,
		volumeAcceleration,
		volatility,
		scenario,
	};
}
export function spreads(rows, s, now = Date.now()) {
	const result = [];
	for (const buy of rows)
		for (const sell of rows) {
			if (
				buy.mint !== sell.mint ||
				buy.venue === sell.venue ||
				buy.pool === sell.pool ||
				!fresh(buy, now) ||
				!fresh(sell, now) ||
				Math.abs(buy.ts - sell.ts) > 45000 ||
				!(buy.price > 0 && sell.price > buy.price) ||
				Math.min(buy.liquidity ?? 0, sell.liquidity ?? 0) < s.minLiquidity
			)
				continue;
			const gross = (sell.price / buy.price - 1) * 100;
			if (gross < s.spread) continue;
			result.push({
				id: buy.pool + "-" + sell.pool,
				mint: buy.mint,
				symbol: buy.symbol,
				buyPool: buy.pool,
				sellPool: sell.pool,
				buyVenue: buy.venue,
				sellVenue: sell.venue,
				gross,
				status: "UNVERIFIED",
				size: s.size,
				netUsd: null,
				reason: "Displayed pool prices only",
				ts: Math.min(buy.ts, sell.ts),
			});
		}
	return result.sort((a, b) => b.gross - a.gross);
}
/** Group finalized transfers sharing a sender, mint and slot in the local sample. */
export function distributionGroups(events, mint, launchTs) {
	const groups = new Map();
	if (!Number.isFinite(launchTs)) return [];
	for (const e of events) {
		if (
			e.mint !== mint ||
			e.confidence !== "FINALIZED" ||
			!e.source ||
			!e.destination ||
			e.source === e.destination ||
			!Number.isSafeInteger(e.slot)
		)
			continue;
		if (e.ts < launchTs || e.ts > launchTs + 3600000) continue;
		const key = e.slot + "/" + e.source,
			group = groups.get(key) ?? {
				slot: e.slot,
				sender: e.source,
				recipients: new Set(),
				signatures: new Set(),
			};
		group.recipients.add(e.destination);
		group.signatures.add(e.signature);
		groups.set(key, group);
	}
	return [...groups.values()]
		.filter((g) => g.recipients.size >= 3)
		.map((g) => ({
			slot: g.slot,
			sender: g.sender,
			recipients: [...g.recipients],
			signatures: [...g.signatures],
			confidence: "LOW",
			interpretation:
				"Shared sender and slot near first reported pool. Airdrops and operational payouts can produce this pattern.",
		}));
}

export function portfolioMarks(positions, rows, cash, now = Date.now()) {
	const marks = new Map();
	for (const row of rows) {
		if (!fresh(row, now) || !(row.price > 0 && row.liquidity > 0)) continue;
		if (!marks.has(row.mint) || marks.get(row.mint).liquidity < row.liquidity)
			marks.set(row.mint, row);
	}
	let total = cash,
		missing = 0;
	const marked = positions.map((p) => {
		const r = marks.get(p.mint),
			marketValue = p.units === 0 ? 0 : r ? p.units * r.price : null;
		if (marketValue === null) missing++;
		else total += marketValue;
		return {
			...p,
			marketValue,
			unrealized: marketValue === null ? null : marketValue - p.basis,
			markPool: r?.pool ?? null,
			markTs: r?.ts ?? null,
		};
	});
	return {
		positions: marked,
		equity: missing ? null : total,
		totalPnl: missing ? null : total - 10000,
		unpricedPositions: missing,
	};
}
