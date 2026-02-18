import { Effect, Context, Layer, Data, Schedule } from "effect";
import { eq, and, lte } from "drizzle-orm";
import { DatabaseService } from "../../db/client.js";
import { jobs, type Job, type NewJob } from "../../db/schema/index.js";
import {
  TransactionService,
  type TransactionError,
} from "../transaction/transaction-service.js";
import type { LedgerError } from "../ledger/ledger-service.js";

export class JobberError extends Data.TaggedError("JobberError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface CreateJobParams {
  readonly name: string;
  readonly jobType: string;
  readonly schedule: string;
  readonly payload: Record<string, unknown>;
  readonly maxRetries?: number;
}

export interface JobberServiceApi {
  readonly createJob: (
    params: CreateJobParams
  ) => Effect.Effect<Job, JobberError>;
  readonly getJob: (id: string) => Effect.Effect<Job | undefined, JobberError>;
  readonly listJobs: () => Effect.Effect<ReadonlyArray<Job>, JobberError>;
  readonly cancelJob: (id: string) => Effect.Effect<Job, JobberError>;
  readonly processDueJobs: () => Effect.Effect<
    ReadonlyArray<Job>,
    JobberError | TransactionError | LedgerError
  >;
  readonly startPolling: (
    intervalMs: number
  ) => Effect.Effect<void, JobberError | TransactionError | LedgerError>;
}

export class JobberService extends Context.Tag("JobberService")<
  JobberService,
  JobberServiceApi
>() {}

function parseScheduleToMs(schedule: string): number {
  const match = schedule.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 60000;
  const [, value, unit] = match;
  const num = parseInt(value!, 10);
  switch (unit) {
    case "s":
      return num * 1000;
    case "m":
      return num * 60 * 1000;
    case "h":
      return num * 60 * 60 * 1000;
    case "d":
      return num * 24 * 60 * 60 * 1000;
    default:
      return 60000;
  }
}

export const JobberServiceLive: Layer.Layer<
  JobberService,
  never,
  DatabaseService | TransactionService
> = Layer.effect(
  JobberService,
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;
    const txService = yield* TransactionService;

    const processJob = (job: Job) =>
      Effect.gen(function* () {
        yield* Effect.tryPromise({
          try: () =>
            db
              .update(jobs)
              .set({ status: "running", lastRunAt: new Date() })
              .where(eq(jobs.id, job.id)),
          catch: (error) =>
            new JobberError({
              message: `Failed to update job status: ${error}`,
              cause: error,
            }),
        });

        const payload = job.payload as Record<string, unknown>;

        if (job.jobType === "contract_transaction") {
          yield* txService
            .submitContractTransaction({
              walletId: payload.walletId as string,
              walletType: payload.walletType as "user" | "server" | "agent",
              contractName: payload.contractName as string,
              chainId: payload.chainId as number,
              method: payload.method as string,
              args: (payload.args as readonly unknown[]) ?? [],
              value: payload.value ? BigInt(payload.value as string) : undefined,
            })
            .pipe(
              Effect.mapError(
                (e) => new JobberError({ message: String(e), cause: e })
              )
            );
        } else if (job.jobType === "raw_transaction") {
          yield* txService
            .submitRawTransaction({
              walletId: payload.walletId as string,
              walletType: payload.walletType as "user" | "server" | "agent",
              chainId: payload.chainId as number,
              to: payload.to as `0x${string}`,
              data: payload.data as `0x${string}` | undefined,
              value: payload.value ? BigInt(payload.value as string) : undefined,
            })
            .pipe(
              Effect.mapError(
                (e) => new JobberError({ message: String(e), cause: e })
              )
            );
        }

        const intervalMs = parseScheduleToMs(job.schedule);
        const nextRun = new Date(Date.now() + intervalMs);

        yield* Effect.tryPromise({
          try: () =>
            db
              .update(jobs)
              .set({
                status: "pending",
                nextRunAt: nextRun,
                retryCount: 0,
                updatedAt: new Date(),
              })
              .where(eq(jobs.id, job.id)),
          catch: (error) =>
            new JobberError({
              message: `Failed to reschedule job: ${error}`,
              cause: error,
            }),
        });
      }).pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            const newRetryCount = job.retryCount + 1;
            const status =
              newRetryCount >= job.maxRetries ? "failed" : "pending";

            yield* Effect.tryPromise({
              try: () =>
                db
                  .update(jobs)
                  .set({
                    status,
                    retryCount: newRetryCount,
                    error: String(error),
                    updatedAt: new Date(),
                  })
                  .where(eq(jobs.id, job.id)),
              catch: (err) =>
                new JobberError({
                  message: `Failed to update failed job: ${err}`,
                  cause: err,
                }),
            });
          })
        )
      );

    return {
      createJob: (params: CreateJobParams) =>
        Effect.tryPromise({
          try: async () => {
            const intervalMs = parseScheduleToMs(params.schedule);
            const values: NewJob = {
              name: params.name,
              jobType: params.jobType,
              schedule: params.schedule,
              payload: params.payload,
              maxRetries: params.maxRetries ?? 3,
              nextRunAt: new Date(Date.now() + intervalMs),
            };
            const [result] = await db.insert(jobs).values(values).returning();
            return result!;
          },
          catch: (error) =>
            new JobberError({
              message: `Failed to create job: ${error}`,
              cause: error,
            }),
        }),

      getJob: (id: string) =>
        Effect.tryPromise({
          try: async () => {
            const [result] = await db
              .select()
              .from(jobs)
              .where(eq(jobs.id, id));
            return result;
          },
          catch: (error) =>
            new JobberError({
              message: `Failed to get job: ${error}`,
              cause: error,
            }),
        }),

      listJobs: () =>
        Effect.tryPromise({
          try: () => db.select().from(jobs).orderBy(jobs.createdAt),
          catch: (error) =>
            new JobberError({
              message: `Failed to list jobs: ${error}`,
              cause: error,
            }),
        }),

      cancelJob: (id: string) =>
        Effect.tryPromise({
          try: async () => {
            const [result] = await db
              .update(jobs)
              .set({ status: "cancelled", updatedAt: new Date() })
              .where(eq(jobs.id, id))
              .returning();
            return result!;
          },
          catch: (error) =>
            new JobberError({
              message: `Failed to cancel job: ${error}`,
              cause: error,
            }),
        }),

      processDueJobs: () =>
        Effect.gen(function* () {
          const dueJobs = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(jobs)
                .where(
                  and(
                    eq(jobs.status, "pending"),
                    lte(jobs.nextRunAt, new Date())
                  )
                ),
            catch: (error) =>
              new JobberError({
                message: `Failed to fetch due jobs: ${error}`,
                cause: error,
              }),
          });

          for (const job of dueJobs) {
            yield* processJob(job);
          }

          return dueJobs;
        }),

      startPolling: (intervalMs: number) =>
        Effect.gen(function* () {
          const dueJobs = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(jobs)
                .where(
                  and(
                    eq(jobs.status, "pending"),
                    lte(jobs.nextRunAt, new Date())
                  )
                ),
            catch: (error) =>
              new JobberError({
                message: `Failed to fetch due jobs: ${error}`,
                cause: error,
              }),
          });

          for (const job of dueJobs) {
            yield* processJob(job);
          }
        }).pipe(
          Effect.repeat(
            Schedule.spaced(`${intervalMs} millis`)
          ),
          Effect.ignore
        ),
    };
  })
);
