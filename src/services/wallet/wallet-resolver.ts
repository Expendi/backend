import { Effect, Context, Layer } from "effect";
import { WalletService, type WalletInstance, WalletError } from "./wallet-service.js";

export interface WalletRef {
  readonly privyWalletId: string;
  readonly type: "user" | "server" | "agent";
}

export interface WalletResolverApi {
  readonly resolve: (ref: WalletRef) => Effect.Effect<WalletInstance, WalletError>;
}

export class WalletResolver extends Context.Tag("WalletResolver")<
  WalletResolver,
  WalletResolverApi
>() {}

export const WalletResolverLive: Layer.Layer<
  WalletResolver,
  never,
  WalletService
> = Layer.effect(
  WalletResolver,
  Effect.gen(function* () {
    const walletService = yield* WalletService;

    return {
      resolve: (ref: WalletRef) =>
        walletService.getWallet(ref.privyWalletId, ref.type),
    };
  })
);
