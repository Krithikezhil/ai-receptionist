import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../config/env.js";
import * as schema from "./schema.js";

export type Database = NodePgDatabase<typeof schema>;

let pool: Pool | undefined;
let db: Database | undefined;

/**
 * Lazily constructs a pg Pool + Drizzle instance. Constructing a Pool does
 * not open a connection (pg connects on first query), so this is safe to
 * call even when Postgres is unavailable — callers only fail when they
 * actually run a query. See DEPLOYMENT.md for the current environment's
 * Docker/Postgres limitation.
 */
export function getDb(): Database {
  if (!db) {
    pool = new Pool({ connectionString: env.databaseUrl });
    db = drizzle(pool, { schema });
  }
  return db;
}
