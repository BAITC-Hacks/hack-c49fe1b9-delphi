import { getMigrations } from "better-auth/db/migration";
import { authOptions, database } from "./auth-config.mjs";

try {
  const migration = await getMigrations(authOptions);
  if (migration.schemaProblems.length) {
    throw new Error(migration.schemaProblems.join("\n"));
  }
  await migration.runMigrations();
  console.log(JSON.stringify({
    createdTables: migration.toBeCreated.length,
    updatedTables: migration.toBeAdded.length,
    addedIndexes: migration.toBeAddedIndexes.length,
  }));
} finally {
  await database.end();
}
