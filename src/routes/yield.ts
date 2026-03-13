import { Hono } from "hono";
import { Effect } from "effect";
import { type AppRuntime, runEffect } from "./effect-handler.js";
import { YieldService } from "../services/yield/yield-service.js";
import { OnboardingService } from "../services/onboarding/onboarding-service.js";
import { ConfigService } from "../config.js";
import type { AuthVariables } from "../middleware/auth.js";
import type { YieldVault } from "../db/schema/index.js";

// ── Morpho GraphQL enrichment ─────────────────────────────────────────

const MORPHO_GRAPHQL = "https://api.morpho.org/graphql";

interface MorphoVaultData {
  avgApy: number;
  netApy: number;
  performanceFee: number;
  totalAssetsUsd: number;
  asset: { symbol: string; priceUsd: number } | null;
  metadata: { image: string | null; description: string | null } | null;
}

const morphoQuery = `
  query VaultData($address: String!, $chainId: Int!) {
    vaultV2ByAddress(address: $address, chainId: $chainId) {
      avgApy
      netApy
      performanceFee
      totalAssetsUsd
      asset { symbol priceUsd }
      metadata { image description }
    }
  }
`;

async function fetchMorphoVault(
  address: string,
  chainId: number
): Promise<MorphoVaultData | null> {
  try {
    const res = await fetch(MORPHO_GRAPHQL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: morphoQuery,
        variables: { address, chainId },
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: { vaultV2ByAddress?: MorphoVaultData };
    };
    return json.data?.vaultV2ByAddress ?? null;
  } catch {
    return null;
  }
}

function formatApy(apy: number): string {
  return `${(apy * 100).toFixed(2)}%`;
}

type EnrichedVault = YieldVault & {
  apy: string | null;
  netApy: string | null;
  performanceFee: string | null;
  totalAssetsUsd: string | null;
  assetPriceUsd: number | null;
  vaultImage: string | null;
  vaultDescription: string | null;
};

async function enrichVault(vault: YieldVault): Promise<EnrichedVault> {
  const morpho = await fetchMorphoVault(vault.vaultAddress, vault.chainId);
  if (!morpho) {
    return {
      ...vault,
      apy: null,
      netApy: null,
      performanceFee: null,
      totalAssetsUsd: null,
      assetPriceUsd: null,
      vaultImage: null,
      vaultDescription: null,
    };
  }
  return {
    ...vault,
    apy: formatApy(morpho.avgApy),
    netApy: formatApy(morpho.netApy),
    performanceFee: `${(morpho.performanceFee * 100).toFixed(2)}%`,
    totalAssetsUsd: morpho.totalAssetsUsd.toFixed(2),
    assetPriceUsd: morpho.asset?.priceUsd ?? null,
    vaultImage: morpho.metadata?.image ?? null,
    vaultDescription: morpho.metadata?.description ?? vault.description,
  };
}

async function enrichVaults(vaults: ReadonlyArray<YieldVault>): Promise<EnrichedVault[]> {
  return Promise.all(vaults.map(enrichVault));
}

/**
 * Public yield routes -- all behind Privy auth middleware.
 * Every operation is scoped to the authenticated user.
 */
export function createYieldRoutes(runtime: AppRuntime) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // ── Vault routes ──────────────────────────────────────────────────

  // List active vaults (enriched with Morpho APY data)
  app.get("/vaults", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const chainIdParam = c.req.query("chainId");
        const chainId = chainIdParam ? Number(chainIdParam) : undefined;
        const yieldService = yield* YieldService;
        const vaults = yield* yieldService.listVaults(chainId);
        return yield* Effect.tryPromise({
          try: () => enrichVaults(vaults),
          catch: () => new Error("Failed to enrich vault data"),
        });
      }),
      c
    )
  );

  // Get a single vault (enriched with Morpho APY data)
  app.get("/vaults/:id", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const yieldService = yield* YieldService;
        const vault = yield* yieldService.getVault(id);
        if (!vault) {
          return yield* Effect.fail(new Error("Vault not found"));
        }
        return yield* Effect.tryPromise({
          try: () => enrichVault(vault),
          catch: () => new Error("Failed to enrich vault data"),
        });
      }),
      c
    )
  );

  // ── Position routes ───────────────────────────────────────────────

  // Create a new yield position (lock)
  app.post("/positions", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const config = yield* ConfigService;
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              walletId?: string;
              walletType: "user" | "server" | "agent";
              vaultId: string;
              amount: string;
              unlockTime: number;
              label?: string;
              chainId?: number;
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        // Resolve walletId from walletType if not provided
        let resolvedWalletId = body.walletId;
        if (!resolvedWalletId) {
          const onboarding = yield* OnboardingService;
          const profile = yield* onboarding.getProfile(userId);
          if (body.walletType === "user") {
            resolvedWalletId = profile.userWalletId;
          } else if (body.walletType === "server") {
            resolvedWalletId = profile.serverWalletId;
          } else {
            resolvedWalletId = profile.agentWalletId;
          }
        }

        const yieldService = yield* YieldService;
        return yield* yieldService.createPosition({
          userId,
          walletId: resolvedWalletId!,
          walletType: body.walletType,
          vaultId: body.vaultId,
          amount: body.amount,
          unlockTime: body.unlockTime,
          label: body.label,
          chainId: body.chainId ?? config.defaultChainId,
        });
      }),
      c,
      201
    )
  );

  // List the authenticated user's positions (optional ?type=goal|lock filter)
  app.get("/positions", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const typeParam = c.req.query("type") as "goal" | "lock" | undefined;
        const type = typeParam === "goal" || typeParam === "lock" ? typeParam : undefined;
        const yieldService = yield* YieldService;
        return yield* yieldService.getUserPositions(userId, type);
      }),
      c
    )
  );

  // Get a single position -- verify the authenticated user owns it
  app.get("/positions/:id", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const userId = c.get("userId");
        const yieldService = yield* YieldService;
        const position = yield* yieldService.getPosition(id);
        if (!position) {
          return yield* Effect.fail(new Error("Position not found"));
        }
        if (position.userId !== userId) {
          return yield* Effect.fail(new Error("Position not found"));
        }
        return position;
      }),
      c
    )
  );

  // Withdraw a matured position
  app.post("/positions/:id/withdraw", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const userId = c.get("userId");
        const yieldService = yield* YieldService;

        const position = yield* yieldService.getPosition(id);
        if (!position || position.userId !== userId) {
          return yield* Effect.fail(new Error("Position not found"));
        }

        return yield* yieldService.withdrawPosition(id);
      }),
      c
    )
  );

  // Get yield snapshot history for a position
  app.get("/positions/:id/history", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const userId = c.get("userId");
        const yieldService = yield* YieldService;

        const position = yield* yieldService.getPosition(id);
        if (!position || position.userId !== userId) {
          return yield* Effect.fail(new Error("Position not found"));
        }

        const limit = Number(c.req.query("limit") ?? "50");
        return yield* yieldService.getYieldHistory(id, limit);
      }),
      c
    )
  );

  // ── Portfolio ─────────────────────────────────────────────────────

  // Portfolio summary (totals, APY)
  app.get("/portfolio", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const yieldService = yield* YieldService;
        return yield* yieldService.getPortfolioSummary(userId);
      }),
      c
    )
  );

  return app;
}
