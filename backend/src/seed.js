import { closeDatabasePool } from "./postgres.js";
import { bootstrapDefaultAdmin, runSchemaMigration } from "./setup.js";

try {
  await runSchemaMigration();
  const admin = await bootstrapDefaultAdmin();
  console.log(
    admin.created
      ? `Admin created: ${admin.email}. First login requires a password change.`
      : `Admin ready: ${admin.email}`
  );
} finally {
  await closeDatabasePool();
}
