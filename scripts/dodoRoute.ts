// ---------------------------------------------------------------------------
// DODO route fetcher — FaroSwap mainnet fill path.
//
// On mainnet, FaroSwap doesn't expose a plain Uniswap-V3 SwapRouter; swaps are
// routed through a DODO route proxy (mixSwap), and the calldata for that call is
// produced by an off-chain pathfinder ("route service"). This module asks that
// service for a route and returns the raw transaction the executor will send.
// DODO separates the transaction target (`to`) from the ERC-20 spender
// (`targetApproveAddr`), so the executor needs both.
//
// SAFETY: this module only FETCHES a route. It does not trust it. swap.ts
// re-checks that the returned `to` equals the verified FAROSWAP.dodoRouteProxy
// and that the quoted output clears our own slippage floor before sending. The
// route API URL is configuration (FAROSWAP_ROUTE_API), never a hardcoded guess.
// ---------------------------------------------------------------------------

import { CHAIN_ID, ROUTE_API, ROUTE_API_KEY, SAFETY } from "./config";

export interface DodoRoute {
  to: string;        // router the calldata must be sent to (we verify == proxy)
  approveTarget: string; // spender that must be approved before calling `to`
  data: string;      // mixSwap calldata
  value: bigint;     // native value to attach (0 for ERC20->ERC20)
  toAmountRaw: bigint; // expected output in toToken's smallest units
}

/**
 * Fetch a swap route from FaroSwap's pathfinder.
 *
 * The DODO route-service "getdodoroute" response shape is used (FaroSwap is a
 * DODO-powered DEX). Fields we rely on: data.to, data.targetApproveAddr,
 * data.data, data.value, and an expected-out amount (resAmount / targetAmount).
 * Parsing is defensive so a minor shape difference is a one-line fix, not a
 * silent wrong-amount bug.
 */
export async function getDodoRoute(params: {
  fromToken: string;
  toToken: string;
  fromAmountRaw: bigint;
  userAddr: string;
  toTokenDecimals: number;
}): Promise<DodoRoute> {
  if (!ROUTE_API) {
    throw new Error(
      "FAROSWAP_ROUTE_API not set — cannot build a DODO mixSwap route on mainnet. " +
        "Set it to FaroSwap's route API base URL (see config.ts ROUTE_API)."
    );
  }

  const deadline = Math.floor(Date.now() / 1000) + 600;
  const slippagePct = (SAFETY.SLIPPAGE_BPS / 100).toString(); // route-service wants percent

  const url = new URL(ROUTE_API);
  url.searchParams.set("chainId", String(CHAIN_ID));
  url.searchParams.set("fromTokenAddress", params.fromToken);
  url.searchParams.set("toTokenAddress", params.toToken);
  url.searchParams.set("fromAmount", params.fromAmountRaw.toString());
  url.searchParams.set("userAddr", params.userAddr);
  url.searchParams.set("slippage", slippagePct);
  url.searchParams.set("deadLine", String(deadline));
  url.searchParams.set("source", "dodoV2AndMixWasm");
  url.searchParams.set("estimateGas", "false");
  if (ROUTE_API_KEY) url.searchParams.set("apikey", ROUTE_API_KEY);

  // DODO's hosted route-service gates on the FaroSwap origin.
  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json, text/plain, */*",
      Origin: "https://faroswap.xyz",
      Referer: "https://faroswap.xyz/",
    },
  });
  if (!res.ok) {
    throw new Error(`route API ${res.status} ${res.statusText}`);
  }
  const json: any = await res.json();
  // DODO wraps the payload in { status, data: {...} }; tolerate a flat shape too.
  const d = json?.data ?? json;
  const to: string | undefined = d?.to;
  const approveTarget: string | undefined =
    d?.targetApproveAddr ?? d?.approveAddr ?? d?.approveTarget ?? d?.allowanceTarget ?? d?.spender;
  const data: string | undefined = d?.data;
  if (!to || !approveTarget || !data) {
    throw new Error(`route API returned no calldata (got keys: ${Object.keys(d ?? {}).join(",")})`);
  }

  // Expected output: route-service calls it resAmount (human) or targetAmount.
  const outHuman = Number(d.resAmount ?? d.targetAmount ?? d.toAmount ?? 0);
  const toAmountRaw =
    d.resAmountRaw != null
      ? BigInt(d.resAmountRaw)
      : BigInt(Math.floor(outHuman * 10 ** params.toTokenDecimals));

  return {
    to,
    approveTarget,
    data,
    value: BigInt(d.value ?? 0),
    toAmountRaw,
  };
}
