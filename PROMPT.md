# Continuation Prompt — Pharos Limit Orders & DCA Automation

Paste everything below into Claude Code (or keep it in the repo as context).

---

## Role & goal

You are helping me finish and ship an **Agent Skill** for the **Pharos Agent
Center "Skill Builder" campaign**. The skill is already scaffolded, type-checks
clean, and its local order lifecycle has been smoke-tested. Your job is to wire
it to the live FaroSwap contracts, test a real on-chain fill, and prepare it for
submission. Do **not** rebuild what already exists — extend it.

## What the skill is

**Pharos Limit Orders & DCA Automation** — unattended **limit orders** and recurring **DCA**
swaps on Pharos via the **FaroSwap** DEX (a Uniswap V3 fork). It is the
*persistent-watcher* counterpart to a one-shot swap: an order is stored and a
background process polls the live price on an interval, firing the swap only
when the order's trigger condition (price target, or schedule) is met. The
strategic point — and the reason it's worth building — is that an AMM has no
native limit orders or recurring buys; the one capability an agent has that a
dapp doesn't is that it *persists and watches*. That persistence is the product.

Limit orders and DCA are deliberately **one engine**: they share the order
store, the watcher loop, and the executor. The only thing that differs is the
trigger predicate in `scripts/trigger.ts`.

## Why this skill (campaign context)

The campaign rewards every developer with an *exceptional, on-thesis* skill with
$500 (it is NOT winner-take-all). Several other submissions already exist and
are read-only or one-shot: a contract security scanner, a 13-module wallet
analytics tool, a CCTP/CCIP bridge, and a one-shot FaroSwap swap. The white
space this skill fills is **automation on top of the swap primitive** — the
thing the crowd doesn't build because it requires persistence, not just a single
RPC call.

## Repository layout (already built)

```
pharos-limit-orders-dca/
├── SKILL.md                 # agent entry point: triggering description, commands, safety, setup
├── README.md                # human setup + explorer steps + demo script
├── package.json             # ethers v6 + ts-node
├── tsconfig.json
├── .env.example             # PRIVATE_KEY, RPC_URL
└── scripts/
    ├── config.ts            # chain, token registry, FaroSwap addresses (TODO: VERIFY), safety params, assertConfigured() guard
    ├── store.ts             # Order type + JSON-file persistence (add/list/cancel/update)
    ├── trigger.ts           # shouldFire() — the ONLY place limit vs DCA differ
    ├── price.ts             # getPrice() — USDC-per-PROS from FaroSwap V3 pool slot0 (sqrtPriceX96)
    ├── swap.ts              # executeFill() — balance check, slippage floor, approve, exactInputSingle
    ├── watcher.ts           # runWatcher() — poll loop that fires triggered orders
    └── orders.ts            # CLI entry: add | list | cancel | status | watch  (+ NL-friendly flag parsing)
```

## STATUS — what is built vs. not

### Built and tested
- Order store (`store.ts`) — persistence, CRUD. **Smoke-tested working.**
- CLI (`orders.ts`) — `add`/`list`/`cancel`/`status`/`watch`, duration parsing
  (`7d`/`30m`/etc.), `--daemon` background spawn. **Smoke-tested working.**
- Config guard (`config.ts` → `assertConfigured()`) — refuses to run the watcher
  while addresses are zero placeholders. **Smoke-tested working.**
- Trigger engine (`trigger.ts`) — limit (price cross) + DCA (interval) predicates.
- Watcher (`watcher.ts`) — poll, evaluate, fire, reschedule DCA, mark limit filled.
- SKILL.md, README.md, package.json, tsconfig.json, .env.example.
- Whole project **type-checks clean** (`npx tsc --noEmit`).

### Built but UNTESTED against live contracts (needs real addresses first)
- Price reader (`price.ts`) — V3 `slot0` sqrtPriceX96 → USDC/PROS, with token0/
  token1 orientation + decimal adjustment. Logic complete; never run against a
  real pool.
- Executor (`swap.ts`) — balance check, slippage floor on `amountOutMinimum`,
  ERC20 approve, `exactInputSingle`. Logic complete; never sent a real tx.

### NOT built / TODO (your work)
1. **Verified FaroSwap addresses** in `config.ts` (all currently zero):
   `FAROSWAP.swapRouter`, `FAROSWAP.prosUsdcPool`, `FAROSWAP.poolFeeTier`,
   `TOKENS.PROS.address` (WPROS), `TOKENS.USDC.address`, and confirm decimals.
2. **Confirm the FaroSwap router ABI** — `swap.ts` assumes Uniswap V3
   `exactInputSingle((tokenIn,tokenOut,fee,recipient,deadline,amountIn,amountOutMinimum,sqrtPriceLimitX96))`.
   It's a V3 fork so this is very likely correct; verify against the deployed
   contract and adjust the one ABI line if it differs.
3. **Price-impact guard** — currently a TODO in `swap.ts`. The slippage floor is
   the only hard protection out of the box. Implement a real impact estimate from
   pool liquidity before allowing large unattended sizes.
4. **Live test**: fund a testnet wallet, run `watch` in foreground, confirm the
   logged price is a believable USDC/PROS number (this validates pool + tokens +
   decimals), then let a DCA order fire and capture the real txhash.
5. **Demo video** (see README demo script).
6. **Confirm skill format against the actual Pharos Skill Engine.** I verified the
   structure matches the standard Agent Skills format (SKILL.md + scripts/,
   installs via `npx skills add` to `~/.claude/skills/` etc.), which is what other
   Pharos submissions use — but I could NOT load pharos.xyz/agent-center directly
   (bot-blocked). If the Skill Engine requires any extra manifest or registration
   file beyond SKILL.md, add it.
7. Optional polish: order expiry, more token pairs beyond PROS/USDC, file-based
   logging, watcher auto-restart (systemd/pm2), richer NL parsing.

## Verified facts (do not re-derive or guess)

- **Pharos networks:** mainnet "Pacific Ocean" chain ID **1672**; testnet chain ID
  **688688**. Native token **PROS** (testnet **PHRS**). USDC + Circle CCTP present.
- **FaroSwap** is a **Uniswap V3 fork** (per the existing FaroSwap swap skill).
  Prices come from the pool's `slot0().sqrtPriceX96`.
- **Start on testnet.** Mainnet DeFi liquidity on Pharos is thin (the RWA lending
  venue OpenFi had ~$14 TVL on mainnet); testnet has faucet liquidity so a demo
  fill actually lands. `config.ts` defaults to 688688; flip `CHAIN_ID`/`RPC_URL`
  to mainnet once you have verified mainnet FaroSwap addresses.
- **How to get verified addresses (do it this way, don't trust any pasted address):**
  do one tiny PROS↔USDC swap on the FaroSwap app, open the tx on the Pharos
  explorer, read the "Interacted With (To)" = router, and the pool that emitted the
  `Swap` event = `prosUsdcPool`; the token transfers give you PROS/USDC addresses.
  Confirm by a read (run the watcher, check the logged price is sane) BEFORE
  trusting any write.

## Constraints / principles

- **Never trust an unverified address for a money-moving call.** The config ships
  with zeros and a guard for this reason. Confirm every address with a read first.
- **Never widen the slippage cap to force a fill.** A failed safety guard must
  abort the fill and leave the order active to retry.
- Never log the private key.
- One skill, done well. Don't add token pairs or features until the core
  PROS/USDC limit + DCA path works end to end on testnet with a real txhash.

## First actions for you

1. `npm install`.
2. Read `config.ts` and `swap.ts` so you understand the wiring.
3. Help me obtain and paste the verified FaroSwap addresses (item 1 above).
4. Run `npx ts-node scripts/orders.ts watch` in the foreground and confirm a sane
   logged price.
5. Create a short-interval DCA order and verify a real fill + txhash on testnet.
