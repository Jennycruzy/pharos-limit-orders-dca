# Pharos Limit Orders & DCA Automation

Unattended **limit orders** and recurring **DCA** swaps on Pharos via FaroSwap.
A one-shot swap fires the moment you run it; this keeps a watcher running in the
background and fires the swap only when your price target or schedule hits —
the thing an AMM can't do natively.

Limit orders and DCA are one engine. They share the order store, the watcher,
and the executor; the only thing that differs is the trigger predicate
(`scripts/trigger.ts`).

## Quick start

```bash
npm install
cp .env.example .env          # set PRIVATE_KEY and RPC_URL
# fill the TODO: VERIFY values in scripts/config.ts  (see below)

npx ts-node scripts/orders.ts add --type limit --side sell --pay PROS --amount 100 --target 0.50
npx ts-node scripts/orders.ts add --type dca   --side buy  --pay USDC --amount 20  --every 7d
npx ts-node scripts/orders.ts watch            # keep this running; orders fire here
```

## You MUST fill these before it will run

`scripts/config.ts` ships with zero-address placeholders and the watcher
refuses to start until they're replaced. You need:

- `TOKENS.PROS.address` (the wrapped-native WPROS used by V3 pools) + decimals
- `TOKENS.USDC.address` + decimals
- `FAROSWAP.swapRouter` (the SwapRouter)
- `FAROSWAP.prosUsdcPool` (the PROS/USDC V3 pool) + `poolFeeTier`

### How to get them (verified, not guessed)

1. Open the FaroSwap app and do **one tiny PROS↔USDC swap**.
2. Open that transaction on the Pharos explorer.
3. Read the **"Interacted With (To)"** contract — that's the `swapRouter`.
4. In the token-transfer / logs, the pool that emitted the `Swap` event is your
   `prosUsdcPool`; the token addresses in the transfers are PROS and USDC.
5. If the pool is verified on the explorer, copy the fee tier from `fee()` or
   the pool name (e.g. 0.3% = 3000). Otherwise the existing FaroSwap swap-skill
   repos list pool addresses you can cross-check.

Confirm the addresses with a read before trusting a write: run the watcher in
the foreground and check the logged price looks sane (a believable USDC/PROS
number). If it does, the pool, tokens, and decimals are wired correctly.

## Network

`CHAIN_ID`/`RPC_URL` default to **testnet (688688)**. Testnet has faucet
liquidity, so your demo fills actually execute. Flip both to mainnet (1672)
once you've verified mainnet FaroSwap addresses. Whichever you use, state it
plainly in your submission.

## Suggested demo (≈90s)

1. Show the wallet balance and `orders.ts list` (empty).
2. Create a limit order with a target just **above** the current price, and
   start the watcher in the foreground (split-screen: terminal + explorer).
3. Create a tiny DCA order with a short interval (e.g. `--every 60s`) so a
   recurring fill happens on camera.
4. Watch the log: price polls, DCA fires, real txhash prints; open it on the
   explorer. Then nudge the limit target below price (cancel + re-add) and show
   the limit order fire too.
5. Cancel an order to show lifecycle control.

The point the video must land: **the swap fired while you weren't touching it.**
That's the whole reason this skill exists.

## Safety

Every fill (it runs unattended) is guarded in `scripts/config.ts`:
slippage floor on `amountOutMinimum`, a max price-impact ceiling, and a balance
check. A failed guard aborts that fill and leaves the order active to retry —
it never widens slippage to force a trade. The private key is read from env and
never logged.

> The price-impact estimate in `scripts/swap.ts` is left as a TODO — the
> slippage floor is the hard protection out of the box. Wire a real impact
> calc from pool liquidity before running large unattended sizes.
