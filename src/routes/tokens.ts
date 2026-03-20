import { Hono } from "hono";
import { Effect } from "effect";
import { createPublicClient, http, erc20Abi } from "viem";
import { base } from "viem/chains";
import { type AppRuntime, runEffect } from "./effect-handler.js";
import { UniswapService } from "../services/uniswap/uniswap-service.js";
import type { AuthVariables } from "../middleware/auth.js";

const publicClient = createPublicClient({ chain: base, transport: http() });

/* ─── Known Tokens on Base (chain 8453) ─────────────────────────── */

// Trust Wallet assets on GitHub (reliable, fast CDN via raw.githubusercontent.com)
const TW_BASE = "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains";
const tw = (chain: string, addr: string) => `${TW_BASE}/${chain}/assets/${addr}/logo.png`;

export interface TokenInfo {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  /** Hex color for UI badges / fallback */
  color: string;
  /** Token logo URL */
  icon: string;
  /** Whether this is a native/gas token */
  native?: boolean;
}

const BASE_TOKENS: TokenInfo[] = [
  {
    symbol: "ETH",
    name: "Ethereum",
    address: "0x0000000000000000000000000000000000000000",
    decimals: 18,
    color: "#627EEA",
    icon: `${TW_BASE}/ethereum/info/logo.png`,
    native: true,
  },
  {
    symbol: "WETH",
    name: "Wrapped Ether",
    address: "0x4200000000000000000000000000000000000006",
    decimals: 18,
    color: "#627EEA",
    icon: `${TW_BASE}/ethereum/info/logo.png`,
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
    color: "#2775CA",
    icon: tw("base", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
  },
  {
    symbol: "USDT",
    name: "Tether USD",
    address: "0x2d1aDB45Bb1d7D2556c6558aDb76CFD4F9F4ed16",
    decimals: 6,
    color: "#26A17B",
    // USDT on Base not in Trust Wallet — use Ethereum mainnet USDT icon (same logo)
    icon: tw("ethereum", "0xdAC17F958D2ee523a2206206994597C13D831ec7"),
  },
  {
    symbol: "DAI",
    name: "Dai Stablecoin",
    address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
    decimals: 18,
    color: "#F5AC37",
    icon: tw("base", "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb"),
  },
  {
    symbol: "cbETH",
    name: "Coinbase Staked ETH",
    address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
    decimals: 18,
    color: "#0052FF",
    icon: tw("base", "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22"),
  },
  {
    symbol: "cbBTC",
    name: "Coinbase Wrapped BTC",
    address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    decimals: 8,
    color: "#F7931A",
    // cbBTC not in Trust Wallet — use CoinGecko image
    icon: "https://coin-images.coingecko.com/coins/images/40143/large/cbbtc.webp",
  },
  {
    symbol: "AERO",
    name: "Aerodrome Finance",
    address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
    decimals: 18,
    color: "#0062FF",
    icon: tw("base", "0x940181a94A35A4569E4529A3CDfB74e38FD98631"),
  },
];

/* ─── Pricing via Uniswap quotes ────────────────────────────────── */

const STABLECOINS = new Set(["USDC", "USDT", "DAI"]);
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
const DUMMY_SWAPPER = "0x0000000000000000000000000000000000000001";

interface PriceCache {
  prices: Record<string, { usd: number; change24h: number }>;
  cachedAt: number;
}

let priceCache: PriceCache | null = null;
const PRICE_CACHE_TTL_MS = 60_000; // 60 seconds

/* ─── Routes ────────────────────────────────────────────────────── */

export function createTokenRoutes(runtime: AppRuntime) {
  const app = new Hono<{ Variables: AuthVariables }>();

  /** GET / — Full list of known Base chain tokens with metadata. */
  app.get("/", async (c) => {
    return c.json({ tokens: BASE_TOKENS });
  });

  /**
   * GET /prices
   * Returns USD prices for all known tokens via Uniswap quotes.
   * Quotes 1 unit of each volatile token against USDC.
   * Cached for 60 seconds.
   */
  app.get("/prices", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const now = Date.now();

        if (priceCache && now - priceCache.cachedAt < PRICE_CACHE_TTL_MS) {
          return priceCache.prices;
        }

        const uniswap = yield* UniswapService;

        // Stablecoins are always ~$1
        const prices: Record<string, { usd: number; change24h: number }> = {};
        for (const symbol of STABLECOINS) {
          prices[symbol] = { usd: 1.0, change24h: 0 };
        }

        // Quote volatile tokens against USDC
        // Skip WETH (mirrors ETH) and stablecoins
        const tokensToQuote = BASE_TOKENS.filter(
          (t) => !STABLECOINS.has(t.symbol) && t.symbol !== "WETH",
        );

        const results = yield* Effect.forEach(
          tokensToQuote,
          (token) => {
            // Uniswap needs WETH address for ETH
            const tokenInAddress =
              token.symbol === "ETH" ? WETH_ADDRESS : token.address;
            const oneUnit = String(10n ** BigInt(token.decimals));

            return uniswap
              .getQuote({
                swapper: DUMMY_SWAPPER,
                tokenIn: tokenInAddress,
                tokenOut: USDC_ADDRESS,
                amount: oneUnit,
                type: "EXACT_INPUT",
              })
              .pipe(
                Effect.map((q) => ({
                  symbol: token.symbol,
                  usd: Number(q.quote.output.amount) / 1e6,
                })),
                Effect.catchAll(() => Effect.succeed(null)),
              );
          },
          { concurrency: 3 },
        );

        for (const r of results) {
          if (r) {
            prices[r.symbol] = { usd: r.usd, change24h: 0 };
          }
        }

        // WETH mirrors ETH
        if (prices["ETH"]) {
          prices["WETH"] = prices["ETH"];
        }

        priceCache = { prices, cachedAt: now };
        return prices;
      }),
      c,
    ),
  );

  /** GET /lookup/:address — Look up token by contract address on-chain. */
  app.get("/lookup/:address", async (c) => {
    const address = c.req.param("address") as `0x${string}`;

    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return c.json({ error: "Invalid address format" }, 400);
    }

    const known = BASE_TOKENS.find(
      (t) => t.address.toLowerCase() === address.toLowerCase(),
    );
    if (known) {
      return c.json({ token: known, source: "registry" });
    }

    try {
      const [name, symbol, decimals] = await Promise.all([
        publicClient.readContract({
          address,
          abi: erc20Abi,
          functionName: "name",
        }),
        publicClient.readContract({
          address,
          abi: erc20Abi,
          functionName: "symbol",
        }),
        publicClient.readContract({
          address,
          abi: erc20Abi,
          functionName: "decimals",
        }),
      ]);

      return c.json({
        token: {
          symbol: symbol as string,
          name: name as string,
          address,
          decimals: Number(decimals),
          color: "#888888",
          icon: tw("base", address),
        },
        source: "onchain",
      });
    } catch {
      return c.json(
        {
          error:
            "Failed to read token data. Address may not be an ERC20 contract.",
        },
        404,
      );
    }
  });

  return app;
}
