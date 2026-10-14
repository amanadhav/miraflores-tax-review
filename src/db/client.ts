import { mkdirSync } from "node:fs";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Db;
  kind: "postgres" | "pglite";
  close: () => Promise<void>;
  /** Apply pending migrations from ./drizzle. */
  migrate: () => Promise<void>;
}

declare global {
  var __miraflores_db: Promise<DbHandle> | undefined;
}

export interface OpenOptions {
  /** PostgreSQL connection string. When absent PGlite is used. */
  databaseUrl?: string;
  /** PGlite data directory. "memory" keeps everything in memory (tests). */
  pgliteDir?: string;
}

/**
 * Open a database. Real PostgreSQL when a URL is supplied, otherwise embedded
 * PGlite (Postgres compiled to WASM) so a fresh checkout runs with no setup.
 * Both paths share the schema, migrations and every query in the app.
 */
export async function openDb(options: OpenOptions = {}): Promise<DbHandle> {
  const url = options.databaseUrl ?? process.env.DATABASE_URL?.trim();
  if (url) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const pool = new Pool({ connectionString: url, max: 10 });
    const db = drizzle(pool, { schema });
    return {
      db: db as unknown as Db,
      kind: "postgres",
      close: async () => {
        await pool.end();
      },
      migrate: async () => {
        await migrate(db, { migrationsFolder: "drizzle" });
      },
    };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dir = options.pgliteDir ?? process.env.PGLITE_DIR?.trim() ?? ".data/pglite";
  if (dir !== "memory") mkdirSync(dir, { recursive: true });
  const client = dir === "memory" ? new PGlite() : new PGlite(dir);
  const db = drizzle(client, { schema });
  return {
    db: db as unknown as Db,
    kind: "pglite",
    close: async () => {
      await client.close();
    },
    migrate: async () => {
      await migrate(db, { migrationsFolder: "drizzle" });
    },
  };
}

/** Process-wide handle for the app server. Migrations run once on first use. */
export function getDb(): Promise<DbHandle> {
  if (!globalThis.__miraflores_db) {
    globalThis.__miraflores_db = (async () => {
      const handle = await openDb();
      await handle.migrate();
      return handle;
    })();
  }
  return globalThis.__miraflores_db;
}
