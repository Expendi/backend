import { Effect, Context, Layer, Config, ConfigError } from "effect";

export interface AppConfig {
  readonly databaseUrl: string;
  readonly privyAppId: string;
  readonly privyAppSecret: string;
  readonly coinmarketcapApiKey: string;
  readonly adminApiKey: string;
  readonly defaultChainId: number;
  readonly port: number;
}

export class ConfigService extends Context.Tag("ConfigService")<
  ConfigService,
  AppConfig
>() {}

export const ConfigLive: Layer.Layer<ConfigService, ConfigError.ConfigError> =
  Layer.effect(
    ConfigService,
    Effect.gen(function* () {
      const databaseUrl = yield* Config.string("DATABASE_URL");
      const privyAppId = yield* Config.string("PRIVY_APP_ID");
      const privyAppSecret = yield* Config.string("PRIVY_APP_SECRET");
      const coinmarketcapApiKey = yield* Config.string(
        "COINMARKETCAP_API_KEY"
      );
      const adminApiKey = yield* Config.string("ADMIN_API_KEY");
      const defaultChainId = yield* Config.withDefault(Config.integer("DEFAULT_CHAIN_ID"), 1);
      const port = yield* Config.withDefault(Config.integer("PORT"), 3000);

      return {
        databaseUrl,
        privyAppId,
        privyAppSecret,
        coinmarketcapApiKey,
        adminApiKey,
        defaultChainId,
        port,
      };
    })
  );
