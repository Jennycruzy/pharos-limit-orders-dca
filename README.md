# Pharos Limit Orders & DCA Automation

Unattended **limit orders** and recurring **DCA** (dollar-cost-averaging) swaps on
the **Pharos Network** via the **FaroSwap** DEX (a Uniswap-V3 fork).

A plain AMM swap fires the instant you send it. The one thing an AMM *can't* do
natively is wait — sell only when a price target is hit, or buy a little on a
fixed schedule. This skill is that missing piece: it stores your order and keeps
a background watcher polling the live FaroSwap price, firing the swap **only when
the order's trigger condition is met**. The persistence *is* the product.

Limit orders and DCA are deliberately **one engine**. They share the order store
(`scripts/store.ts`), the watcher loop (`scripts/watcher.ts`), and the executor
(`scripts/swap.ts`). The only thing that differs between them is the trigger
predicate in `scripts/trigger.ts`.

---

## How it works

```
add order ──▶ store.ts (orders.json)
                  │
                  ▼
            watcher.ts  ──poll every 30s──▶ price.ts  (USDC-per-WPHRS from the V3 pool's slot0)
                  │
                  ▼
            trigger.ts  ──"should this fire now?"──┐
                  │                                 │  limit: price crossed the target
                  ▼                                 │  dca:   the interval elapsed
            swap.ts  ──re-read price, run safety guards, approve, swap on FaroSwap──▶ on-chain fill
```

- **Limit order** — fires when the live price crosses a target.
  `sell WPHRS when price >= 0.50`, `buy WPHRS when price <= 0.30`.
  One-shot: once filled, the order's status becomes `filled`.
- **DCA (recurring)** — fires every N seconds regardless of price.
  `buy 20 USDC of WPHRS every 7 days`. After each fill it reschedules itself for
  the next interval, so it runs indefinitely until you cancel it.

The trading pair is **WPHRS / USDC**, and price is always quoted as **USDC per
WPHRS**. Pharos's native token is PHRS; `WPHRS` is its wrapped ERC-20, which is
what the FaroSwap V3 pools actually hold. The CLI accepts `PHRS`, `PROS`, or
`WPHRS` and normalizes them all to `WPHRS`.

---

## Installation

```bash
npm install
cp .env.example .env          # then edit it
```

`.env`:

| Variable      | Purpose                                              |
| ------------- | ---------------------------------------------------- |
| `PRIVATE_KEY` | Wallet that signs fills. Read from env, never logged.|
| `RPC_URL`     | Pharos RPC endpoint (a sane default is built in).    |
| `ORDERS_FILE` | Where orders persist. Defaults to `./orders.json`.   |

Optional environment overrides:

| Variable                 | Default                                  | Purpose                                |
| ------------------------ | ---------------------------------------- | -------------------------------------- |
| `PHAROS_NETWORK`         | `testnet`                                | `testnet` (688688) or `mainnet` (1672).|
| `FAROSWAP_ROUTE_API`     | DODO hosted route service                | DODO pathfinder endpoint for mainnet.  |
| `FAROSWAP_ROUTE_API_KEY` | built-in widget key                      | API key for the route service.         |

---

## CLI reference

Everything goes through a single entry point, `scripts/orders.ts`, run with
`npx ts-node`.

### `add` — create an order

```bash
# Limit: sell 100 WPHRS once 1 WPHRS is worth >= 0.50 USDC
npx ts-node scripts/orders.ts add --type limit --side sell --pay WPHRS --amount 100 --target 0.50

# Limit: buy WPHRS with 50 USDC once the price falls to <= 0.30 USDC
npx ts-node scripts/orders.ts add --type limit --side buy  --pay USDC  --amount 50  --target 0.30

# DCA: spend 20 USDC buying WPHRS every 7 days
npx ts-node scripts/orders.ts add --type dca   --side buy  --pay USDC  --amount 20  --every 7d
```

| Flag       | Required for | Meaning                                                            |
| ---------- | ------------ | ------------------------------------------------------------------ |
| `--type`   | all          | `limit` or `dca`.                                                  |
| `--side`   | all          | `buy` or `sell`.                                                   |
| `--pay`    | all          | The token you spend: `WPHRS`/`PHRS`/`PROS` or `USDC`.              |
| `--amount` | all          | Amount of `--pay` token to spend per fill. Must be `> 0`.          |
| `--target` | `limit`      | Trigger price in **USDC per WPHRS**. Sell fires `>=`, buy fires `<=`. |
| `--every`  | `dca`        | Interval: `30s`, `15m`, `6h`, `7d` (`s`/`m`/`h`/`d` suffixes).     |

If the watcher isn't running when you add an order, the CLI warns you — the order
is saved but won't fire until you start the watcher.

### `list` — show all orders and their status

```bash
npx ts-node scripts/orders.ts list
```

Prints each order's id, status, type, side, amount, trigger condition, fill count,
and last transaction hash.

### `cancel` — cancel an active order

```bash
npx ts-node scripts/orders.ts cancel --id <id>
```

### `status` — is the watcher alive?

```bash
npx ts-node scripts/orders.ts status      # -> "watcher: running" | "watcher: stopped"
```

### `watch` — run the watcher (this is what makes it persistent)

```bash
npx ts-node scripts/orders.ts watch            # foreground; blocks, logs each poll
npx ts-node scripts/orders.ts watch --daemon   # detached background process
```

The watcher must be running for any order to fire. `--daemon` re-spawns the
process detached and records its PID in `watcher.pid`, which `status` and `add`
use to detect whether it's alive.

---

## How agents use this skill

This repo is packaged as an **Agent Skill** (`SKILL.md` + `scripts/`). An agent
host loads `SKILL.md`, whose `description` front-matter tells the model *when* to
reach for it, and the body tells it *how*. The CLI is intentionally the entire
surface area: one `add` command per user intent, plus a watcher to start.

**1. Recognize the intent.** Trigger this skill whenever a swap should happen
*later* or *repeatedly* rather than now — phrases like "sell my PHRS when it hits
$0.50", "DCA into PHRS", "buy 20 USDC of PHRS every Monday", "set a limit order",
or "swap when the price drops". A request for an *immediate* swap is **not** this
skill.

**2. Map natural language to exactly one `add` call.** Infer the flags:

| The user says…                              | Becomes                                                        |
| ------------------------------------------- | -------------------------------------------------------------- |
| "sell my PHRS when it hits $0.50"           | `--type limit --side sell --pay WPHRS --amount <n> --target 0.50` |
| "buy PHRS if it drops to $0.30"             | `--type limit --side buy  --pay USDC  --amount <n> --target 0.30` |
| "DCA $20 into PHRS every week"              | `--type dca   --side buy  --pay USDC  --amount 20 --every 7d`     |
| "sell a bit of PHRS every day"              | `--type dca   --side sell --pay WPHRS --amount <n> --every 1d`    |

- "sell X when…" → `side sell`, you pay the base token (WPHRS).
- "buy / DCA into X" → `side buy`, you pay the quote token (USDC).
- A price like "$0.50" is `--target 0.50` (USDC per WPHRS).
- "every week" → `--every 7d`; accept `s`/`m`/`h`/`d`.

**3. Always ensure the watcher is running.** After creating an order, check
`status`; if it says `stopped`, start it with `watch --daemon`. An order with no
watcher silently never fires — this is the single most common failure mode, so
verify it explicitly.

**4. Manage the lifecycle.** Use `list` to report current orders and their fill
history back to the user, and `cancel --id` to remove one. Surface the printed
transaction hashes so the user can confirm fills on the explorer.

**5. Respect the safety contract.** The executor enforces guards on every
unattended fill (below) and **aborts** rather than taking a bad trade. An agent
must never work around them — never widen slippage to force a fill, and never log
or echo the private key.

---

## Configuration & addresses

All on-chain wiring lives in `scripts/config.ts`, keyed by network. It selects
`testnet` by default (where FaroSwap is fully live with faucet liquidity) and
exposes `mainnet` too. Addresses come from FaroSwap's own deployment config and
docs, or were extracted from a real on-chain swap and confirmed via
`symbol()`/`decimals()`/`token0()`/`token1()` — **not** from third-party bots,
which disagree with each other on token addresses.

`assertConfigured()` refuses to run the watcher while any money-moving address is
still a zero placeholder, and the V3 pool is **auto-discovered** from the verified
factory at runtime, so you never paste a pool address by hand.

### Verifying the USDC address (testnet)

USDC is an external token (not in FaroSwap's repo), so on testnet it ships as a
zero placeholder and the watcher will refuse to run until you fill it. To verify
it the right way — don't trust a pasted address for a money-moving call:

1. Do one tiny WPHRS↔USDC swap in the FaroSwap app.
2. Open that transaction on the Pharos explorer (`testnet.pharosscan.xyz`).
3. Read the token-transfer rows: the non-WPHRS token is USDC. Confirm its
   `symbol()` is `USDC` and `decimals()` is `6`.
4. Paste it into `TOKENS.USDC.address` for the `testnet` block in `config.ts`.

Confirm with a **read before any write**: run the watcher in the foreground and
check the logged price is a believable USDC/WPHRS number. If it is, the pool,
tokens, and decimals are all wired correctly.

### Mainnet fill path

On mainnet the WPHRS/USDC pool and token addresses are verified and **price reads
work today**. The plain V3 `SwapRouter` (`exactInputSingle`) is *not* yet verified
on mainnet, so it stays a zero placeholder and `assertConfigured()` blocks
unattended fills until the fill path is settled. FaroSwap's mainnet swaps settle
through a DODO route proxy (`mixSwap`) whose calldata is built by DODO's hosted
pathfinder; the executor anchors safety on-chain by submitting only if the API's
returned router matches the configured `dodoRouteProxy` and the quote clears the
local slippage floor.

---

## Safety

Because trades fire while you're away, the executor enforces these guards from
`scripts/config.ts` on **every** fill and aborts the fill — leaving the order
active to retry — rather than taking a bad trade. It never widens slippage to
force a trade.

| Guard            | Default        | Effect                                                       |
| ---------------- | -------------- | ------------------------------------------------------------ |
| `SLIPPAGE_BPS`   | `50` (0.50%)   | `amountOutMinimum = quote * (1 - SLIPPAGE_BPS)`.             |
| `MAX_IMPACT_BPS` | `300` (3.00%)  | Abort the fill if estimated price impact exceeds this.       |
| `POLL_INTERVAL_MS` | `30_000`     | How often the watcher re-checks price/time.                  |
| Balance check    | —              | Abort if the wallet can't cover the amount plus gas.         |
| Re-read at fill  | —              | The trigger price is re-read at execution; a stale trigger is re-validated. |

The private key is read from `env` and never logged.

> **Note:** the price-impact estimate in `scripts/swap.ts` is a TODO. Out of the
> box the slippage floor is the hard protection. Wire a real impact calculation
> from pool liquidity before running large unattended sizes.

---

## Repository layout

```
pharos-limit-orders-dca/
├── SKILL.md          # agent entry point: when-to-trigger description, commands, safety
├── README.md         # this file
├── package.json      # ethers v6 + ts-node
├── tsconfig.json
├── .env.example      # PRIVATE_KEY, RPC_URL, ORDERS_FILE
└── scripts/
    ├── config.ts     # network-keyed config: tokens, FaroSwap addresses, safety, assertConfigured()
    ├── store.ts      # Order type + JSON-file persistence (add/list/cancel/update)
    ├── trigger.ts    # shouldFire() — the ONLY place limit vs DCA differ
    ├── price.ts      # getPrice() — USDC-per-WPHRS from the V3 pool's slot0 (sqrtPriceX96)
    ├── dodoRoute.ts  # DODO route-service client for the mainnet mixSwap fill path
    ├── swap.ts       # executeFill() — balance check, slippage floor, approve, swap
    ├── watcher.ts    # runWatcher() — poll loop that fires triggered orders
    └── orders.ts     # CLI: add | list | cancel | status | watch
```

## Network

Defaults to **testnet (688688)**, which has faucet liquidity so fills actually
execute. Set `PHAROS_NETWORK=mainnet` (1672) once the mainnet fill path is
settled (see *Mainnet fill path* above). Whichever you use, state it plainly.

## License

MIT.
