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

async function tick(): Promise<void> {
  const orders = activeOrders();
  if (orders.length === 0) return;

  let price: number;
  try {
    price = await getPrice();
  } catch (e: any) {
    log(`price read failed, skipping tick: ${e?.message ?? e}`);
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  log(`price = ${price.toFixed(6)} USDC/WPHRS — ${orders.length} active order(s)`);

  for (const order of orders) {
    if (!shouldFire(order, price, now)) continue;

    log(`firing ${order.type} ${order.id} (${order.side} ${order.amount} ${order.pay})`);
    const result = await executeFill(order);

    if (!result.ok) {
      log(`  fill aborted: ${result.reason} — order stays active`);
      continue;
    }

    log(`  filled: ${result.txHash}`);
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
}

export async function runWatcher(): Promise<void> {
  assertConfigured();
  log(`watcher started — polling every ${SAFETY.POLL_INTERVAL_MS / 1000}s`);
  // Run immediately, then on the interval.
  await tick();
  setInterval(() => {
    tick().catch((e) => log(`tick error: ${e?.message ?? e}`));
  }, SAFETY.POLL_INTERVAL_MS);
}
