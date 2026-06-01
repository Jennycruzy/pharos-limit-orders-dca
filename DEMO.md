# DEMO.md — showing this skill working (for judges)

Goal: in ~60 seconds, talk to an AI agent in plain English → it creates an order
and starts a watcher → the watcher prints the live FaroSwap price → it fires a
real on-chain swap → click the transaction on the explorer.

This skill is agent-neutral. It works with **Claude Code** (`SKILL.md`),
**Codex / Jules / Zed / Aider** (`AGENTS.md`), and **Cursor**
(`.cursor/rules/`). Pick whichever agent you're demoing.

---

## Choose your network

| Network     | Best for                          | Funding                                  | Explorer                      |
| ----------- | --------------------------------- | ---------------------------------------- | ----------------------------- |
| **mainnet** | **Recommended** — a real swap of real value, real explorer link, no faucet | real PHRS (gas) + a little USDC | `pharosscan.xyz`              |
| testnet     | Free dry runs                     | faucet PHRS + a little USDC              | `testnet.pharosscan.xyz`      |

The default network is mainnet. Set `PHAROS_NETWORK=testnet` only if you
intentionally want a testnet run. Everything else is identical between the two —
the code picks the right router per network automatically.

**Mainnet is verified and ready.** The price feed and fill path were checked
end-to-end (read-only) before this doc was written:
- live price ≈ `0.607 USDC/WPHRS` from the verified WPHRS/USDC pool;
- DODO's pathfinder returns a real route for Pharos mainnet (chain 1672) whose
  target **matches** the configured `dodoRouteProxy` — which is exactly the
  on-chain check `swap.ts` enforces before it will submit.

So on mainnet the only thing left to happen live is the signed transaction
itself. Keep the demo amount tiny (e.g. **1 USDC**) — it's real money.

## Why the demo is deterministic

A **DCA** order fires on the *very first* watcher poll (`trigger.ts`:
`nextRunAt == null → fire now`), and the watcher runs a tick immediately on
start and logs the live price every poll. So you don't wait for the market to
move — starting the watcher produces a fill within seconds.

---

## One-time setup

One command (clones if needed, installs deps, scaffolds `.env`, and registers
the skill with Claude Code):

```bash
curl -fsSL https://raw.githubusercontent.com/Jennycruzy/pharos-limit-orders-dca/main/install.sh | bash
# or, inside a clone:  ./install.sh
```

Then:
1. Put your wallet `PRIVATE_KEY` in `.env`. The default network is mainnet.
   Addresses are already filled in (`scripts/config.ts`) — don't edit them.
2. **Fund the wallet** (it does a real swap): real **PHRS for gas** + a little
   **USDC** for a *buy* (or **WPHRS** for a *sell*). Tiny amounts are fine.

Codex / Cursor / Zed / Aider don't need the symlink — just open the repo as the
workspace and they read `AGENTS.md` / `.cursor/rules/` automatically.

---

## The live demo (what you say + what judges see)

Optional opener (read-only, proves the feed is live before any order):
> **"What's PHRS worth right now?"** → agent runs `price`:
> ```
> price   : 1 WPHRS = 0.607093 USDC   (1 USDC = 1.647194 WPHRS)
> ```

Then, in plain English:

> **"DCA 1 USDC into PHRS every 30 seconds on mainnet, and run the watcher in the foreground."**

The agent runs:
```bash
npx ts-node scripts/orders.ts add --type dca --side buy --pay USDC --amount 1 --every 30s
npx ts-node scripts/orders.ts watch --once   # foreground; fires once, then exits cleanly
```
(`--once` exits right after the first fill — clean ending for a screen recording.
Drop it if you want the DCA to keep repeating live.)

Judges see:
```
[..] watcher started — polling every 30s
[..] price = 0.6xxxxx USDC/WPHRS — 1 active order(s)
[..] firing dca <id> (buy 1 USDC)
[..]   filled: 0x<txhash>
```

Then:
- Open `https://pharosscan.xyz/tx/0x<txhash>` (testnet: `https://testnet.pharosscan.xyz/tx/...`).
- Say **"what orders do I have?"** → agent runs `list`, fill count climbs each interval.
- Say **"cancel it"** → agent runs `cancel --id <id>`.

### Alternative: show the *limit* (price-trigger) logic
Ask the agent for the current price, then:
> **"Sell 1 PHRS the moment it's worth at least $<just-below-current-price>."**

It fires on the next poll because the condition is already true — proving the
trigger reads live price, not a timer.

---

## Gotchas to rehearse

- **RPC reachability.** The watcher needs a reachable Pharos RPC. The mainnet
  default (`infra.originstake.com/pharos/evm`) is public and was reachable during
  validation; if it's slow/blocked where you demo, set a working `RPC_URL` in
  `.env`.
- **No funds = visible abort, not a crash.** Unfunded, the watcher still logs the
  live price and prints `fill aborted: insufficient … — order stays active`.
  That actually shows the safety guard working, but it's not an on-chain tx — so
  fund the wallet for the explorer link.

---

## Hand-off prompt for the agent on your Mac (runs the real fill)

Paste this to any coding agent (Claude Code / Codex / Cursor) in a terminal that
has internet + a funded wallet. It does a read-before-write check, then one tiny
real fill. Defaults to **mainnet**; change `PHAROS_NETWORK` for testnet.

```
You are setting up a live demo of the "pharos-limit-orders-dca" skill on Pharos
MAINNET via FaroSwap. Do these steps and report back at each one:

1. Set up the repo:
   curl -fsSL https://raw.githubusercontent.com/Jennycruzy/pharos-limit-orders-dca/main/install.sh | bash
   cd pharos-limit-orders-dca

2. In .env set PRIVATE_KEY to the funded wallet I give you (do NOT print it).
   Mainnet is the default. If the default RPC_URL is unreachable from this
   machine, ask me for a working Pharos mainnet RPC URL and put it in .env.

3. READ BEFORE ANY WRITE — confirm the price feed works before risking funds:
     npx ts-node scripts/orders.ts price
   Confirm it prints a believable "1 WPHRS = <n> USDC" (around 0.6, not 0, NaN,
   or an error). If it errors on the pool/price, STOP and tell me.

4. Confirm the wallet is funded: it needs PHRS for gas and ~1 USDC for a buy. If
   USDC balance is 0, tell me and wait.

5. Create a fast DCA so it fires immediately, then run the watcher in the
   foreground (--once exits right after the first fill) so I can screen-record:
     npx ts-node scripts/orders.ts add --type dca --side buy --pay USDC --amount 1 --every 30s
     npx ts-node scripts/orders.ts watch --once

6. When you see "filled: 0x...", give me the tx hash and the explorer link
   https://pharosscan.xyz/tx/<hash>. Then run:
     npx ts-node scripts/orders.ts list
   and report the fill count. Then cancel the order:
     npx ts-node scripts/orders.ts cancel --id <id>

Safety rules: never widen the slippage settings to force a fill, never print or
log the private key, and if any safety guard aborts a fill, report the reason
verbatim instead of working around it.
```
