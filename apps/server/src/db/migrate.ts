import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, closeDb } from "./client.js";

async function main() {
  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  // eslint-disable-next-line no-console
  console.log("Migrations applied.");
  await closeDb();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Migration failed:", err);
  process.exit(1);
});
