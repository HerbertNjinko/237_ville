import { closeDatabasePool } from "./postgres.js";
import { bootstrapDefaultAdmin, runSchemaMigration } from "./setup.js";

try {
  await runSchemaMigration();
  const admin = await bootstrapDefaultAdmin();
  console.log(`Admin ready: ${admin.email}`);
} finally {
  await closeDatabasePool();
}
