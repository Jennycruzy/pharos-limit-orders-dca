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

## Just talk to it (plain English)

This is an **agent skill** — the normal way to use it is to tell your agent what
you want in everyday language. You don't run commands or edit addresses yourself;
the agent maps your sentence to the right action and makes sure the watcher is
running. Things you can say:

| You say…                                         | What happens                                              |
| ------------------------------------------------ | --------------------------------------------------------- |
| "Sell 100 PHRS when it hits $0.50."              | Creates a limit sell at 0.50 USDC and starts the watcher. |
| "Buy PHRS if it drops to $0.30, spend 50 USDC."  | Creates a limit buy at 0.30 USDC.                         |
| "DCA $20 into PHRS every week."                  | Creates a recurring buy of 20 USDC every 7 days.          |
| "What orders do I have?"                         | Lists your orders, their status, and any fills.           |
| "Cancel that one."                               | Cancels the order.                                        |
| "Is it still watching?"                          | Reports whether the background watcher is running.        |

One-time setup before your first order: `npm install`, then put your wallet's
`PRIVATE_KEY` in `.env` (copy `.env.example`). That's it — all the FaroSwap and
token addresses are already filled in for both testnet and mainnet. The sections
below document the underlying CLI the agent drives for you.

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

One command (clones if needed, installs deps, scaffolds `.env`, and links the
skill into Claude Code):

```bash
curl -fsSL https://raw.githubusercontent.com/Jennycruzy/pharos-limit-orders-dca/main/install.sh | bash
```

Or manually:

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

This repo is packaged as an **agent skill**, and it's agent-neutral: the same
instructions ship in the entry file each tool reads —
`SKILL.md` (Claude Code), `AGENTS.md` (Codex / Jules / Zed / Aider), and
`.cursor/rules/` (Cursor). Each tells the model *when* to reach for the skill and
*how* to drive it. The CLI is intentionally the entire surface area: one `add`
command per user intent, plus a watcher to start. For a step-by-step live demo,
see [`DEMO.md`](DEMO.md).

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

All on-chain wiring lives in `scripts/config.ts`, keyed by network, and is
**already filled in for both testnet and mainnet** — there is nothing for you to
look up or paste. It selects `testnet` by default (where FaroSwap has faucet
liquidity, so test fills actually execute) and exposes `mainnet` too. Addresses
come from FaroSwap's own deployment (testnet) and from a real on-chain FaroSwap
swap confirmed via `symbol()`/`decimals()`/`token0()`/`token1()` (mainnet).

Two safety nets mean a bad address can never cause a bad trade:

- The WPHRS/USDC pool is **auto-discovered** from FaroSwap's V3 factory at
  runtime, so you never paste a pool address. If a token address were wrong, the
  pool lookup fails and the watcher refuses to start with a clear error — it
  never trades against the wrong token.
- `assertConfigured()` refuses to start while any required address is still a
  zero placeholder.

Each network simply uses the router FaroSwap actually exposes there: a plain V3
`SwapRouter` on **testnet**, and FaroSwap's **DODO route proxy** (`mixSwap`) on
**mainnet**. On mainnet, the route's calldata is built by DODO's hosted
pathfinder, and the executor anchors safety on-chain — it submits only if the
API's returned router matches the configured `dodoRouteProxy` *and* the quote
clears the local slippage floor. Both paths are wired and ready; you don't pick
one, the code uses the right one for the selected network.

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
├── SKILL.md          # agent entry point (Claude Code): when-to-trigger, commands, safety
├── AGENTS.md         # same skill for Codex / Jules / Zed / Aider (cross-agent standard)
├── .cursor/rules/    # same skill for Cursor
├── DEMO.md           # step-by-step live demo runbook + hand-off prompt
├── install.sh        # one-command setup (clone, deps, .env, skill link)
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
execute. Set `PHAROS_NETWORK=mainnet` (1672) to trade real funds — mainnet is
fully wired (tokens, pool, and the DODO route proxy fill path). Whichever you
use, state it plainly so the user knows which network an order will fire on.

## License

MIT.
