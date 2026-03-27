import { Effect, Context, Layer, Data } from "effect";
import {
  createPublicClient,
  http,
  encodeFunctionData,
  parseUnits,
  keccak256,
  pad,
  type Hash,
  type Chain,
} from "viem";
import { mainnet, polygon, arbitrum, optimism, base } from "viem/chains";
import { eq, desc, and } from "drizzle-orm";
import { DatabaseService } from "../../db/client.js";
import { cctpTransfers, type CctpTransfer } from "../../db/schema/index.js";
import {
  ContractRegistry,
  type ContractNotFoundError,
} from "../contract/contract-registry.js";
import {
  WalletService,
  type WalletError,
} from "../wallet/wallet-service.js";
import { ConfigService } from "../../config.js";
import { CCTP_DOMAIN_IDS } from "../../connectors/cctp.js";

// ── Errors ─────────────────────────────────────────────────────────

export class CctpError extends Data.TaggedError("CctpError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ── World Chain definition (not in viem/chains by default) ─────────

const worldchain: Chain = {
  id: 480,
  name: "World Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://worldchain-mainnet.g.alchemy.com/public"] },
  },
};

const CHAIN_MAP: Record<number, Chain> = {
  1: mainnet,
  137: polygon,
  42161: arbitrum,
  10: optimism,
  8453: base,
  480: worldchain,
};

const CCTP_SUPPORTED_CHAINS = new Set(Object.keys(CCTP_DOMAIN_IDS).map(Number));

const CIRCLE_ATTESTATION_API = "https://iris-api.circle.com/attestations";

// USDC addresses per chain (needed for approve + burnToken param)
const USDC_ADDRESSES: Record<number, `0x${string}`> = {
  1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  137: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  10: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  480: "0x79A02482A880bCE3B13e3b26f08d52d44D3D0AC2",
};

const ERC20_APPROVE_ABI = [
  {
    type: "function" as const,
    name: "approve",
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// ── Params ─────────────────────────────────────────────────────────

export interface InitiateCctpTransferParams {
  readonly walletId: string;
  readonly walletType: "user" | "server" | "agent";
  readonly sourceChainId: number;
  readonly destinationChainId: number;
  readonly amount: string; // Human-readable USDC (e.g. "10.5")
  readonly recipient: `0x${string}`; // Address on destination chain
  readonly userId: string;
}

// ── Service API ────────────────────────────────────────────────────

export interface CctpServiceApi {
  readonly initiate: (
    params: InitiateCctpTransferParams
  ) => Effect.Effect<CctpTransfer, CctpError | ContractNotFoundError | WalletError>;
  readonly pollAttestation: (
    transferId: string
  ) => Effect.Effect<CctpTransfer, CctpError>;
  readonly completeMint: (
    transferId: string,
    walletId: string,
    walletType: "user" | "server" | "agent"
  ) => Effect.Effect<CctpTransfer, CctpError | ContractNotFoundError | WalletError>;
  readonly getTransfer: (
    id: string
  ) => Effect.Effect<CctpTransfer | undefined, CctpError>;
  readonly listTransfers: (
    userId: string
  ) => Effect.Effect<ReadonlyArray<CctpTransfer>, CctpError>;
}

export class CctpService extends Context.Tag("CctpService")<
  CctpService,
  CctpServiceApi
>() {}

// ── Implementation ─────────────────────────────────────────────────

export const CctpServiceLive: Layer.Layer<
  CctpService,
  never,
  DatabaseService | ContractRegistry | WalletService | ConfigService
> = Layer.effect(
  CctpService,
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;
    const registry = yield* ContractRegistry;
    const walletService = yield* WalletService;
    const config = yield* ConfigService;

    function getClient(chainId: number) {
      const chain = CHAIN_MAP[chainId] ?? mainnet;
      const rpcUrl =
        chainId === 8453 && config.baseRpcUrl ? config.baseRpcUrl : undefined;
      return createPublicClient({ chain, transport: http(rpcUrl) });
    }

    return {
      // ── Step 1: Approve USDC + depositForBurn ──────────────────
      initiate: (params: InitiateCctpTransferParams) =>
        Effect.gen(function* () {
          // Validate chains
          if (!CCTP_SUPPORTED_CHAINS.has(params.sourceChainId)) {
            return yield* Effect.fail(
              new CctpError({
                message: `Source chain ${params.sourceChainId} is not supported by CCTP`,
              })
            );
          }
          if (!CCTP_SUPPORTED_CHAINS.has(params.destinationChainId)) {
            return yield* Effect.fail(
              new CctpError({
                message: `Destination chain ${params.destinationChainId} is not supported by CCTP`,
              })
            );
          }
          if (params.sourceChainId === params.destinationChainId) {
            return yield* Effect.fail(
              new CctpError({
                message: "Source and destination chains must be different",
              })
            );
          }

          const destinationDomain = CCTP_DOMAIN_IDS[params.destinationChainId]!;
          const rawAmount = parseUnits(params.amount, 6); // USDC = 6 decimals

          // Create transfer record
          const [transfer] = yield* Effect.tryPromise({
            try: () =>
              db
                .insert(cctpTransfers)
                .values({
                  userId: params.userId,
                  walletId: params.walletId,
                  walletType: params.walletType,
                  sourceChainId: params.sourceChainId,
                  destinationChainId: params.destinationChainId,
                  destinationDomain,
                  amount: params.amount,
                  recipient: params.recipient,
                  status: "pending_approval",
                })
                .returning(),
            catch: (e) =>
              new CctpError({ message: `Failed to create transfer: ${e}`, cause: e }),
          });

          const wallet = yield* walletService.getWallet(
            params.walletId,
            params.walletType
          );

          const usdcAddress = USDC_ADDRESSES[params.sourceChainId];
          if (!usdcAddress) {
            return yield* Effect.fail(
              new CctpError({
                message: `USDC not configured for chain ${params.sourceChainId}`,
              })
            );
          }

          // Look up TokenMessenger address
          const tokenMessenger = yield* registry.get(
            "cctp-token-messenger",
            params.sourceChainId
          );

          // Step 1: Approve USDC to TokenMessenger
          const approveData = encodeFunctionData({
            abi: ERC20_APPROVE_ABI,
            functionName: "approve",
            args: [tokenMessenger.address, rawAmount],
          });

          const approveTxHash = yield* wallet
            .sendTransaction({
              to: usdcAddress,
              data: approveData,
              chainId: params.sourceChainId,
            })
            .pipe(
              Effect.tapError(() =>
                Effect.tryPromise({
                  try: () =>
                    db
                      .update(cctpTransfers)
                      .set({ status: "failed", error: "USDC approval failed" })
                      .where(eq(cctpTransfers.id, transfer!.id)),
                  catch: () => new CctpError({ message: "DB update failed" }),
                }).pipe(Effect.ignore)
              )
            );

          // Update record with approve hash
          yield* Effect.tryPromise({
            try: () =>
              db
                .update(cctpTransfers)
                .set({
                  approveTxHash,
                  status: "approved",
                  updatedAt: new Date(),
                })
                .where(eq(cctpTransfers.id, transfer!.id)),
            catch: (e) =>
              new CctpError({ message: `DB update failed: ${e}`, cause: e }),
          });

          // Step 2: depositForBurn
          // Convert recipient address to bytes32 (left-padded)
          const mintRecipient = pad(params.recipient, { size: 32 });

          const burnData = encodeFunctionData({
            abi: tokenMessenger.abi,
            functionName: "depositForBurn",
            args: [rawAmount, destinationDomain, mintRecipient, usdcAddress],
          });

          const burnTxHash = yield* wallet
            .sendTransaction({
              to: tokenMessenger.address,
              data: burnData,
              chainId: params.sourceChainId,
            })
            .pipe(
              Effect.tapError(() =>
                Effect.tryPromise({
                  try: () =>
                    db
                      .update(cctpTransfers)
                      .set({ status: "failed", error: "depositForBurn failed" })
                      .where(eq(cctpTransfers.id, transfer!.id)),
                  catch: () => new CctpError({ message: "DB update failed" }),
                }).pipe(Effect.ignore)
              )
            );

          // Extract MessageSent event to get message bytes + hash
          const client = getClient(params.sourceChainId);
          const receipt = yield* Effect.tryPromise({
            try: () => client.waitForTransactionReceipt({ hash: burnTxHash }),
            catch: (e) =>
              new CctpError({
                message: `Failed to get burn receipt: ${e}`,
                cause: e,
              }),
          });

          // Find MessageSent log (topic0 = keccak256("MessageSent(bytes)"))
          const messageSentTopic = keccak256(
            new TextEncoder().encode("MessageSent(bytes)")
          ) as `0x${string}`;

          const messageSentLog = receipt.logs.find(
            (log) => log.topics[0] === messageSentTopic
          );

          let messageBytes: string | null = null;
          let messageHash: string | null = null;

          if (messageSentLog) {
            // The message is ABI-encoded in log data; raw bytes after offset
            messageBytes = messageSentLog.data;
            messageHash = keccak256(messageSentLog.data as `0x${string}`);
          }

          // Update record
          const [updated] = yield* Effect.tryPromise({
            try: () =>
              db
                .update(cctpTransfers)
                .set({
                  burnTxHash,
                  messageBytes,
                  messageHash,
                  status: "burned",
                  updatedAt: new Date(),
                })
                .where(eq(cctpTransfers.id, transfer!.id))
                .returning(),
            catch: (e) =>
              new CctpError({ message: `DB update failed: ${e}`, cause: e }),
          });

          return updated!;
        }),

      // ── Step 2: Poll Circle attestation API ────────────────────
      pollAttestation: (transferId: string) =>
        Effect.gen(function* () {
          const [transfer] = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(cctpTransfers)
                .where(eq(cctpTransfers.id, transferId)),
            catch: (e) =>
              new CctpError({ message: `Failed to get transfer: ${e}`, cause: e }),
          });

          if (!transfer) {
            return yield* Effect.fail(
              new CctpError({ message: `Transfer ${transferId} not found` })
            );
          }

          if (!transfer.messageHash) {
            return yield* Effect.fail(
              new CctpError({
                message: "Transfer has no message hash - burn may not be complete",
              })
            );
          }

          if (transfer.status === "attested" || transfer.status === "completed") {
            return transfer;
          }

          // Query Circle's attestation service
          const response = yield* Effect.tryPromise({
            try: () =>
              fetch(`${CIRCLE_ATTESTATION_API}/${transfer.messageHash}`),
            catch: (e) =>
              new CctpError({
                message: `Attestation API request failed: ${e}`,
                cause: e,
              }),
          });

          const body = yield* Effect.tryPromise({
            try: () => response.json() as Promise<{
              status: string;
              attestation?: string;
            }>,
            catch: (e) =>
              new CctpError({
                message: `Failed to parse attestation response: ${e}`,
                cause: e,
              }),
          });

          if (body.status !== "complete" || !body.attestation) {
            // Not ready yet, update status to attesting
            if (transfer.status !== "attesting") {
              yield* Effect.tryPromise({
                try: () =>
                  db
                    .update(cctpTransfers)
                    .set({ status: "attesting", updatedAt: new Date() })
                    .where(eq(cctpTransfers.id, transferId)),
                catch: (e) =>
                  new CctpError({ message: `DB update failed: ${e}`, cause: e }),
              });
            }

            return yield* Effect.fail(
              new CctpError({
                message: `Attestation not ready (status: ${body.status})`,
              })
            );
          }

          // Attestation is ready
          const [updated] = yield* Effect.tryPromise({
            try: () =>
              db
                .update(cctpTransfers)
                .set({
                  attestation: body.attestation,
                  status: "attested",
                  updatedAt: new Date(),
                })
                .where(eq(cctpTransfers.id, transferId))
                .returning(),
            catch: (e) =>
              new CctpError({ message: `DB update failed: ${e}`, cause: e }),
          });

          return updated!;
        }),

      // ── Step 3: Mint on destination chain ──────────────────────
      completeMint: (
        transferId: string,
        walletId: string,
        walletType: "user" | "server" | "agent"
      ) =>
        Effect.gen(function* () {
          const [transfer] = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(cctpTransfers)
                .where(eq(cctpTransfers.id, transferId)),
            catch: (e) =>
              new CctpError({ message: `Failed to get transfer: ${e}`, cause: e }),
          });

          if (!transfer) {
            return yield* Effect.fail(
              new CctpError({ message: `Transfer ${transferId} not found` })
            );
          }

          if (transfer.status === "completed") {
            return transfer;
          }

          if (!transfer.messageBytes || !transfer.attestation) {
            return yield* Effect.fail(
              new CctpError({
                message:
                  "Transfer missing messageBytes or attestation - poll attestation first",
              })
            );
          }

          // Get MessageTransmitter on destination chain
          const messageTransmitter = yield* registry.get(
            "cctp-message-transmitter",
            transfer.destinationChainId
          );

          const mintData = encodeFunctionData({
            abi: messageTransmitter.abi,
            functionName: "receiveMessage",
            args: [
              transfer.messageBytes as `0x${string}`,
              transfer.attestation as `0x${string}`,
            ],
          });

          const wallet = yield* walletService.getWallet(walletId, walletType);

          const mintTxHash = yield* wallet
            .sendTransaction({
              to: messageTransmitter.address,
              data: mintData,
              chainId: transfer.destinationChainId,
            })
            .pipe(
              Effect.tapError(() =>
                Effect.tryPromise({
                  try: () =>
                    db
                      .update(cctpTransfers)
                      .set({
                        status: "failed",
                        error: "receiveMessage failed on destination chain",
                        updatedAt: new Date(),
                      })
                      .where(eq(cctpTransfers.id, transferId)),
                  catch: () => new CctpError({ message: "DB update failed" }),
                }).pipe(Effect.ignore)
              )
            );

          const [updated] = yield* Effect.tryPromise({
            try: () =>
              db
                .update(cctpTransfers)
                .set({
                  mintTxHash,
                  status: "completed",
                  updatedAt: new Date(),
                  completedAt: new Date(),
                })
                .where(eq(cctpTransfers.id, transferId))
                .returning(),
            catch: (e) =>
              new CctpError({ message: `DB update failed: ${e}`, cause: e }),
          });

          return updated!;
        }),

      getTransfer: (id: string) =>
        Effect.tryPromise({
          try: async () => {
            const [result] = await db
              .select()
              .from(cctpTransfers)
              .where(eq(cctpTransfers.id, id));
            return result;
          },
          catch: (e) =>
            new CctpError({ message: `Failed to get transfer: ${e}`, cause: e }),
        }),

      listTransfers: (userId: string) =>
        Effect.tryPromise({
          try: async () => {
            const results = await db
              .select()
              .from(cctpTransfers)
              .where(eq(cctpTransfers.userId, userId))
              .orderBy(desc(cctpTransfers.createdAt));
            return results;
          },
          catch: (e) =>
            new CctpError({ message: `Failed to list transfers: ${e}`, cause: e }),
        }),
    };
  })
);
