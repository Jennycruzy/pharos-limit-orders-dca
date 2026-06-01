#!/usr/bin/env ts-node
// ---------------------------------------------------------------------------
// CLI entry — the single surface the agent calls. Parses simple flags so a
// natural-language request maps to one command (see SKILL.md).
// ---------------------------------------------------------------------------

import { spawn } from "child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import {
  addOrder,
  listOrders,
  cancelOrder,
  Order,
  Side,
  OrderType,
} from "./store";
import { runWatcher } from "./watcher";
import {
  WATCHER_PID_FILE,
  BASE_SYMBOL,
  QUOTE_SYMBOL,
  NETWORK,
  EXPLORER,
} from "./config";
import { ensureEnvScaffold, privateKeyConfigured } from "./env";

// Map natural-language token names to the configured symbols. The native token
// is PHRS; orders trade its wrapped form WPHRS, so "PHRS"/"PROS" -> WPHRS.
function normalizeSymbol(raw: string): string {
  const s = raw.toUpperCase();
  if (s === "PHRS" || s === "PROS" || s === "WPHRS") return BASE_SYMBOL;
  if (s === QUOTE_SYMBOL) return QUOTE_SYMBOL;
  return s;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

// "7d" -> 604800, "30m" -> 1800, etc.
function parseDuration(s: string): number {
  const m = s.match(/^(\d+)([smhd])$/);
  if (!m) throw new Error(`bad duration "${s}" — use e.g. 30s, 15m, 6h, 7d`);
  const n = parseInt(m[1], 10);
  return n * { s: 1, m: 60, h: 3600, d: 86400 }[m[2] as "s" | "m" | "h" | "d"];
}

function watcherRunning(): boolean {
  if (!existsSync(WATCHER_PID_FILE)) return false;
  const pid = parseInt(readFileSync(WATCHER_PID_FILE, "utf8"), 10);
  try {
    process.kill(pid, 0); // signal 0 = existence check
    return true;
  } catch {
    return false;
  }
}

// Render a seconds interval back into the most natural unit (604800 -> "7d").
function formatDuration(sec: number): string {
  for (const [unit, size] of [["d", 86400], ["h", 3600], ["m", 60]] as const) {
    if (sec % size === 0 && sec >= size) return `${sec / size}${unit}`;
  }
  return `${sec}s`;
}

function printOrder(o: Order): void {
  const cond =
    o.type === "limit"
      ? `${o.side} when price ${o.side === "sell" ? ">=" : "<="} ${o.targetPrice}`
      : `every ${formatDuration(o.intervalSec ?? 0)}`;
  console.log(
    `  ${o.id}  [${o.status}]  ${o.type} ${o.side} ${o.amount} ${o.pay}  (${cond})  fills:${o.fillCount}` +
      (o.lastTxHash ? `  last:${o.lastTxHash}` : "")
  );
}

function requirePrivateKeyForWrites(): void {
  if (privateKeyConfigured()) return;
  const created = ensureEnvScaffold();
  console.error("PRIVATE_KEY is not configured, so I cannot execute live fills.");
  if (created) {
    console.error("I created .env from .env.example. Put your funded wallet PRIVATE_KEY in .env.");
  } else {
    console.error("Put your funded wallet PRIVATE_KEY in .env.");
  }
  console.error("For a mainnet demo, also set PHAROS_NETWORK=mainnet in .env.");
  console.error("I did not print or use any private key.");
  process.exit(1);
}

async function main(): Promise<void> {
  const cmd = process.argv[2];

  switch (cmd) {
    case "add": {
      const type = arg("type") as OrderType;
      const side = arg("side") as Side;
      const pay = normalizeSymbol(arg("pay") ?? "");
      const amount = Number(arg("amount"));
      if (!["limit", "dca"].includes(type)) throw new Error("--type must be limit|dca");
      if (!["buy", "sell"].includes(side)) throw new Error("--side must be buy|sell");
      if (![BASE_SYMBOL, QUOTE_SYMBOL].includes(pay))
        throw new Error(`--pay must be ${BASE_SYMBOL}|${QUOTE_SYMBOL}`);
      if (!amount || amount <= 0) throw new Error("--amount must be > 0");

      const base = { type, side, pay, amount };
      let order: Order;
      if (type === "limit") {
        const target = Number(arg("target"));
        if (!target || target <= 0)
          throw new Error(`--target (${QUOTE_SYMBOL} per ${BASE_SYMBOL}) required for limit`);
        order = addOrder({ ...base, targetPrice: target });
      } else {
        const every = arg("every");
        if (!every) throw new Error("--every (e.g. 7d) required for dca");
        order = addOrder({ ...base, intervalSec: parseDuration(every) });
      }

      console.log("order created:");
      printOrder(order);
      if (!watcherRunning()) {
        console.log("\n⚠ watcher is NOT running — this order will not fire until you start it:");
        console.log("    npx ts-node scripts/orders.ts watch --daemon");
      }
      break;
    }

    case "list": {
      const orders = listOrders();
      if (orders.length === 0) console.log("no orders.");
      else orders.forEach(printOrder);
      break;
    }

    case "cancel": {
      const id = arg("id");
      if (!id) throw new Error("--id required");
      console.log(cancelOrder(id) ? `cancelled ${id}` : `no active order ${id}`);
      break;
    }

    case "status": {
      console.log(watcherRunning() ? "watcher: running" : "watcher: stopped");
      break;
    }

    case "price": {
      // Read-only live price from the FaroSwap pool. Good for a "read before
      // write" check before creating an order, and a clean demo beat on its own.
      const { getPrice, resolvePool } = await import("./price");
      const pool = await resolvePool();
      const price = await getPrice();
      console.log(`network : ${NETWORK}`);
      console.log(`pool    : ${pool.address}  (fee ${pool.fee / 10_000}%)`);
      console.log(
        `price   : 1 ${BASE_SYMBOL} = ${price.toFixed(6)} ${QUOTE_SYMBOL}` +
          `   (1 ${QUOTE_SYMBOL} = ${(1 / price).toFixed(6)} ${BASE_SYMBOL})`
      );
      console.log(`explorer: ${EXPLORER}/address/${pool.address}`);
      break;
    }

    case "watch": {
      const once = flag("once"); // exit after the first fill (good for a demo recording)
      requirePrivateKeyForWrites();
      if (flag("daemon")) {
        // Re-spawn this script detached, running the watcher in foreground.
        const child = spawn(
          "npx",
          ["ts-node", __filename, "watch", ...(once ? ["--once"] : [])],
          { detached: true, stdio: "ignore" }
        );
        child.unref();
        writeFileSync(WATCHER_PID_FILE, String(child.pid));
        console.log(`watcher started in background (pid ${child.pid})`);
      } else {
        writeFileSync(WATCHER_PID_FILE, String(process.pid));
        process.on("exit", () => {
          try { unlinkSync(WATCHER_PID_FILE); } catch {}
        });
        await runWatcher({ once }); // blocks (or runs until the first fill with --once)
      }
      break;
    }

    default:
      console.log("commands: add | list | cancel | status | price | watch  (see SKILL.md)");
  }
}

main().catch((e) => {
  console.error("error:", e?.message ?? e);
  process.exit(1);
});
