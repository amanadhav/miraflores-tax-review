import "./env";
import { openDb } from "../src/db/client";
import { loadPacket } from "../src/packet/load";
import { importPacket } from "../src/packet/import";

async function main() {
  const handle = await openDb();
  await handle.migrate();
  const loaded = loadPacket();
  console.log(`Packet ${loaded.path}`);
  console.log(`SHA-256 ${loaded.sha256} (${loaded.byteLength} bytes)`);
  const result = await importPacket(handle.db, loaded);
  console.log(result.imported ? "Imported." : "Already imported; nothing changed.");
  console.log(JSON.stringify(result.counts, null, 2));
  await handle.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
