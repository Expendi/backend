import { Effect, Context, Layer } from "effect";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { ConfigService } from "../config.js";
import * as schema from "./schema/index.js";

export type Database = NodePgDatabase<typeof schema>;

export class DatabaseService extends Context.Tag("DatabaseService")<
  DatabaseService,
  {
    readonly db: Database;
    readonly pool: pg.Pool;
  }
>() {}

export const DatabaseLive: Layer.Layer<
  DatabaseService,
  never,
  ConfigService
> = Layer.effect(
  DatabaseService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const pool = new pg.Pool({ connectionString: config.databaseUrl });
    const db = drizzle(pool, { schema });

    return { db, pool };
  })
);
