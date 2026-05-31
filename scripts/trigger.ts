// ---------------------------------------------------------------------------
// Trigger evaluation — the one place limit and DCA differ. Everything else
// (store, watcher, executor) is shared. Add a new order type here and the
// rest of the engine handles it unchanged.
// ---------------------------------------------------------------------------

import { Order } from "./store";

/**
 * Should this order fire right now?
 * @param order      the active order
 * @param price      current USDC-per-WPHRS spot price
 * @param nowSec     current unix time in seconds
 */
export function shouldFire(order: Order, price: number, nowSec: number): boolean {
  if (order.status !== "active") return false;

  if (order.type === "limit") {
    if (order.targetPrice == null) return false;
    // sell WPHRS once it's worth at least the target; buy once it's cheap enough.
    return order.side === "sell"
      ? price >= order.targetPrice
      : price <= order.targetPrice;
  }

  if (order.type === "dca") {
    if (order.nextRunAt == null) return true; // first run
    return nowSec >= order.nextRunAt;
  }

  return false;
}

/** After a DCA fill, compute when the next one is due. */
export function nextDcaRun(order: Order, nowSec: number): number {
  return nowSec + (order.intervalSec ?? 0);
}
