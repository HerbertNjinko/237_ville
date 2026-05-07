import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword } from "./auth.js";
import { config } from "./config.js";
import { query } from "./postgres.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(__dirname, "..", "data", "schema.sql");

function splitName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "237",
    lastName: parts.slice(1).join(" ") || "Ville Admin"
  };
}

export async function runSchemaMigration() {
  const schema = await readFile(schemaPath, "utf8");
  await query(schema);
}

export async function bootstrapDefaultAdmin() {
  const admin = config.defaultAdmin;
  const fallback = splitName(admin.fullName);
  const firstName = String(admin.firstName || fallback.firstName).trim();
  const lastName = String(admin.lastName || fallback.lastName).trim();
  const fullName = String(admin.fullName || `${firstName} ${lastName}`).trim();
  const temporaryPassword = String(admin.temporaryPassword || "").trim();
  if (temporaryPassword.length < 8) {
    throw new Error("ADMIN_TEMPORARY_PASSWORD must be at least 8 characters.");
  }

  const passwordHash = await hashPassword(temporaryPassword);

  const { rows } = await query(
    `
      WITH existing_admin AS (
        SELECT id
        FROM users
        WHERE email = $1
        LIMIT 1
      ),
      upserted_admin AS (
      INSERT INTO users (
        email,
        password_hash,
        first_name,
        last_name,
        full_name,
        role,
        membership_status,
        password_must_change,
        approved_at
      )
      VALUES ($1, $2, $3, $4, $5, 'admin', 'active', TRUE, now())
      ON CONFLICT (email)
      DO UPDATE SET
        password_hash = CASE WHEN users.approved_at IS NULL THEN EXCLUDED.password_hash ELSE users.password_hash END,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        full_name = EXCLUDED.full_name,
        role = 'admin',
        membership_status = 'active',
        approved_at = COALESCE(users.approved_at, now()),
        password_must_change = CASE WHEN users.approved_at IS NULL THEN TRUE ELSE users.password_must_change END,
        updated_at = now()
        RETURNING id, email, password_must_change
      )
      SELECT upserted_admin.*,
             NOT EXISTS (SELECT 1 FROM existing_admin) AS created
      FROM upserted_admin
    `,
    [admin.email, passwordHash, firstName, lastName, fullName]
  );

  return rows[0];
}
