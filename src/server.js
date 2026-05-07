import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  buildSessionCookie,
  createSessionToken,
  hashPassword,
  hashSessionToken,
  parseCookies,
  sessionCookieName,
  sessionMaxAgeSeconds,
  verifyPassword
} from "./auth.js";
import { config } from "./config.js";
import { query, withTransaction } from "./postgres.js";
import { bootstrapDefaultAdmin, runSchemaMigration } from "./setup.js";

import { handlePublicRoutes } from "./server/routes/public.js";
import { handleContentRoutes } from "./server/routes/content.js";
import { handleSocialRoutes } from "./server/routes/social.js";
import { handleFinancialRoutes } from "./server/routes/financial.js";
import { handleAboutRoutes } from "./server/routes/about.js";
import { handleNotificationRoutes } from "./server/routes/notifications.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");
const paymentMethods = new Set(["cash", "cash_app", "venmo", "zelle", "paypal", "cheque", "bank_account"]);
const userRoles = new Set(["member", "admin", "secretary", "treasurer", "social"]);
const staffRoles = new Set(["admin", "secretary", "treasurer", "social"]);
const assignableStaffRoles = new Set(["", "admin", "secretary", "treasurer", "social"]);
const rolePermissions = {
  admin: new Set(["overview", "about", "announcements", "questions", "events", "social", "votes", "payments", "payment-details", "expenditures", "budgets", "profile:view", "profile:manage", "notifications:view", "notifications:clear", "archive", "delete"]),
  secretary: new Set(["overview", "about", "announcements", "questions", "votes", "profile:view", "notifications:view"]),
  treasurer: new Set(["overview", "announcements", "questions", "events", "votes", "payments", "payment-details", "expenditures", "budgets", "notifications:view", "notifications:clear"]),
  social: new Set(["overview", "announcements", "questions", "events", "social"])
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

function toUser(row) {
  if (!row) return null;

  return {
    id: Number(row.id),
    email: row.email,
    firstName: row.first_name || "",
    lastName: row.last_name || "",
    fullName: row.full_name,
    phone: row.phone || "",
    address: row.address || "",
    city: row.city || "",
    state: row.state || "",
    bio: row.bio || "",
    registrationStatement: row.registration_statement || "",
    identityDocument: {
      name: row.identity_document_name || "",
      type: row.identity_document_type || "",
      size: Number(row.identity_document_size || 0),
      dataUrl: row.identity_document_data_url || ""
    },
    role: row.role,
    staffRole: row.staff_role || "",
    effectiveRole: effectiveStaffRole(row) || row.role,
    hasMemberPortal: row.role === "member",
    membershipStatus: row.membership_status,
    notificationOptIn: row.notification_opt_in,
    passwordMustChange: row.password_must_change,
    policyAcceptedAt: row.policy_accepted_at,
    policySignatureName: row.policy_signature_name || "",
    policyVersion: row.policy_version || "",
    approvedAt: row.approved_at,
    approvedBy: row.approved_by ? Number(row.approved_by) : null,
    rejectedAt: row.rejected_at,
    rejectedBy: row.rejected_by ? Number(row.rejected_by) : null,
    rejectionReason: row.rejection_reason || "",
    createdAt: row.created_at
  };
}

function sendJson(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers
  });
  res.end(JSON.stringify(payload));
}

function sendNoContent(res, headers = {}) {
  res.writeHead(204, headers);
  res.end();
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

async function readJson(req) {
  let body = "";

  for await (const chunk of req) {
    body += chunk;
    if (body.length > 8_000_000) {
      throw Object.assign(new Error("Request body is too large."), { statusCode: 413 });
    }
  }

  if (!body.trim()) {
    return {};
  }

  try {
    return JSON.parse(body);
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), { statusCode: 400 });
  }
}

function requireFields(payload, fields) {
  const missing = fields.filter((field) => !String(payload[field] || "").trim());
  if (missing.length > 0) {
    throw Object.assign(new Error(`Missing required field: ${missing.join(", ")}`), { statusCode: 400 });
  }
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeUserRole(role) {
  const value = String(role || "").trim().toLowerCase();
  return userRoles.has(value) ? value : "member";
}

function normalizeStaffRole(role) {
  const value = String(role || "").trim().toLowerCase();
  return assignableStaffRoles.has(value) ? value : "";
}

function isStaffRole(role) {
  return staffRoles.has(role);
}

function effectiveStaffRole(user) {
  const staffRole = String(user?.staffRole || user?.staff_role || "").trim().toLowerCase();
  if (isStaffRole(staffRole)) return staffRole;
  const accountRole = String(user?.role || "").trim().toLowerCase();
  return isStaffRole(accountRole) ? accountRole : "";
}

function hasStaffPermission(user, permission) {
  const role = effectiveStaffRole(user);
  if (!user || !role) return false;
  if (role === "admin") return true;
  return rolePermissions[role]?.has(permission) || false;
}

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw Object.assign(new Error("Invalid id."), { statusCode: 400 });
  }
  return id;
}

function dollarsToCents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw Object.assign(new Error("Amount must be greater than zero."), { statusCode: 400 });
  }
  return Math.round(amount * 100);
}

function centsToDollarAmount(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

function normalizePaymentMethod(method) {
  const value = String(method || "").trim().toLowerCase();
  if (!paymentMethods.has(value)) {
    throw Object.assign(new Error("Choose a supported payment method."), { statusCode: 400 });
  }
  return value;
}

function normalizePaymentRecordDetails(payload = {}) {
  const details = {
    paymentReference: String(payload.paymentReference || "").trim(),
    payerHandle: String(payload.payerHandle || "").trim(),
    bankName: String(payload.bankName || "").trim(),
    accountHolderName: String(payload.accountHolderName || "").trim(),
    bankAccountType: ["checking", "savings"].includes(payload.bankAccountType) ? payload.bankAccountType : "",
    accountLast4: String(payload.accountLast4 || "").replace(/\D/g, "").slice(-4),
    cashDonorName: String(payload.cashDonorName || "").trim(),
    cashReceivedBy: String(payload.cashReceivedBy || "").trim()
  };

  return Object.fromEntries(Object.entries(details).filter(([, value]) => value));
}

function publicPaymentNote(note = "") {
  return String(note || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.toLowerCase().includes("submitted for admin review"))
    .join("\n");
}

function validateIdentityDocument(document) {
  if (!document || typeof document !== "object") {
    throw Object.assign(new Error("ID card upload is required."), { statusCode: 400 });
  }

  const name = String(document.name || "").trim();
  const type = String(document.type || "").trim();
  const size = Number(document.size || 0);
  const dataUrl = String(document.dataUrl || "");
  const acceptedTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

  if (!name || !type || !dataUrl) {
    throw Object.assign(new Error("ID card upload is incomplete."), { statusCode: 400 });
  }

  if (!acceptedTypes.includes(type)) {
    throw Object.assign(new Error("ID card must be a JPG, PNG, WebP, or PDF file."), { statusCode: 400 });
  }

  if (!Number.isFinite(size) || size <= 0 || size > 3_000_000) {
    throw Object.assign(new Error("ID card file must be 3 MB or smaller."), { statusCode: 400 });
  }

  if (!dataUrl.startsWith(`data:${type};base64,`)) {
    throw Object.assign(new Error("ID card upload is not valid."), { statusCode: 400 });
  }

  return { name, type, size, dataUrl };
}

function validateImageUpload(image) {
  if (!image || typeof image !== "object" || !String(image.dataUrl || "").trim()) {
    return { name: "", type: "", size: 0, dataUrl: "" };
  }

  const name = String(image.name || "").trim();
  const type = String(image.type || "").trim();
  const size = Number(image.size || 0);
  const dataUrl = String(image.dataUrl || "");
  const acceptedTypes = ["image/jpeg", "image/png", "image/webp"];

  if (!name || !type || !dataUrl) {
    throw Object.assign(new Error("Image upload is incomplete."), { statusCode: 400 });
  }

  if (!acceptedTypes.includes(type)) {
    throw Object.assign(new Error("Image must be a JPG, PNG, or WebP file."), { statusCode: 400 });
  }

  if (!Number.isFinite(size) || size <= 0 || size > 3_000_000) {
    throw Object.assign(new Error("Image must be 3 MB or smaller."), { statusCode: 400 });
  }

  if (!dataUrl.startsWith(`data:${type};base64,`)) {
    throw Object.assign(new Error("Image upload is not valid."), { statusCode: 400 });
  }

  return { name, type, size, dataUrl };
}

function validateReceiptUpload(receipt) {
  if (!receipt || typeof receipt !== "object" || !String(receipt.dataUrl || "").trim()) {
    return { name: "", type: "", size: 0, dataUrl: "" };
  }

  const name = String(receipt.name || "").trim();
  const type = String(receipt.type || "").trim();
  const size = Number(receipt.size || 0);
  const dataUrl = String(receipt.dataUrl || "");
  const acceptedTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

  if (!name || !type || !dataUrl) {
    throw Object.assign(new Error("Receipt upload is incomplete."), { statusCode: 400 });
  }

  if (!acceptedTypes.includes(type)) {
    throw Object.assign(new Error("Receipt must be a JPG, PNG, WebP, or PDF file."), { statusCode: 400 });
  }

  if (!Number.isFinite(size) || size <= 0 || size > 5_000_000) {
    throw Object.assign(new Error("Receipt must be 5 MB or smaller."), { statusCode: 400 });
  }

  if (!dataUrl.startsWith(`data:${type};base64,`)) {
    throw Object.assign(new Error("Receipt upload is not valid."), { statusCode: 400 });
  }

  return { name, type, size, dataUrl };
}

function buildFullName(firstName, lastName) {
  return [firstName, lastName].map((part) => String(part || "").trim()).filter(Boolean).join(" ");
}

function isLockedStatus(status) {
  return status === "inactive" || status === "suspended" || status === "rejected";
}

function isPortalReady(user) {
  return Boolean(user && user.membershipStatus === "active" && !user.passwordMustChange);
}

function isOnboardingUser(user) {
  return Boolean(
    user &&
      !isLockedStatus(user.membershipStatus) &&
      (user.passwordMustChange || (user.role === "member" && user.membershipStatus !== "active"))
  );
}

async function createNotification(userId, type, title, body = "", link = "") {
  await query(
    `
      INSERT INTO notifications (user_id, type, title, body, link)
      VALUES ($1, $2, $3, $4, $5)
    `,
    [userId, type, title, body, link]
  );
}

async function notifyAdmins(type, title, body = "", link = "/admin") {
  await query(
    `
      INSERT INTO notifications (user_id, type, title, body, link)
      SELECT id, $1, $2, $3, $4
      FROM users
      WHERE (role = 'admin' OR staff_role = 'admin')
        AND membership_status = 'active'
        AND notification_opt_in = TRUE
    `,
    [type, title, body, link]
  );
}

async function createSession(userId) {
  const token = createSessionToken();
  const tokenHash = hashSessionToken(token);

  await query(
    `
      INSERT INTO sessions (user_id, token_hash, expires_at)
      VALUES ($1, $2, now() + ($3 || ' seconds')::interval)
    `,
    [userId, tokenHash, sessionMaxAgeSeconds]
  );

  return token;
}

async function getCurrentUser(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[sessionCookieName];

  if (!token) {
    return null;
  }

  const { rows } = await query(
    `
      SELECT users.*
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = $1
        AND sessions.expires_at > now()
        AND users.membership_status NOT IN ('inactive', 'suspended')
      LIMIT 1
    `,
    [hashSessionToken(token)]
  );

  return toUser(rows[0]);
}

async function requireUser(req, res) {
  const user = await getCurrentUser(req);
  if (!user) {
    sendError(res, 401, "You need to sign in first.");
    return null;
  }
  return user;
}

async function requireActiveUser(req, res) {
  const user = await requireUser(req, res);
  if (!user) {
    return null;
  }
  if (!isPortalReady(user)) {
    sendError(res, 403, "Complete account onboarding before using the member portal.");
    return null;
  }
  return user;
}

async function requireAdmin(req, res) {
  const user = await requireUser(req, res);
  if (!user) {
    return null;
  }
  if (effectiveStaffRole(user) !== "admin" || !isPortalReady(user)) {
    sendError(res, 403, "Admin access is required.");
    return null;
  }
  return user;
}

async function requireStaffPermission(req, res, permission) {
  const user = await requireActiveUser(req, res);
  if (!user) {
    return null;
  }
  if (!hasStaffPermission(user, permission)) {
    sendError(res, 403, "You do not have permission to access this admin tool.");
    return null;
  }
  return user;
}

async function createAnnouncementNotifications(announcement) {
  await query(
    `
      INSERT INTO notifications (user_id, type, title, body, link)
      SELECT id, 'announcement', $1, $2, $3
      FROM users
      WHERE notification_opt_in = TRUE
        AND membership_status = 'active'
    `,
    [
      announcement.title,
      announcement.body.slice(0, 240),
      `/announcements/${announcement.id}`
    ]
  );
}

async function notifyActiveMembers(type, title, body = "", link = "/") {
  await query(
    `
      INSERT INTO notifications (user_id, type, title, body, link)
      SELECT id, $1, $2, $3, $4
      FROM users
      WHERE notification_opt_in = TRUE
        AND membership_status = 'active'
    `,
    [type, title, body, link]
  );
}

async function listAnnouncements(limit = 30) {
  const { rows } = await query(
    `
      SELECT announcements.*, users.full_name AS author_name
      FROM announcements
      LEFT JOIN users ON users.id = announcements.created_by
      WHERE announcements.status = 'published'
      ORDER BY announcements.published_at DESC NULLS LAST, announcements.created_at DESC
      LIMIT $1
    `,
    [limit]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    title: row.title,
    body: row.body,
    category: row.category,
    authorName: row.author_name || "237 Ville",
    publishedAt: row.published_at,
    createdAt: row.created_at
  }));
}

async function listAdminAnnouncements(limit = 100) {
  const { rows } = await query(
    `
      SELECT announcements.*, users.full_name AS author_name
      FROM announcements
      LEFT JOIN users ON users.id = announcements.created_by
      ORDER BY announcements.created_at DESC
      LIMIT $1
    `,
    [limit]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    title: row.title,
    body: row.body,
    category: row.category,
    status: row.status,
    authorName: row.author_name || "237 Ville",
    publishedAt: row.published_at,
    createdAt: row.created_at
  }));
}

function toLeadershipPosition(row) {
  return {
    id: Number(row.id),
    title: row.title,
    holderName: row.holder_name || "",
    body: row.body || "",
    image: {
      name: row.image_name || "",
      type: row.image_type || "",
      size: Number(row.image_size || 0),
      dataUrl: row.image_data_url || ""
    },
    displayOrder: Number(row.display_order || 0),
    status: row.status,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeLeadershipStatus(status) {
  if (status === "hidden" || status === "archived") return status;
  return "published";
}

function toPublicAboutArticle(row) {
  return {
    id: Number(row.id),
    title: row.title,
    body: row.body,
    image: {
      name: row.image_name || "",
      type: row.image_type || "",
      size: Number(row.image_size || 0),
      dataUrl: row.image_data_url || ""
    },
    displayOrder: Number(row.display_order || 0),
    status: row.status,
    hiddenAt: row.hidden_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function cleanupExpiredHiddenAboutArticles() {
  const { rowCount } = await query(
    `
      DELETE FROM public_about_articles
      WHERE status = 'hidden'
        AND COALESCE(hidden_at, updated_at, created_at) < now() - interval '30 days'
    `
  );

  return rowCount;
}

async function getAboutContent({ includeHidden = false } = {}) {
  await cleanupExpiredHiddenAboutArticles();

  const about = await query(
    `
      SELECT *
      FROM organization_about
      WHERE id = 1
      LIMIT 1
    `
  );
  const positions = await query(
    `
      SELECT *
      FROM leadership_positions
      WHERE ($1::boolean = true OR status = 'published')
      ORDER BY display_order ASC, created_at DESC
      LIMIT 100
    `,
    [Boolean(includeHidden)]
  );
  const articles = await query(
    `
      SELECT *
      FROM public_about_articles
      WHERE ($1::boolean = true OR status = 'published')
      ORDER BY display_order ASC, created_at DESC
      LIMIT 100
    `,
    [Boolean(includeHidden)]
  );

  const row = about.rows[0] || {};
  return {
    summary: row.summary || "",
    missionStatement: row.mission_statement || "",
    purpose: row.purpose || "",
    updatedAt: row.updated_at || null,
    articles: articles.rows.map(toPublicAboutArticle),
    positions: positions.rows.map(toLeadershipPosition)
  };
}

async function listEvents(limit = 30) {
  await archiveExpiredEvents();

  const { rows } = await query(
    `
      SELECT events.*, users.full_name AS author_name
      FROM events
      LEFT JOIN users ON users.id = events.created_by
      WHERE events.status = 'active'
        AND COALESCE(events.ends_at, events.starts_at) >= now() - interval '1 day'
      ORDER BY events.starts_at ASC
      LIMIT $1
    `,
    [limit]
  );

  return rows.map((row) => ({
    id: Number(row.id),
    title: row.title,
    description: row.description || "",
    location: row.location || "",
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status || "active",
    archivedAt: row.archived_at,
    authorName: row.author_name || "237 Ville"
  }));
}

async function listAdminEvents(limit = 100) {
  await archiveExpiredEvents();

  const { rows } = await query(
    `
      SELECT events.*, users.full_name AS author_name
      FROM events
      LEFT JOIN users ON users.id = events.created_by
      ORDER BY
        CASE events.status WHEN 'active' THEN 0 ELSE 1 END,
        events.starts_at DESC
      LIMIT $1
    `,
    [limit]
  );

  return rows.map((row) => ({
    id: Number(row.id),
    title: row.title,
    description: row.description || "",
    location: row.location || "",
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status || "active",
    archivedAt: row.archived_at,
    authorName: row.author_name || "237 Ville"
  }));
}

async function archiveExpiredEvents() {
  await query(
    `
      UPDATE events
      SET status = 'archived',
          archived_at = COALESCE(archived_at, now()),
          updated_at = now()
      WHERE status = 'active'
        AND COALESCE(ends_at, starts_at) < now() - interval '30 days'
    `
  );
}

async function listQuestions({ includePending = false } = {}) {
  const statusFilter = includePending
    ? "member_questions.status IN ('pending', 'published', 'closed')"
    : "member_questions.status = 'published' AND member_questions.content_type = 'question'";

  const { rows } = await query(
    `
      SELECT member_questions.*, users.full_name AS author_name
      FROM member_questions
      JOIN users ON users.id = member_questions.user_id
      WHERE ${statusFilter}
      ORDER BY member_questions.created_at DESC
      LIMIT 50
    `
  );

  const questionIds = rows.map((row) => row.id);
  const commentsByQuestion = new Map();

  if (questionIds.length > 0) {
    const comments = await query(
      `
        SELECT question_comments.*, users.full_name AS author_name
        FROM question_comments
        JOIN users ON users.id = question_comments.user_id
        WHERE question_comments.question_id = ANY($1::bigint[])
        ORDER BY question_comments.created_at ASC
      `,
      [questionIds]
    );

    for (const row of comments.rows) {
      const key = String(row.question_id);
      if (!commentsByQuestion.has(key)) commentsByQuestion.set(key, []);
      commentsByQuestion.get(key).push({
        id: Number(row.id),
        body: row.body,
        authorName: row.author_name,
        createdAt: row.created_at
      });
    }
  }

  return rows.map((row) => ({
    id: Number(row.id),
    contentType: row.content_type || "question",
    title: row.title,
    body: row.body,
    status: row.status,
    authorName: row.author_name,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    comments: commentsByQuestion.get(String(row.id)) || []
  }));
}

async function closeExpiredBallots() {
  await query(
    `
      UPDATE ballots
      SET status = 'closed',
          updated_at = now()
      WHERE status = 'open'
        AND ends_at IS NOT NULL
        AND ends_at < now()
    `
  );
}

async function listBallots(user, { includeDrafts = false, includeArchived = false } = {}) {
  await closeExpiredBallots();

  const statusClause = includeDrafts
    ? includeArchived
      ? "TRUE"
      : "ballots.status <> 'archived'"
    : "ballots.status IN ('open', 'closed')";

  const { rows } = await query(
    `
      SELECT ballots.*, member_questions.title AS question_title
      FROM ballots
      LEFT JOIN member_questions ON member_questions.id = ballots.question_id
      WHERE ${statusClause}
      ORDER BY
        CASE ballots.status WHEN 'open' THEN 0 WHEN 'draft' THEN 1 WHEN 'closed' THEN 2 ELSE 3 END,
        ballots.created_at DESC
      LIMIT 50
    `
  );

  if (rows.length === 0) {
    return [];
  }

  const ballotIds = rows.map((row) => row.id);
  const options = await query(
    `
      SELECT
        ballot_options.*,
        COUNT(votes.id)::int AS vote_count
      FROM ballot_options
      LEFT JOIN votes ON votes.option_id = ballot_options.id
      WHERE ballot_options.ballot_id = ANY($1::bigint[])
      GROUP BY ballot_options.id
      ORDER BY ballot_options.id ASC
    `,
    [ballotIds]
  );
  const userVotes = await query(
    `
      SELECT ballot_id, option_id
      FROM votes
      WHERE user_id = $1
        AND ballot_id = ANY($2::bigint[])
    `,
    [user.id, ballotIds]
  );

  const optionsByBallot = new Map();
  for (const row of options.rows) {
    const key = String(row.ballot_id);
    if (!optionsByBallot.has(key)) optionsByBallot.set(key, []);
    optionsByBallot.get(key).push({
      id: Number(row.id),
      label: row.label,
      description: row.description || "",
      candidateUserId: row.candidate_user_id ? Number(row.candidate_user_id) : null,
      voteCount: Number(row.vote_count)
    });
  }

  const userVoteByBallot = new Map(
    userVotes.rows.map((row) => [String(row.ballot_id), Number(row.option_id)])
  );

  return rows.map((row) => {
    const ballotOptions = optionsByBallot.get(String(row.id)) || [];
    const totalVotes = ballotOptions.reduce((sum, option) => sum + option.voteCount, 0);

    return {
      id: Number(row.id),
      title: row.title,
      description: row.description || "",
      ballotType: row.ballot_type,
      status: row.status,
      questionId: row.question_id ? Number(row.question_id) : null,
      questionTitle: row.question_title || "",
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      totalVotes,
      userVoteOptionId: userVoteByBallot.get(String(row.id)) || null,
      options: ballotOptions
    };
  });
}

async function listPayments(user, { includeAll = false } = {}) {
  const { rows } = includeAll
      ? await query(
        `
          SELECT payments.*, users.full_name, users.email
          FROM payments
          LEFT JOIN users ON users.id = payments.user_id
          ORDER BY payments.created_at DESC
          LIMIT 100
        `
      )
    : await query(
        `
          SELECT payments.*, users.full_name, users.email
          FROM payments
          LEFT JOIN users ON users.id = payments.user_id
          WHERE payments.user_id = $1
          ORDER BY payments.created_at DESC
          LIMIT 50
        `,
        [user.id]
      );

  return rows.map((row) => ({
    id: Number(row.id),
    userId: row.user_id ? Number(row.user_id) : null,
    memberName: row.full_name || row.donor_name || "Anonymous donor",
    memberEmail: row.email || row.donor_email || "",
    purpose: row.purpose,
    amountCents: Number(row.amount_cents),
    method: row.method,
    status: row.status,
    note: row.note || "",
    externalReference: row.external_reference || "",
    donorName: row.donor_name || "",
    donorEmail: row.donor_email || "",
    dwollaTransferUrl: row.dwolla_transfer_url || "",
    processorStatus: row.processor_status || "",
    publishedAt: row.published_at,
    paymentDetails: row.payment_details || {},
    paymentDetailSnapshot: row.payment_detail_snapshot || "",
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at
  }));
}

function toPaymentDetail(row) {
  return {
    method: row.method,
    displayName: row.display_name,
    accountIdentifier: row.account_identifier || "",
    instructions: row.instructions || "",
    enabled: row.enabled,
    updatedAt: row.updated_at
  };
}

function paymentDetailSnapshot(detail) {
  if (!detail) return "";
  return [
    detail.display_name,
    detail.account_identifier ? `Account: ${detail.account_identifier}` : "",
    detail.instructions || ""
  ]
    .filter(Boolean)
    .join("\n");
}

async function listOrganizationPaymentDetails({ includeDisabled = false } = {}) {
  const { rows } = await query(
    `
      SELECT *
      FROM organization_payment_details
      WHERE ($1::boolean = true OR enabled = true)
      ORDER BY
        CASE method
          WHEN 'cash' THEN 1
          WHEN 'cash_app' THEN 2
          WHEN 'venmo' THEN 3
          WHEN 'zelle' THEN 4
          WHEN 'paypal' THEN 5
          WHEN 'cheque' THEN 6
          ELSE 7
        END
    `,
    [Boolean(includeDisabled)]
  );

  return rows.map(toPaymentDetail);
}

async function getOrganizationPaymentDetail(method) {
  const { rows } = await query(
    "SELECT * FROM organization_payment_details WHERE method = $1 LIMIT 1",
    [method]
  );
  return rows[0] ? toPaymentDetail(rows[0]) : null;
}

async function requireEnabledPaymentDetail(method) {
  const detail = await getOrganizationPaymentDetail(method);
  if (!detail || !detail.enabled) {
    throw Object.assign(new Error("This payment method is not currently available."), { statusCode: 400 });
  }
  return detail;
}

function toReceiptAttachment(row, { includeData = true } = {}) {
  return {
    name: row.receipt_name || "",
    type: row.receipt_type || "",
    size: Number(row.receipt_size || 0),
    dataUrl: includeData ? row.receipt_data_url || "" : ""
  };
}

function toExpenditure(row, { includeReceiptData = true } = {}) {
  return {
    id: Number(row.id),
    title: row.title,
    category: row.category || "",
    vendor: row.vendor || "",
    amountCents: Number(row.amount_cents),
    expenseDate: row.expense_date,
    note: row.note || "",
    receipt: toReceiptAttachment(row, { includeData: includeReceiptData }),
    status: row.status,
    createdBy: row.created_by ? Number(row.created_by) : null,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeDepartmentBudgetStatus(value) {
  return ["published", "closed"].includes(value) ? value : "draft";
}

function normalizeDepartmentBudgetExpenseStatus(value) {
  return value === "published" ? "published" : "draft";
}

async function listExpenditures({ publishedOnly = false, limit = 100, includeReceiptData = true } = {}) {
  const { rows } = await query(
    `
      SELECT *
      FROM expenditures
      WHERE ($1::boolean = false OR status = 'published')
      ORDER BY expense_date DESC, created_at DESC
      LIMIT $2
    `,
    [Boolean(publishedOnly), limit]
  );

  return rows.map((row) => toExpenditure(row, { includeReceiptData }));
}

function toDepartmentBudgetExpense(row, { includeReceiptData = true } = {}) {
  return {
    id: Number(row.id),
    budgetId: Number(row.budget_id),
    budgetTitle: row.budget_title || "",
    budgetDepartmentName: row.budget_department_name || "",
    title: row.title,
    vendor: row.vendor || "",
    amountCents: Number(row.amount_cents || 0),
    expenseDate: row.expense_date,
    note: row.note || "",
    receipt: toReceiptAttachment(row, { includeData: includeReceiptData }),
    status: row.status,
    createdBy: row.created_by ? Number(row.created_by) : null,
    createdByName: row.created_by_name || "",
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toDepartmentBudget(row, expenses = []) {
  const budgetExpenses = expenses.filter((expense) => Number(expense.budgetId) === Number(row.id));
  const publishedExpenses = budgetExpenses.filter((expense) => expense.status === "published");
  const publishedSpentCents = publishedExpenses.reduce((sum, expense) => sum + expense.amountCents, 0);
  const enteredExpenseTotalCents = budgetExpenses.reduce((sum, expense) => sum + expense.amountCents, 0);
  const amountCents = Number(row.amount_cents || 0);

  return {
    id: Number(row.id),
    departmentName: row.department_name || "",
    title: row.title || "",
    amountCents,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    purpose: row.purpose || "",
    assignedTo: row.assigned_to ? Number(row.assigned_to) : null,
    assignedToName: row.assigned_to_name || "",
    assignedToEmail: row.assigned_to_email || "",
    status: row.status,
    createdBy: row.created_by ? Number(row.created_by) : null,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    spentCents: publishedSpentCents,
    enteredExpenseTotalCents,
    remainingCents: amountCents - publishedSpentCents,
    expenses: budgetExpenses
  };
}

async function listDepartmentBudgets({ includeAll = false, user = null, includeReceiptData = includeAll } = {}) {
  const userId = user?.id ? Number(user.id) : 0;
  const budgetsResult = await query(
    `
      SELECT department_budgets.*,
             assigned.full_name AS assigned_to_name,
             assigned.email AS assigned_to_email
      FROM department_budgets
      LEFT JOIN users assigned ON assigned.id = department_budgets.assigned_to
      WHERE ($1::boolean = true OR department_budgets.status = 'published')
      ORDER BY
        CASE department_budgets.status
          WHEN 'published' THEN 1
          WHEN 'draft' THEN 2
          ELSE 3
        END,
        department_budgets.department_name ASC,
        department_budgets.created_at DESC
      LIMIT 150
    `,
    [Boolean(includeAll)]
  );

  const expensesResult = await query(
    `
      SELECT department_budget_expenses.*,
             department_budgets.title AS budget_title,
             department_budgets.department_name AS budget_department_name,
             users.full_name AS created_by_name
      FROM department_budget_expenses
      JOIN department_budgets ON department_budgets.id = department_budget_expenses.budget_id
      LEFT JOIN users ON users.id = department_budget_expenses.created_by
      WHERE (
        $1::boolean = true
        OR (
          department_budgets.status = 'published'
          AND (
            department_budget_expenses.status = 'published'
            OR department_budgets.assigned_to = $2
          )
        )
      )
      ORDER BY department_budget_expenses.expense_date DESC, department_budget_expenses.created_at DESC
      LIMIT 500
    `,
    [Boolean(includeAll), userId]
  );

  const expenses = expensesResult.rows.map((row) => toDepartmentBudgetExpense(row, { includeReceiptData }));
  return budgetsResult.rows.map((row) => toDepartmentBudget(row, expenses));
}

async function getFinancialSummary() {
  const payments = await query(
    `
      SELECT
        COALESCE(SUM(amount_cents) FILTER (WHERE status = 'received'), 0)::bigint AS received_total_cents,
        COALESCE(SUM(amount_cents) FILTER (WHERE status = 'received' AND purpose = 'donation'), 0)::bigint AS donation_total_cents,
        COALESCE(SUM(amount_cents) FILTER (WHERE status = 'pending'), 0)::bigint AS pending_payment_total_cents,
        COALESCE(SUM(amount_cents) FILTER (WHERE status = 'received' AND purpose = 'donation' AND published_at IS NOT NULL), 0)::bigint AS published_donation_total_cents
      FROM payments
    `
  );
  const expenditures = await query(
    `
      SELECT
        COALESCE(SUM(amount_cents), 0)::bigint AS expenditure_total_cents,
        COALESCE(SUM(amount_cents) FILTER (WHERE status = 'published'), 0)::bigint AS published_expenditure_total_cents
      FROM expenditures
    `
  );
  const budgetExpenses = await query(
    `
      SELECT
        COALESCE(SUM(amount_cents), 0)::bigint AS budget_expense_total_cents,
        COALESCE(SUM(amount_cents) FILTER (WHERE status = 'published'), 0)::bigint AS published_budget_expense_total_cents
      FROM department_budget_expenses
    `
  );
  const budgets = await query(
    `
      SELECT
        COALESCE(SUM(amount_cents) FILTER (WHERE status <> 'closed'), 0)::bigint AS budget_allocation_cents,
        COALESCE(SUM(amount_cents) FILTER (WHERE status = 'published'), 0)::bigint AS published_budget_allocation_cents
      FROM department_budgets
    `
  );

  const paymentRow = payments.rows[0] || {};
  const expenditureRow = expenditures.rows[0] || {};
  const budgetExpenseRow = budgetExpenses.rows[0] || {};
  const budgetRow = budgets.rows[0] || {};
  const receivedTotalCents = Number(paymentRow.received_total_cents || 0);
  const expenditureTotalCents = Number(expenditureRow.expenditure_total_cents || 0);
  const budgetExpenseTotalCents = Number(budgetExpenseRow.budget_expense_total_cents || 0);
  const budgetAllocationCents = Number(budgetRow.budget_allocation_cents || 0);
  const publishedBudgetAllocationCents = Number(budgetRow.published_budget_allocation_cents || 0);

  return {
    receivedTotalCents,
    donationTotalCents: Number(paymentRow.donation_total_cents || 0),
    pendingPaymentTotalCents: Number(paymentRow.pending_payment_total_cents || 0),
    publishedDonationTotalCents: Number(paymentRow.published_donation_total_cents || 0),
    expenditureTotalCents,
    publishedExpenditureTotalCents: Number(expenditureRow.published_expenditure_total_cents || 0),
    budgetAllocationCents,
    publishedBudgetAllocationCents,
    budgetExpenseTotalCents,
    publishedBudgetExpenseTotalCents: Number(budgetExpenseRow.published_budget_expense_total_cents || 0),
    accountBalanceCents: receivedTotalCents - expenditureTotalCents - budgetAllocationCents
  };
}

async function listPublishedFinancials(user = null) {
  const donations = await query(
    `
      SELECT payments.*, users.full_name, users.email
      FROM payments
      LEFT JOIN users ON users.id = payments.user_id
      WHERE payments.purpose = 'donation'
        AND payments.status = 'received'
        AND payments.published_at IS NOT NULL
      ORDER BY payments.published_at DESC, payments.created_at DESC
      LIMIT 100
    `
  );

  const expenditures = await listExpenditures({ publishedOnly: true, limit: 100, includeReceiptData: false });
  const budgets = await listDepartmentBudgets({ user, includeReceiptData: false });
  const financialSummary = await getFinancialSummary();
  const donationRows = donations.rows.map((row) => ({
    id: Number(row.id),
    donorName: row.full_name || row.donor_name || "Anonymous donor",
    donorEmail: row.email || row.donor_email || "",
    amountCents: Number(row.amount_cents),
    note: publicPaymentNote(row.note),
    publishedAt: row.published_at,
    createdAt: row.created_at
  }));
  const donationTotalCents = donationRows.reduce((sum, item) => sum + item.amountCents, 0);
  const expenditureTotalCents = expenditures.reduce((sum, item) => sum + item.amountCents, 0);
  const publishedBudgetExpenseTotalCents = budgets.reduce((sum, budget) => sum + budget.spentCents, 0);
  const publishedBudgetAllocationCents = budgets
    .filter((budget) => budget.status === "published")
    .reduce((sum, budget) => sum + budget.amountCents, 0);

  return {
    donations: donationRows,
    expenditures,
    budgets,
    assignedBudgets: user ? budgets.filter((budget) => Number(budget.assignedTo) === Number(user.id)) : [],
    summary: {
      donationTotalCents,
      expenditureTotalCents,
      budgetAllocationCents: financialSummary.budgetAllocationCents,
      publishedBudgetAllocationCents,
      publishedBudgetExpenseTotalCents,
      publishedNetCents: donationTotalCents - expenditureTotalCents - publishedBudgetAllocationCents,
      receivedTotalCents: financialSummary.receivedTotalCents,
      accountBalanceCents: financialSummary.accountBalanceCents
    }
  };
}

async function listNotifications(user) {
  const { rows } = await query(
    `
      SELECT *
      FROM notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 30
    `,
    [user.id]
  );

  return rows.map((row) => ({
    id: Number(row.id),
    type: row.type,
    title: row.title,
    body: row.body || "",
    link: row.link || "",
    readAt: row.read_at,
    createdAt: row.created_at
  }));
}

async function listAdminNotifications({ userId = "", dateFrom = "", dateTo = "" } = {}) {
  const selectedUserId = userId ? Number(userId) : null;

  if (selectedUserId && (!Number.isInteger(selectedUserId) || selectedUserId <= 0)) {
    throw Object.assign(new Error("Invalid user filter."), { statusCode: 400 });
  }

  const { rows } = await query(
    `
      SELECT
        notifications.*,
        users.full_name AS user_name,
        users.email AS user_email
      FROM notifications
      JOIN users ON users.id = notifications.user_id
      WHERE ($1::bigint IS NULL OR notifications.user_id = $1)
        AND ($2::text = '' OR notifications.created_at >= $2::date)
        AND ($3::text = '' OR notifications.created_at < ($3::date + interval '1 day'))
      ORDER BY notifications.created_at DESC
      LIMIT 5000
    `,
    [selectedUserId, String(dateFrom || ""), String(dateTo || "")]
  );

  return rows.map((row) => ({
    id: Number(row.id),
    userId: Number(row.user_id),
    userName: row.user_name,
    userEmail: row.user_email,
    type: row.type,
    title: row.title,
    body: row.body || "",
    link: row.link || "",
    readAt: row.read_at,
    createdAt: row.created_at
  }));
}

async function listMembers() {
  const { rows } = await query(
    `
      SELECT
        id,
        email,
        first_name,
        last_name,
        full_name,
        phone,
        city,
        state,
        registration_statement,
        identity_document_name,
        identity_document_type,
        identity_document_size,
        identity_document_data_url,
        role,
        staff_role,
        staff_role_assigned_at,
        staff_role_revoked_at,
        staff_role_note,
        membership_status,
        password_must_change,
        policy_accepted_at,
        approved_at,
        rejected_at,
        rejection_reason,
        created_at
      FROM users
      ORDER BY created_at DESC
      LIMIT 200
    `
  );

  return rows.map((row) => ({
    id: Number(row.id),
    email: row.email,
    firstName: row.first_name || "",
    lastName: row.last_name || "",
    fullName: row.full_name,
    phone: row.phone || "",
    city: row.city || "",
    state: row.state || "",
    registrationStatement: row.registration_statement || "",
    identityDocument: {
      name: row.identity_document_name || "",
      type: row.identity_document_type || "",
      size: Number(row.identity_document_size || 0),
      dataUrl: row.identity_document_data_url || ""
    },
    role: row.role,
    staffRole: row.staff_role || "",
    effectiveRole: effectiveStaffRole(row) || row.role,
    hasMemberPortal: row.role === "member",
    staffRoleAssignedAt: row.staff_role_assigned_at,
    staffRoleRevokedAt: row.staff_role_revoked_at,
    staffRoleNote: row.staff_role_note || "",
    membershipStatus: row.membership_status,
    passwordMustChange: row.password_must_change,
    policyAcceptedAt: row.policy_accepted_at,
    approvedAt: row.approved_at,
    rejectedAt: row.rejected_at,
    rejectionReason: row.rejection_reason || "",
    createdAt: row.created_at
  }));
}

function membersForStaffSummary(members, staffUser) {
  if (effectiveStaffRole(staffUser) === "admin") return members;

  const canViewProfiles = hasStaffPermission(staffUser, "profile:view");

  return members.map((member) => ({
    id: member.id,
    email: member.email,
    firstName: member.firstName,
    lastName: member.lastName,
    fullName: member.fullName,
    phone: canViewProfiles ? member.phone : "",
    city: canViewProfiles ? member.city : "",
    state: canViewProfiles ? member.state : "",
    registrationStatement: "",
    identityDocument: {
      name: "",
      type: "",
      size: 0,
      dataUrl: ""
    },
    role: member.role,
    staffRole: member.staffRole || "",
    effectiveRole: member.effectiveRole || member.role,
    hasMemberPortal: member.hasMemberPortal,
    staffRoleAssignedAt: member.staffRoleAssignedAt,
    staffRoleRevokedAt: member.staffRoleRevokedAt,
    staffRoleNote: canViewProfiles ? member.staffRoleNote : "",
    membershipStatus: member.membershipStatus,
    passwordMustChange: member.passwordMustChange,
    policyAcceptedAt: member.policyAcceptedAt,
    approvedAt: member.approvedAt,
    rejectedAt: member.rejectedAt,
    rejectionReason: canViewProfiles ? member.rejectionReason : "",
    createdAt: member.createdAt
  }));
}

function firstSaturdayFromMonth(monthValue) {
  const match = String(monthValue || "").trim().match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    throw Object.assign(new Error("Choose a valid meeting month."), { statusCode: 400 });
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const firstDay = new Date(Date.UTC(year, monthIndex, 1));
  const daysUntilSaturday = (6 - firstDay.getUTCDay() + 7) % 7;
  firstDay.setUTCDate(firstDay.getUTCDate() + daysUntilSaturday);
  return firstDay.toISOString().slice(0, 10);
}

function normalizeSocialMeetingDate(payload = {}) {
  if (payload.meetingDate) {
    const date = new Date(`${payload.meetingDate}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) {
      throw Object.assign(new Error("Choose a valid meeting date."), { statusCode: 400 });
    }
    return date.toISOString().slice(0, 10);
  }
  return firstSaturdayFromMonth(payload.meetingMonth);
}

function normalizeSocialTaskType(value) {
  return ["food", "drinks", "host", "setup", "cleanup", "other"].includes(value) ? value : "other";
}

function defaultSocialGroup(taskType) {
  if (taskType === "food") return "women";
  if (taskType === "drinks") return "men";
  return "general";
}

function normalizeSocialMeetingStatus(value) {
  return ["draft", "published", "completed", "cancelled"].includes(value) ? value : "draft";
}

function normalizeSocialAssignmentStatus(value) {
  return ["assigned", "completed", "cancelled", "archived"].includes(value) ? value : "assigned";
}

function normalizeResourceStatus(value) {
  return value === "retired" ? "retired" : "active";
}

function normalizeResourceRequestStatus(value) {
  if (value === "returned") return "checked_in";
  return ["approved", "delivered", "checked_in", "declined"].includes(value) ? value : "pending";
}

function resourceRequestReservesInventory(status) {
  return ["approved", "delivered"].includes(status);
}

function normalizeFundRequestStatus(value) {
  return ["approved", "rejected"].includes(value) ? value : "pending";
}

function toSocialResource(row) {
  return {
    id: Number(row.id),
    name: row.name,
    description: row.description || "",
    totalQuantity: Number(row.total_quantity || 0),
    availableQuantity: Number(row.available_quantity || 0),
    storageLocation: row.storage_location || "",
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toSocialResourceAdjustment(row) {
  return {
    id: Number(row.id),
    resourceId: Number(row.resource_id),
    resourceName: row.resource_name || "",
    adjustmentType: row.adjustment_type,
    quantity: Number(row.quantity || 0),
    note: row.note || "",
    adjustedBy: row.adjusted_by ? Number(row.adjusted_by) : null,
    adjustedByName: row.adjusted_by_name || "",
    createdAt: row.created_at
  };
}

function toSocialAssignment(row) {
  return {
    id: Number(row.id),
    meetingId: Number(row.meeting_id),
    userId: row.user_id ? Number(row.user_id) : null,
    memberName: row.member_name || "Unassigned",
    memberEmail: row.member_email || "",
    taskType: row.task_type,
    groupName: row.group_name || defaultSocialGroup(row.task_type),
    title: row.title,
    note: row.note || "",
    status: row.status,
    foodContribution: row.food_contribution || "",
    drinkBottleCount: Number(row.drink_bottle_count || 0),
    drinkIsAlcoholic: Boolean(row.drink_is_alcoholic),
    drinkBrand: row.drink_brand || "",
    responseNote: row.response_note || "",
    respondedAt: row.responded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at
  };
}

function toSocialFundRequest(row) {
  return {
    id: Number(row.id),
    meetingId: row.meeting_id ? Number(row.meeting_id) : null,
    meetingTitle: row.meeting_title || "",
    meetingDate: row.meeting_date || null,
    assignmentId: row.assignment_id ? Number(row.assignment_id) : null,
    assignmentTitle: row.assignment_title || "",
    taskType: row.task_type || "",
    requestedBy: Number(row.requested_by),
    requesterName: row.requester_name || "",
    requesterEmail: row.requester_email || "",
    itemDescription: row.item_description || "",
    amountCents: Number(row.amount_cents || 0),
    reason: row.reason || "",
    status: row.status,
    adminNote: row.admin_note || "",
    reviewedBy: row.reviewed_by ? Number(row.reviewed_by) : null,
    reviewedAt: row.reviewed_at,
    deliveredAt: row.delivered_at,
    checkedInAt: row.checked_in_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toSocialResourceRequest(row) {
  return {
    id: Number(row.id),
    meetingId: row.meeting_id ? Number(row.meeting_id) : null,
    meetingTitle: row.meeting_title || "",
    meetingDate: row.meeting_date || null,
    resourceId: Number(row.resource_id),
    resourceName: row.resource_name || "",
    requestedBy: Number(row.requested_by),
    requesterName: row.requester_name || "",
    requesterEmail: row.requester_email || "",
    quantity: Number(row.quantity || 0),
    neededDate: row.needed_date,
    returnDate: row.return_date,
    status: row.status,
    note: row.note || "",
    adminNote: row.admin_note || "",
    reviewedBy: row.reviewed_by ? Number(row.reviewed_by) : null,
    reviewedAt: row.reviewed_at,
    deliveredAt: row.delivered_at,
    checkedInAt: row.checked_in_at,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toSocialMeeting(row, assignments = [], resourceRequests = []) {
  return {
    id: Number(row.id),
    title: row.title,
    meetingDate: row.meeting_date,
    location: row.location || "",
    notes: row.notes || "",
    status: row.status,
    announcementId: row.announcement_id ? Number(row.announcement_id) : null,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    assignments: assignments.filter((assignment) => Number(assignment.meetingId) === Number(row.id)),
    resourceRequests: resourceRequests.filter((request) => Number(request.meetingId) === Number(row.id))
  };
}

async function archivePastSocialItems() {
  await query(
    `
      UPDATE social_assignments
      SET status = 'archived',
          archived_at = COALESCE(archived_at, now()),
          updated_at = now()
      FROM social_meetings
      WHERE social_assignments.meeting_id = social_meetings.id
        AND social_meetings.meeting_date < CURRENT_DATE
        AND social_assignments.status IN ('assigned', 'completed')
    `
  );

  await query(
    `
      UPDATE social_meetings
      SET status = 'completed',
          updated_at = now()
      WHERE meeting_date < CURRENT_DATE
        AND status IN ('draft', 'published')
    `
  );

  await query(
    `
      UPDATE social_resource_requests
      SET status = 'checked_in',
          checked_in_at = COALESCE(checked_in_at, updated_at, now()),
          archived_at = COALESCE(archived_at, checked_in_at, updated_at, now()),
          updated_at = now()
      WHERE status IN ('checked_in', 'returned')
        AND archived_at IS NULL
    `
  );
}

async function listSocialCoordinator(user, { includeAll = false } = {}) {
  await archivePastSocialItems();

  const meetingsResult = await query(
    `
      SELECT *
      FROM social_meetings
      WHERE ($1::boolean = true OR (status = 'published' AND meeting_date >= CURRENT_DATE))
      ORDER BY meeting_date DESC
      LIMIT 36
    `,
    [Boolean(includeAll)]
  );
  const resourcesResult = await query(
    `
      SELECT *
      FROM social_resources
      WHERE ($1::boolean = true OR status = 'active')
      ORDER BY status ASC, name ASC
      LIMIT 100
    `,
    [Boolean(includeAll)]
  );
  const adjustmentsResult = includeAll
    ? await query(
        `
          SELECT social_resource_adjustments.*,
                 social_resources.name AS resource_name,
                 users.full_name AS adjusted_by_name
          FROM social_resource_adjustments
          JOIN social_resources ON social_resources.id = social_resource_adjustments.resource_id
          LEFT JOIN users ON users.id = social_resource_adjustments.adjusted_by
          ORDER BY social_resource_adjustments.created_at DESC
          LIMIT 150
        `
      )
    : { rows: [] };
  const assignmentsResult = await query(
    `
      SELECT social_assignments.*, users.full_name AS member_name, users.email AS member_email
      FROM social_assignments
      LEFT JOIN users ON users.id = social_assignments.user_id
      JOIN social_meetings ON social_meetings.id = social_assignments.meeting_id
      WHERE (
        $1::boolean = true
        OR (
          social_assignments.status <> 'archived'
          AND social_assignments.archived_at IS NULL
          AND social_meetings.status = 'published'
          AND social_meetings.meeting_date >= CURRENT_DATE
        )
      )
      ORDER BY social_meetings.meeting_date DESC, social_assignments.task_type ASC, social_assignments.created_at ASC
      LIMIT 500
    `,
    [Boolean(includeAll)]
  );
  const requestsResult = includeAll
    ? await query(
        `
          SELECT social_resource_requests.*,
                 social_resources.name AS resource_name,
                 social_meetings.title AS meeting_title,
                 social_meetings.meeting_date,
                 users.full_name AS requester_name,
                 users.email AS requester_email
          FROM social_resource_requests
          JOIN social_resources ON social_resources.id = social_resource_requests.resource_id
          JOIN users ON users.id = social_resource_requests.requested_by
          LEFT JOIN social_meetings ON social_meetings.id = social_resource_requests.meeting_id
          ORDER BY social_resource_requests.created_at DESC
          LIMIT 300
        `
      )
    : await query(
        `
          SELECT social_resource_requests.*,
                 social_resources.name AS resource_name,
                 social_meetings.title AS meeting_title,
                 social_meetings.meeting_date,
                 users.full_name AS requester_name,
                 users.email AS requester_email
          FROM social_resource_requests
          JOIN social_resources ON social_resources.id = social_resource_requests.resource_id
          JOIN users ON users.id = social_resource_requests.requested_by
          LEFT JOIN social_meetings ON social_meetings.id = social_resource_requests.meeting_id
          WHERE social_resource_requests.requested_by = $1
            AND social_resource_requests.archived_at IS NULL
          ORDER BY social_resource_requests.created_at DESC
          LIMIT 100
        `,
        [user.id]
      );
  const fundRequestsResult = includeAll
    ? await query(
        `
          SELECT social_fund_requests.*,
                 social_meetings.title AS meeting_title,
                 social_meetings.meeting_date,
                 social_assignments.title AS assignment_title,
                 social_assignments.task_type,
                 users.full_name AS requester_name,
                 users.email AS requester_email
          FROM social_fund_requests
          JOIN users ON users.id = social_fund_requests.requested_by
          LEFT JOIN social_meetings ON social_meetings.id = social_fund_requests.meeting_id
          LEFT JOIN social_assignments ON social_assignments.id = social_fund_requests.assignment_id
          ORDER BY social_fund_requests.created_at DESC
          LIMIT 300
        `
      )
    : await query(
        `
          SELECT social_fund_requests.*,
                 social_meetings.title AS meeting_title,
                 social_meetings.meeting_date,
                 social_assignments.title AS assignment_title,
                 social_assignments.task_type,
                 users.full_name AS requester_name,
                 users.email AS requester_email
          FROM social_fund_requests
          JOIN users ON users.id = social_fund_requests.requested_by
          LEFT JOIN social_meetings ON social_meetings.id = social_fund_requests.meeting_id
          LEFT JOIN social_assignments ON social_assignments.id = social_fund_requests.assignment_id
          WHERE social_fund_requests.requested_by = $1
          ORDER BY social_fund_requests.created_at DESC
          LIMIT 100
        `,
        [user.id]
      );

  const assignments = assignmentsResult.rows.map(toSocialAssignment);
  const requests = requestsResult.rows.map(toSocialResourceRequest);
  const fundRequests = fundRequestsResult.rows.map(toSocialFundRequest);

  return {
    meetings: meetingsResult.rows.map((row) => toSocialMeeting(row, assignments, requests)),
    resources: resourcesResult.rows.map(toSocialResource),
    resourceAdjustments: adjustmentsResult.rows.map(toSocialResourceAdjustment),
    resourceRequests: requests,
    fundRequests
  };
}

async function getSocialFundRequest(id) {
  const { rows } = await query(
    `
      SELECT social_fund_requests.*,
             social_meetings.title AS meeting_title,
             social_meetings.meeting_date,
             social_assignments.title AS assignment_title,
             social_assignments.task_type,
             users.full_name AS requester_name,
             users.email AS requester_email
      FROM social_fund_requests
      JOIN users ON users.id = social_fund_requests.requested_by
      LEFT JOIN social_meetings ON social_meetings.id = social_fund_requests.meeting_id
      LEFT JOIN social_assignments ON social_assignments.id = social_fund_requests.assignment_id
      WHERE social_fund_requests.id = $1
      LIMIT 1
    `,
    [id]
  );

  return rows[0] ? toSocialFundRequest(rows[0]) : null;
}

function socialTaskLabel(taskType) {
  const labels = {
    food: "Food team",
    drinks: "Drinks team",
    host: "Meeting host",
    setup: "Setup",
    cleanup: "Cleanup",
    other: "Other"
  };
  return labels[taskType] || "Other";
}

function socialAssignmentResponseDetails(assignment) {
  const taskType = assignment.taskType || assignment.task_type;
  const foodContribution = String(assignment.foodContribution || assignment.food_contribution || "").trim();
  const drinkBottleCount = Number(assignment.drinkBottleCount ?? assignment.drink_bottle_count ?? 0);
  const drinkBrand = String(assignment.drinkBrand || assignment.drink_brand || "").trim();
  const drinkIsAlcoholic = assignment.drinkIsAlcoholic ?? assignment.drink_is_alcoholic;
  const responseNote = String(assignment.responseNote || assignment.response_note || "").trim();
  const details = [];

  if ((taskType === "food" || foodContribution) && foodContribution) {
    details.push(`Dishes: ${foodContribution}`);
  }

  if ((taskType === "drinks" || drinkBottleCount > 0 || drinkBrand) && (drinkBottleCount > 0 || drinkBrand)) {
    const drinkDetails = [];
    if (drinkBottleCount > 0) {
      drinkDetails.push(`${drinkBottleCount} bottle${drinkBottleCount === 1 ? "" : "s"}`);
    }
    drinkDetails.push(drinkIsAlcoholic ? "alcoholic" : "non-alcoholic");
    if (drinkBrand) {
      drinkDetails.push(`Brands: ${drinkBrand}`);
    }
    details.push(`Drinks: ${drinkDetails.join(", ")}`);
  }

  if (responseNote) {
    details.push(`Member note: ${responseNote}`);
  }

  return details.join("; ");
}

function buildSocialAnnouncementBody(meeting, assignments, requests) {
  const assignmentLines = assignments.length
    ? assignments.map((assignment) => {
        const taskType = assignment.taskType || assignment.task_type;
        const groupName = assignment.groupName || assignment.group_name;
        const group = groupName ? ` (${groupName})` : "";
        const name = assignment.memberName || assignment.member_name || "Unassigned";
        const note = assignment.note ? ` - ${assignment.note}` : "";
        const responseDetails = socialAssignmentResponseDetails(assignment);
        return `- ${socialTaskLabel(taskType)}${group}: ${name}${note}${responseDetails ? ` | ${responseDetails}` : ""}`;
      })
    : ["- No assignments have been added yet."];

  const activeResourceRequests = requests.filter((request) => ["approved", "delivered"].includes(request.status));
  const requestLines = activeResourceRequests.length
    ? requests
        .filter((request) => ["approved", "delivered"].includes(request.status))
        .map((request) => {
          const resourceName = request.resourceName || request.resource_name;
          const requesterName = request.requesterName || request.requester_name;
          const statusLabel = request.status === "delivered" ? "delivered to" : "approved for";
          return `- ${resourceName}: ${request.quantity} ${statusLabel} ${requesterName}`;
        })
    : ["- No approved resource requests yet."];

  return [
    `${meeting.title} is scheduled for ${meeting.meeting_date}.`,
    meeting.location ? `Location: ${meeting.location}` : "",
    meeting.notes ? `Notes: ${meeting.notes}` : "",
    "",
    "Assignments:",
    ...assignmentLines,
    "",
    "Approved resource requests:",
    ...requestLines
  ].filter((line) => line !== "").join("\n");
}

const routeContext = {
  config,
  query,
  withTransaction,
  hashPassword,
  verifyPassword,
  createSessionToken,
  hashSessionToken,
  parseCookies,
  sessionCookieName,
  buildSessionCookie,
  sendJson,
  sendNoContent,
  sendError,
  toUser,
  readJson,
  requireFields,
  normalizeEmail,
  normalizeUserRole,
  normalizeStaffRole,
  effectiveStaffRole,
  hasStaffPermission,
  parseId,
  dollarsToCents,
  centsToDollarAmount,
  normalizePaymentMethod,
  normalizePaymentRecordDetails,
  validateIdentityDocument,
  validateImageUpload,
  validateReceiptUpload,
  buildFullName,
  isLockedStatus,
  isOnboardingUser,
  createNotification,
  notifyAdmins,
  createSession,
  requireUser,
  requireActiveUser,
  requireAdmin,
  requireStaffPermission,
  createAnnouncementNotifications,
  notifyActiveMembers,
  listAnnouncements,
  listAdminAnnouncements,
  toLeadershipPosition,
  normalizeLeadershipStatus,
  toPublicAboutArticle,
  cleanupExpiredHiddenAboutArticles,
  getAboutContent,
  listEvents,
  listAdminEvents,
  archiveExpiredEvents,
  listQuestions,
  closeExpiredBallots,
  listBallots,
  listPayments,
  toPaymentDetail,
  paymentDetailSnapshot,
  listOrganizationPaymentDetails,
  requireEnabledPaymentDetail,
  toExpenditure,
  listExpenditures,
  normalizeDepartmentBudgetStatus,
  normalizeDepartmentBudgetExpenseStatus,
  toDepartmentBudgetExpense,
  toDepartmentBudget,
  listDepartmentBudgets,
  getFinancialSummary,
  listPublishedFinancials,
  listNotifications,
  listAdminNotifications,
  listMembers,
  membersForStaffSummary,
  normalizeSocialMeetingDate,
  normalizeSocialTaskType,
  defaultSocialGroup,
  normalizeSocialMeetingStatus,
  normalizeSocialAssignmentStatus,
  normalizeResourceStatus,
  normalizeResourceRequestStatus,
  resourceRequestReservesInventory,
  normalizeFundRequestStatus,
  toSocialResource,
  toSocialResourceAdjustment,
  toSocialAssignment,
  toSocialFundRequest,
  toSocialResourceRequest,
  toSocialMeeting,
  archivePastSocialItems,
  listSocialCoordinator,
  getSocialFundRequest,
  socialTaskLabel,
  buildSocialAnnouncementBody
};

const apiRouteHandlers = [
  handlePublicRoutes,
  handleContentRoutes,
  handleSocialRoutes,
  handleFinancialRoutes,
  handleAboutRoutes,
  handleNotificationRoutes
];

async function handleApi(req, res, url) {
  for (const handler of apiRouteHandlers) {
    await handler(req, res, url, routeContext);
    if (res.writableEnded) return;
  }

  return sendError(res, 404, "API route not found.");
}

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);

  if (pathname === "/") {
    pathname = "/index.html";
  }

  const requestedPath = normalize(join(publicDir, pathname));

  if (!requestedPath.startsWith(publicDir)) {
    sendError(res, 403, "Forbidden.");
    return;
  }

  try {
    const filePath = pathname.includes(".") ? requestedPath : join(publicDir, "index.html");
    await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream"
    });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    createReadStream(join(publicDir, "index.html")).pipe(res);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    await serveStatic(req, res, url);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) {
      console.error(error);
    }
    sendError(res, statusCode, error.message || "Unexpected server error.");
  }
});

await runSchemaMigration();
const defaultAdmin = await bootstrapDefaultAdmin();
console.log(`Default admin checked: ${defaultAdmin.email}`);

server.listen(config.port, () => {
  console.log(`237 Ville is running at http://localhost:${config.port}`);
  console.log(`237 Ville public app URL: ${config.appUrl}`);
});
