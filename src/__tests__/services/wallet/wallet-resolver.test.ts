import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import {
  WalletResolver,
  WalletResolverLive,
  type WalletRef,
} from "../../../services/wallet/wallet-resolver.js";
import {
  WalletService,
  WalletError,
  type WalletInstance,
} from "../../../services/wallet/wallet-service.js";

function makeMockWalletInstance(address: `0x${string}`): WalletInstance {
  return {
    getAddress: () => Effect.succeed(address),
    sign: (msg) => Effect.succeed(`0xsig_${msg}` as `0x${string}`),
    sendTransaction: () =>
      Effect.succeed(
        "0xhash1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde1" as const
      ),
  };
}

const userAddr = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const serverAddr = "0x2222222222222222222222222222222222222222" as `0x${string}`;
const agentAddr = "0x3333333333333333333333333333333333333333" as `0x${string}`;

function makeTestLayer(opts?: { getWalletFail?: boolean }) {
  const MockWalletServiceLayer = Layer.succeed(WalletService, {
    createUserWallet: () => Effect.succeed(makeMockWalletInstance(userAddr)),
    createServerWallet: () => Effect.succeed(makeMockWalletInstance(serverAddr)),
    createAgentWallet: () => Effect.succeed(makeMockWalletInstance(agentAddr)),
    getWallet: (privyWalletId: string, type: "user" | "server" | "agent") => {
      if (opts?.getWalletFail) {
        return Effect.fail(
          new WalletError({ message: "Wallet not found" })
        );
      }
      switch (type) {
        case "user":
          return Effect.succeed(makeMockWalletInstance(userAddr));
        case "server":
          return Effect.succeed(makeMockWalletInstance(serverAddr));
        case "agent":
          return Effect.succeed(makeMockWalletInstance(agentAddr));
      }
    },
  });

  return WalletResolverLive.pipe(Layer.provide(MockWalletServiceLayer));
}

describe("WalletResolver", () => {
  describe("resolve", () => {
    it("should resolve a user wallet reference", async () => {
      const layer = makeTestLayer();

      const address = await Effect.runPromise(
        Effect.gen(function* () {
          const resolver = yield* WalletResolver;
          const wallet = yield* resolver.resolve({
            privyWalletId: "privy-1",
            type: "user",
          });
          return yield* wallet.getAddress();
        }).pipe(Effect.provide(layer))
      );

      expect(address).toBe(userAddr);
    });

    it("should resolve a server wallet reference", async () => {
      const layer = makeTestLayer();

      const address = await Effect.runPromise(
        Effect.gen(function* () {
          const resolver = yield* WalletResolver;
          const wallet = yield* resolver.resolve({
            privyWalletId: "privy-2",
            type: "server",
          });
          return yield* wallet.getAddress();
        }).pipe(Effect.provide(layer))
      );

      expect(address).toBe(serverAddr);
    });

    it("should resolve an agent wallet reference", async () => {
      const layer = makeTestLayer();

      const address = await Effect.runPromise(
        Effect.gen(function* () {
          const resolver = yield* WalletResolver;
          const wallet = yield* resolver.resolve({
            privyWalletId: "privy-3",
            type: "agent",
          });
          return yield* wallet.getAddress();
        }).pipe(Effect.provide(layer))
      );

      expect(address).toBe(agentAddr);
    });

    it("should propagate WalletError when getWallet fails", async () => {
      const layer = makeTestLayer({ getWalletFail: true });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const resolver = yield* WalletResolver;
          return yield* resolver
            .resolve({ privyWalletId: "bad-id", type: "user" })
            .pipe(
              Effect.matchEffect({
                onSuccess: () => Effect.succeed({ tag: "ok" as const }),
                onFailure: (e) => Effect.succeed({ tag: "err" as const, e }),
              })
            );
        }).pipe(Effect.provide(layer))
      );

      expect(result.tag).toBe("err");
      if (result.tag === "err") {
        expect(result.e).toBeInstanceOf(WalletError);
      }
    });

    it("should return a wallet instance that can sign messages", async () => {
      const layer = makeTestLayer();

      const signature = await Effect.runPromise(
        Effect.gen(function* () {
          const resolver = yield* WalletResolver;
          const wallet = yield* resolver.resolve({
            privyWalletId: "privy-1",
            type: "user",
          });
          return yield* wallet.sign("hello");
        }).pipe(Effect.provide(layer))
      );

      expect(signature).toBe("0xsig_hello");
    });

    it("should return a wallet instance that can send transactions", async () => {
      const layer = makeTestLayer();

      const hash = await Effect.runPromise(
        Effect.gen(function* () {
          const resolver = yield* WalletResolver;
          const wallet = yield* resolver.resolve({
            privyWalletId: "privy-1",
            type: "server",
          });
          return yield* wallet.sendTransaction({
            to: "0x0000000000000000000000000000000000000001",
            chainId: 1,
          });
        }).pipe(Effect.provide(layer))
      );

      expect(hash.startsWith("0x")).toBe(true);
    });
  });
});
