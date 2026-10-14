import "dotenv/config";
import { openDb } from "../src/db/client";

async function main() {
  const handle = await openDb();
  console.log(`Applying migrations to ${handle.kind} database`);
  await handle.migrate();
  await handle.close();
  console.log("Migrations applied");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
