// ---------------------------------------------------------------------------
// Order store — orders persist to a JSON file so the watcher can pick them up
// across invocations. (Filesystem, not browser storage: this runs in node.)
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync } from "fs";
import { ORDERS_FILE } from "./config";

export type OrderType = "limit" | "dca";
export type Side = "buy" | "sell";
export type Status = "active" | "filled" | "cancelled";

export interface Order {
  id: string;
  type: OrderType;
  side: Side;          // buy = acquire WPHRS with USDC; sell = sell WPHRS for USDC
  pay: string;         // symbol being spent ("WPHRS" or "USDC")
  amount: number;      // human units of `pay` to spend per fill
  // limit-only:
  targetPrice?: number; // USDC per WPHRS; sell fires when price >= target,
                        // buy fires when price <= target
  // dca-only:
  intervalSec?: number; // seconds between fills
  nextRunAt?: number;   // unix seconds; when the next DCA fill is due
  // bookkeeping:
  status: Status;
  createdAt: number;
  lastTxHash?: string;
  fillCount: number;
}

function load(): Order[] {
  if (!existsSync(ORDERS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(ORDERS_FILE, "utf8")) as Order[];
  } catch {
    return [];
  }
}

function save(orders: Order[]): void {
  writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
}

export function listOrders(): Order[] {
  return load();
}

export function activeOrders(): Order[] {
  return load().filter((o) => o.status === "active");
}

export function addOrder(o: Omit<Order, "id" | "status" | "createdAt" | "fillCount">): Order {
  const orders = load();
  const order: Order = {
    ...o,
    id: Math.random().toString(36).slice(2, 8),
    status: "active",
    createdAt: Math.floor(Date.now() / 1000),
    fillCount: 0,
  };
  orders.push(order);
  save(orders);
  return order;
}

export function updateOrder(id: string, patch: Partial<Order>): void {
  const orders = load();
  const i = orders.findIndex((o) => o.id === id);
  if (i === -1) return;
  orders[i] = { ...orders[i], ...patch };
  save(orders);
}

export function cancelOrder(id: string): boolean {
  const orders = load();
  const i = orders.findIndex((o) => o.id === id);
  if (i === -1 || orders[i].status !== "active") return false;
  orders[i].status = "cancelled";
  save(orders);
  return true;
}
