import { Effect, Context, Layer } from "effect";
import { PrivyClient } from "@privy-io/node";
import { ConfigService } from "../../config.js";

export class PrivyService extends Context.Tag("PrivyService")<
  PrivyService,
  { readonly client: PrivyClient }
>() {}

export const PrivyLive: Layer.Layer<PrivyService, never, ConfigService> =
  Layer.effect(
    PrivyService,
    Effect.gen(function* () {
      const config = yield* ConfigService;
      const client = new PrivyClient({
        appId: config.privyAppId,
        appSecret: config.privyAppSecret,
      });
      return { client };
    })
  );
