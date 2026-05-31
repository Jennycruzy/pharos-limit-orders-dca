---
name: pharos-limit-orders-dca
description: >-
  Create and run unattended limit orders, stop conditions, and recurring DCA
  (dollar-cost-averaging) swaps on the Pharos Network via the FaroSwap DEX.
  Use this skill whenever the user wants a swap to happen LATER or REPEATEDLY
  rather than right now — e.g. "sell my PROS when it hits $0.50", "buy 20 USDC
  of PROS every Monday", "set a limit order", "DCA into PROS", "alert and swap
  when the price drops", or any request that implies waiting for a price level
  or a schedule. This is the persistent-watcher counterpart to a one-shot swap:
  it keeps monitoring price/time in the background and fires the swap when the
  trigger condition is met. Trigger this even if the user just says "schedule",
  "recurring buy", "limit", or "when price reaches X" without naming the chain.
---

# Pharos Limit Orders & DCA Automation

A persistent trading skill for Pharos. Unlike a one-shot swap, an order created
here is stored and watched by a background process that polls the live FaroSwap
price on an interval and executes the swap only when its trigger fires.

## What it does

Two order types, **one shared engine**. The only thing that differs is the
trigger condition:

- **Limit order** — fires when the live price crosses a target
  (`sell PROS when price >= 0.50`, `buy PROS when price <= 0.30`).
- **DCA (recurring)** — fires every N seconds regardless of price
  (`buy 20 USDC of PROS every 7 days`).

When an order fires, the executor re-reads the price, runs safety checks
(slippage cap, max price-impact, balance/liquidity), approves if needed, and
swaps on FaroSwap. Limit orders are one-shot (status -> filled); DCA orders
reschedule themselves for the next interval.

## How to use it

All actions go through `scripts/orders.ts`. Run with `npx ts-node`.

**Create a limit order**
```
npx ts-node scripts/orders.ts add --type limit --side sell \
  --pay PROS --amount 100 --target 0.50
```
Reads as: when 1 PROS is worth >= 0.50 USDC, sell 100 PROS for USDC.

**Create a DCA order**
```
npx ts-node scripts/orders.ts add --type dca --side buy \
  --pay USDC --amount 20 --every 7d
```
Reads as: every 7 days, spend 20 USDC buying PROS.

**Manage orders**
```
npx ts-node scripts/orders.ts list                 # show all orders + status
npx ts-node scripts/orders.ts cancel --id <id>     # cancel one order
npx ts-node scripts/orders.ts status               # is the watcher running?
```

**Run the watcher (this is what makes it persistent)**
```
npx ts-node scripts/orders.ts watch                # foreground (good for demo video)
npx ts-node scripts/orders.ts watch --daemon       # detached background process
```
The watcher must be running for orders to fire. `add` will warn if it isn't.

## Translating natural language

When the user speaks, map to a single `add` call. Infer `--side` from intent:
"sell PROS when..." -> side sell, pay PROS. "buy PROS / DCA into PROS" ->
side buy, pay USDC. A price like "$0.50" is `--target 0.50` (USDC per PROS).
"every week" -> `--every 7d`; accept `s`/`m`/`h`/`d` suffixes.

If the watcher is not running after you create an order, start it
(`watch --daemon`) so the order can actually fire — otherwise nothing happens.

## Safety (this runs unattended — be conservative)

Because trades fire while the user is away, the executor enforces guards from
`scripts/config.ts` on EVERY fill, and aborts the fill (leaving the order
active) rather than taking a bad trade:

- Slippage cap: amountOutMinimum = quote * (1 - SLIPPAGE_BPS).
- Max price impact: abort if the trade moves the pool more than MAX_IMPACT_BPS.
- Balance check: abort if the wallet can't cover amount + gas.
- The trigger price is re-read at execution time; a stale trigger is re-validated.

Never log the private key. Never widen the slippage cap to force a fill.

## Setup

1. `npm install`
2. `cp .env.example .env` and set `PRIVATE_KEY` and `RPC_URL`.
3. Open `scripts/config.ts` and fill every value marked `TODO: VERIFY` —
   the FaroSwap router, the PROS/USDC pool address, and the token addresses
   and decimals. See `README.md` for the exact explorer steps to get these.
4. `npx ts-node scripts/orders.ts add ...` then `... watch`.

Do NOT trust the placeholder addresses in config — they are zeros. The skill
will refuse to run until real, verified values are filled in.
