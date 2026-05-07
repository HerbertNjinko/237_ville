import dotenv from "dotenv";

dotenv.config();

function normalizeAppUrl(value, fallbackPort) {
  const fallback = `http://localhost:${fallbackPort}`;
  const rawUrl = String(value || fallback).trim() || fallback;
  const withProtocol = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;

  try {
    const url = new URL(withProtocol);
    return url.toString().replace(/\/$/, "");
  } catch {
    return fallback;
  }
}

const port = Number(process.env.PORT || 4173);
const defaultAdminEmail = (process.env.ADMIN_EMAIL || "admin@237ville.org").toLowerCase();
const defaultAdminTemporaryPassword =
  process.env.ADMIN_TEMPORARY_PASSWORD || process.env.ADMIN_PASSWORD || "ChangeMe237!";
const smtpHost = String(process.env.SMTP_HOST || "").trim();
const smtpEnabledValue = String(process.env.SMTP_ENABLED || "").trim().toLowerCase();
const smtpSecureValue = String(process.env.SMTP_SECURE || "").trim().toLowerCase();

export const config = {
  port,
  appUrl: normalizeAppUrl(process.env.APP_URL, port),
  sessionSecret: process.env.SESSION_SECRET || "dev-session-secret-change-me",
  defaultAdmin: {
    email: defaultAdminEmail,
    temporaryPassword: defaultAdminTemporaryPassword,
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
  dwolla: {
    enabled: String(process.env.DWOLLA_ENABLED || "false").toLowerCase() === "true",
    environment: String(process.env.DWOLLA_ENVIRONMENT || "sandbox").toLowerCase(),
    key: process.env.DWOLLA_KEY || "",
    secret: process.env.DWOLLA_SECRET || "",
    companyFundingSourceUrl: process.env.DWOLLA_COMPANY_FUNDING_SOURCE_URL || ""
  },
  smtp: {
    enabled: smtpEnabledValue ? ["1", "true", "yes", "on"].includes(smtpEnabledValue) : Boolean(smtpHost),
    host: smtpHost,
    port: Number(process.env.SMTP_PORT || 587),
    secure: smtpSecureValue ? ["1", "true", "yes", "on"].includes(smtpSecureValue) : Number(process.env.SMTP_PORT || 587) === 465,
    startTls: String(process.env.SMTP_STARTTLS || "true").toLowerCase() !== "false",
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || process.env.SMTP_PASSWORD || "",
    from: process.env.SMTP_FROM || process.env.SMTP_USER || defaultAdminEmail,
    fromName: process.env.SMTP_FROM_NAME || "237 Ville",
    replyTo: process.env.SMTP_REPLY_TO || process.env.SMTP_FROM || process.env.SMTP_USER || defaultAdminEmail,
    timeoutMs: Number(process.env.SMTP_TIMEOUT_MS || 10000)
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
