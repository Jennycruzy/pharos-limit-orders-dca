// ---------------------------------------------------------------------------
// Pharos Limit Orders & DCA Automation — configuration
//
// Network-keyed config. Select with PHAROS_NETWORK=testnet|mainnet (default
// testnet, which is where FaroSwap is actually deployed today).
//
// PROVENANCE OF ADDRESSES
// -----------------------
// The testnet FaroSwap addresses below come straight from FaroSwap's own
// deployment config (github.com/faroswap/contracts → config/pharos_testnet.ts)
// and the published docs (docs.faroswap.xyz/.../contracts-integration). That is
// the single authoritative source — community bots disagree with each other on
// token addresses because they target different testnet DEXs, so we do NOT
// trust them for money-moving calls.
//
// Anything still `ZeroAddress` is NOT yet verified from an authoritative source.
// assertConfigured() refuses to run the watcher until those are filled, and the
// pool is discovered from the verified V3 factory at runtime (see price.ts) so
// you never have to paste a pool address by hand.
// ---------------------------------------------------------------------------

import { ZeroAddress } from "ethers";

export interface TokenInfo {
  address: string;
  decimals: number;
}

export interface NetworkConfig {
  chainId: number;
  rpcUrl: string;
  explorer: string;
  tokens: Record<string, TokenInfo>;
  faroswap: {
    swapRouter: string;   // Uniswap-V3 SwapRouter (exactInputSingle)
    v3Factory: string;    // UniswapV3Factory — used to discover the pool
    pool: string;         // leave ZeroAddress to auto-discover from the factory
    poolFeeTier: number;  // default tier tried first during discovery
    dodoRouteProxy: string; // DODO route proxy — fallback venue (see README)
  };
}

// The pair this skill trades. Price is always expressed as QUOTE per BASE
// (i.e. USDC per WPHRS). Pharos's native token is PHRS; WPHRS is its wrapped
// ERC20, which is what the V3 pools hold.
export const BASE_SYMBOL = "WPHRS";
export const QUOTE_SYMBOL = "USDC";

// Fee tiers to probe when auto-discovering the pool, most-liquid first.
export const FEE_TIERS = [3000, 500, 10000, 100];

export const NETWORKS: Record<string, NetworkConfig> = {
  // --- Pharos Testnet (FaroSwap is LIVE here) ------------------------------
  testnet: {
    chainId: 688688,
    rpcUrl: process.env.RPC_URL ?? "https://testnet.dplabs-internal.com",
    explorer: "https://testnet.pharosscan.xyz",
    tokens: {
      // WETH9 deployed by FaroSwap = wrapped native PHRS. (faroswap/contracts)
      WPHRS: { address: "0x3019b247381c850ab53dc0ee53bce7a07ea9155f", decimals: 18 },
      // USDC is an external token (not in FaroSwap's repo) so it is UNVERIFIED.
      // Candidate seen in the vonssy FaroSwap bot (DODO route path):
      //   0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8  (6 decimals)
      // CONFIRM before trusting: see README "Verifying the USDC address".
      USDC: { address: ZeroAddress, decimals: 6 },
    },
    faroswap: {
      swapRouter: "0x259C9EBBE307bb0aF410e103202662667254d062", // verified (repo+docs)
      v3Factory: "0x711b476cbEb92803500Dea10CAeb35741d4c33f7",  // verified (repo+docs)
      pool: ZeroAddress,         // auto-discovered from v3Factory.getPool()
      poolFeeTier: 3000,
      dodoRouteProxy: "0x4b177AdEd3b8bD1D5D747F91B9E853513838Cd49", // DODOV2Proxy02 (verified)
    },
  },

  // --- Pharos Mainnet "Pacific" (FaroSwap IS LIVE here) --------------------
  // All values below were extracted from a real FaroSwap WPHRS->USDC swap on
  // mainnet and confirmed on-chain (symbol()/decimals()/token0()/token1()):
  //   tx 0x7843aa595ef2b71aaef5ef6d8eec670829edcec36eb5bc94e41b64cb37f662e0
  // The swap was routed through FaroSwap's DODO route proxy (mixSwap), which
  // settled against the V3 pool below. NOTE: `swapRouter` (the plain V3
  // SwapRouter used by swap.ts's exactInputSingle) is NOT yet verified on
  // mainnet — the verified router is the DODO route proxy. It stays
  // ZeroAddress so assertConfigured() blocks unattended fills until the fill
  // path is settled (see README "Mainnet fill path"). Price reads work today
  // because `pool` is set directly.
  mainnet: {
    chainId: 1672,
    rpcUrl: process.env.RPC_URL ?? "https://infra.originstake.com/pharos/evm",
    explorer: "https://pharosscan.xyz",
    tokens: {
      WPHRS: { address: "0x52c48d4213107b20bc583832b0d951fb9ca8f0b0", decimals: 18 }, // verified symbol()="WPHRS"
      USDC:  { address: "0xc879c018db60520f4355c26ed1a6d572cdac1815", decimals: 6 },  // verified symbol()="USDC"
    },
    faroswap: {
      swapRouter: ZeroAddress,             // V3 SwapRouter UNVERIFIED on mainnet — see note above
      v3Factory: ZeroAddress,              // optional: pool is set directly below
      pool: "0xfc5f8974a7e94504f8d3ac20fbdc67dadff75049", // verified WPHRS/USDC V3 pool (token0=WPHRS, token1=USDC)
      poolFeeTier: 10000,                  // verified fee() = 10000 (1%)
      dodoRouteProxy: "0xa5ca5fbe34e444f366b373170541ec6902b0f75c", // verified router (tx `to`, mixSwap)
    },
  },
};

// --- Active network selection -----------------------------------------------
export const NETWORK = (process.env.PHAROS_NETWORK ?? "testnet").toLowerCase();
const active = NETWORKS[NETWORK];
if (!active) {
  throw new Error(
    `Unknown PHAROS_NETWORK="${NETWORK}". Use one of: ${Object.keys(NETWORKS).join(", ")}`
  );
}

export const CHAIN_ID = active.chainId;
export const RPC_URL = active.rpcUrl;
export const EXPLORER = active.explorer;
export const TOKENS = active.tokens;
export const FAROSWAP = active.faroswap;

// Convenience accessors for the configured pair.
export const baseToken = (): TokenInfo => TOKENS[BASE_SYMBOL];
export const quoteToken = (): TokenInfo => TOKENS[QUOTE_SYMBOL];

// --- Safety guards (applied on every unattended fill) -----------------------
export const SAFETY = {
  SLIPPAGE_BPS: 50,      // 0.50% — amountOutMinimum = quote * (1 - this)
  MAX_IMPACT_BPS: 300,   // 3.00% — abort the fill if estimated price impact exceeds this
  POLL_INTERVAL_MS: 30_000, // how often the watcher checks price/time
};

// --- Routing ----------------------------------------------------------------
// FaroSwap mainnet settles through a DODO route proxy (mixSwap), whose calldata
// is built by DODO's hosted pathfinder ("route service"). The FaroSwap app
// calls api.dodoex.io with the params below (confirmed from the FaroSwap app +
// the open-source FaroSwap bot). chainId is taken from CHAIN_ID at call time, so
// this same endpoint serves mainnet (1672). Override via env if FaroSwap moves
// it. The executor still anchors safety on-chain: it submits only if the API's
// returned router == FAROSWAP.dodoRouteProxy and the quote clears our own
// slippage floor (see swap.ts) — so a wrong/hostile route is rejected, not run.
export const ROUTE_API =
  process.env.FAROSWAP_ROUTE_API ??
  "https://api.dodoex.io/route-service/v2/widget/getdodoroute";
export const ROUTE_API_KEY = process.env.FAROSWAP_ROUTE_API_KEY ?? "a37546505892e1a952";

// --- Storage ----------------------------------------------------------------
export const ORDERS_FILE = process.env.ORDERS_FILE ?? "./orders.json";
export const WATCHER_PID_FILE = "./watcher.pid";

// Refuse to run against unconfigured placeholders. The pool is intentionally
// NOT required here: it is discovered from the verified v3Factory at runtime.
export function assertConfigured(): void {
  const missing: string[] = [];
  if (baseToken().address === ZeroAddress) missing.push(`TOKENS.${BASE_SYMBOL}.address`);
  if (quoteToken().address === ZeroAddress) missing.push(`TOKENS.${QUOTE_SYMBOL}.address`);
  // A fill needs SOME router: either the V3 SwapRouter (exactInputSingle) or
  // the DODO route proxy + a route API (mixSwap). Require at least one path.
  const hasV3Router = FAROSWAP.swapRouter !== ZeroAddress;
  const hasDodoRouter = FAROSWAP.dodoRouteProxy !== ZeroAddress && ROUTE_API !== "";
  if (!hasV3Router && !hasDodoRouter) {
    missing.push(
      "a router: set FAROSWAP.swapRouter (V3) OR FAROSWAP.dodoRouteProxy + FAROSWAP_ROUTE_API env (DODO)"
    );
  }
  if (FAROSWAP.v3Factory === ZeroAddress && FAROSWAP.pool === ZeroAddress) {
    missing.push("FAROSWAP.v3Factory (or FAROSWAP.pool)");
  }
  if (missing.length) {
    throw new Error(
      `Refusing to run on network "${NETWORK}" — unconfigured values in config.ts:\n  - ${missing.join(
        "\n  - "
      )}\nFill these with verified addresses (see README.md).`
    );
  }
}
