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
npx ts-node scripts/orders.ts price                # read live price (no order/funds)
```

Use `price` to answer "what's PHRS worth right now?" and as a read-only check
that the feed works before creating an order.

**Run the watcher (this is what makes it persistent)**
```
npx ts-node scripts/orders.ts watch                # foreground (good for demo video)
npx ts-node scripts/orders.ts watch --daemon       # detached background process
npx ts-node scripts/orders.ts watch --once         # foreground; exit after the first fill
```
The watcher must be running for orders to fire. `add` will warn if it isn't.

## Translating natural language

The user talks in plain English; you do the rest. Each request is a short loop:

1. **Map the sentence to one `add` call.** Infer `--side` from intent:
   "sell PROS when..." -> side sell, pay PROS. "buy PROS / DCA into PROS" ->
   side buy, pay USDC. A price like "$0.50" is `--target 0.50` (USDC per PROS).
   "every week" -> `--every 7d`; accept `s`/`m`/`h`/`d` suffixes. If an amount is
   missing, ask for just that one number — don't ask about flags or addresses.
2. **Ensure the watcher is running.** Check `status`; if it's stopped, start it
   with `watch --daemon`. An order with no watcher silently never fires — this is
   the single most common failure mode, so always verify it.
3. **Confirm back in plain English.** Tell the user what was created (side,
   amount, trigger), that the watcher is running, and which network it's on
   (testnet vs mainnet). Surface fill transaction hashes from `list` so they can
   check the explorer.

For "what do I have / cancel that / is it still watching", use `list`, `cancel
--id`, and `status` and answer conversationally — the user never needs to see a
flag or an address.

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

One-time, before the first order:

1. `npm install`
2. `cp .env.example .env` and set `PRIVATE_KEY` (the wallet that signs fills).
   `RPC_URL` is optional — a sane default per network is built in.

That's the whole setup. **All FaroSwap and token addresses are already filled in
for both testnet and mainnet** in `scripts/config.ts`; you do not edit it. The
config defaults to testnet (faucet liquidity, so fills execute); set
`PHAROS_NETWORK=mainnet` to trade real funds.

The skill is self-checking: if any required address were wrong or missing, the
watcher refuses to start with a clear error (the pool lookup fails, or
`assertConfigured()` blocks it) — it never silently trades against the wrong
token. So you can just create an order and start the watcher.
