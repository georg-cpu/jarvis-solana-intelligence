# Solana RPC evidence and coverage

The local backend queries finalized mainnet data for a supplied public address. Each wallet inspection requests the native balance, classic SPL and Token-2022 holdings, and the five latest signatures referencing that address. It retrieves successful transactions with parsed instructions and supports version 0 and legacy transactions. The response preserves RPC gaps and transaction-level SOL balance changes (including fees).

The transfer parser recognizes System Program native SOL transfers and standard SPL transfer and transferChecked instructions, including inner instructions. Each event records the signature, instruction position, slot, block timestamp, exact atomic-unit amount, source and destination accounts, and recorded token-account owners when available. A null owner means unknown. Native SOL has no mint address. Transaction explorer links open the original evidence.

Token-specific net flows aggregate observed incoming and outgoing quantities for the inspected address. USD estimates require a same-mint price observation from the two minutes preceding the block timestamp. Native SOL uses the wrapped SOL market as a proxy. RPC history can predate the local observation window, in which case USD estimates remain unavailable. Net flows and balance changes alone do not establish purchases, realized returns, accumulation, or distribution.

The bounded sample can miss transactions on busy wallets and inbound SPL transfers referencing only a token account. No chain-wide whale coverage, initial liquidity attribution, inferred common ownership, smart-money profitability ranking, or protocol-specific swap and liquidity classification is assumed. Holdings and bank balances can reflect different finalized slots. Human-readable quantities are approximate floating-point values. Use the raw units for exact comparisons.

Mint inspection checks the account's owner program and parsed mint type, including mint and freeze authorities, inline Token-2022 metadata when available, and named extensions. Null authority denotes revoked. UNKNOWN denotes insufficient evidence. Unknown extensions and external metadata are not evaluated. The 20 largest token accounts and mint supply provide rough top-one and top-ten account percentages only when the two finalized observations differ by at most 40 slots and amounts are consistent. Separate observations can still differ within that interval. Concentration can include exchange custody, pool vaults and treasury accounts. Unique holders, developer control, and beneficial ownership are unknown.

Read-only calls are routed through the central provider scheduler. The public Solana RPC is shared, throttled infrastructure. Rate limits change and historical transaction availability varies. Each inspection reports partial errors and returns available observations.

Official references

- [Public RPC clusters and limits](https://solana.com/docs/references/clusters)
- [getAccountInfo](https://solana.com/docs/rpc/http/getaccountinfo) and [getTokenLargestAccounts](https://solana.com/docs/rpc/http/gettokenlargestaccounts)
- [getSignaturesForAddress](https://solana.com/docs/rpc/http/getsignaturesforaddress) and [getTransaction](https://solana.com/docs/rpc/http/gettransaction)
- [getTokenAccountsByOwner](https://solana.com/docs/rpc/http/gettokenaccountsbyowner) and [getBalance](https://solana.com/docs/rpc/http/getbalance)

## Launch and protocol evidence

The worker rotates through recently observed Pump venue mints, requesting up to five finalized signatures per selected mint. The same inspection is available from pool details. A wallet inspection also decodes direct instructions with that wallet in the actor role. The allowlist matches the deployed program address, eight-byte instruction discriminator and account roles from the official IDLs. Transaction failure, unknown layouts and inner instructions are excluded. A migration call is idempotent. The stronger migration label requires the referenced pool to have zero lamports before the transaction and a positive post-balance. Curve completion is read separately at a finalized slot, using program ownership, account discriminator and stored completion flag. A missing curve account leaves its current state unknown.

The browser displays detected liquidity movements and wallet trades with transaction links. Sampled history cannot reconstruct every launch or trade. The volume alert uses the ratio of five-minute volume to the five-minute average over the previous 55 minutes. Zero or missing baselines yield UNKNOWN. Portfolio equity requires a recent mark for each open holding and uses the deepest eligible pool for that mint.

[Pump instruction layouts](https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump.json) and [PumpSwap instruction layouts](https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump_amm.json).
