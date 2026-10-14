import "./env";
import { rmSync } from "node:fs";
import { sql } from "drizzle-orm";
import { openDb } from "../src/db/client";

/**
 * Drop everything and re-apply migrations. For the embedded database this
 * deletes the PGlite directory. For a real server it drops the public schema
 * of the configured database, so only point it at a development database.
 */
async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    const dir = process.env.PGLITE_DIR?.trim() || ".data/pglite";
    rmSync(dir, { recursive: true, force: true });
    console.log(`Removed ${dir}`);
  } else {
    const handle = await openDb();
    await handle.db.execute(sql`drop schema if exists public cascade`);
    await handle.db.execute(sql`create schema public`);
    await handle.db.execute(sql`drop schema if exists drizzle cascade`);
    await handle.close();
    console.log("Dropped and recreated the public schema");
  }
  const handle = await openDb();
  await handle.migrate();
  await handle.close();
  console.log("Migrations applied");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
