// ---------------------------------------------------------------------------
// Executor — runs when a trigger fires. Re-reads price, enforces the safety
// guards (slippage floor + price-impact), approves if needed, and swaps on
// FaroSwap's V3 SwapRouter. Aborts (without discarding the order) if any guard
// fails, so a bad market never forces a bad fill.
// ---------------------------------------------------------------------------

import { Contract, JsonRpcProvider, Wallet, parseUnits, MaxUint256, ZeroAddress } from "ethers";
import {
  RPC_URL,
  FAROSWAP,
  SAFETY,
  BASE_SYMBOL,
  QUOTE_SYMBOL,
  baseToken,
  quoteToken,
} from "./config";
import { resolvePool, getPoolState, sqrtPriceToQuotePerBase } from "./price";
import { getDodoRoute } from "./dodoRoute";
import { Order } from "./store";

const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];

// Uniswap-V3 SwapRouter exactInputSingle. FaroSwap is a DODO fork that also
// ships the stock Uniswap V3 periphery, so this signature matches its deployed
// SwapRouter. (If a pair's liquidity lives in a DODO PMM pool instead, the V3
// route will have no pool — see README for the DODO route fallback.)
const ROUTER_ABI = [
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
];

export interface FillResult {
  ok: boolean;
  reason?: string;
  txHash?: string;
}

/**
 * Single-tick V3 price-impact estimate, in basis points.
 *
 * Uses the pool's current sqrtPrice + liquidity to compute the output for this
 * trade assuming liquidity is constant across it (exact for trades that don't
 * cross a tick; for larger trades it UNDER-states impact, so pair it with the
 * slippage floor below). The pool fee is charged on the input first, which
 * makes the estimate slightly conservative.
 */
export function estimateImpactBps(
  sqrtPriceX96: bigint,
  liquidity: bigint,
  token0: string,
  fee: number,
  amountInHuman: number,
  payIsBase: boolean
): number {
  const baseInfo = baseToken();
  const quoteInfo = quoteToken();
  const tokenIn = payIsBase ? baseInfo : quoteInfo;
  const tokenOut = payIsBase ? quoteInfo : baseInfo;

  const L = Number(liquidity);
  if (L <= 0) return Number.POSITIVE_INFINITY;

  const sqrtP = Number(sqrtPriceX96) / 2 ** 96; // sqrt(token1/token0), base units
  const spot = sqrtPriceToQuotePerBase(sqrtPriceX96, token0); // QUOTE per BASE

  // Input in raw base units, net of the pool fee.
  const amountInRaw = amountInHuman * 10 ** tokenIn.decimals * (1 - fee / 1_000_000);

  const inIsToken0 = tokenIn.address.toLowerCase() === token0;
  let amountOutRaw: number;
  if (inIsToken0) {
    // Selling token0: 1/sqrtP grows by amountIn/L; out is token1.
    const sqrtPNew = 1 / (1 / sqrtP + amountInRaw / L);
    amountOutRaw = L * (sqrtP - sqrtPNew);
  } else {
    // Selling token1: sqrtP grows by amountIn/L; out is token0.
    const sqrtPNew = sqrtP + amountInRaw / L;
    amountOutRaw = L * (1 / sqrtP - 1 / sqrtPNew);
  }
  const amountOutHuman = amountOutRaw / 10 ** tokenOut.decimals;
  if (!(amountOutHuman > 0)) return Number.POSITIVE_INFINITY;

  // Effective execution price as QUOTE per BASE.
  const effective = payIsBase
    ? amountOutHuman / amountInHuman // base in, quote out
    : amountInHuman / amountOutHuman; // quote in, base out

  return Math.abs(spot - effective) / spot * 10_000;
}

export async function executeFill(order: Order): Promise<FillResult> {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) return { ok: false, reason: "PRIVATE_KEY not set" };

  const provider = new JsonRpcProvider(RPC_URL);
  const wallet = new Wallet(pk, provider);

  const payIsBase = order.pay === BASE_SYMBOL;
  const tokenIn = payIsBase ? baseToken() : quoteToken();
  const tokenOut = payIsBase ? quoteToken() : baseToken();
  const amountIn = parseUnits(order.amount.toString(), tokenIn.decimals);

  // --- Guard 1: balance --------------------------------------------------
  const inErc20 = new Contract(tokenIn.address, ERC20_ABI, wallet);
  const bal: bigint = await inErc20.balanceOf(wallet.address);
  if (bal < amountIn) {
    return { ok: false, reason: `insufficient ${order.pay}: have ${bal}, need ${amountIn}` };
  }

  // --- Resolve the pool + read state once --------------------------------
  const pool = await resolvePool();
  const state = await getPoolState();
  const price = sqrtPriceToQuotePerBase(state.sqrtPriceX96, state.token0); // QUOTE/BASE

  // --- Guard 2: price impact --------------------------------------------
  const impactBps = estimateImpactBps(
    state.sqrtPriceX96,
    state.liquidity,
    state.token0,
    pool.fee,
    order.amount,
    payIsBase
  );
  if (impactBps > SAFETY.MAX_IMPACT_BPS) {
    return {
      ok: false,
      reason: `price impact ${impactBps.toFixed(1)}bps exceeds cap ${SAFETY.MAX_IMPACT_BPS}bps — order left active`,
    };
  }

  // --- Guard 3: slippage floor on amountOutMinimum -----------------------
  // Re-reading price above also re-validates a possibly-stale limit trigger.
  const expectedOutHuman = payIsBase ? order.amount * price : order.amount / price;
  const minOutHuman = expectedOutHuman * (1 - SAFETY.SLIPPAGE_BPS / 10_000);
  const amountOutMinimum = parseUnits(minOutHuman.toFixed(tokenOut.decimals), tokenOut.decimals);

  // --- Pick the router this network exposes ------------------------------
  // Testnet: a plain V3 SwapRouter (exactInputSingle). Mainnet: FaroSwap's
  // DODO route proxy (mixSwap), whose calldata comes from the route API.
  const useDodo = FAROSWAP.swapRouter === ZeroAddress;

  if (useDodo) {
    // --- DODO route proxy path (mainnet) ---------------------------------
    let route;
    try {
      route = await getDodoRoute({
        fromToken: tokenIn.address,
        toToken: tokenOut.address,
        fromAmountRaw: amountIn,
        userAddr: wallet.address,
        toTokenDecimals: tokenOut.decimals,
      });
    } catch (e: any) {
      return { ok: false, reason: `route fetch failed: ${e?.message ?? e} — order stays active` };
    }
    // Anchor safety on verified, on-chain facts — never trust the API blindly.
    if (route.to.toLowerCase() !== FAROSWAP.dodoRouteProxy.toLowerCase()) {
      return {
        ok: false,
        reason: `route target ${route.to} != verified proxy ${FAROSWAP.dodoRouteProxy} — aborted`,
      };
    }
    if (route.toAmountRaw < amountOutMinimum) {
      return {
        ok: false,
        reason: `route out ${route.toAmountRaw} below slippage floor ${amountOutMinimum} — order stays active`,
      };
    }

    // DODO returns a separate spender for ERC-20 approval. Approving the tx
    // target is insufficient and causes SafeERC20 transferFrom failures.
    const allowance: bigint = await inErc20.allowance(wallet.address, route.approveTarget);
    if (allowance < amountIn) {
      const approveTx = await inErc20.approve(route.approveTarget, MaxUint256);
      await approveTx.wait();
    }

    try {
      const tx = await wallet.sendTransaction({ to: route.to, data: route.data, value: route.value });
      const receipt = await tx.wait();
      return { ok: true, txHash: receipt!.hash };
    } catch (e: any) {
      return { ok: false, reason: `swap reverted: ${e?.shortMessage ?? e?.message ?? e}` };
    }
  }

  // --- V3 SwapRouter path (testnet) --------------------------------------
  const allowance: bigint = await inErc20.allowance(wallet.address, FAROSWAP.swapRouter);
  if (allowance < amountIn) {
    const approveTx = await inErc20.approve(FAROSWAP.swapRouter, MaxUint256);
    await approveTx.wait();
  }

  const router = new Contract(FAROSWAP.swapRouter, ROUTER_ABI, wallet);
  const deadline = Math.floor(Date.now() / 1000) + 600;
  const params = {
    tokenIn: tokenIn.address,
    tokenOut: tokenOut.address,
    fee: pool.fee, // use the resolved pool's actual fee tier
    recipient: wallet.address,
    deadline,
    amountIn,
    amountOutMinimum,
    sqrtPriceLimitX96: 0,
  };

  try {
    const tx = await router.exactInputSingle(params);
    const receipt = await tx.wait();
    return { ok: true, txHash: receipt.hash };
  } catch (e: any) {
    // Most commonly a slippage revert (price moved past the floor). Leave the
    // order active so it can try again on the next poll.
    return { ok: false, reason: `swap reverted: ${e?.shortMessage ?? e?.message ?? e}` };
  }
}
