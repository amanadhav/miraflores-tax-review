import { openDb, type DbHandle } from "@/db/client";
import { loadPacket, type LoadedPacket } from "@/packet/load";
import { importPacket } from "@/packet/import";

/**
 * Fresh in-memory Postgres (PGlite) with migrations applied. Set
 * TEST_DATABASE_URL to run the same tests against a real server instead.
 */
export async function testDb(): Promise<DbHandle> {
  const url = process.env.TEST_DATABASE_URL?.trim();
  const handle = url ? await openDb({ databaseUrl: url }) : await openDb({ pgliteDir: "memory" });
  if (url) await resetSchema(handle);
  await handle.migrate();
  return handle;
}

async function resetSchema(handle: DbHandle) {
  const { sql } = await import("drizzle-orm");
  await handle.db.execute(sql`drop schema if exists public cascade`);
  await handle.db.execute(sql`create schema public`);
  await handle.db.execute(sql`drop schema if exists drizzle cascade`);
}

let cachedPacket: LoadedPacket | undefined;
export function fixturePacket(): LoadedPacket {
  cachedPacket ??= loadPacket();
  return cachedPacket;
}

export async function importedDb(): Promise<{ handle: DbHandle; packetId: string; loaded: LoadedPacket }> {
  const handle = await testDb();
  const loaded = fixturePacket();
  const result = await importPacket(handle.db, loaded);
  return { handle, packetId: result.packetId, loaded };
}
