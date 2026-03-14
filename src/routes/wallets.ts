import { Hono } from "hono";
import { Effect } from "effect";
import { eq, and, gte, sql } from "drizzle-orm";
import {
  createPublicClient,
  http,
  parseAbiItem,
  formatUnits,
  type Address,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import { type AppRuntime, runEffect } from "./effect-handler.js";
import { WalletService } from "../services/wallet/wallet-service.js";
import { WalletResolver } from "../services/wallet/wallet-resolver.js";
import { TransactionService } from "../services/transaction/transaction-service.js";
import { OnboardingService } from "../services/onboarding/onboarding-service.js";
import { ContractExecutor } from "../services/contract/contract-executor.js";
import { ConfigService } from "../config.js";
import { DatabaseService } from "../db/client.js";
import { wallets, categoryLimits, transactions } from "../db/schema/index.js";
import type { AuthVariables } from "../middleware/auth.js";

/**
 * Public wallet routes -- all behind Privy auth middleware.
 * Every operation is scoped to the authenticated user.
 */
export function createWalletRoutes(runtime: AppRuntime) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // List the authenticated user's own wallets
  app.get("/", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const { db } = yield* DatabaseService;
        const results = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(wallets)
              .where(eq(wallets.ownerId, userId))
              .orderBy(wallets.createdAt),
          catch: (error) => new Error(`Failed to list wallets: ${error}`),
        });
        return results;
      }),
      c
    )
  );

  // Read on-chain token balances for all of the authenticated user's wallets
  app.get("/balances", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const config = yield* ConfigService;
        const { db } = yield* DatabaseService;
        const executor = yield* ContractExecutor;
        const chainId = config.defaultChainId;

        const userWallets = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(wallets)
              .where(eq(wallets.ownerId, userId))
              .orderBy(wallets.createdAt),
          catch: (error) => new Error(`Failed to list wallets: ${error}`),
        });

        const walletsWithAddress = userWallets.filter(
          (w): w is typeof w & { address: string } =>
            w.address !== null && w.address !== ""
        );

        const publicClient = createPublicClient({
          chain: base,
          transport: http(),
        });

        const results = yield* Effect.forEach(
          walletsWithAddress,
          (wallet) =>
            Effect.gen(function* () {
              const address = wallet.address as Address;

              const ethBalance = yield* Effect.tryPromise({
                try: () => publicClient.getBalance({ address }),
                catch: () =>
                  new Error(
                    `Failed to read ETH balance for wallet ${wallet.id}`
                  ),
              }).pipe(
                Effect.map((balance) => balance.toString()),
                Effect.catchAll(() => Effect.succeed("0"))
              );

              const usdcBalance = yield* executor
                .readContract("usdc", chainId, "balance", [address])
                .pipe(
                  Effect.map((balance) => String(balance)),
                  Effect.catchAll(() => Effect.succeed("0"))
                );

              return {
                walletId: wallet.id,
                type: wallet.type,
                address: wallet.address,
                balances: {
                  ETH: ethBalance,
                  USDC: usdcBalance,
                },
              };
            }),
          { concurrency: "unbounded" }
        );

        return results;
      }),
      c
    )
  );

  // Get a single wallet -- verify the authenticated user owns it
  app.get("/:id", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const userId = c.get("userId");
        const { db } = yield* DatabaseService;
        const [result] = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(wallets)
              .where(and(eq(wallets.id, id), eq(wallets.ownerId, userId))),
          catch: (error) => new Error(`Failed to get wallet: ${error}`),
        });
        if (!result) {
          return yield* Effect.fail(new Error("Wallet not found"));
        }
        return result;
      }),
      c
    )
  );

  // Create a user wallet -- userId comes from the auth context
  app.post("/user", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const walletService = yield* WalletService;
        const wallet = yield* walletService.createUserWallet(userId);
        const address = yield* wallet.getAddress();
        return { address, type: "user" as const };
      }),
      c
    )
  );

  // Sign a message with a wallet -- verify ownership first
  app.post("/:id/sign", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const id = c.req.param("id");
        const userId = c.get("userId");
        const body = yield* Effect.tryPromise({
          try: () => c.req.json<{ message: string }>(),
          catch: () => new Error("Invalid request body"),
        });
        const { db } = yield* DatabaseService;
        const [walletRecord] = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(wallets)
              .where(and(eq(wallets.id, id), eq(wallets.ownerId, userId))),
          catch: (error) => new Error(`Failed to find wallet: ${error}`),
        });
        if (!walletRecord) {
          return yield* Effect.fail(new Error("Wallet not found"));
        }
        const resolver = yield* WalletResolver;
        const wallet = yield* resolver.resolve({
          walletId: walletRecord.id,
          type: walletRecord.type,
        });
        const signature = yield* wallet.sign(body.message);
        return { signature };
      }),
      c
    )
  );

  // Transfer tokens between the authenticated user's own wallets.
  // Frontend just specifies from/to wallet types and amount — backend handles the rest.
  app.post("/transfer", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const config = yield* ConfigService;
        const body = yield* Effect.tryPromise({
          try: () =>
            c.req.json<{
              from: "user" | "server" | "agent";
              to: "user" | "server" | "agent";
              amount: string;
              token?: string;
              chainId?: number;
              categoryId?: string;
            }>(),
          catch: () => new Error("Invalid request body"),
        });

        if (body.from === body.to) {
          return yield* Effect.fail(
            new Error("Source and destination wallets must be different")
          );
        }

        // Resolve wallet IDs from profile
        const onboarding = yield* OnboardingService;
        const profile = yield* onboarding.getProfile(userId);

        const walletMap = {
          user: profile.userWalletId,
          server: profile.serverWalletId,
          agent: profile.agentWalletId,
        } as const;

        const fromWalletId = walletMap[body.from];
        const toWalletId = walletMap[body.to];

        if (!fromWalletId || !toWalletId) {
          return yield* Effect.fail(
            new Error("One or both wallet types not found on profile")
          );
        }

        // Look up the destination wallet address
        const { db } = yield* DatabaseService;
        const [toWallet] = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(wallets)
              .where(
                and(
                  eq(wallets.id, toWalletId),
                  eq(wallets.ownerId, userId)
                )
              ),
          catch: (error) =>
            new Error(`Failed to find destination wallet: ${error}`),
        });

        if (!toWallet?.address) {
          return yield* Effect.fail(
            new Error("Destination wallet not found or has no address")
          );
        }

        const chainId = body.chainId ?? config.defaultChainId;
        const token = body.token ?? "usdc";

        // ── Category spending limit enforcement ──
        if (body.categoryId) {
          const [limit] = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(categoryLimits)
                .where(
                  and(
                    eq(categoryLimits.userId, userId),
                    eq(categoryLimits.categoryId, body.categoryId!)
                  )
                ),
            catch: () => new Error("Failed to check spending limit"),
          });

          if (limit) {
            // Sum confirmed transactions for this category this month
            const monthStart = new Date(
              new Date().getFullYear(),
              new Date().getMonth(),
              1
            );

            const [spendingResult] = yield* Effect.tryPromise({
              try: () =>
                db
                  .select({
                    total: sql<string>`coalesce(sum(
                      coalesce((${transactions.payload}->'args'->>1)::numeric, 0)
                    ), 0)::text`,
                  })
                  .from(transactions)
                  .where(
                    and(
                      eq(transactions.userId, userId),
                      eq(transactions.categoryId, body.categoryId!),
                      gte(transactions.createdAt, monthStart)
                    )
                  ),
              catch: () => new Error("Failed to calculate spending"),
            });

            const total = spendingResult?.total ?? "0";
            const currentSpent = BigInt(total);
            const monthlyLimit = BigInt(limit.monthlyLimit);
            const txAmount = BigInt(body.amount);

            if (currentSpent + txAmount > monthlyLimit) {
              const decimals = limit.tokenDecimals;
              const spentFormatted = (
                Number(currentSpent) / Math.pow(10, decimals)
              ).toFixed(2);
              const limitFormatted = (
                Number(monthlyLimit) / Math.pow(10, decimals)
              ).toFixed(2);
              return yield* Effect.fail(
                new Error(
                  `Category spending limit exceeded: ${spentFormatted}/${limitFormatted} ${limit.tokenSymbol} this month`
                )
              );
            }
          }
        }

        const txService = yield* TransactionService;
        return yield* txService.submitContractTransaction({
          walletId: fromWalletId,
          walletType: body.from,
          contractName: token,
          chainId,
          method: "transfer",
          args: [toWallet.address, BigInt(body.amount)],
          categoryId: body.categoryId,
          userId,
        });
      }),
      c
    )
  );

  // Get on-chain deposit history (incoming ERC-20 transfers) for the user's wallets
  app.get("/deposits", (c) =>
    runEffect(
      runtime,
      Effect.gen(function* () {
        const userId = c.get("userId");
        const config = yield* ConfigService;
        const { db } = yield* DatabaseService;

        const chainId = Number(c.req.query("chainId") ?? config.defaultChainId);
        const chain = chainId === 84532 ? baseSepolia : base;

        const blocksParam = c.req.query("blocks");
        const blocks = blocksParam ? BigInt(blocksParam) : 100_000n;

        const userWallets = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(wallets)
              .where(eq(wallets.ownerId, userId)),
          catch: (error) => new Error(`Failed to list wallets: ${error}`),
        });

        const addresses = userWallets
          .filter((w) => w.address)
          .map((w) => ({
            address: w.address!.toLowerCase() as Address,
            walletId: w.id,
            walletType: w.type,
          }));

        if (addresses.length === 0) {
          return [];
        }

        // Token contracts to scan for incoming transfers
        const tokens: Array<{
          address: Address;
          symbol: string;
          decimals: number;
        }> = [
          {
            address: (chainId === 84532
              ? "0x036cbd53842c5426634e7929541ec2318f3dcf7e"
              : "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913") as Address,
            symbol: "USDC",
            decimals: 6,
          },
        ];

        const publicClient = createPublicClient({
          chain,
          transport: http(),
        });

        const currentBlock = yield* Effect.tryPromise({
          try: () => publicClient.getBlockNumber(),
          catch: () => new Error("Failed to get current block number"),
        });

        const fromBlock = currentBlock > blocks ? currentBlock - blocks : 0n;

        const transferEvent = parseAbiItem(
          "event Transfer(address indexed from, address indexed to, uint256 value)"
        );

        const addressSet = new Map(
          addresses.map((a) => [a.address, a])
        );

        const allDeposits: Array<{
          walletId: string;
          walletType: string;
          walletAddress: string;
          from: string;
          tokenAddress: string;
          tokenSymbol: string;
          amount: string;
          formattedAmount: string;
          blockNumber: string;
          transactionHash: string;
        }> = [];

        for (const token of tokens) {
          const logs = yield* Effect.tryPromise({
            try: () =>
              publicClient.getLogs({
                address: token.address,
                event: transferEvent,
                args: {
                  to: addresses.map((a) => a.address as Address),
                },
                fromBlock,
                toBlock: currentBlock,
              }),
            catch: (error) =>
              new Error(
                `Failed to fetch ${token.symbol} transfer logs: ${error}`
              ),
          });

          for (const log of logs) {
            const toAddr = (log.args.to as string).toLowerCase();
            const walletInfo = addressSet.get(toAddr as Address);
            if (!walletInfo) continue;

            allDeposits.push({
              walletId: walletInfo.walletId,
              walletType: walletInfo.walletType,
              walletAddress: walletInfo.address,
              from: log.args.from as string,
              tokenAddress: token.address,
              tokenSymbol: token.symbol,
              amount: String(log.args.value),
              formattedAmount: formatUnits(
                log.args.value as bigint,
                token.decimals
              ),
              blockNumber: String(log.blockNumber),
              transactionHash: log.transactionHash,
            });
          }
        }

        // Sort by block number descending (newest first)
        allDeposits.sort(
          (a, b) => Number(BigInt(b.blockNumber) - BigInt(a.blockNumber))
        );

        return allDeposits;
      }),
      c
    )
  );

  return app;
}
