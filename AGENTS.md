# AGENTS.md — Pharos Limit Orders & DCA

Cross-agent instructions for this repo. This is the same skill described in
`SKILL.md` (Claude Code) and `.cursor/rules/` (Cursor), written here in the
tool-neutral `AGENTS.md` convention so **any** coding agent — Codex, Cursor,
Jules, Zed, Aider, etc. — can drive it. If you are an agent reading this, follow
it directly.

## What this skill does

Unattended **limit orders** and recurring **DCA** swaps on the **Pharos Network**
via the **FaroSwap** DEX. An order is stored and a background watcher polls the
live price, firing the swap only when the trigger condition is met:

- **Limit** — fires when price crosses a target (`sell when price >= 0.50`,
  `buy when price <= 0.30`). One-shot.
- **DCA** — fires every N seconds regardless of price, then reschedules itself.

The pair is **WPHRS / USDC**; price is **USDC per WPHRS**. Native PHRS is traded
as its wrapped form WPHRS; the CLI accepts `PHRS`/`PROS`/`WPHRS` and normalizes
them.

## When to use it

Trigger this whenever the user wants a swap to happen **later** or **repeatedly**
rather than now: "sell my PHRS when it hits $0.50", "DCA $20 into PHRS every
week", "set a limit order", "buy when it dips to $0.30". An immediate swap is
NOT this skill.

## How to drive it

Everything is one CLI: `scripts/orders.ts`, run with `npx ts-node`. Map the
user's sentence to exactly one `add` call, then make sure the watcher runs.

```bash
# Limit: sell 100 WPHRS once 1 WPHRS >= 0.50 USDC
npx ts-node scripts/orders.ts add --type limit --side sell --pay WPHRS --amount 100 --target 0.50

# DCA: spend 20 USDC buying WPHRS every 7 days
npx ts-node scripts/orders.ts add --type dca --side buy --pay USDC --amount 20 --every 7d

npx ts-node scripts/orders.ts list              # show orders + fills
npx ts-node scripts/orders.ts cancel --id <id>  # cancel one
npx ts-node scripts/orders.ts status            # is the watcher running?
npx ts-node scripts/orders.ts price             # live price, read-only (no order/funds)
npx ts-node scripts/orders.ts watch             # foreground (good for demos)
npx ts-node scripts/orders.ts watch --daemon    # detached background process
```

| Flag       | For    | Meaning                                                      |
| ---------- | ------ | ------------------------------------------------------------ |
| `--type`   | all    | `limit` or `dca`                                             |
| `--side`   | all    | `buy` or `sell`                                              |
| `--pay`    | all    | token you spend: `WPHRS`/`PHRS`/`PROS` or `USDC`             |
| `--amount` | all    | amount of `--pay` per fill, `> 0`                            |
| `--target` | limit  | trigger price in USDC per WPHRS (sell `>=`, buy `<=`)        |
| `--every`  | dca    | interval: `30s`, `15m`, `6h`, `7d`                           |

### Translating natural language

- "sell PHRS when…" → `--side sell --pay WPHRS`. "buy / DCA into PHRS" →
  `--side buy --pay USDC`.
- "$0.50" → `--target 0.50`. "every week" → `--every 7d`.
- If only the amount is missing, ask for that one number — never ask about flags
  or addresses.

### Always ensure the watcher runs

After creating an order, run `status`; if stopped, start it (`watch --daemon`).
An order with no watcher silently never fires — the single most common mistake.
Then confirm back in plain English (side, amount, trigger, network) and surface
any fill tx hashes from `list`.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and set `PRIVATE_KEY` (the wallet that signs
   fills). `RPC_URL` is optional — a per-network default is built in.

All FaroSwap/token addresses are already filled in for testnet and mainnet in
`scripts/config.ts` — **do not edit it**. Defaults to testnet (faucet liquidity);
set `PHAROS_NETWORK=mainnet` to trade real funds.

## Safety (this runs unattended — never weaken it)

`scripts/swap.ts` enforces guards on every fill and ABORTS (leaving the order
active) rather than taking a bad trade:

- Slippage floor: `amountOutMinimum = quote * (1 - SLIPPAGE_BPS)`.
- Max price impact: abort if the trade moves the pool past `MAX_IMPACT_BPS`.
- Balance check: abort if the wallet can't cover amount + gas.
- Price is re-read at execution; a stale trigger is re-validated.

Never widen slippage to force a fill. Never log or echo the private key. The
config is self-checking: a wrong address makes pool discovery fail and the
watcher refuses to start — it never trades against the wrong token.
