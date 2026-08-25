/**
 * RAID has no fixture data to seed: scenarios are authored as code in
 * @raid/game-engine (not stored in the DB), and rooms/players are created
 * transiently through normal gameplay. This script exists to satisfy the
 * standard `pnpm db:seed` workflow and to fail loudly if the DB isn't
 * reachable/migrated, which is a useful local-setup sanity check.
 *
 * For an actual populated end-to-end game, run `pnpm bots` instead - it
 * drives a full 4-player game through the real REST + Socket.IO API.
 */
import { closeDb, db } from "./client.js";
import { sql } from "drizzle-orm";

async function main() {
  await db.execute(sql`select 1`);
  // eslint-disable-next-line no-console
  console.log("Database reachable and migrated. Nothing to seed — see comment in src/db/seed.ts.");
  await closeDb();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Seed check failed:", err);
  process.exit(1);
});
