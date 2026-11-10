import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";

type RecordData = Record<string, unknown>;
type Row = {
	mint: string;
	pool: string;
	symbol: string;
	name: string;
	venue: string;
	price: number | null;
	liquidity: number | null;
	volume: number | null;
	buys: number | null;
	sells: number | null;
	change: number | null;
	created: number | null;
	ts: number;
	source: string;
	cap: number | null;
	holders?: number | null;
	firstPoolAt?: number | null;
	discoveredBy?: string;
	volumeSpike?: boolean;
	volumeRatio?: number | null;
	volumeAcceleration?: number | null;
	signal?: unknown;
	imbalance?: number | null;
	momentum?: number | null;
	liquidityChange?: number | null;
	volumeChange?: number | null;
	volatility?: number | null;
	scenario?: RecordData | null;
};
type State = {
	equity: number | null;
	totalPnl: number | null;
	unpricedPositions: number;
	protocolEvents: RecordData[];
	quoteHistory: RecordData[];
	candidateHistory: RecordData[];
	walletReports: RecordData[];
	positions: RecordData[];
	rows: Row[];
	history: Row[];
	health: RecordData | RecordData[];
	trades: RecordData[];
	cash: number;
	wallets: unknown[];
	events: RecordData[];
	opportunities: RecordData[];
	journal: RecordData[];
	settings: RecordData;
	watchlist: unknown[];
};
const groups = [
	[
		"Workspace",
		"Command center",
		"Token discovery",
		"Launch radar",
		"Trending memecoins",
	],
	[
		"Intelligence",
		"Whale movements",
		"Wallet watchlist",
		"Smart money & KOL",
		"Arbitrage hunter",
		"Security analyzer",
		"Insider / bundle risk",
	],
	[
		"Research",
		"Signal center",
		"Liquidity & volume",
		"Historical analytics",
		"Paper portfolio",
		"Watchlists & alerts",
		"API health",
	],
];
const path = [
	"M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
	"M12 3v18M3 12h18M5 6l14 12M5 18L19 6",
	"M4 20l4-7 4 2 8-12 M14 3h6v6",
	"M2 14l5-5 4 6 5-9 6 5",
	"M2 14q4-4 8 0t8 0l4-4 M2 18q4-4 8 0t8 0",
	"M3 6h17v13H3z M15 10h6v5h-6z",
	"M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M2 20q0-6 6-6t6 6 M16 6q6 0 3 6 M17 15q4 0 5 5",
	"M3 8h17l-4-4 M21 16H4l4 4",
	"M12 2l8 4v6q-1 6-8 10-7-4-8-10V6z M8 12l3 3 5-6",
	"M4 5h5v5H4z M15 4h5v5h-5z M10 16h5v5h-5z M6 10l5 6 M17 9l-4 7",
	"M2 13h4l3-7 4 12 4-9 2 4h3",
	"M4 20V9 M10 20V4 M16 20v-8 M22 20V6",
	"M3 3v18h18 M6 15l5-5 4 3 6-7",
	"M3 7h18v13H3z M8 7V4h8v3 M3 12q9 5 18 0",
	"M6 4h12v17l-6-4-6 4z",
	"M3 5h18v5H3z M3 14h18v5H3z M6 7h1 M6 16h1",
];
const sections = groups.flatMap((g) => g.slice(1));
function Icon({ n, size = 16 }: { n: number; size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.55"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d={path[n]} />
		</svg>
	);
}
const num = (v: unknown) =>
	typeof v === "number" && Number.isFinite(v) ? v : null;
const usd = (v: unknown) =>
	num(v) === null
		? "—"
		: new Intl.NumberFormat("en-US", {
				style: "currency",
				currency: "USD",
				notation: Math.abs(Number(v)) >= 100000 ? "compact" : "standard",
				maximumFractionDigits: Number(v) > 0 && Number(v) < 0.01 ? 8 : 2,
			}).format(Number(v));
const pct = (v: unknown) =>
	num(v) === null ? "—" : Number(v).toFixed(1) + "%";
const when = (v: unknown) =>
	!v ? "Unknown" : new Date(Number(v) || String(v)).toLocaleString();
const short = (s: unknown) =>
	typeof s === "string" && s.length > 18
		? s.slice(0, 6) + "…" + s.slice(-5)
		: String(s ?? "Unknown");
function Panel({
	title,
	extra,
	children,
	className = "",
}: {
	title: string;
	extra?: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	return (
		<section className={"panel " + className}>
			<header className="panelhead">
				<h2>{title}</h2>
				{extra}
			</header>
			{children}
		</section>
	);
}
function Empty({ children }: { children: ReactNode }) {
	return (
		<div className="empty">
			<span>◇</span>
			{children}
		</div>
	);
}
function value(v: unknown): string {
	return v === null || v === undefined
		? "Unknown"
		: typeof v === "object"
			? JSON.stringify(v)
			: String(v);
}
function Records({ list }: { list: RecordData[] }) {
	if (!list.length) return <Empty>No records available.</Empty>;
	return (
		<div className="records">
			{list.slice(0, 80).map((r, i) => (
				<dl key={i}>
					{Object.entries(r).map(([k, v]) => (
						<div key={k}>
							<dt>{k}</dt>
							<dd>
								{k === "signature" && typeof v === "string" ? (
									<a
										href={
											"https://explorer.solana.com/tx/" + encodeURIComponent(v)
										}
										target="_blank"
										rel="noreferrer"
									>
										{short(v)} ↗
									</a>
								) : ["ts", "timestamp", "lastSuccess"].includes(k) && num(v) ? (
									when(v)
								) : (
									value(v)
								)}
							</dd>
						</div>
					))}
				</dl>
			))}
		</div>
	);
}
function Radar({ rows, select }: { rows: Row[]; select: (r: Row) => void }) {
	const targets = rows
		.filter((r) => num(r.liquidity) !== null && num(r.volume) !== null)
		.slice(0, 32);
	return (
		<div className="radar">
			<svg
				viewBox="0 0 640 228"
				role="img"
				aria-label="Radar of observed pools, radius increases with 24-hour volume, angle increases with liquidity"
			>
				<defs>
					<pattern
						id="grid"
						width="24"
						height="24"
						patternUnits="userSpaceOnUse"
					>
						<path
							d="M24 0H0V24"
							fill="none"
							stroke="#203332"
							strokeWidth=".65"
						/>
					</pattern>
					<radialGradient id="bloom">
						<stop stopColor="#0d4a3a" stopOpacity=".85" />
						<stop offset="1" stopColor="#0c181b" stopOpacity=".1" />
					</radialGradient>
					<linearGradient id="beam" x1="0" x2="1" y1="0" y2="1">
						<stop stopColor="#42eeb2" stopOpacity="0" />
						<stop offset="1" stopColor="#42eeb2" stopOpacity=".32" />
					</linearGradient>
				</defs>
				<rect width="640" height="228" fill="url(#grid)" />
				<ellipse cx="320" cy="117" rx="260" ry="170" fill="url(#bloom)" />
				<g stroke="#285047" fill="none">
					{[30, 56, 82, 108, 135, 162].map((r) => (
						<circle
							key={r}
							cx="320"
							cy="117"
							r={r}
							strokeDasharray={r === 135 ? "2 5" : undefined}
						/>
					))}
					<path
						d="M0 117h640M320 0v228M167 0l306 234M167 234L473 0"
						strokeDasharray="3 5"
					/>
				</g>
				<g className="sweep">
					<path d="M320 117l0-162a162 162 0 0 1 100 35z" fill="url(#beam)" />
					<path d="M320 117l100-127" stroke="#59d9a7" opacity=".65" />
				</g>
				<g stroke="#91f3c8">
					<path d="M312 117h16m-8-8v16" />
				</g>
				{targets.map((r) => {
					const a = Math.log10(1 + (r.liquidity ?? 0)) * 1.45;
					const radius = Math.min(105, Math.log10(1 + (r.volume ?? 0)) * 14);
					return (
						<circle
							key={r.pool}
							onClick={() => select(r)}
							cx={320 + radius * Math.cos(a)}
							cy={117 + radius * Math.sin(a)}
							r="4"
							fill="#74ffd0"
						>
							<title>
								{r.symbol} · {r.venue}
							</title>
						</circle>
					);
				})}
			</svg>
			<div className="radar-label">SOLANA / MAINNET</div>
			<div className="radar-bottom">
				<i />
				{targets.length} PLOTTED POOLS
			</div>
		</div>
	);
}
function Heatmap({ opportunities }: { opportunities: RecordData[] }) {
	const venues = [
		...new Set(
			opportunities.flatMap((o) => [String(o.buyVenue), String(o.sellVenue)]),
		),
	].sort();
	if (!venues.length) return null;
	return (
		<div className="scroll">
			<table aria-label="Maximum observed spread percent by venue">
				<thead>
					<tr>
						<th>Buy ↓ / Sell →</th>
						{venues.map((v) => (
							<th key={v}>{v}</th>
						))}
					</tr>
				</thead>
				<tbody>
					{venues.map((buy) => (
						<tr key={buy}>
							<th>{buy}</th>
							{venues.map((sell) => {
								const gross = Math.max(
									...opportunities
										.filter((o) => o.buyVenue === buy && o.sellVenue === sell)
										.map((o) => Number(o.gross)),
								);
								return (
									<td
										key={sell}
										style={
											Number.isFinite(gross)
												? {
														background:
															"rgba(59,201,153," +
															Math.min(0.65, gross / 100) +
															")",
													}
												: undefined
										}
									>
										{pct(gross)}
									</td>
								);
							})}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
function History({ observations }: { observations: Row[] }) {
	if (!observations.length)
		return <Empty>No historical samples available.</Empty>;
	return (
		<div className="scroll historytable">
			<table>
				<thead>
					<tr>
						{["Observed", "Source", "Price USD", "Liquidity", "Volume 24h"].map(
							(k) => (
								<th key={k}>{k}</th>
							),
						)}
					</tr>
				</thead>
				<tbody>
					{observations.slice(0, 100).map((r) => (
						<tr key={r.ts}>
							<td>{when(r.ts)}</td>
							<td>{r.source}</td>
							<td>{usd(r.price)}</td>
							<td>{usd(r.liquidity)}</td>
							<td>{usd(r.volume)}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
function Candles({ rows }: { rows: Row[] }) {
	const buckets = new Map<number, number[]>();
	for (const r of [...rows].sort((a, b) => a.ts - b.ts)) {
		if (!r.price || Date.now() - r.ts > 86400000) continue;
		const key = Math.floor(r.ts / 300000);
		const prices = buckets.get(key) || [];
		prices.push(r.price);
		buckets.set(key, prices);
	}
	const all = [...buckets].slice(-40);
	if (!all.length)
		return <Empty>Waiting for timestamped price observations.</Empty>;
	const values = all.flatMap((x) => x[1]),
		min = Math.min(...values),
		max = Math.max(...values);
	const y = (p: number) => 95 - ((p - min) / (max - min || 1)) * 80;
	return (
		<>
			<svg
				className="candles"
				viewBox="0 0 500 110"
				role="img"
				aria-label="5 minute observed-price candles"
			>
				{all.map(([t, p], i) => {
					const x = ((i + 0.5) * 500) / all.length,
						open = p[0],
						close = p[p.length - 1],
						color = close >= open ? "#58deb0" : "#f28c89";
					return (
						<g
							key={t}
							stroke={color}
							opacity={t === Math.floor(Date.now() / 300000) ? 0.5 : 1}
						>
							<title>
								{when(t * 300000)} · {p.length} samples
							</title>
							<path
								d={"M" + x + " " + y(Math.max(...p)) + "V" + y(Math.min(...p))}
							/>
							<rect
								x={x - 3}
								y={Math.min(y(open), y(close))}
								width="6"
								height={Math.max(1, Math.abs(y(open) - y(close)))}
								fill={color}
							/>
						</g>
					);
				})}
			</svg>
			<p className="note">
				Five-minute sampled OHLC · gaps omitted · current bucket incomplete.
			</p>
		</>
	);
}
const coffeeAddress = "CYmGyR3E2rEheJiG48t9LNPjCU9dxGG6sBeUh9mJB9Fy";
function CoffeeSupport() {
 const [status,setStatus]=useState("");
 return <details className="coffee"><summary>Buy me a coffee with SOL</summary>
 <p>Optional support · Native SOL on Solana mainnet</p><code>{coffeeAddress}</code>
 <button type="button" onClick={async()=>{try{await navigator.clipboard.writeText(coffeeAddress);setStatus("Address copied");}catch{setStatus("Select the address above to copy it manually");}}}>Copy address</button>
 <span role="status">{status}</span></details>;
}
export default function App() {
	const [extraSettings, setExtraSettings] = useState<Record<string, string>>(
		{},
	);
	const [risk, setRisk] = useState({ entry: "", stop: "", target: "" });
	const [section, setSection] = useState("Command center"),
		[state, setState] = useState<State | null>(null),
		[error, setError] = useState(""),
		[busy, setBusy] = useState(""),
		[message, setMessage] = useState(""),
		[query, setQuery] = useState(""),
		[venue, setVenue] = useState(""),
		[sort, setSort] = useState("liquidity"),
		[selected, setSelected] = useState<Row | null>(null),
		[addr, setAddr] = useState(""),
		[result, setResult] = useState<RecordData | null>(null),
		[amount, setAmount] = useState("100"),
		[side, setSide] = useState("buy"),
		[menu, setMenu] = useState(false),
		[kind, setKind] = useState("demo"),
		[threshold, setThreshold] = useState("10000"),
		[spread, setSpread] = useState("15"),
		[slip, setSlip] = useState("50");
	async function load() {
		try {
			const res = await fetch("/api/state");
			if (!res.ok) throw Error("Backend unavailable");
			const s: State = await res.json();
			setState(s);
			setError("");
		} catch (e) {
			setError(String(e));
		}
	}
	useEffect(() => {
		void load();
		const t = setInterval(() => void load(), 15000);
		return () => clearInterval(t);
	}, []);
	async function action(route: string, data: RecordData = {}, show = false) {
		setBusy(route);
		setMessage("");
		try {
			const r = await fetch("/api/" + route, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(data),
			});
			const v = await r.json();
			if (!r.ok || v.error) throw Error(v.error || "Request failed");
			if (show) setResult(v);
			setMessage(
				route === "refresh"
					? "Refresh requested. Check provider health for ingestion status."
					: "Request completed.",
			);
			await load();
		} catch (e) {
			setMessage(String(e));
		} finally {
			setBusy("");
		}
	}
	useEffect(() => {
		function escape(e: KeyboardEvent) {
			if (e.key === "Escape") {
				setSelected(null);
				setMenu(false);
			}
		}
		window.addEventListener("keydown", escape);
		return () => window.removeEventListener("keydown", escape);
	}, []);
	function navigate(s: string) {
		setSection(s);
		setSelected(null);
		setResult(null);
		setMessage("");
		setMenu(false);
		setQuery("");
		setVenue("");
	}
	function detail(r: Row) {
		setSelected(r);
		setRisk({
			entry: String(r.scenario?.entry ?? r.price ?? ""),
			stop: String(r.scenario?.stop ?? ""),
			target: String(r.scenario?.target ?? ""),
		});
		setResult(null);
		setMessage("");
	}
	useEffect(() => {
		if (state && selected) {
			const update = state.rows.find((r) => r.pool === selected.pool);
			if (update && update.ts > selected.ts) setSelected(update);
		}
	}, [state, selected]);
	const rows = state?.rows ?? [],
		history = state?.history ?? [],
		fresh = rows.filter((r) => Date.now() - r.ts < 120000),
		mints = new Set(rows.map((r) => r.mint)),
		venues = [...new Set(rows.map((r) => r.venue))].sort(),
		watch = state?.watchlist ?? [];
	const inWatch = (r: Row) =>
		watch.some((w) => w === r.mint || (w as RecordData)?.mint === r.mint);
	const listed = rows
		.filter(
			(r) =>
				(!venue || r.venue === venue) &&
				[r.name, r.symbol, r.mint].some((s) =>
					s?.toLowerCase().includes(query.toLowerCase()),
				) &&
				(section !== "Launch radar" ||
					(r.created && Date.now() - r.created < 86400000)) &&
				(section !== "Watchlists & alerts" || inWatch(r)),
		)
		.sort(
			(a, b) =>
				Number(
					b[
						(section === "Launch radar"
							? "created"
							: section === "Trending memecoins"
								? "volume"
								: sort) as keyof Row
					] ?? -Infinity,
				) -
				Number(
					a[
						(section === "Launch radar"
							? "created"
							: section === "Trending memecoins"
								? "volume"
								: sort) as keyof Row
					] ?? -Infinity,
				),
		);
	const health: RecordData[] = Array.isArray(state?.health)
		? state.health
		: Object.entries(state?.health ?? {}).map(([provider, v]) => ({
				provider,
				...(typeof v === "object" ? (v as RecordData) : { status: v }),
			}));
	const settings = state?.settings;
	useEffect(() => {
		if (settings) {
			if (settings.threshold) setThreshold(String(settings.threshold));
			if (settings.spread) setSpread(String(settings.spread));
			if (settings.slippage !== undefined) setSlip(String(settings.slippage));
			if (settings.size) setAmount(String(settings.size));
		}
	}, [
		settings?.threshold,
		settings?.spread,
		settings?.slippage,
		settings?.size,
	]);
	const status = (v: RecordData) =>
		String(
			v.status ?? (v.error ? "error" : v.lastSuccess ? "online" : "unknown"),
		);
	const healthBlock = (
		<Panel
			title="Source telemetry"
			extra={<span className="tag">PROVIDERS</span>}
		>
			<div className="feedlist">
				{health.length ? (
					health.map((h, i) => (
						<div className="feed" key={i}>
							<span className="feed-icon">
								<Icon n={15} />
							</span>
							<div>
								<strong>{String(h.provider ?? h.name ?? "Provider")}</strong>
								<small>
									{h.lastSuccess
										? "Updated " + when(h.lastSuccess)
										: "Last success unavailable"}
								</small>
							</div>
							<em
								className={
									/ok|healthy|online|live/i.test(status(h)) ? "up" : ""
								}
							>
								{status(h)}
							</em>
						</div>
					))
				) : (
					<Empty>Waiting for provider telemetry.</Empty>
				)}
			</div>
		</Panel>
	);
	const sortLabel =
		section === "Trending memecoins"
			? "volume"
			: section === "Launch radar"
				? "created"
				: sort;
	const table = (
		<Panel
			title={
				section === "Command center"
					? "Token discovery"
					: section === "Launch radar"
						? "Pools created in the past 24 hours"
						: "Observed pools"
			}
			extra={<span className="tag">{listed.length} POOLS</span>}
		>
			<div className="filters">
				<input
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Search name, symbol or mint"
					aria-label="Search tokens"
				/>
				<button
					disabled={!!busy || query.trim().length < 2}
					onClick={() => action("search", { query })}
				>
					Search providers
				</button>
				<select
					aria-label="Venue filter"
					value={venue}
					onChange={(e) => setVenue(e.target.value)}
				>
					<option value="">All venues</option>
					{venues.map((v) => (
						<option key={v}>{v}</option>
					))}
				</select>
				<select
					aria-label="Sort by"
					disabled={["Trending memecoins", "Launch radar"].includes(section)}
					value={sortLabel}
					onChange={(e) => setSort(e.target.value)}
				>
					{["liquidity", "volume", "change", "ts", "created"].map((v) => (
						<option key={v} value={v}>
							{"Sort · " + v}
						</option>
					))}
				</select>
			</div>
			<div className="scroll">
				<table>
					<thead>
						<tr>
							{[
								"Token / mint",
								"Venue",
								"Price USD",
								"24h change",
								"Liquidity",
								"Volume 24h",
								...(section === "Signal center"
									? ["Signal", "Imbalance"]
									: section === "Liquidity & volume"
										? ["Liquidity Δ", "Volume Δ"]
										: section === "Launch radar"
											? ["Pool creation"]
											: []),
								"State",
							].map((t) => (
								<th key={t}>{t}</th>
							))}
						</tr>
					</thead>
					<tbody>
						{listed.slice(0, 250).map((r) => (
							<tr key={r.pool} onClick={() => detail(r)}>
								<td>
									<button className="tokenbtn" onClick={() => detail(r)}>
										<b>{r.symbol || "Unknown"}</b>
										<small>{short(r.mint)}</small>
									</button>
								</td>
								<td>{r.venue}</td>
								<td>{usd(r.price)}</td>
								<td className={Number(r.change) < 0 ? "red" : "green"}>
									{pct(r.change)}
								</td>
								<td>{usd(r.liquidity)}</td>
								<td>{usd(r.volume)}</td>
								{section === "Signal center" && (
									<>
										<td>{value(r.signal)}</td>
										<td>
											{num(r.imbalance) === null
												? "—"
												: pct(Number(r.imbalance) * 100)}
										</td>
									</>
								)}
								{section === "Launch radar" && <td>{when(r.created)}</td>}
								{section === "Liquidity & volume" && (
									<>
										<td>{pct(r.liquidityChange)}</td>
										<td>{pct(r.volumeChange)}</td>
									</>
								)}
								<td>{Date.now() - r.ts < 120000 ? "Recent" : "Stale"}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{!listed.length && (
				<Empty>
					{rows.length
						? "No pools match this view."
						: "No provider observations available."}
				</Empty>
			)}
		</Panel>
	);
	const saveSettings = () =>
		action("settings", {
			threshold: Number(threshold),
			spread: Number(spread),
			size: Number(amount),
			slippage: Number(slip),
			...Object.fromEntries(
				Object.entries(extraSettings).map(([k, v]) => [k, Number(v)]),
			),
		});
	const settingsBox = (
		<Panel title="Alert & simulation settings">
			<div className="formgrid">
				<label>
					Whale alert USD
					<select
						value={threshold}
						onChange={(e) => setThreshold(e.target.value)}
					>
						{[10000, 50000, 100000, 1000000].map((n) => (
							<option key={n} value={n}>
								{usd(n)}
							</option>
						))}
					</select>
				</label>
				<label>
					Gross spread filter
					<select value={spread} onChange={(e) => setSpread(e.target.value)}>
						{[15, 20, 25, 25.01].map((n) => (
							<option key={n} value={n}>
								{n === 25.01 ? "25%+" : n + "% and higher"}
							</option>
						))}
					</select>
				</label>
				<label>
					Trade size USD
					<input
						type="number"
						min="1"
						value={amount}
						onChange={(e) => setAmount(e.target.value)}
					/>
				</label>
				<label>
					Slippage (bps)
					<input
						type="number"
						min="0"
						max="1000"
						value={slip}
						onChange={(e) => setSlip(e.target.value)}
					/>
				</label>
				{Object.entries({
					minLiquidity: "Minimum liquidity USD",
					volumeMultiple: "Volume spike multiple",
					imbalance: "Imbalance threshold",
					networkFeeUsd: "Network fee USD",
					priorityFeeUsd: "Priority fee USD",
				}).map(([k, label]) => (
					<label key={k}>
						{label}
						<input
							type="number"
							step="any"
							value={extraSettings[k] ?? String(settings?.[k] ?? "")}
							onChange={(e) =>
								setExtraSettings({ ...extraSettings, [k]: e.target.value })
							}
						/>
					</label>
				))}
				<button disabled={!!busy} onClick={saveSettings}>
					Save settings
				</button>
			</div>
		</Panel>
	);
	function addressForm(route: string, label: string) {
		return (
			<form
				className="filters"
				onSubmit={(e: FormEvent) => {
					e.preventDefault();
					void action(
						route,
						route === "wallet" ? { address: addr } : { mint: addr },
						true,
					);
				}}
			>
				<input
					required
					value={addr}
					onChange={(e) => setAddr(e.target.value)}
					placeholder={label}
					aria-label={label}
				/>
				<button disabled={!!busy}>
					{route === "wallet" ? "Track wallet" : "Inspect mint"}
				</button>
			</form>
		);
	}
	const walletBlock = (
		<>
			<Panel title="Public wallet lookup">
				{addressForm("wallet", "Public Solana wallet address")}
				<p className="note">
					Confirmed transaction evidence from watched addresses. A transfer
					alone does not establish a trade.
				</p>
			</Panel>
			<Panel title="Wallet watchlist">
				{(state?.wallets ?? []).length ? (
					(state?.wallets ?? []).map((w) => (
						<div className="wallet-row" key={String(w)}>
							<a
								href={
									"https://explorer.solana.com/address/" +
									encodeURIComponent(String(w))
								}
								target="_blank"
								rel="noreferrer"
							>
								{short(w)} ↗
							</a>
							<button
								onClick={() => {
									setAddr(String(w));
									setResult(
										(state?.walletReports ?? []).find(
											(r) => r.address === w,
										) ?? { address: w, status: "Awaiting inspection" },
									);
								}}
							>
								Inspect history
							</button>
							<button
								disabled={!!busy}
								onClick={() => action("wallet", { address: w, remove: true })}
							>
								Remove
							</button>
						</div>
					))
				) : (
					<Empty>No watched public wallets.</Empty>
				)}
			</Panel>
			<Panel
				title={
					section === "Whale movements"
						? "Large transfer alerts"
						: "Wallet timeline"
				}
			>
				<Records
					list={(state?.events ?? []).filter(
						(e) =>
							section !== "Whale movements" ||
							Number(e.usd) >= Number(settings?.threshold ?? 10000),
					)}
				/>
			</Panel>
		</>
	);
	const overview = section === "Command center",
		arb = section === "Arbitrage hunter",
		wallet = ["Whale movements", "Wallet watchlist"].includes(section),
		security = ["Security analyzer", "Insider / bundle risk"].includes(section);
	const description: Record<string, string> = {
		"Command center":
			"Solana market activity, on-chain evidence and paper research.",
		"Launch radar":
			"Recent pool creation reported by discovery providers. Polling and indexing add latency.",
		"Trending memecoins": "Observed pools ranked by reported 24-hour volume.",
		"Arbitrage hunter":
			"Compare same-mint pool prices and request two-leg route evidence.",
		"Signal center":
			"Inspect a pool to review its rule-based scenario and inputs.",
		"Historical analytics":
			"Select a pool to explore timestamped observations and sampled candles.",
		"Liquidity & volume":
			"Compare pool liquidity and volume. Select a pool to inspect its history.",
		"Insider / bundle risk":
			"Inspect concentration evidence. Common ownership and coordinated acquisitions require additional evidence.",
		"Paper portfolio":
			"Virtual balances and simulated fills in the local research portfolio.",
	};
	return (
		<div className="shell">
			<aside className={menu ? "opened" : ""}>
				<div className="brand">
					<svg viewBox="0 0 44 42" width="40" height="40" aria-hidden="true">
						<path d="M6 32L21 5h10L16 32z" fill="#6fffc9" />
						<path d="M21 35L34 12l5 9-8 14z" fill="#30bda4" />
					</svg>
					<div>
						<strong>JARVIS</strong>
						<small>SOLANA INTELLIGENCE</small>
					</div>
				</div>
				<nav>
					{groups.map((g) => (
						<div className="navgroup" key={g[0]}>
							<h3>{g[0]}</h3>
							{g.slice(1).map((s) => (
								<button
									key={s}
									className={s === section ? "active" : ""}
									onClick={() => navigate(s)}
								>
									<Icon n={sections.indexOf(s)} />
									{s}
								</button>
							))}
						</div>
					))}
				</nav>
				<div className="sidefoot">
					<i /> Local research terminal
				</div>
			</aside>
			<main>
				<div className="topbar">
					<button
						className="mobilemenu"
						onClick={() => setMenu(!menu)}
						aria-label="Toggle navigation"
					>
						☰
					</button>
					<span>
						Workspace <b>/</b> <strong>{section}</strong>
					</span>
					<span className="paperpill">
						<i /> PAPER MODE
					</span>
				</div>
				<div className="content">
					<div className="heading">
						<div>
							<div className="overline">
								<span /> SOLANA INTELLIGENCE
							</div>
							<h1>
								{section === "Command center" ? "Command Center" : section}
							</h1>
							<p>
								{description[section] ??
									"Explore source-attributed Solana observations."}
							</p>
						</div>
						<button
							className="refresh"
							onClick={() => action("refresh")}
							disabled={!!busy}
						>
							<span>⟳</span>{" "}
							{busy === "refresh" ? "Refreshing…" : "Refresh data"}
						</button>
					</div>
					{error && (
						<div className="notice" role="alert">
							{error}
						</div>
					)}
					{message && (
						<div className="notice" role="status">
							{message}
							<button aria-label="Dismiss" onClick={() => setMessage("")}>
								×
							</button>
						</div>
					)}
					{overview && (
						<>
							<div className="kpis">
								{[
									["Tracked tokens", mints.size, "Unique mint addresses", 1],
									["DEX venues", venues.length, "Observed venues", 7],
									["Fresh pools", fresh.length, "Within two minutes", 2],
									["Paper balance", usd(state?.cash), "Virtual cash · USD", 13],
								].map(([label, v, foot, icon]) => (
									<div className="kpi" key={label}>
										<span>
											{label}
											<Icon n={Number(icon)} />
										</span>
										<strong>{v}</strong>
										<small>{foot}</small>
									</div>
								))}
							</div>
							<div className="hero">
								<Panel
									title="Market radar"
									extra={<span className="tag">POOL COVERAGE</span>}
								>
									<Radar rows={fresh} select={detail} />
									<div className="radar-legend">
										<i /> Observed liquidity × volume <span>2 MIN WINDOW</span>
									</div>
								</Panel>
								{healthBlock}
							</div>
						</>
					)}
					{(overview ||
						[
							"Token discovery",
							"Launch radar",
							"Trending memecoins",
							"Watchlists & alerts",
							"Signal center",
							"Liquidity & volume",
							"Historical analytics",
						].includes(section)) &&
						table}
					{(section === "Watchlists & alerts" ||
						section === "Signal center" ||
						arb ||
						section === "Whale movements") &&
						settingsBox}
					{section === "Launch radar" && (
						<Panel title="Finalized launch and migration evidence">
							<p className="note">
								One recent Pump pool mint is sampled per cycle. Open a pool to
								inspect its five latest mint signatures and bonding curve.
							</p>
							<Records
								list={(state?.protocolEvents ?? []).filter((e) =>
									/CREATED|MIGRAT/.test(String(e.type)),
								)}
							/>
						</Panel>
					)}
					{section === "Liquidity & volume" && (
						<Panel title="Finalized liquidity changes">
							<Records
								list={(state?.protocolEvents ?? []).filter((e) =>
									String(e.type).includes("LIQUIDITY"),
								)}
							/>
						</Panel>
					)}
					{section === "Liquidity & volume" && (
						<Panel title="Volume spike detector">
							<p className="note">
								Latest five-minute volume divided by average five-minute volume
								during the preceding 55 minutes. Alert threshold{" "}
								{String(settings?.volumeMultiple ?? 3)}×.
							</p>
							<Records
								list={rows
									.filter((r) => r.volumeSpike)
									.map((r) => ({
										symbol: r.symbol,
										pool: r.pool,
										multiple: r.volumeRatio,
										ts: r.ts,
									}))}
							/>
							{settingsBox}
						</Panel>
					)}
					{wallet && walletBlock}
					{wallet && (
						<Panel title="Finalized trades by watched wallets">
							<Records
								list={(state?.protocolEvents ?? []).filter(
									(e) =>
										state?.wallets.includes(e.actor) &&
										["BUY", "SELL"].includes(String(e.type)),
								)}
							/>
						</Panel>
					)}
					{security && (
						<Panel title="On-chain mint inspection">
							{addressForm("security", "Solana token mint address")}
						</Panel>
					)}
					{section === "Smart money & KOL" && (
						<Panel title="GMGN read-only research">
							<form
								className="filters"
								onSubmit={(e) => {
									e.preventDefault();
									void action("gmgn", { kind, address: addr }, true);
								}}
							>
								<select value={kind} onChange={(e) => setKind(e.target.value)}>
									{[
										"demo",
										"market",
										"wallet",
										"smartmoney",
										"kol",
										"token",
										"security",
									].map((k) => (
										<option key={k}>{k}</option>
									))}
								</select>
								<input
									value={addr}
									onChange={(e) => setAddr(e.target.value)}
									placeholder="Public address when applicable"
								/>
								<button disabled={!!busy}>Query GMGN</button>
							</form>
						</Panel>
					)}
					{arb && (
						<>
							<Panel title="Arbitrage spread heatmap">
								<Heatmap opportunities={state?.opportunities ?? []} />
								<div className="opps">
									{(state?.opportunities ?? []).map((o, i) => (
										<article key={i}>
											<b>{value(o.symbol ?? o.mint)}</b>
											<span>
												{value(o.buyVenue)} → {value(o.sellVenue)}
											</span>
											<strong>{pct(o.gross)}</strong>
											<em>{value(o.status)}</em>
											<button
												disabled={!!busy}
												onClick={() =>
													action(
														"quote",
														{
															mint: o.mint,
															buyPool: o.buyPool,
															sellPool: o.sellPool,
															size: Number(amount),
														},
														true,
													)
												}
											>
												Check quotes
											</button>
										</article>
									))}
								</div>
								{!state?.opportunities?.length && (
									<Empty>
										No observed spreads meet the configured threshold.
									</Empty>
								)}
							</Panel>
							<Panel title="Quote verification history">
								<Records list={state?.quoteHistory ?? []} />
							</Panel>
							<Panel title="Observed spread history">
								<Records list={state?.candidateHistory ?? []} />
							</Panel>
							<Panel title="Paper arbitrage journal">
								<Records list={state?.journal ?? []} />
							</Panel>
						</>
					)}
					{section === "API health" && (
						<>
							{healthBlock}
							<Panel title="Provider diagnostics">
								<Records list={health} />
							</Panel>
						</>
					)}
					{section === "Paper portfolio" && (
						<>
							<Panel title="Virtual cash">
								<div className="balance">{usd(state?.cash)}</div>
								<p className="note">
									Select an observed pool below to simulate a buy or sell.
								</p>
							</Panel>
							{table}
							<Panel title="Marked portfolio">
								<Records
									list={[
										{
											equity: usd(state?.equity),
											totalPnl: usd(state?.totalPnl),
											unpricedPositions: state?.unpricedPositions,
										},
									]}
								/>
								<p className="note">
									Open positions use a recent sample from the deepest observed
									pool per mint. Equity requires a current mark for every open
									position.
								</p>
							</Panel>
							<Panel title="Positions & realized performance">
								<Records list={state?.positions ?? []} />
							</Panel>
							<Panel
								title="Paper trade history"
								extra={
									<a href="/api/export" download>
										Export CSV ↓
									</a>
								}
							>
								<Records list={state?.trades ?? []} />
							</Panel>
						</>
					)}
					{result && !selected && (
						<Panel title="Research result">
							<Records list={[result]} />
							{result.status === "QUOTE VERIFIED" && (
								<button
									disabled={!!busy}
									onClick={() => action("simulate", { id: result.id }, true)}
								>
									Simulate verified quote
								</button>
							)}
						</Panel>
					)}
					<CoffeeSupport />
                    <footer>
						JARVIS <span>/</span> Solana Intelligence <b>READ-ONLY RESEARCH</b>
					</footer>
				</div>
			</main>
			{selected && (
				<div className="overlay" onClick={() => setSelected(null)}>
					<section
						className="drawer"
						role="dialog"
						aria-label="Pool detail"
						onClick={(e) => e.stopPropagation()}
					>
						<button
							className="close"
							onClick={() => setSelected(null)}
							aria-label="Close details"
						>
							×
						</button>
						<div className="overline">POOL INTELLIGENCE</div>
						<h1>{selected.symbol}</h1>
						<p>
							{selected.name} · {selected.venue}
						</p>
						<button
							disabled={!!busy}
							onClick={() => action("watch", { mint: selected.mint })}
						>
							{inWatch(selected) ? "Remove from watchlist" : "Add to watchlist"}
						</button>
						<Panel
							title="Market observation"
							extra={
								<span className="tag">
									{Date.now() - selected.ts < 120000 ? "RECENT" : "STALE"}
								</span>
							}
						>
							<Records
								list={[
									{
										mint: selected.mint,
										pool: selected.pool,
										price: usd(selected.price),
										liquidity: usd(selected.liquidity),
										volume: usd(selected.volume),
										marketCap: usd(selected.cap),
										holders: selected.holders,
										firstPool: when(selected.firstPoolAt),
										discoveredBy: selected.discoveredBy,
										buys: selected.buys,
										sells: selected.sells,
										source: selected.source,
										observed: when(selected.ts),
										poolCreated: when(selected.created),
									},
								]}
							/>
						</Panel>
						<Panel title="Launch and pool instructions">
							<button
								disabled={!!busy}
								onClick={() =>
									action("protocol", { mint: selected.mint }, true)
								}
							>
								Inspect finalized activity
							</button>
							<p className="note">
								Direct Pump.fun and PumpSwap instructions. Historical coverage
								depends on available finalized transactions.
							</p>
							<Records
								list={(state?.protocolEvents ?? []).filter(
									(e) => e.mint === selected.mint,
								)}
							/>
						</Panel>
						<Panel title="Sampled price history">
							<Candles rows={history.filter((r) => r.pool === selected.pool)} />
						</Panel>
						<details className="samples">
							<summary>Historical market observations</summary>
							<History
								observations={history.filter((r) => r.pool === selected.pool)}
							/>
						</details>
						<Panel title="Signal & risk scenarios">
							<Records
								list={[
									typeof selected.signal === "object" && selected.signal
										? (selected.signal as RecordData)
										: {
												signal: selected.signal ?? "WAIT",
												imbalance: selected.imbalance,
												momentum: pct(selected.momentum),
												liquidityChange: pct(selected.liquidityChange),
												volumeChange: pct(selected.volumeChange),
												rollingVolumeAccelerationUsdPerMinSquared:
													selected.volumeAcceleration,
												volatility: selected.volatility,
												scenario: selected.scenario ?? "Unavailable",
											},
								]}
							/>
							<button
								onClick={() =>
									action("security", { mint: selected.mint }, true)
								}
								disabled={!!busy}
							>
								Inspect on-chain risk
							</button>
							<p className="note">
								Imbalance = (buys − sells) / (buys + sells). Watch rules require
								three earlier samples, qualifying liquidity and price movement
								in the same direction as the imbalance. Changes compare
								consecutive observations.
							</p>
						</Panel>
						<Panel title="Long scenario calculator">
							<div className="formgrid">
								{(["entry", "stop", "target"] as const).map((k) => (
									<label key={k}>
										{k}
										<input
											type="number"
											step="any"
											value={risk[k]}
											onChange={(e) =>
												setRisk({ ...risk, [k]: e.target.value })
											}
										/>
									</label>
								))}
							</div>
							<p className="note">
								Reward / risk = (target − entry) / (entry − stop) ·{" "}
								<strong>
									{Number(risk.stop) > 0 &&
									Number(risk.entry) > Number(risk.stop) &&
									Number(risk.target) > Number(risk.entry)
										? (
												(Number(risk.target) - Number(risk.entry)) /
												(Number(risk.entry) - Number(risk.stop))
											).toFixed(2) + "×"
										: "Unavailable"}
								</strong>
							</p>
						</Panel>
						<Panel title="Simulated fill">
							<div className="formgrid">
								<label>
									Side
									<select
										value={side}
										onChange={(e) => setSide(e.target.value)}
									>
										<option>buy</option>
										<option>sell</option>
									</select>
								</label>
								<label>
									Notional USD
									<input
										type="number"
										min="1"
										value={amount}
										onChange={(e) => setAmount(e.target.value)}
									/>
								</label>
								<label>
									Slippage (bps)
									<input
										type="number"
										min="0"
										value={slip}
										onChange={(e) => setSlip(e.target.value)}
									/>
								</label>
								<button
									disabled={!!busy}
									onClick={() =>
										action(
											"paper",
											{
												mint: selected.mint,
												pool: selected.pool,
												side,
												size: Number(amount),
												slippage: Number(slip),
											},
											true,
										)
									}
								>
									Simulate {side}
								</button>
							</div>
						</Panel>
						{message && <p role="status">{message}</p>}
						{result && <Records list={[result]} />}
					</section>
				</div>
			)}
		</div>
	);
}
