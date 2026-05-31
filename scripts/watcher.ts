// ---------------------------------------------------------------------------
// Watcher — the persistence layer that makes this a limit/DCA engine rather
// than a one-shot swap. Polls on an interval, evaluates every active order's
// trigger, and fires the ones that are due. Keep this running (foreground for
// a demo, --daemon for real use) or nothing ever fires.
// ---------------------------------------------------------------------------

import { activeOrders, updateOrder, Order } from "./store";
import { getPrice } from "./price";
import { shouldFire, nextDcaRun } from "./trigger";
import { executeFill } from "./swap";
import { SAFETY, assertConfigured } from "./config";

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// Runs one poll. Returns true if a fill succeeded this tick (used by --once).
async function tick(): Promise<boolean> {
  const orders = activeOrders();
  if (orders.length === 0) return false;

  let price: number;
  try {
    price = await getPrice();
  } catch (e: any) {
    log(`price read failed, skipping tick: ${e?.message ?? e}`);
    return false;
  }
  const now = Math.floor(Date.now() / 1000);
  log(`price = ${price.toFixed(6)} USDC/WPHRS — ${orders.length} active order(s)`);

  let filled = false;
  for (const order of orders) {
    if (!shouldFire(order, price, now)) continue;

    log(`firing ${order.type} ${order.id} (${order.side} ${order.amount} ${order.pay})`);
    const result = await executeFill(order);

    if (!result.ok) {
      log(`  fill aborted: ${result.reason} — order stays active`);
      continue;
    }

    log(`  filled: ${result.txHash}`);
    filled = true;
    if (order.type === "limit") {
      updateOrder(order.id, {
        status: "filled",
        lastTxHash: result.txHash,
        fillCount: order.fillCount + 1,
      });
    } else {
      // DCA reschedules itself for the next interval.
      updateOrder(order.id, {
        lastTxHash: result.txHash,
        fillCount: order.fillCount + 1,
        nextRunAt: nextDcaRun(order, now),
      });
    }
  }
  return filled;
}

export interface WatchOptions {
  /** Exit cleanly after the first successful fill (handy for a demo recording). */
  once?: boolean;
}

export async function runWatcher(opts: WatchOptions = {}): Promise<void> {
  assertConfigured();
  log(
    `watcher started — polling every ${SAFETY.POLL_INTERVAL_MS / 1000}s` +
      (opts.once ? " (will exit after the first fill)" : "")
  );

  // Run immediately; if --once already filled, we're done — returning leaves no
  // pending timers, so the process exits cleanly.
  if ((await tick()) && opts.once) return;

  const timer = setInterval(async () => {
    try {
      const filled = await tick();
      if (filled && opts.once) {
        log("--once: fired one fill, exiting");
        clearInterval(timer); // nothing else keeps the loop alive -> clean exit
      }
    } catch (e: any) {
      log(`tick error: ${e?.message ?? e}`);
    }
  }, SAFETY.POLL_INTERVAL_MS);
}
