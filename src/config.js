import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 4173),
  sessionSecret: process.env.SESSION_SECRET || "dev-session-secret-change-me",
  defaultAdmin: {
    email: (process.env.ADMIN_EMAIL || "admin@237ville.org").toLowerCase(),
    password: process.env.ADMIN_PASSWORD || "ChangeMe237!",
    firstName: process.env.ADMIN_FIRST_NAME || "",
    lastName: process.env.ADMIN_LAST_NAME || "",
    fullName: process.env.ADMIN_NAME || "237 Ville Admin"
  },
  registrationFeeCents: Number(process.env.REGISTRATION_FEE_CENTS || 5000),
  organizationPolicy: {
    title: process.env.POLICY_TITLE || "237 Ville Member Policy",
    version: process.env.POLICY_VERSION || "2026-05-06",
    body:
      process.env.POLICY_BODY ||
      "Members agree to act respectfully, keep organization information accurate, pay required dues and fees, follow voting rules, protect member privacy, and support the mission and decisions of 237 Ville."
  },
  database:
    process.env.DATABASE_URL
      ? { connectionString: process.env.DATABASE_URL }
      : {
          database: process.env.PGDATABASE || "organization_237",
          host: process.env.PGHOST,
          port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
          user: process.env.PGUSER,
          password: process.env.PGPASSWORD
        }
};
