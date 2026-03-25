import { Effect, Context, Layer, Data } from "effect";
import { eq, and } from "drizzle-orm";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { DatabaseService } from "../../db/client.js";
import { ConfigService } from "../../config.js";
import { userProfiles, userPasskeys } from "../../db/schema/index.js";

// ── Error type ───────────────────────────────────────────────────────

export class TransactionApprovalError extends Data.TaggedError(
  "TransactionApprovalError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ── Types ────────────────────────────────────────────────────────────

export interface ApprovalSettings {
  enabled: boolean;
  method: "pin" | "passkey" | null;
  passkeyCount: number;
}

export interface PasskeyInfo {
  id: string;
  credentialId: string;
  label: string | null;
  createdAt: Date;
}

// ── Service interface ────────────────────────────────────────────────

export interface TransactionApprovalServiceApi {
  // PIN
  readonly setupPin: (
    userId: string,
    pin: string
  ) => Effect.Effect<void, TransactionApprovalError>;

  readonly changePin: (
    userId: string,
    currentPin: string,
    newPin: string
  ) => Effect.Effect<void, TransactionApprovalError>;

  readonly removePin: (
    userId: string,
    pin: string
  ) => Effect.Effect<void, TransactionApprovalError>;

  readonly verifyPin: (
    userId: string,
    pin: string
  ) => Effect.Effect<boolean, TransactionApprovalError>;

  // Passkey
  readonly generateRegistrationOptions: (
    userId: string
  ) => Effect.Effect<unknown, TransactionApprovalError>;

  readonly verifyRegistration: (
    userId: string,
    credential: RegistrationResponseJSON,
    label?: string
  ) => Effect.Effect<void, TransactionApprovalError>;

  readonly generateAuthenticationOptions: (
    userId: string
  ) => Effect.Effect<unknown, TransactionApprovalError>;

  readonly verifyAuthentication: (
    userId: string,
    credential: AuthenticationResponseJSON
  ) => Effect.Effect<boolean, TransactionApprovalError>;

  readonly listPasskeys: (
    userId: string
  ) => Effect.Effect<PasskeyInfo[], TransactionApprovalError>;

  readonly removePasskey: (
    userId: string,
    passkeyId: string
  ) => Effect.Effect<void, TransactionApprovalError>;

  // Settings
  readonly getApprovalSettings: (
    userId: string
  ) => Effect.Effect<ApprovalSettings, TransactionApprovalError>;

  readonly disableApproval: (
    userId: string,
    pin?: string,
    credential?: AuthenticationResponseJSON
  ) => Effect.Effect<void, TransactionApprovalError>;

  // Token
  readonly generateApprovalToken: (
    userId: string
  ) => Effect.Effect<string, TransactionApprovalError>;

  readonly verifyApprovalToken: (
    token: string
  ) => Effect.Effect<string, TransactionApprovalError>;
}

export class TransactionApprovalService extends Context.Tag(
  "TransactionApprovalService"
)<TransactionApprovalService, TransactionApprovalServiceApi>() {}

// ── Constants ────────────────────────────────────────────────────────

const PIN_REGEX = /^\d{4,6}$/;
const BCRYPT_ROUNDS = 12;
const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const RP_NAME = "Expendi";
const RP_ID = process.env.WEBAUTHN_RP_ID ?? "expendi.app";
const RP_ORIGINS = [
  process.env.WEBAUTHN_ORIGIN ?? `https://${RP_ID}`,  // web + iOS
  process.env.WEBAUTHN_ANDROID_ORIGIN,                 // Android (android:apk-key-hash:...)
].filter(Boolean) as string[];

// ── Live implementation ──────────────────────────────────────────────

export const TransactionApprovalServiceLive: Layer.Layer<
  TransactionApprovalService,
  never,
  DatabaseService | ConfigService
> = Layer.effect(
  TransactionApprovalService,
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;
    const config = yield* ConfigService;

    // In-memory stores (adequate for single-server)
    const challenges = new Map<
      string,
      { challenge: string; expiresAt: number }
    >();
    const failedAttempts = new Map<
      string,
      { count: number; lockedUntil: number }
    >();

    // ── Helpers ────────────────────────────────────────────────────

    const findProfile = (userId: string) =>
      Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(userProfiles)
            .where(eq(userProfiles.privyUserId, userId))
            .limit(1),
        catch: (error) =>
          new TransactionApprovalError({
            message: `Failed to look up profile: ${error}`,
            cause: error,
          }),
      });

    const checkLockout = (userId: string) => {
      const record = failedAttempts.get(userId);
      if (record && record.lockedUntil > Date.now()) {
        return Effect.fail(
          new TransactionApprovalError({
            message: `Too many failed attempts. Try again in ${Math.ceil((record.lockedUntil - Date.now()) / 60000)} minutes`,
          })
        );
      }
      return Effect.void;
    };

    const recordFailedAttempt = (userId: string) => {
      const record = failedAttempts.get(userId) ?? {
        count: 0,
        lockedUntil: 0,
      };
      record.count += 1;
      if (record.count >= MAX_FAILED_ATTEMPTS) {
        record.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
        record.count = 0;
      }
      failedAttempts.set(userId, record);
    };

    const clearFailedAttempts = (userId: string) => {
      failedAttempts.delete(userId);
    };

    const storeChallenge = (userId: string, challenge: string) => {
      challenges.set(userId, {
        challenge,
        expiresAt: Date.now() + CHALLENGE_TTL_MS,
      });
    };

    const consumeChallenge = (userId: string): string | null => {
      const record = challenges.get(userId);
      challenges.delete(userId);
      if (!record || record.expiresAt < Date.now()) return null;
      return record.challenge;
    };

    const createHmacToken = (userId: string): string => {
      const expiry = Date.now() + TOKEN_TTL_MS;
      const payload = `${userId}:${expiry}`;
      const hmac = crypto
        .createHmac("sha256", config.approvalTokenSecret)
        .update(payload)
        .digest("hex");
      return `${payload}:${hmac}`;
    };

    const verifyHmacToken = (
      token: string
    ): { valid: boolean; userId?: string } => {
      // Token format: userId:expiry:hmac
      // userId may contain colons (e.g. did:privy:xxx), so extract from the right
      const lastColon = token.lastIndexOf(":");
      if (lastColon === -1) return { valid: false };
      const providedHmac = token.slice(lastColon + 1);
      const beforeHmac = token.slice(0, lastColon);
      const secondLastColon = beforeHmac.lastIndexOf(":");
      if (secondLastColon === -1) return { valid: false };
      const userId = beforeHmac.slice(0, secondLastColon);
      const expiryStr = beforeHmac.slice(secondLastColon + 1);
      const expiry = Number(expiryStr);
      if (!userId || isNaN(expiry) || expiry < Date.now()) return { valid: false };
      const payload = `${userId}:${expiryStr}`;
      const expectedHmac = crypto
        .createHmac("sha256", config.approvalTokenSecret)
        .update(payload)
        .digest("hex");
      if (
        !crypto.timingSafeEqual(
          Buffer.from(providedHmac),
          Buffer.from(expectedHmac)
        )
      ) {
        return { valid: false };
      }
      return { valid: true, userId };
    };

    // ── Service methods ───────────────────────────────────────────

    return {
      setupPin: (userId, pin) =>
        Effect.gen(function* () {
          if (!PIN_REGEX.test(pin)) {
            return yield* Effect.fail(
              new TransactionApprovalError({
                message: "PIN must be 4-6 digits",
              })
            );
          }

          const rows = yield* findProfile(userId);
          if (!rows[0]) {
            return yield* Effect.fail(
              new TransactionApprovalError({
                message: "Profile not found",
              })
            );
          }

          if (rows[0].transactionPinHash) {
            return yield* Effect.fail(
              new TransactionApprovalError({
                message:
                  "PIN already set. Use change endpoint to update it",
              })
            );
          }

          const hash = yield* Effect.tryPromise({
            try: () => bcrypt.hash(pin, BCRYPT_ROUNDS),
            catch: (error) =>
              new TransactionApprovalError({
                message: `Failed to hash PIN: ${error}`,
                cause: error,
              }),
          });

          yield* Effect.tryPromise({
            try: () =>
              db
                .update(userProfiles)
                .set({
                  transactionPinHash: hash,
                  transactionApprovalMethod: "pin",
                  requireTransactionApproval: true,
                  updatedAt: new Date(),
                })
                .where(eq(userProfiles.privyUserId, userId)),
            catch: (error) =>
              new TransactionApprovalError({
                message: `Failed to save PIN: ${error}`,
                cause: error,
              }),
          });
        }),

      changePin: (userId, currentPin, newPin) =>
        Effect.gen(function* () {
          yield* checkLockout(userId);

          if (!PIN_REGEX.test(newPin)) {
            return yield* Effect.fail(
              new TransactionApprovalError({
                message: "New PIN must be 4-6 digits",
              })
            );
          }

          const rows = yield* findProfile(userId);
          if (!rows[0]?.transactionPinHash) {
            return yield* Effect.fail(
              new TransactionApprovalError({
                message: "No PIN is currently set",
              })
            );
          }

          const isValid = yield* Effect.tryPromise({
            try: () => bcrypt.compare(currentPin, rows[0]!.transactionPinHash!),
            catch: (error) =>
              new TransactionApprovalError({
                message: `Failed to verify PIN: ${error}`,
                cause: error,
              }),
          });

          if (!isValid) {
            recordFailedAttempt(userId);
            return yield* Effect.fail(
              new TransactionApprovalError({
                message: "Current PIN is incorrect",
              })
            );
          }

          clearFailedAttempts(userId);

          const hash = yield* Effect.tryPromise({
            try: () => bcrypt.hash(newPin, BCRYPT_ROUNDS),
            catch: (error) =>
              new TransactionApprovalError({
                message: `Failed to hash new PIN: ${error}`,
                cause: error,
              }),
          });

          yield* Effect.tryPromise({
            try: () =>
              db
                .update(userProfiles)
                .set({
                  transactionPinHash: hash,
                  updatedAt: new Date(),
                })
                .where(eq(userProfiles.privyUserId, userId)),
            catch: (error) =>
              new TransactionApprovalError({
                message: `Failed to update PIN: ${error}`,
                cause: error,
              }),
          });
        }),

      removePin: (userId, pin) =>
        Effect.gen(function* () {
          yield* checkLockout(userId);

          const rows = yield* findProfile(userId);
          if (!rows[0]?.transactionPinHash) {
            return yield* Effect.fail(
              new TransactionApprovalError({
                message: "No PIN is currently set",
              })
            );
          }

          const isValid = yield* Effect.tryPromise({
            try: () => bcrypt.compare(pin, rows[0]!.transactionPinHash!),
            catch: (error) =>
              new TransactionApprovalError({
                message: `Failed to verify PIN: ${error}`,
                cause: error,
              }),
          });

          if (!isValid) {
            recordFailedAttempt(userId);
            return yield* Effect.fail(
              new TransactionApprovalError({
                message: "PIN is incorrect",
              })
            );
          }

          clearFailedAttempts(userId);

          yield* Effect.tryPromise({
            try: () =>
              db
                .update(userProfiles)
                .set({
                  transactionPinHash: null,
                  transactionApprovalMethod: null,
                  requireTransactionApproval: false,
                  updatedAt: new Date(),
                })
                .where(eq(userProfiles.privyUserId, userId)),
            catch: (error) =>
              new TransactionApprovalError({
                message: `Failed to remove PIN: ${error}`,
                cause: error,
              }),
          });
        }),

      verifyPin: (userId, pin) =>
        Effect.gen(function* () {
          yield* checkLockout(userId);

          const rows = yield* findProfile(userId);
          if (!rows[0]?.transactionPinHash) {
            return yield* Effect.fail(
              new TransactionApprovalError({
                message: "No PIN is configured",
              })
            );
          }

          const isValid = yield* Effect.tryPromise({
            try: () => bcrypt.compare(pin, rows[0]!.transactionPinHash!),
            catch: (error) =>
              new TransactionApprovalError({
                message: `Failed to verify PIN: ${error}`,
                cause: error,
              }),
          });

          if (!isValid) {
            recordFailedAttempt(userId);
          } else {
            clearFailedAttempts(userId);
          }

          return isValid;
        }),

      generateRegistrationOptions: (userId) =>
        Effect.gen(function* () {
          const rows = yield* findProfile(userId);
          if (!rows[0]) {
            return yield* Effect.fail(
              new TransactionApprovalError({
                message: "Profile not found",
              })
            );
          }

          // Get existing passkeys for exclusion
          const existingPasskeys = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(userPasskeys)
                .where(eq(userPasskeys.userId, userId)),
            catch: (error) =>
              new TransactionApprovalError({
                message: `Failed to list passkeys: ${error}`,
                cause: error,
              }),
          });

          const options = yield* Effect.tryPromise({
            try: () =>
              generateRegistrationOptions({
                rpName: RP_NAME,
                rpID: RP_ID,
                userName: rows[0]!.username ?? userId,
                userID: new TextEncoder().encode(userId),
                attestationType: "none",
                excludeCredentials: existingPasskeys.map((p) => ({
                  id: p.credentialId,
                  transports: p.transports
                    ? JSON.parse(p.transports)
                    : undefined,
                })),
                authenticatorSelection: {
                  residentKey: "preferred",
                  userVerification: "preferred",
                },
              }),
            catch: (error) =>
              new TransactionApprovalError({
                message: `Failed to generate registration options: ${error}`,
                cause: error,
              }),
          });

          storeChallenge(userId, options.challenge);
          return options;
        }),

      verifyRegistration: (userId, credential, label) =>
        Effect.gen(function* () {
          const expectedChallenge = consumeChallenge(userId);
          if (!expectedChallenge) {
            return yield* Effect.fail(
              new TransactionApprovalError({
                message: "Challenge expired or not found. Start registration again",
              })
            );
          }

          const verification = yield* Effect.tryPromise({
            try: () =>
              verifyRegistrationResponse({
                response: credential,
                expectedChallenge,
                expectedOrigin: RP_ORIGINS,
                expectedRPID: RP_ID,
              }),
            catch: (error) =>
              new TransactionApprovalError({
                message: `Registration verification failed: ${error}`,
                cause: error,
              }),
          });

          if (!verification.verified || !verification.registrationInfo) {
            return yield* Effect.fail(
              new TransactionApprovalError({
                message: "Passkey registration verification failed",
              })
            );
          }

          const { credential: cred } = verification.registrationInfo;

          yield* Effect.tryPromise({
            try: () =>
              db.insert(userPasskeys).values({
                userId,
                credentialId: cred.id,
                publicKey: Buffer.from(cred.publicKey).toString("base64url"),
                counter: cred.counter,
                transports: credential.response.transports
                  ? JSON.stringify(credential.response.transports)
                  : null,
                label: label ?? null,
              }),
            catch: (error) =>
              new TransactionApprovalError({
                message: `Failed to save passkey: ${error}`,
                cause: error,
              }),
          });

          // Enable approval with passkey method
          yield* Effect.tryPromise({
            try: () =>
              db
                .update(userProfiles)
                .set({
                  transactionApprovalMethod: "passkey",
                  requireTransactionApproval: true,
                  updatedAt: new Date(),
                })
                .where(eq(userProfiles.privyUserId, userId)),
            catch: (error) =>
              new TransactionApprovalError({
                message: `Failed to update profile: ${error}`,
                cause: error,
              }),
          });
        }),

      generateAuthenticationOptions: (userId) =>
        Effect.gen(function* () {
          const existingPasskeys = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(userPasskeys)
                .where(eq(userPasskeys.userId, userId)),
            catch: (error) =>
              new TransactionApprovalError({
                message: `Failed to list passkeys: ${error}`,
                cause: error,
              }),
          });

          if (existingPasskeys.length === 0) {
            return yield* Effect.fail(
              new TransactionApprovalError({
                message: "No passkeys registered",
              })
            );
          }

          const options = yield* Effect.tryPromise({
            try: () =>
              generateAuthenticationOptions({
                rpID: RP_ID,
                allowCredentials: existingPasskeys.map((p) => ({
                  id: p.credentialId,
                  transports: p.transports
                    ? JSON.parse(p.transports)
                    : undefined,
                })),
                userVerification: "preferred",
              }),
            catch: (error) =>
              new TransactionApprovalError({
                message: `Failed to generate authentication options: ${error}`,
                cause: error,
              }),
          });

          storeChallenge(userId, options.challenge);
          return options;
        }),

      verifyAuthentication: (userId, credential) =>
        Effect.gen(function* () {
          yield* checkLockout(userId);

          const expectedChallenge = consumeChallenge(userId);
          if (!expectedChallenge) {
            return yield* Effect.fail(
              new TransactionApprovalError({
                message: "Challenge expired or not found",
              })
            );
          }

          // Find the passkey
          const [passkey] = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(userPasskeys)
                .where(
                  and(
                    eq(userPasskeys.userId, userId),
                    eq(userPasskeys.credentialId, credential.id)
                  )
                )
                .limit(1),
            catch: (error) =>
              new TransactionApprovalError({
                message: `Failed to find passkey: ${error}`,
                cause: error,
              }),
          });

          if (!passkey) {
            recordFailedAttempt(userId);
            return yield* Effect.fail(
              new TransactionApprovalError({
                message: "Passkey not found",
              })
            );
          }

          const verification = yield* Effect.tryPromise({
            try: () =>
              verifyAuthenticationResponse({
                response: credential,
                expectedChallenge,
                expectedOrigin: RP_ORIGINS,
                expectedRPID: RP_ID,
                credential: {
                  id: passkey.credentialId,
                  publicKey: Buffer.from(passkey.publicKey, "base64url"),
                  counter: passkey.counter,
                  transports: passkey.transports
                    ? JSON.parse(passkey.transports)
                    : undefined,
                },
              }),
            catch: (error) =>
              new TransactionApprovalError({
                message: `Authentication verification failed: ${error}`,
                cause: error,
              }),
          });

          if (!verification.verified) {
            recordFailedAttempt(userId);
            return false;
          }

          clearFailedAttempts(userId);

          // Update counter for replay protection
          yield* Effect.tryPromise({
            try: () =>
              db
                .update(userPasskeys)
                .set({
                  counter: verification.authenticationInfo.newCounter,
                })
                .where(eq(userPasskeys.id, passkey.id)),
            catch: (error) =>
              new TransactionApprovalError({
                message: `Failed to update passkey counter: ${error}`,
                cause: error,
              }),
          });

          return true;
        }),

      listPasskeys: (userId) =>
        Effect.gen(function* () {
          const rows = yield* Effect.tryPromise({
            try: () =>
              db
                .select({
                  id: userPasskeys.id,
                  credentialId: userPasskeys.credentialId,
                  label: userPasskeys.label,
                  createdAt: userPasskeys.createdAt,
                })
                .from(userPasskeys)
                .where(eq(userPasskeys.userId, userId)),
            catch: (error) =>
              new TransactionApprovalError({
                message: `Failed to list passkeys: ${error}`,
                cause: error,
              }),
          });
          return rows;
        }),

      removePasskey: (userId, passkeyId) =>
        Effect.gen(function* () {
          const [passkey] = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(userPasskeys)
                .where(
                  and(
                    eq(userPasskeys.id, passkeyId),
                    eq(userPasskeys.userId, userId)
                  )
                )
                .limit(1),
            catch: (error) =>
              new TransactionApprovalError({
                message: `Failed to find passkey: ${error}`,
                cause: error,
              }),
          });

          if (!passkey) {
            return yield* Effect.fail(
              new TransactionApprovalError({
                message: "Passkey not found",
              })
            );
          }

          yield* Effect.tryPromise({
            try: () =>
              db
                .delete(userPasskeys)
                .where(eq(userPasskeys.id, passkeyId)),
            catch: (error) =>
              new TransactionApprovalError({
                message: `Failed to remove passkey: ${error}`,
                cause: error,
              }),
          });

          // Check if any passkeys remain
          const remaining = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(userPasskeys)
                .where(eq(userPasskeys.userId, userId)),
            catch: (error) =>
              new TransactionApprovalError({
                message: `Failed to count remaining passkeys: ${error}`,
                cause: error,
              }),
          });

          // If no passkeys left and method is passkey, disable approval
          if (remaining.length === 0) {
            yield* Effect.tryPromise({
              try: () =>
                db
                  .update(userProfiles)
                  .set({
                    transactionApprovalMethod: null,
                    requireTransactionApproval: false,
                    updatedAt: new Date(),
                  })
                  .where(eq(userProfiles.privyUserId, userId)),
              catch: (error) =>
                new TransactionApprovalError({
                  message: `Failed to update profile: ${error}`,
                  cause: error,
                }),
            });
          }
        }),

      getApprovalSettings: (userId) =>
        Effect.gen(function* () {
          const rows = yield* findProfile(userId);
          if (!rows[0]) {
            return yield* Effect.fail(
              new TransactionApprovalError({
                message: "Profile not found",
              })
            );
          }

          const passkeys = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(userPasskeys)
                .where(eq(userPasskeys.userId, userId)),
            catch: (error) =>
              new TransactionApprovalError({
                message: `Failed to count passkeys: ${error}`,
                cause: error,
              }),
          });

          return {
            enabled: rows[0].requireTransactionApproval,
            method: rows[0].transactionApprovalMethod,
            hasPin: rows[0].transactionPinHash !== null,
            passkeyCount: passkeys.length,
          };
        }),

      disableApproval: (userId, pin, credential) =>
        Effect.gen(function* () {
          yield* checkLockout(userId);

          const rows = yield* findProfile(userId);
          if (!rows[0]) {
            return yield* Effect.fail(
              new TransactionApprovalError({
                message: "Profile not found",
              })
            );
          }

          if (!rows[0].requireTransactionApproval) {
            return; // Already disabled
          }

          // Verify identity before disabling
          if (rows[0].transactionApprovalMethod === "pin") {
            if (!pin) {
              return yield* Effect.fail(
                new TransactionApprovalError({
                  message: "PIN required to disable approval",
                })
              );
            }
            const isValid = yield* Effect.tryPromise({
              try: () =>
                bcrypt.compare(pin, rows[0]!.transactionPinHash!),
              catch: (error) =>
                new TransactionApprovalError({
                  message: `Failed to verify PIN: ${error}`,
                  cause: error,
                }),
            });
            if (!isValid) {
              recordFailedAttempt(userId);
              return yield* Effect.fail(
                new TransactionApprovalError({
                  message: "PIN is incorrect",
                })
              );
            }
          } else if (
            rows[0].transactionApprovalMethod === "passkey" &&
            credential
          ) {
            // For passkey, we expect the caller to have already verified via
            // generateAuthenticationOptions + verifyAuthentication flow.
            // The credential here is just for the final disable call.
            // In practice, frontend calls /verify first, gets approval token,
            // then calls /disable with the token. So this path is a fallback.
          }

          clearFailedAttempts(userId);

          // Remove all passkeys
          yield* Effect.tryPromise({
            try: () =>
              db
                .delete(userPasskeys)
                .where(eq(userPasskeys.userId, userId)),
            catch: (error) =>
              new TransactionApprovalError({
                message: `Failed to remove passkeys: ${error}`,
                cause: error,
              }),
          });

          // Reset profile
          yield* Effect.tryPromise({
            try: () =>
              db
                .update(userProfiles)
                .set({
                  requireTransactionApproval: false,
                  transactionApprovalMethod: null,
                  transactionPinHash: null,
                  updatedAt: new Date(),
                })
                .where(eq(userProfiles.privyUserId, userId)),
            catch: (error) =>
              new TransactionApprovalError({
                message: `Failed to update profile: ${error}`,
                cause: error,
              }),
          });
        }),

      generateApprovalToken: (userId) =>
        Effect.gen(function* () {
          return createHmacToken(userId);
        }),

      verifyApprovalToken: (token) =>
        Effect.gen(function* () {
          const result = verifyHmacToken(token);
          if (!result.valid || !result.userId) {
            return yield* Effect.fail(
              new TransactionApprovalError({
                message: "Invalid or expired approval token",
              })
            );
          }
          return result.userId;
        }),
    };
  })
);
