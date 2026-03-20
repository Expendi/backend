import { Effect, Context, Layer, Data } from "effect";
import { eq, and, gte, desc } from "drizzle-orm";
import { DatabaseService } from "../../db/client.js";
import {
  transactions,
  pretiumTransactions,
  type Transaction,
  type PretiumTransaction,
  type MandateTrigger,
  type MandateAction,
  type MandateConstraints,
} from "../../db/schema/index.js";

// ── Error type ───────────────────────────────────────────────────────

export class AgentPatternError extends Data.TaggedError("AgentPatternError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ── Types ────────────────────────────────────────────────────────────

export interface SuggestedMandate {
  readonly type: string;
  readonly name: string;
  readonly trigger: MandateTrigger;
  readonly action: MandateAction;
  readonly constraints?: MandateConstraints;
}

export interface PatternEvidence {
  readonly count: number;
  readonly dates: ReadonlyArray<string>;
  readonly amounts: ReadonlyArray<string>;
}

export interface DetectedPattern {
  readonly type:
    | "recurring_send"
    | "regular_buy"
    | "dca"
    | "balance_threshold"
    | "yield_repeat";
  readonly confidence: number;
  readonly description: string;
  readonly suggestedMandate: SuggestedMandate;
  readonly evidence: PatternEvidence;
}

// ── Service interface ────────────────────────────────────────────────

export interface AgentPatternServiceApi {
  readonly analyzePatterns: (
    userId: string
  ) => Effect.Effect<ReadonlyArray<DetectedPattern>, AgentPatternError>;
}

export class AgentPatternService extends Context.Tag("AgentPatternService")<
  AgentPatternService,
  AgentPatternServiceApi
>() {}

// ── Helpers ──────────────────────────────────────────────────────────

function computeIntervalStats(dates: Date[]): {
  meanMs: number;
  stdDevMs: number;
} {
  if (dates.length < 2) {
    return { meanMs: 0, stdDevMs: 0 };
  }

  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(sorted[i]!.getTime() - sorted[i - 1]!.getTime());
  }

  const meanMs = gaps.reduce((sum, g) => sum + g, 0) / gaps.length;
  const variance =
    gaps.reduce((sum, g) => sum + (g - meanMs) ** 2, 0) / gaps.length;
  const stdDevMs = Math.sqrt(variance);

  return { meanMs, stdDevMs };
}

function computeConfidence(
  occurrences: number,
  normalizedStdDev: number,
  mostRecentDate: Date
): number {
  // Base score: min(occurrences / 5, 1.0) * 0.5
  const baseScore = Math.min(occurrences / 5, 1.0) * 0.5;

  // Regularity bonus: (1 - normalizedStdDev) * 0.3
  // Clamp normalizedStdDev to [0, 1] so the bonus is never negative
  const clampedStdDev = Math.min(Math.max(normalizedStdDev, 0), 1);
  const regularityBonus = (1 - clampedStdDev) * 0.3;

  // Recency bonus: 0.2 if most recent is within 14 days
  const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
  const recencyBonus =
    Date.now() - mostRecentDate.getTime() <= fourteenDaysMs ? 0.2 : 0;

  return Math.round((baseScore + regularityBonus + recencyBonus) * 100) / 100;
}

function frequencyFromMeanMs(meanMs: number): string {
  const hours = meanMs / (1000 * 60 * 60);
  if (hours < 1) return "1h";
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = hours / 24;
  if (days < 7) return `${Math.round(days)}d`;
  const weeks = days / 7;
  return `${Math.round(weeks)}w`;
}

function medianAmount(amounts: string[]): string {
  const nums = amounts
    .map((a) => parseFloat(a))
    .filter((n) => !isNaN(n))
    .sort((a, b) => a - b);
  if (nums.length === 0) return "0";
  const mid = Math.floor(nums.length / 2);
  const median =
    nums.length % 2 !== 0 ? nums[mid]! : (nums[mid - 1]! + nums[mid]!) / 2;
  return median.toString();
}

// ── Live implementation ──────────────────────────────────────────────

export const AgentPatternServiceLive: Layer.Layer<
  AgentPatternService,
  never,
  DatabaseService
> = Layer.effect(
  AgentPatternService,
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;

    const analyzePatterns = (
      userId: string
    ): Effect.Effect<ReadonlyArray<DetectedPattern>, AgentPatternError> =>
      Effect.gen(function* () {
        const ninetyDaysAgo = new Date(
          Date.now() - 90 * 24 * 60 * 60 * 1000
        );

        // Fetch user's transactions from the last 90 days
        const userTransactions = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(transactions)
              .where(
                and(
                  eq(transactions.userId, userId),
                  gte(transactions.createdAt, ninetyDaysAgo)
                )
              )
              .orderBy(desc(transactions.createdAt)),
          catch: (error) =>
            new AgentPatternError({
              message: `Failed to fetch transactions: ${error}`,
              cause: error,
            }),
        });

        // Fetch user's pretium transactions from the last 90 days
        const userPretiumTxs = yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(pretiumTransactions)
              .where(
                and(
                  eq(pretiumTransactions.userId, userId),
                  gte(pretiumTransactions.createdAt, ninetyDaysAgo)
                )
              )
              .orderBy(desc(pretiumTransactions.createdAt)),
          catch: (error) =>
            new AgentPatternError({
              message: `Failed to fetch pretium transactions: ${error}`,
              cause: error,
            }),
        });

        const patterns: DetectedPattern[] = [];

        // ── Detect recurring sends ─────────────────────────────────

        const sendTxs = userTransactions.filter(
          (tx) =>
            tx.method === "transfer" &&
            tx.status === "confirmed" &&
            tx.payload?.to
        );

        const sendsByRecipient = new Map<string, Transaction[]>();
        for (const tx of sendTxs) {
          const recipient = String(tx.payload.to).toLowerCase();
          const existing = sendsByRecipient.get(recipient);
          if (existing) {
            existing.push(tx);
          } else {
            sendsByRecipient.set(recipient, [tx]);
          }
        }

        for (const [recipient, txs] of sendsByRecipient) {
          if (txs.length < 3) continue;

          const dates = txs.map((tx) => new Date(tx.createdAt));
          const { meanMs, stdDevMs } = computeIntervalStats(dates);

          if (meanMs === 0) continue;

          const normalizedStdDev = stdDevMs / meanMs;
          if (normalizedStdDev > 0.3) continue;

          const amounts = txs.map((tx) =>
            tx.payload.value ? String(tx.payload.value) : "0"
          );
          const sortedDates = [...dates].sort(
            (a, b) => b.getTime() - a.getTime()
          );
          const mostRecent = sortedDates[0]!;

          const confidence = computeConfidence(
            txs.length,
            normalizedStdDev,
            mostRecent
          );

          if (confidence <= 0.5) continue;

          const freq = frequencyFromMeanMs(meanMs);
          const typicalAmount = medianAmount(amounts);
          const shortRecipient = `${recipient.slice(0, 6)}...${recipient.slice(-4)}`;

          patterns.push({
            type: "recurring_send",
            confidence,
            description: `You send approximately ${typicalAmount} to ${shortRecipient} every ${freq}`,
            suggestedMandate: {
              type: "auto_send",
              name: `Recurring transfer to ${shortRecipient}`,
              trigger: {
                type: "schedule",
                frequency: freq,
                anchor: mostRecent.toISOString(),
              },
              action: {
                type: "transfer",
                to: recipient,
                amount: typicalAmount,
              },
              constraints: {
                maxPerExecution: typicalAmount,
              },
            },
            evidence: {
              count: txs.length,
              dates: sortedDates.map((d) => d.toISOString()),
              amounts,
            },
          });
        }

        // ── Detect regular buys (onramp) ───────────────────────────

        const onrampTxs = userPretiumTxs.filter(
          (tx) => tx.direction === "onramp" && tx.status === "completed"
        );

        if (onrampTxs.length >= 3) {
          const dates = onrampTxs.map((tx) => new Date(tx.createdAt));
          const { meanMs, stdDevMs } = computeIntervalStats(dates);

          if (meanMs > 0) {
            const normalizedStdDev = stdDevMs / meanMs;
            const amounts = onrampTxs.map((tx) => tx.usdcAmount);
            const sortedDates = [...dates].sort(
              (a, b) => b.getTime() - a.getTime()
            );
            const mostRecent = sortedDates[0]!;

            const confidence = computeConfidence(
              onrampTxs.length,
              normalizedStdDev,
              mostRecent
            );

            if (confidence > 0.5) {
              const freq = frequencyFromMeanMs(meanMs);
              const typicalAmount = medianAmount(amounts);
              // Pick the most common country/currency from onramps
              const countryCounts = new Map<string, number>();
              for (const tx of onrampTxs) {
                countryCounts.set(
                  tx.countryCode,
                  (countryCounts.get(tx.countryCode) ?? 0) + 1
                );
              }
              let topCountry = onrampTxs[0]!.countryCode;
              let topCount = 0;
              for (const [country, count] of countryCounts) {
                if (count > topCount) {
                  topCountry = country;
                  topCount = count;
                }
              }

              patterns.push({
                type: "regular_buy",
                confidence,
                description: `You buy approximately ${typicalAmount} USDC every ${freq} via ${topCountry} onramp`,
                suggestedMandate: {
                  type: "recurring_buy",
                  name: `Regular USDC purchase`,
                  trigger: {
                    type: "schedule",
                    frequency: freq,
                    anchor: mostRecent.toISOString(),
                  },
                  action: {
                    type: "notify",
                    message: `Time to buy ${typicalAmount} USDC via ${topCountry} onramp`,
                  },
                },
                evidence: {
                  count: onrampTxs.length,
                  dates: sortedDates.map((d) => d.toISOString()),
                  amounts,
                },
              });
            }
          }
        }

        // ── Detect DCA behavior (swap patterns) ─────────────────────

        const swapTxs = userTransactions.filter(
          (tx) => tx.method === "swap" && tx.status === "confirmed"
        );

        // Group by token pair
        const swapsByPair = new Map<string, Transaction[]>();
        for (const tx of swapTxs) {
          const tokenIn = tx.payload.tokenIn
            ? String(tx.payload.tokenIn).toLowerCase()
            : "";
          const tokenOut = tx.payload.tokenOut
            ? String(tx.payload.tokenOut).toLowerCase()
            : "";
          if (!tokenIn || !tokenOut) continue;

          const pair = `${tokenIn}:${tokenOut}`;
          const existing = swapsByPair.get(pair);
          if (existing) {
            existing.push(tx);
          } else {
            swapsByPair.set(pair, [tx]);
          }
        }

        for (const [pair, txs] of swapsByPair) {
          if (txs.length < 3) continue;

          const dates = txs.map((tx) => new Date(tx.createdAt));
          const { meanMs, stdDevMs } = computeIntervalStats(dates);

          if (meanMs === 0) continue;

          const normalizedStdDev = stdDevMs / meanMs;
          const amounts = txs.map((tx) =>
            tx.payload.amount ? String(tx.payload.amount) : "0"
          );
          const sortedDates = [...dates].sort(
            (a, b) => b.getTime() - a.getTime()
          );
          const mostRecent = sortedDates[0]!;

          const confidence = computeConfidence(
            txs.length,
            normalizedStdDev,
            mostRecent
          );

          if (confidence <= 0.5) continue;

          const [tokenIn, tokenOut] = pair.split(":");
          const freq = frequencyFromMeanMs(meanMs);
          const typicalAmount = medianAmount(amounts);

          const shortIn = tokenIn!.length > 10
            ? `${tokenIn!.slice(0, 6)}...${tokenIn!.slice(-4)}`
            : tokenIn!;
          const shortOut = tokenOut!.length > 10
            ? `${tokenOut!.slice(0, 6)}...${tokenOut!.slice(-4)}`
            : tokenOut!;

          patterns.push({
            type: "dca",
            confidence,
            description: `You swap approximately ${typicalAmount} ${shortIn} to ${shortOut} every ${freq}`,
            suggestedMandate: {
              type: "dca",
              name: `DCA: ${shortIn} to ${shortOut}`,
              trigger: {
                type: "schedule",
                frequency: freq,
                anchor: mostRecent.toISOString(),
              },
              action: {
                type: "swap",
                from: tokenIn,
                to: tokenOut,
                amount: typicalAmount,
              },
              constraints: {
                maxPerExecution: typicalAmount,
              },
            },
            evidence: {
              count: txs.length,
              dates: sortedDates.map((d) => d.toISOString()),
              amounts,
            },
          });
        }

        // ── Detect balance threshold offramps ──────────────────────

        const offrampTxs = userPretiumTxs.filter(
          (tx) => tx.direction === "offramp" && tx.status === "completed"
        );

        if (offrampTxs.length >= 3) {
          const amounts = offrampTxs.map((tx) => parseFloat(tx.usdcAmount));
          const validAmounts = amounts.filter((a) => !isNaN(a));

          if (validAmounts.length >= 3) {
            // Look for clustering of offramp amounts -- if the amounts are
            // relatively consistent, it could indicate a balance threshold behavior.
            const meanAmount =
              validAmounts.reduce((s, a) => s + a, 0) / validAmounts.length;
            const amountStdDev = Math.sqrt(
              validAmounts.reduce((s, a) => s + (a - meanAmount) ** 2, 0) /
                validAmounts.length
            );
            const normalizedAmountStdDev =
              meanAmount > 0 ? amountStdDev / meanAmount : 1;

            // If amounts are clustered (std dev < 40% of mean), suggest threshold
            if (normalizedAmountStdDev < 0.4) {
              const dates = offrampTxs.map((tx) => new Date(tx.createdAt));
              const sortedDates = [...dates].sort(
                (a, b) => b.getTime() - a.getTime()
              );
              const mostRecent = sortedDates[0]!;
              const { meanMs, stdDevMs } = computeIntervalStats(dates);
              const normalizedStdDev =
                meanMs > 0 ? stdDevMs / meanMs : 1;

              const confidence = computeConfidence(
                offrampTxs.length,
                normalizedStdDev,
                mostRecent
              );

              if (confidence > 0.5) {
                const typicalOfframpAmount = medianAmount(
                  offrampTxs.map((tx) => tx.usdcAmount)
                );

                // Estimate the threshold: typical offramp + a buffer suggests
                // the user offramps when balance exceeds approximately this much
                const estimatedThreshold = (
                  parseFloat(typicalOfframpAmount) * 1.5
                ).toFixed(2);

                const topCountry = offrampTxs[0]!.countryCode;
                const topPhone = offrampTxs[0]!.phoneNumber;
                const topNetwork = offrampTxs[0]!.mobileNetwork;

                patterns.push({
                  type: "balance_threshold",
                  confidence,
                  description: `You tend to offramp ~${typicalOfframpAmount} USDC when your balance is high`,
                  suggestedMandate: {
                    type: "auto_offramp",
                    name: `Auto-offramp when balance exceeds ${estimatedThreshold} USDC`,
                    trigger: {
                      type: "balance",
                      condition: "above",
                      value: estimatedThreshold,
                    },
                    action: {
                      type: "offramp",
                      amount: typicalOfframpAmount,
                      country: topCountry,
                      ...(topPhone && { phone: topPhone }),
                      ...(topNetwork && { network: topNetwork }),
                    },
                    constraints: {
                      maxPerExecution: typicalOfframpAmount,
                      maxPerDay: (
                        parseFloat(typicalOfframpAmount) * 2
                      ).toFixed(2),
                    },
                  },
                  evidence: {
                    count: offrampTxs.length,
                    dates: sortedDates.map((d) => d.toISOString()),
                    amounts: offrampTxs.map((tx) => tx.usdcAmount),
                  },
                });
              }
            }
          }
        }

        // Sort patterns by confidence descending
        patterns.sort((a, b) => b.confidence - a.confidence);

        return patterns;
      });

    return {
      analyzePatterns,
    };
  })
);
