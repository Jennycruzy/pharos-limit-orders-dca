# DEMO.md — showing this skill working (for judges)

Goal: in ~60 seconds, talk to an AI agent in plain English → it creates an order
and starts a watcher → the watcher prints the live FaroSwap price → it fires a
real on-chain swap → click the transaction on the explorer.

This skill is agent-neutral. It works with **Claude Code** (`SKILL.md`),
**Codex / Jules / Zed / Aider** (`AGENTS.md`), and **Cursor**
(`.cursor/rules/`). Pick whichever agent you're demoing.

---

## Why the demo is deterministic

A **DCA** order fires on the *very first* watcher poll (`trigger.ts`:
`nextRunAt == null → fire now`), and the watcher runs a tick immediately on
start and logs the live price every poll. So you don't wait for the market to
move — starting the watcher produces a fill within seconds. That's your live
"it works" moment.

---

## One-time setup

1. **Install the skill into your agent** (so plain English triggers it):
   - *Claude Code:* `ln -sfn "$PWD" ~/.claude/skills/pharos-limit-orders-dca`
   - *Codex / Cursor / others:* just open this repo as the workspace — they read
     `AGENTS.md` / `.cursor/rules/` automatically.
2. **Install deps & key:**
   ```bash
   npm install
   cp .env.example .env      # then put your wallet PRIVATE_KEY in it
   ```
   Addresses are already filled in (`scripts/config.ts`); don't edit them.
   Defaults to **testnet**.
3. **Fund the demo wallet** (it does a real swap):
   - Testnet **PHRS for gas** from the Pharos faucet.
   - A little **USDC** for a *buy* demo — do one tiny WPHRS→USDC swap in the
     FaroSwap app. (Or demo a *sell* and fund WPHRS instead.)
   - Keep amounts tiny, e.g. **1 USDC**, so the fill clears the balance and
     slippage guards.

---

## The live demo (what you say + what judges see)

Say to the agent, in plain English:

> **"DCA 1 USDC into PHRS every 30 seconds on testnet, and run the watcher in the foreground."**

The agent runs:
```bash
npx ts-node scripts/orders.ts add --type dca --side buy --pay USDC --amount 1 --every 30s
npx ts-node scripts/orders.ts watch     # foreground — judges watch this log
```

Judges see:
```
[..] watcher started — polling every 30s
[..] price = 0.0xxxxx USDC/WPHRS — 1 active order(s)
[..] firing dca <id> (buy 1 USDC)
[..]   filled: 0x<txhash>
```

Then:
- Open `https://testnet.pharosscan.xyz/tx/0x<txhash>` — the swap on-chain.
- Say **"what orders do I have?"** → agent runs `list`, fill count climbs each interval.
- Say **"cancel it"** → agent runs `cancel --id <id>`.

### Alternative: show the *limit* (price-trigger) logic
Ask the agent for the current price, then:
> **"Sell 1 PHRS the moment it's worth at least $<just-below-current-price>."**

It fires on the next poll because the condition is already true — proving the
trigger reads live price, not a timer.

---

## Gotchas to rehearse

- **RPC reachability.** The watcher needs a reachable Pharos RPC. The default
  testnet endpoint is network-gated; if it's blocked where you demo, set a
  working `RPC_URL` in `.env` before going live.
- **No funds = visible abort, not a crash.** Unfunded, the watcher still logs the
  live price and prints `fill aborted: insufficient … — order stays active`.
  That shows the safety guard, but it's not an on-chain tx — fund the wallet for
  the explorer link.

---

## Hand-off prompt for the agent on your Mac (runs the real fill)

Paste this to any coding agent (Claude Code / Codex / Cursor) in a terminal that
has internet + a funded testnet wallet. It does a read-before-write check, then
one tiny real fill:

```
You are setting up a live demo of the "pharos-limit-orders-dca" skill on Pharos
testnet via FaroSwap. Do these steps and report back at each one:

1. Clone and enter the repo (skip clone if already present):
   git clone https://github.com/Jennycruzy/pharos-limit-orders-dca.git
   cd pharos-limit-orders-dca && npm install

2. Create .env from .env.example and set PRIVATE_KEY to the funded testnet
   wallet I give you. Do NOT print the private key. Leave PHAROS_NETWORK unset
   (defaults to testnet). If the default RPC_URL is unreachable from this
   machine, ask me for a working Pharos testnet RPC URL and put it in .env.

3. READ BEFORE ANY WRITE — confirm the price feed works before risking funds.
   Run the watcher in the foreground for ~40s with NO orders yet:
     npx ts-node scripts/orders.ts watch
   Confirm it logs a believable "price = <n> USDC/WPHRS" line (a small number,
   not 0, NaN, or an error). If it errors on the pool/price, STOP and tell me —
   do not proceed. Then Ctrl-C.

4. Confirm the wallet is funded: it needs testnet PHRS for gas and ~1 USDC for a
   buy. If USDC balance is 0, tell me how to get it (faucet / one FaroSwap swap)
   and wait.

5. Create a fast DCA so it fires immediately, then run the watcher in the
   foreground so I can screen-record the log:
     npx ts-node scripts/orders.ts add --type dca --side buy --pay USDC --amount 1 --every 30s
     npx ts-node scripts/orders.ts watch

6. When you see "filled: 0x...", give me the tx hash and the explorer link
   https://testnet.pharosscan.xyz/tx/<hash>. Then run:
     npx ts-node scripts/orders.ts list
   and report the fill count. Then cancel the order:
     npx ts-node scripts/orders.ts cancel --id <id>

Safety rules: never widen the slippage settings to force a fill, never print or
log the private key, and if any safety guard aborts a fill, report the reason
verbatim instead of working around it.
```
