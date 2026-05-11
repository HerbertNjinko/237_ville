import { closeDatabasePool } from "./postgres.js";
import { runSchemaMigration } from "./setup.js";

try {
  await runSchemaMigration();
  console.log("237 Ville database schema is up to date.");
} finally {
  await closeDatabasePool();
}
