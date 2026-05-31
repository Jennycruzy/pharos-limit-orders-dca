// ---------------------------------------------------------------------------
// Live price reader — computes QUOTE-per-BASE (USDC per WPHRS) spot price from
// the FaroSwap V3 pool's slot0 (sqrtPriceX96). This is enough to evaluate
// triggers; the actual fill amount is protected separately by slippage and the
// price-impact guard in swap.ts.
//
// The pool address is NOT hardcoded: if FAROSWAP.pool is left as the zero
// address, we discover it from the verified V3 factory (getPool across the
// standard fee tiers, picking the most-liquid). That means the only token
// values you must verify are the two ERC20 addresses — the pool is derived
// from contracts FaroSwap itself published.
// ---------------------------------------------------------------------------

import { Contract, JsonRpcProvider, ZeroAddress } from "ethers";
import {
  RPC_URL,
  FAROSWAP,
  FEE_TIERS,
  baseToken,
  quoteToken,
  BASE_SYMBOL,
  QUOTE_SYMBOL,
} from "./config";

// Minimal Uniswap-V3 pool ABI — slot0 gives the current sqrt price, token0/
// token1 give the ordering, and liquidity feeds the price-impact estimate.
const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function liquidity() view returns (uint128)",
];

const FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)",
];

export const provider = new JsonRpcProvider(RPC_URL);

export interface PoolInfo {
  address: string;
  fee: number;
  token0: string; // lowercased
}

export interface PoolState {
  sqrtPriceX96: bigint;
  liquidity: bigint;
  token0: string; // lowercased
}

let cachedPool: PoolInfo | null = null;

/**
 * Returns the V3 pool for BASE/QUOTE. Uses FAROSWAP.pool if explicitly set,
 * otherwise discovers it from the factory and picks the most-liquid fee tier.
 * Cached after the first resolution.
 */
export async function resolvePool(): Promise<PoolInfo> {
  if (cachedPool) return cachedPool;

  // Explicit override wins — read its real fee/ordering off-chain isn't needed,
  // but we still read token0 so price orientation is correct.
  if (FAROSWAP.pool !== ZeroAddress) {
    const pool = new Contract(FAROSWAP.pool, POOL_ABI, provider);
    const token0 = (await pool.token0()) as string;
    cachedPool = {
      address: FAROSWAP.pool,
      fee: FAROSWAP.poolFeeTier,
      token0: token0.toLowerCase(),
    };
    return cachedPool;
  }

  const factory = new Contract(FAROSWAP.v3Factory, FACTORY_ABI, provider);
  const base = baseToken().address;
  const quote = quoteToken().address;

  // Try the preferred tier first, then the rest, and keep the most-liquid pool.
  const tiers = [FAROSWAP.poolFeeTier, ...FEE_TIERS.filter((f) => f !== FAROSWAP.poolFeeTier)];
  let best: { info: PoolInfo; liquidity: bigint } | null = null;

  for (const fee of tiers) {
    const addr = (await factory.getPool(base, quote, fee)) as string;
    if (addr === ZeroAddress) continue;
    const pool = new Contract(addr, POOL_ABI, provider);
    const [liquidity, token0] = await Promise.all([
      pool.liquidity() as Promise<bigint>,
      pool.token0() as Promise<string>,
    ]);
    const info: PoolInfo = { address: addr, fee, token0: token0.toLowerCase() };
    if (!best || liquidity > best.liquidity) best = { info, liquidity };
  }

  if (!best) {
    throw new Error(
      `No FaroSwap V3 pool found for ${BASE_SYMBOL}/${QUOTE_SYMBOL} at fee tiers ` +
        `[${tiers.join(", ")}]. The pair's liquidity may live in a DODO PMM or V2 ` +
        `pool instead — see README "FaroSwap is a DODO fork". Set FAROSWAP.pool ` +
        `manually if you know the V3 pool address.`
    );
  }
  if (best.liquidity === 0n) {
    throw new Error(
      `${BASE_SYMBOL}/${QUOTE_SYMBOL} V3 pool ${best.info.address} exists but has ZERO ` +
        `liquidity — a V3 fill would revert. Liquidity is likely in a DODO pool; ` +
        `see README for the DODO route fallback.`
    );
  }

  cachedPool = best.info;
  return cachedPool;
}

/** Raw pool state for the price-impact estimate. */
export async function getPoolState(): Promise<PoolState> {
  const { address } = await resolvePool();
  const pool = new Contract(address, POOL_ABI, provider);
  const [slot0, liquidity, token0] = await Promise.all([
    pool.slot0(),
    pool.liquidity() as Promise<bigint>,
    pool.token0() as Promise<string>,
  ]);
  return {
    sqrtPriceX96: slot0.sqrtPriceX96 as bigint,
    liquidity,
    token0: (token0 as string).toLowerCase(),
  };
}

/**
 * Convert a sqrtPriceX96 + token0 identity into QUOTE-per-BASE (USDC per WPHRS),
 * adjusting for decimals and pool ordering.
 */
export function sqrtPriceToQuotePerBase(sqrtPriceX96: bigint, token0: string): number {
  const baseInfo = baseToken();
  const quoteInfo = quoteToken();
  const baseAddr = baseInfo.address.toLowerCase();
  const quoteAddr = quoteInfo.address.toLowerCase();
  const t0 = token0.toLowerCase();

  // (sqrtPriceX96 / 2^96)^2 = raw token1-per-token0 (in base units).
  const sqrt = Number(sqrtPriceX96) / 2 ** 96;
  let priceToken1PerToken0 = sqrt * sqrt;

  // Decimal adjustment: raw price is in token1/token0 base units.
  const dec0 = t0 === baseAddr ? baseInfo.decimals : quoteInfo.decimals;
  const dec1 = t0 === baseAddr ? quoteInfo.decimals : baseInfo.decimals;
  priceToken1PerToken0 = priceToken1PerToken0 * 10 ** (dec0 - dec1);

  if (t0 === baseAddr) {
    // token0 = BASE, token1 = QUOTE -> already QUOTE per BASE.
    return priceToken1PerToken0;
  } else if (t0 === quoteAddr) {
    // token0 = QUOTE, token1 = BASE -> invert.
    return 1 / priceToken1PerToken0;
  }
  throw new Error(
    `Pool token0 (${t0}) is neither ${BASE_SYMBOL} nor ${QUOTE_SYMBOL} — check the ` +
      `token addresses and the resolved pool.`
  );
}

/** Current price expressed as QUOTE per 1 BASE (USDC per WPHRS). */
export async function getPrice(): Promise<number> {
  const { sqrtPriceX96, token0 } = await getPoolState();
  return sqrtPriceToQuotePerBase(sqrtPriceX96, token0);
}
