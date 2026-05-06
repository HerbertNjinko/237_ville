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

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");
const paymentMethods = new Set(["cash", "cash_app", "venmo", "zelle", "paypal", "cheque", "bank_account"]);

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
      WHERE role = 'admin'
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
  if (user.role !== "admin" || !isPortalReady(user)) {
    sendError(res, 403, "Admin access is required.");
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

function toExpenditure(row) {
  return {
    id: Number(row.id),
    title: row.title,
    category: row.category || "",
    vendor: row.vendor || "",
    amountCents: Number(row.amount_cents),
    expenseDate: row.expense_date,
    note: row.note || "",
    status: row.status,
    createdBy: row.created_by ? Number(row.created_by) : null,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function listExpenditures({ publishedOnly = false, limit = 100 } = {}) {
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

  return rows.map(toExpenditure);
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

  const paymentRow = payments.rows[0] || {};
  const expenditureRow = expenditures.rows[0] || {};
  const receivedTotalCents = Number(paymentRow.received_total_cents || 0);
  const expenditureTotalCents = Number(expenditureRow.expenditure_total_cents || 0);

  return {
    receivedTotalCents,
    donationTotalCents: Number(paymentRow.donation_total_cents || 0),
    pendingPaymentTotalCents: Number(paymentRow.pending_payment_total_cents || 0),
    publishedDonationTotalCents: Number(paymentRow.published_donation_total_cents || 0),
    expenditureTotalCents,
    publishedExpenditureTotalCents: Number(expenditureRow.published_expenditure_total_cents || 0),
    accountBalanceCents: receivedTotalCents - expenditureTotalCents
  };
}

async function listPublishedFinancials() {
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

  const expenditures = await listExpenditures({ publishedOnly: true, limit: 100 });
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

  return {
    donations: donationRows,
    expenditures,
    summary: {
      donationTotalCents,
      expenditureTotalCents,
      publishedNetCents: donationTotalCents - expenditureTotalCents
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
    membershipStatus: row.membership_status,
    passwordMustChange: row.password_must_change,
    policyAcceptedAt: row.policy_accepted_at,
    approvedAt: row.approved_at,
    rejectedAt: row.rejected_at,
    rejectionReason: row.rejection_reason || "",
    createdAt: row.created_at
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

function normalizeResourceStatus(value) {
  return value === "retired" ? "retired" : "active";
}

function normalizeResourceRequestStatus(value) {
  return ["approved", "declined", "returned"].includes(value) ? value : "pending";
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
    updatedAt: row.updated_at
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

async function listSocialCoordinator(user, { includeAll = false } = {}) {
  const meetingsResult = await query(
    `
      SELECT *
      FROM social_meetings
      WHERE ($1::boolean = true OR status IN ('published', 'completed'))
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
  const assignmentsResult = await query(
    `
      SELECT social_assignments.*, users.full_name AS member_name, users.email AS member_email
      FROM social_assignments
      LEFT JOIN users ON users.id = social_assignments.user_id
      JOIN social_meetings ON social_meetings.id = social_assignments.meeting_id
      WHERE ($1::boolean = true OR social_meetings.status IN ('published', 'completed') OR social_assignments.user_id = $2)
      ORDER BY social_meetings.meeting_date DESC, social_assignments.task_type ASC, social_assignments.created_at ASC
      LIMIT 500
    `,
    [Boolean(includeAll), user.id]
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

  const requestLines = requests.filter((request) => request.status === "approved").length
    ? requests
        .filter((request) => request.status === "approved")
        .map((request) => `- ${request.resource_name}: ${request.quantity} approved for ${request.requester_name}`)
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

async function handleApi(req, res, url) {
  const method = req.method || "GET";
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/api/payment-details") {
    return sendJson(res, 200, { paymentDetails: await listOrganizationPaymentDetails() });
  }

  if (method === "GET" && pathname === "/api/about") {
    return sendJson(res, 200, { about: await getAboutContent() });
  }

  if (method === "POST" && pathname === "/api/auth/register") {
    const payload = await readJson(req);
    requireFields(payload, ["email", "firstName", "lastName", "registrationStatement"]);

    const email = normalizeEmail(payload.email);
    const firstName = String(payload.firstName).trim();
    const lastName = String(payload.lastName).trim();
    const fullName = buildFullName(firstName, lastName);
    const registrationStatement = String(payload.registrationStatement).trim();
    const identityDocument = validateIdentityDocument(payload.identityDocument);
    const passwordHash = await hashPassword(createSessionToken());

    if (registrationStatement.length < 40) {
      return sendError(res, 400, "Tell us more about who you are and why you want to join. Please enter at least 40 characters.");
    }

    try {
      const { rows } = await query(
        `
          INSERT INTO users (
            email,
            password_hash,
            first_name,
            last_name,
            full_name,
            registration_statement,
            identity_document_name,
            identity_document_type,
            identity_document_size,
            identity_document_data_url,
            role,
            membership_status,
            password_must_change
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'member', 'pending_approval', TRUE)
          RETURNING *
        `,
        [
          email,
          passwordHash,
          firstName,
          lastName,
          fullName,
          registrationStatement,
          identityDocument.name,
          identityDocument.type,
          identityDocument.size,
          identityDocument.dataUrl
        ]
      );

      await notifyAdmins(
        "account_request",
        "New member registration request",
        `${fullName} (${email}) submitted an application and ID card for validation.`,
        "/admin"
      );

      return sendJson(res, 201, {
        message: "Registration submitted. An admin will validate your application and ID card before approval.",
        user: toUser(rows[0])
      });
    } catch (error) {
      if (error.code === "23505") {
        return sendError(res, 409, "An account with this email already exists.");
      }
      throw error;
    }
  }

  if (method === "POST" && pathname === "/api/donations/anonymous") {
    const payload = await readJson(req);
    const amountCents = dollarsToCents(payload.amount);
    const donorName = String(payload.donorName || "").trim();
    const donorEmail = normalizeEmail(payload.donorEmail || "");
    const donorNote = String(payload.note || "").trim();
    const paymentMethod = normalizePaymentMethod(payload.method);
    const paymentDetails = normalizePaymentRecordDetails(payload);
    const organizationPaymentDetail = await requireEnabledPaymentDetail(paymentMethod);
    const reviewNote = config.dwolla.enabled
      ? "Dwolla sandbox donation record submitted for admin review."
      : "Donation record submitted for admin review.";
    const note = [donorNote, reviewNote].filter(Boolean).join("\n");
    const { rows } = await query(
      `
        INSERT INTO payments (
          user_id,
          purpose,
          amount_cents,
          method,
          note,
          external_reference,
          donor_name,
          donor_email,
          dwolla_transfer_url,
          processor_status,
          payment_details,
          payment_detail_snapshot
        )
        VALUES (NULL, 'donation', $1, $2, $3, '', $4, $5, '', 'pending_admin_review', $6::jsonb, $7)
        RETURNING *
      `,
      [
        amountCents,
        paymentMethod,
        note,
        donorName,
        donorEmail,
        JSON.stringify(paymentDetails),
        paymentDetailSnapshot(organizationPaymentDetail)
      ]
    );

    await notifyAdmins(
      "donation",
      "Anonymous donation submitted",
      `${donorName || "Anonymous donor"} submitted a $${centsToDollarAmount(amountCents)} donation for review.`,
      "/admin"
    );

    return sendJson(res, 201, {
      message: "Donation submitted for admin review.",
      payment: rows[0],
      processorStatus: "pending_admin_review"
    });
  }

  if (method === "POST" && pathname === "/api/auth/login") {
    const payload = await readJson(req);
    requireFields(payload, ["email", "password"]);
    const email = normalizeEmail(payload.email);
    const { rows } = await query("SELECT * FROM users WHERE email = $1 LIMIT 1", [email]);
    const user = rows[0];

    if (!user || !(await verifyPassword(payload.password, user.password_hash))) {
      return sendError(res, 401, "Email or password is incorrect.");
    }

    if (user.membership_status === "pending_approval") {
      return sendError(res, 403, "Your account request is waiting for admin approval.");
    }

    if (user.membership_status === "rejected") {
      const reason = user.rejection_reason ? ` Reason: ${user.rejection_reason}` : "";
      return sendError(res, 403, `Your account request was rejected.${reason}`);
    }

    if (isLockedStatus(user.membership_status)) {
      return sendError(res, 403, "This account is not active.");
    }

    const token = await createSession(user.id);
    return sendJson(res, 200, { user: toUser(user) }, { "Set-Cookie": buildSessionCookie(token) });
  }

  if (method === "POST" && pathname === "/api/auth/logout") {
    const cookies = parseCookies(req.headers.cookie || "");
    const token = cookies[sessionCookieName];

    if (token) {
      await query("DELETE FROM sessions WHERE token_hash = $1", [hashSessionToken(token)]);
    }

    return sendNoContent(res, { "Set-Cookie": buildSessionCookie("", { clear: true }) });
  }

  if (method === "POST" && pathname === "/api/auth/change-password") {
    const user = await requireUser(req, res);
    if (!user) return;
    const payload = await readJson(req);
    requireFields(payload, ["newPassword"]);

    if (String(payload.newPassword).length < 8) {
      return sendError(res, 400, "New password must be at least 8 characters.");
    }

    const passwordHash = await hashPassword(payload.newPassword);
    const { rows } = await query(
      `
        UPDATE users
        SET password_hash = $2,
            password_must_change = FALSE,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [user.id, passwordHash]
    );

    return sendJson(res, 200, { user: toUser(rows[0]) });
  }

  if (method === "GET" && pathname === "/api/me") {
    const user = await requireUser(req, res);
    if (!user) return;
    return sendJson(res, 200, { user });
  }

  if (method === "PATCH" && pathname === "/api/me") {
    const user = await requireActiveUser(req, res);
    if (!user) return;
    const payload = await readJson(req);
    const firstName = String(payload.firstName || user.firstName || "").trim();
    const lastName = String(payload.lastName || user.lastName || "").trim();
    const fullName = buildFullName(firstName, lastName) || String(payload.fullName || user.fullName).trim();

    const { rows } = await query(
      `
        UPDATE users
        SET
          first_name = $2,
          last_name = $3,
          full_name = $4,
          phone = $5,
          address = $6,
          city = $7,
          state = $8,
          bio = $9,
          notification_opt_in = $10,
          updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [
        user.id,
        firstName,
        lastName,
        fullName,
        String(payload.phone || ""),
        String(payload.address || ""),
        String(payload.city || ""),
        String(payload.state || ""),
        String(payload.bio || ""),
        Boolean(payload.notificationOptIn)
      ]
    );

    return sendJson(res, 200, { user: toUser(rows[0]) });
  }

  if (method === "GET" && pathname === "/api/dashboard") {
    const user = await requireUser(req, res);
    if (!user) return;

    const [notifications, payments, paymentDetails] = await Promise.all([
      listNotifications(user),
      listPayments(user),
      listOrganizationPaymentDetails()
    ]);

    if (isOnboardingUser(user)) {
      return sendJson(res, 200, {
        user,
        onboarding: true,
        policy: config.organizationPolicy,
        registrationFeeCents: config.registrationFeeCents,
        paymentDetails,
        payments,
        notifications,
        announcements: [],
        events: [],
        questions: [],
        ballots: [],
        social: { meetings: [], resources: [], resourceRequests: [], fundRequests: [] },
        financials: { donations: [], expenditures: [], summary: { donationTotalCents: 0, expenditureTotalCents: 0, publishedNetCents: 0 } }
      });
    }

    const [announcements, events, questions, ballots, financials, social] = await Promise.all([
      listAnnouncements(10),
      listEvents(10),
      listQuestions(),
      listBallots(user, { includeDrafts: user.role === "admin" }),
      listPublishedFinancials(),
      listSocialCoordinator(user, { includeAll: user.role === "admin" })
    ]);

    return sendJson(res, 200, {
      user,
      onboarding: false,
      announcements,
      events,
      questions,
      ballots,
      social,
      financials,
      paymentDetails,
      payments,
      notifications
    });
  }

  if (method === "POST" && pathname === "/api/onboarding/policy") {
    const user = await requireUser(req, res);
    if (!user) return;

    if (user.passwordMustChange) {
      return sendError(res, 403, "Update your temporary password before signing the policy.");
    }

    if (user.role !== "member" || user.membershipStatus !== "pending_policy") {
      return sendError(res, 400, "This account is not waiting for policy acknowledgement.");
    }

    const payload = await readJson(req);
    requireFields(payload, ["signatureName"]);
    const signatureName = String(payload.signatureName).trim();

    const { rows } = await query(
      `
        UPDATE users
        SET policy_accepted_at = now(),
            policy_signature_name = $2,
            policy_version = $3,
            membership_status = 'pending_fee',
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [user.id, signatureName, config.organizationPolicy.version]
    );

    await createNotification(
      user.id,
      "policy",
      "Policy acknowledged",
      "Your 237 Ville policy acknowledgement was recorded. Submit your registration fee for admin review.",
      "/payments"
    );

    return sendJson(res, 200, { user: toUser(rows[0]) });
  }

  if (method === "POST" && pathname === "/api/onboarding/registration-fee") {
    const user = await requireUser(req, res);
    if (!user) return;

    if (user.passwordMustChange) {
      return sendError(res, 403, "Update your temporary password before submitting the registration fee.");
    }

    if (user.role !== "member" || user.membershipStatus !== "pending_fee") {
      return sendError(res, 400, "This account is not waiting for a registration fee.");
    }

    const existing = await query(
      `
        SELECT *
        FROM payments
        WHERE user_id = $1
          AND purpose = 'registration_fee'
          AND status IN ('pending', 'received')
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [user.id]
    );

    if (existing.rows[0]?.status === "received") {
      const { rows } = await query(
        `
          UPDATE users
          SET membership_status = 'active',
              updated_at = now()
          WHERE id = $1
          RETURNING *
        `,
        [user.id]
      );
      return sendJson(res, 200, { user: toUser(rows[0]), payment: existing.rows[0] });
    }

    if (existing.rows.length > 0) {
      return sendError(res, 409, "A registration fee payment is already waiting for admin review.");
    }

    const payload = await readJson(req);
    const paymentMethod = normalizePaymentMethod(payload.method);
    const paymentDetails = normalizePaymentRecordDetails(payload);
    const organizationPaymentDetail = await requireEnabledPaymentDetail(paymentMethod);
    const { rows } = await query(
      `
        INSERT INTO payments (
          user_id,
          purpose,
          amount_cents,
          method,
          note,
          external_reference,
          payment_details,
          payment_detail_snapshot
        )
        VALUES ($1, 'registration_fee', $2, $3, $4, $5, $6::jsonb, $7)
        RETURNING *
      `,
      [
        user.id,
        config.registrationFeeCents,
        paymentMethod,
        String(payload.note || "").trim(),
        String(payload.externalReference || "").trim(),
        JSON.stringify(paymentDetails),
        paymentDetailSnapshot(organizationPaymentDetail)
      ]
    );

    await notifyAdmins(
      "registration_fee",
      "Registration fee submitted",
      `${user.fullName} submitted a registration fee record for review.`,
      "/admin"
    );

    return sendJson(res, 201, { payment: rows[0] });
  }

  if (method === "GET" && pathname === "/api/announcements") {
    const user = await requireActiveUser(req, res);
    if (!user) return;
    return sendJson(res, 200, { announcements: await listAnnouncements(50) });
  }

  if (method === "POST" && pathname === "/api/admin/announcements") {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const payload = await readJson(req);
    requireFields(payload, ["title", "body"]);

    const status = payload.status === "draft" ? "draft" : "published";
    const { rows } = await query(
      `
        INSERT INTO announcements (title, body, category, status, created_by, published_at)
        VALUES ($1, $2, $3, $4, $5, CASE WHEN $4 = 'published' THEN now() ELSE NULL END)
        RETURNING *
      `,
      [
        String(payload.title).trim(),
        String(payload.body).trim(),
        String(payload.category || "announcement").trim(),
        status,
        admin.id
      ]
    );

    if (status === "published") {
      await createAnnouncementNotifications(rows[0]);
    }

    return sendJson(res, 201, { announcement: rows[0] });
  }

  if (method === "GET" && pathname === "/api/events") {
    const user = await requireActiveUser(req, res);
    if (!user) return;
    return sendJson(res, 200, { events: await listEvents(50) });
  }

  if (method === "POST" && pathname === "/api/admin/events") {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const payload = await readJson(req);
    requireFields(payload, ["title", "startsAt"]);

    const { rows } = await query(
      `
        INSERT INTO events (title, description, location, starts_at, ends_at, created_by)
        VALUES ($1, $2, $3, $4, NULLIF($5, '')::timestamptz, $6)
        RETURNING *
      `,
      [
        String(payload.title).trim(),
        String(payload.description || "").trim(),
        String(payload.location || "").trim(),
        payload.startsAt,
        payload.endsAt || "",
        admin.id
      ]
    );

    return sendJson(res, 201, { event: rows[0] });
  }

  const eventUpdateMatch = pathname.match(/^\/api\/admin\/events\/(\d+)$/);
  if (method === "PATCH" && eventUpdateMatch) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const eventId = parseId(eventUpdateMatch[1]);
    const payload = await readJson(req);
    requireFields(payload, ["title", "startsAt"]);

    const { rows } = await query(
      `
        UPDATE events
        SET title = $2,
            description = $3,
            location = $4,
            starts_at = $5,
            ends_at = NULLIF($6, '')::timestamptz,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [
        eventId,
        String(payload.title).trim(),
        String(payload.description || "").trim(),
        String(payload.location || "").trim(),
        payload.startsAt,
        payload.endsAt || ""
      ]
    );

    if (rows.length === 0) {
      return sendError(res, 404, "Event not found.");
    }

    return sendJson(res, 200, { event: rows[0] });
  }

  const eventArchiveMatch = pathname.match(/^\/api\/admin\/events\/(\d+)\/archive$/);
  if (method === "POST" && eventArchiveMatch) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const eventId = parseId(eventArchiveMatch[1]);
    const { rows } = await query(
      `
        UPDATE events
        SET status = 'archived',
            archived_at = COALESCE(archived_at, now()),
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [eventId]
    );

    if (rows.length === 0) {
      return sendError(res, 404, "Event not found.");
    }

    return sendJson(res, 200, { event: rows[0] });
  }

  if (method === "POST" && pathname === "/api/admin/social/meetings") {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const payload = await readJson(req);
    const meetingDate = normalizeSocialMeetingDate(payload);
    const title = String(payload.title || `237 Ville monthly meeting`).trim();

    const { rows } = await query(
      `
        INSERT INTO social_meetings (title, meeting_date, location, notes, status, created_by)
        VALUES ($1, $2::date, $3, $4, $5, $6)
        ON CONFLICT (meeting_date)
        DO UPDATE SET
          title = EXCLUDED.title,
          location = EXCLUDED.location,
          notes = EXCLUDED.notes,
          updated_at = now()
        RETURNING *
      `,
      [
        title,
        meetingDate,
        String(payload.location || "").trim(),
        String(payload.notes || "").trim(),
        normalizeSocialMeetingStatus(payload.status),
        admin.id
      ]
    );

    return sendJson(res, 201, { meeting: toSocialMeeting(rows[0]) });
  }

  const socialMeetingMatch = pathname.match(/^\/api\/admin\/social\/meetings\/(\d+)$/);
  if (method === "PATCH" && socialMeetingMatch) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const meetingId = parseId(socialMeetingMatch[1]);
    const payload = await readJson(req);
    requireFields(payload, ["title", "meetingDate"]);
    const status = normalizeSocialMeetingStatus(payload.status);

    const { rows } = await query(
      `
        UPDATE social_meetings
        SET title = $2,
            meeting_date = $3::date,
            location = $4,
            notes = $5,
            status = $6,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [
        meetingId,
        String(payload.title).trim(),
        normalizeSocialMeetingDate(payload),
        String(payload.location || "").trim(),
        String(payload.notes || "").trim(),
        status
      ]
    );

    if (rows.length === 0) {
      return sendError(res, 404, "Social meeting not found.");
    }

    return sendJson(res, 200, { meeting: toSocialMeeting(rows[0]) });
  }

  const socialAssignmentCreateMatch = pathname.match(/^\/api\/admin\/social\/meetings\/(\d+)\/assignments$/);
  if (method === "POST" && socialAssignmentCreateMatch) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const meetingId = parseId(socialAssignmentCreateMatch[1]);
    const payload = await readJson(req);
    requireFields(payload, ["title"]);
    const taskType = normalizeSocialTaskType(payload.taskType);
    const memberId = payload.userId ? parseId(payload.userId) : null;

    const meetingResult = await query("SELECT * FROM social_meetings WHERE id = $1", [meetingId]);
    if (meetingResult.rows.length === 0) {
      return sendError(res, 404, "Social meeting not found.");
    }

    if (memberId) {
      const memberResult = await query(
        "SELECT id FROM users WHERE id = $1 AND role = 'member' AND membership_status = 'active'",
        [memberId]
      );
      if (memberResult.rows.length === 0) {
        return sendError(res, 400, "Assignments can only be given to active member accounts.");
      }
    }

    const { rows } = await query(
      `
        INSERT INTO social_assignments (meeting_id, user_id, task_type, group_name, title, note, status)
        VALUES ($1, $2, $3, $4, $5, $6, 'assigned')
        RETURNING *
      `,
      [
        meetingId,
        memberId,
        taskType,
        String(payload.groupName || defaultSocialGroup(taskType)).trim(),
        String(payload.title).trim(),
        String(payload.note || "").trim()
      ]
    );

    if (memberId) {
      await createNotification(
        memberId,
        "social_assignment",
        "Social meeting assignment",
        `You were assigned ${socialTaskLabel(taskType).toLowerCase()} for ${meetingResult.rows[0].title} on ${meetingResult.rows[0].meeting_date}.`,
        "/social"
      );
    }

    return sendJson(res, 201, { assignment: rows[0] });
  }

  const socialAssignmentMatch = pathname.match(/^\/api\/admin\/social\/assignments\/(\d+)$/);
  if (method === "PATCH" && socialAssignmentMatch) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const assignmentId = parseId(socialAssignmentMatch[1]);
    const payload = await readJson(req);
    requireFields(payload, ["title"]);
    const taskType = normalizeSocialTaskType(payload.taskType);
    const memberId = payload.userId ? parseId(payload.userId) : null;
    const status = ["assigned", "completed", "cancelled"].includes(payload.status) ? payload.status : "assigned";

    if (memberId) {
      const memberResult = await query(
        "SELECT id FROM users WHERE id = $1 AND role = 'member' AND membership_status = 'active'",
        [memberId]
      );
      if (memberResult.rows.length === 0) {
        return sendError(res, 400, "Assignments can only be given to active member accounts.");
      }
    }

    const { rows } = await query(
      `
        UPDATE social_assignments
        SET user_id = $2,
            task_type = $3,
            group_name = $4,
            title = $5,
            note = $6,
            status = $7,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [
        assignmentId,
        memberId,
        taskType,
        String(payload.groupName || defaultSocialGroup(taskType)).trim(),
        String(payload.title).trim(),
        String(payload.note || "").trim(),
        status
      ]
    );

    if (rows.length === 0) {
      return sendError(res, 404, "Social assignment not found.");
    }

    return sendJson(res, 200, { assignment: rows[0] });
  }

  const socialAssignmentResponseMatch = pathname.match(/^\/api\/social\/assignments\/(\d+)\/response$/);
  if (method === "PATCH" && socialAssignmentResponseMatch) {
    const user = await requireActiveUser(req, res);
    if (!user) return;
    if (user.role !== "member") {
      return sendError(res, 403, "Only member accounts can respond to social meeting assignments.");
    }

    const assignmentId = parseId(socialAssignmentResponseMatch[1]);
    const payload = await readJson(req);
    const assignmentResult = await query(
      `
        SELECT social_assignments.*,
               social_meetings.title AS meeting_title,
               social_meetings.meeting_date,
               social_meetings.status AS meeting_status
        FROM social_assignments
        JOIN social_meetings ON social_meetings.id = social_assignments.meeting_id
        WHERE social_assignments.id = $1
        LIMIT 1
      `,
      [assignmentId]
    );
    const assignment = assignmentResult.rows[0];
    if (!assignment) {
      return sendError(res, 404, "Social assignment not found.");
    }
    if (Number(assignment.user_id) !== Number(user.id)) {
      return sendError(res, 403, "You can only respond to your assigned social meeting tasks.");
    }
    if (assignment.status !== "assigned") {
      return sendError(res, 400, "Only active assignments can be updated.");
    }
    if (!["published", "completed"].includes(assignment.meeting_status)) {
      return sendError(res, 403, "You can only respond after the meeting schedule is published.");
    }
    if (!["food", "drinks"].includes(assignment.task_type)) {
      return sendError(res, 400, "Only food and drinks assignments accept member contribution details.");
    }

    const foodContribution = assignment.task_type === "food" ? String(payload.foodContribution || "").trim() : "";
    const drinkBottleCount =
      assignment.task_type === "drinks" ? Math.max(0, Math.trunc(Number(payload.drinkBottleCount || 0))) : 0;
    const drinkBrand = assignment.task_type === "drinks" ? String(payload.drinkBrand || "").trim() : "";
    const drinkIsAlcoholic =
      assignment.task_type === "drinks" &&
      (payload.drinkIsAlcoholic === true ||
        payload.drinkIsAlcoholic === "true" ||
        payload.drinkIsAlcoholic === "on" ||
        payload.drinkIsAlcoholic === "1");
    const responseNote = String(payload.responseNote || "").trim();

    if (assignment.task_type === "food" && !foodContribution) {
      return sendError(res, 400, "Enter the dishes you will bring.");
    }
    if (assignment.task_type === "drinks" && (!drinkBottleCount || !drinkBrand)) {
      return sendError(res, 400, "Enter the drink bottle count and at least one drink brand.");
    }

    const { rows } = await query(
      `
        UPDATE social_assignments
        SET food_contribution = $2,
            drink_bottle_count = $3,
            drink_is_alcoholic = $4,
            drink_brand = $5,
            response_note = $6,
            responded_at = now(),
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [assignmentId, foodContribution, drinkBottleCount, drinkIsAlcoholic, drinkBrand, responseNote]
    );

    await notifyAdmins(
      "social_assignment_response",
      "Social assignment response submitted",
      `${user.fullName} updated ${socialTaskLabel(assignment.task_type).toLowerCase()} details for ${assignment.meeting_title}.`,
      "/admin"
    );

    return sendJson(res, 200, {
      assignment: toSocialAssignment({ ...rows[0], member_name: user.fullName, member_email: user.email })
    });
  }

  if (method === "POST" && pathname === "/api/social/fund-requests") {
    const user = await requireActiveUser(req, res);
    if (!user) return;
    if (user.role !== "member") {
      return sendError(res, 403, "Only member accounts can request social meeting funds.");
    }
    const payload = await readJson(req);
    requireFields(payload, ["assignmentId", "itemDescription", "amount", "reason"]);
    const assignmentId = parseId(payload.assignmentId);
    const amountCents = dollarsToCents(payload.amount);
    const itemDescription = String(payload.itemDescription || "").trim();
    const reason = String(payload.reason || "").trim();

    if (itemDescription.length < 3) {
      return sendError(res, 400, "Enter the dish or drink that needs funds.");
    }
    if (reason.length < 10) {
      return sendError(res, 400, "Enter why organization funds are needed.");
    }

    const assignmentResult = await query(
      `
        SELECT social_assignments.*,
               social_meetings.title AS meeting_title,
               social_meetings.status AS meeting_status
        FROM social_assignments
        JOIN social_meetings ON social_meetings.id = social_assignments.meeting_id
        WHERE social_assignments.id = $1
        LIMIT 1
      `,
      [assignmentId]
    );
    const assignment = assignmentResult.rows[0];
    if (!assignment) {
      return sendError(res, 404, "Social assignment not found.");
    }
    if (Number(assignment.user_id) !== Number(user.id)) {
      return sendError(res, 403, "You can only request funds for your own assigned social meeting task.");
    }
    if (assignment.status !== "assigned") {
      return sendError(res, 400, "Only active assignments can request funds.");
    }
    if (!["published", "completed"].includes(assignment.meeting_status)) {
      return sendError(res, 403, "You can only request funds after the meeting schedule is published.");
    }
    if (!["food", "drinks"].includes(assignment.task_type)) {
      return sendError(res, 400, "Only food and drinks assignments can request preparation funds.");
    }

    const { rows } = await query(
      `
        INSERT INTO social_fund_requests (meeting_id, assignment_id, requested_by, item_description, amount_cents, reason)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `,
      [assignment.meeting_id, assignmentId, user.id, itemDescription, amountCents, reason]
    );

    await notifyAdmins(
      "social_fund_request",
      "New social fund request",
      `${user.fullName} requested $${centsToDollarAmount(amountCents)} for ${itemDescription} for ${assignment.meeting_title}.`,
      "/admin"
    );

    return sendJson(res, 201, { fundRequest: await getSocialFundRequest(rows[0].id) });
  }

  const socialPublishMatch = pathname.match(/^\/api\/admin\/social\/meetings\/(\d+)\/publish$/);
  if (method === "POST" && socialPublishMatch) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const meetingId = parseId(socialPublishMatch[1]);
    const meetingResult = await query("SELECT * FROM social_meetings WHERE id = $1", [meetingId]);
    const meeting = meetingResult.rows[0];
    if (!meeting) {
      return sendError(res, 404, "Social meeting not found.");
    }

    const assignmentsResult = await query(
      `
        SELECT social_assignments.*, users.full_name AS member_name, users.email AS member_email
        FROM social_assignments
        LEFT JOIN users ON users.id = social_assignments.user_id
        WHERE social_assignments.meeting_id = $1
        ORDER BY task_type ASC, created_at ASC
      `,
      [meetingId]
    );
    const requestsResult = await query(
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
        WHERE social_resource_requests.meeting_id = $1
        ORDER BY social_resource_requests.created_at ASC
      `,
      [meetingId]
    );
    const assignments = assignmentsResult.rows.map(toSocialAssignment);
    const resourceRequests = requestsResult.rows.map(toSocialResourceRequest);
    const body = buildSocialAnnouncementBody(meeting, assignments, resourceRequests);
    const announcementResult = await query(
      `
        INSERT INTO announcements (title, body, category, status, created_by, published_at)
        VALUES ($1, $2, 'social', 'published', $3, now())
        RETURNING *
      `,
      [`Social coordinator schedule: ${meeting.title}`, body, admin.id]
    );

    const updatedMeeting = await query(
      `
        UPDATE social_meetings
        SET status = 'published',
            announcement_id = $2,
            published_at = now(),
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [meetingId, announcementResult.rows[0].id]
    );

    await createAnnouncementNotifications(announcementResult.rows[0]);

    return sendJson(res, 200, {
      meeting: toSocialMeeting(updatedMeeting.rows[0], assignments, resourceRequests),
      announcement: announcementResult.rows[0]
    });
  }

  if (method === "POST" && pathname === "/api/admin/social/resources") {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const payload = await readJson(req);
    requireFields(payload, ["name"]);
    const totalQuantity = Math.max(0, Math.trunc(Number(payload.totalQuantity || 0)));
    const availableQuantity = Math.max(0, Math.trunc(Number(payload.availableQuantity || totalQuantity)));

    const { rows } = await query(
      `
        INSERT INTO social_resources (name, description, total_quantity, available_quantity, storage_location, status, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `,
      [
        String(payload.name).trim(),
        String(payload.description || "").trim(),
        totalQuantity,
        Math.min(availableQuantity, totalQuantity),
        String(payload.storageLocation || "").trim(),
        normalizeResourceStatus(payload.status),
        admin.id
      ]
    );

    return sendJson(res, 201, { resource: toSocialResource(rows[0]) });
  }

  const socialResourceMatch = pathname.match(/^\/api\/admin\/social\/resources\/(\d+)$/);
  if (method === "PATCH" && socialResourceMatch) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const resourceId = parseId(socialResourceMatch[1]);
    const payload = await readJson(req);
    requireFields(payload, ["name"]);
    const totalQuantity = Math.max(0, Math.trunc(Number(payload.totalQuantity || 0)));
    const availableQuantity = Math.max(0, Math.trunc(Number(payload.availableQuantity || 0)));

    const { rows } = await query(
      `
        UPDATE social_resources
        SET name = $2,
            description = $3,
            total_quantity = $4,
            available_quantity = $5,
            storage_location = $6,
            status = $7,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [
        resourceId,
        String(payload.name).trim(),
        String(payload.description || "").trim(),
        totalQuantity,
        Math.min(availableQuantity, totalQuantity),
        String(payload.storageLocation || "").trim(),
        normalizeResourceStatus(payload.status)
      ]
    );

    if (rows.length === 0) {
      return sendError(res, 404, "Resource not found.");
    }

    return sendJson(res, 200, { resource: toSocialResource(rows[0]) });
  }

  const socialResourceStockMatch = pathname.match(/^\/api\/admin\/social\/resources\/(\d+)\/stock$/);
  if (method === "POST" && socialResourceStockMatch) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const resourceId = parseId(socialResourceStockMatch[1]);
    const payload = await readJson(req);
    const quantity = Math.trunc(Number(payload.quantity || 0));

    if (quantity < 1) {
      return sendError(res, 400, "Enter a quantity of at least 1.");
    }

    const { rows } = await query(
      `
        UPDATE social_resources
        SET total_quantity = total_quantity + $2,
            available_quantity = available_quantity + $2,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [resourceId, quantity]
    );

    if (rows.length === 0) {
      return sendError(res, 404, "Resource not found.");
    }

    return sendJson(res, 200, { resource: toSocialResource(rows[0]) });
  }

  if (method === "POST" && pathname === "/api/social/resource-requests") {
    const user = await requireActiveUser(req, res);
    if (!user) return;
    if (user.role !== "member") {
      return sendError(res, 403, "Only member accounts can request organization resources.");
    }
    const payload = await readJson(req);
    const resourceId = parseId(payload.resourceId);
    const meetingId = payload.meetingId ? parseId(payload.meetingId) : null;
    const quantity = Math.max(1, Math.trunc(Number(payload.quantity || 1)));

    if (!meetingId) {
      return sendError(res, 400, "Choose the meeting tied to your assigned task before requesting resources.");
    }

    const resourceResult = await query("SELECT id, name, status FROM social_resources WHERE id = $1 AND status = 'active'", [resourceId]);
    if (resourceResult.rows.length === 0) {
      return sendError(res, 404, "Active resource not found.");
    }

    const assignmentResult = await query(
      `
        SELECT social_assignments.id
        FROM social_assignments
        JOIN social_meetings ON social_meetings.id = social_assignments.meeting_id
        WHERE social_assignments.meeting_id = $1
          AND social_assignments.user_id = $2
          AND social_assignments.status = 'assigned'
          AND social_meetings.status IN ('published', 'completed')
        LIMIT 1
      `,
      [meetingId, user.id]
    );
    if (assignmentResult.rows.length === 0) {
      return sendError(res, 403, "You can only request resources for a published meeting where you have an assigned task.");
    }

    const { rows } = await query(
      `
        INSERT INTO social_resource_requests (meeting_id, resource_id, requested_by, quantity, needed_date, return_date, note)
        VALUES (NULLIF($1, 0), $2, $3, $4, NULLIF($5, '')::date, NULLIF($6, '')::date, $7)
        RETURNING *
      `,
      [
        meetingId || 0,
        resourceId,
        user.id,
        quantity,
        payload.neededDate || "",
        payload.returnDate || "",
        String(payload.note || "").trim()
      ]
    );

    await notifyAdmins(
      "social_resource_request",
      "New resource request",
      `${user.fullName} requested ${quantity} ${resourceResult.rows[0].name} for a social meeting.`,
      "/admin"
    );

    return sendJson(res, 201, { request: rows[0] });
  }

  const socialResourceRequestStatusMatch = pathname.match(/^\/api\/admin\/social\/resource-requests\/(\d+)\/status$/);
  if (method === "PATCH" && socialResourceRequestStatusMatch) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const requestId = parseId(socialResourceRequestStatusMatch[1]);
    const payload = await readJson(req);
    const status = normalizeResourceRequestStatus(payload.status);
    const adminNote = String(payload.adminNote || "").trim();

    const result = await withTransaction(async (client) => {
      const currentResult = await client.query(
        `
          SELECT social_resource_requests.*, social_resources.available_quantity, social_resources.name AS resource_name
          FROM social_resource_requests
          JOIN social_resources ON social_resources.id = social_resource_requests.resource_id
          WHERE social_resource_requests.id = $1
          FOR UPDATE
        `,
        [requestId]
      );
      const current = currentResult.rows[0];
      if (!current) {
        throw Object.assign(new Error("Resource request not found."), { statusCode: 404 });
      }

      if (status === "approved" && current.status !== "approved" && Number(current.available_quantity) < Number(current.quantity)) {
        throw Object.assign(new Error("Not enough available resource quantity to approve this request."), { statusCode: 400 });
      }

      if (status === "approved" && current.status !== "approved") {
        await client.query(
          "UPDATE social_resources SET available_quantity = available_quantity - $2, updated_at = now() WHERE id = $1",
          [current.resource_id, current.quantity]
        );
      }

      if ((status === "declined" || status === "returned") && current.status === "approved") {
        await client.query(
          "UPDATE social_resources SET available_quantity = available_quantity + $2, updated_at = now() WHERE id = $1",
          [current.resource_id, current.quantity]
        );
      }

      const updated = await client.query(
        `
          UPDATE social_resource_requests
          SET status = $2,
              admin_note = $3,
              reviewed_by = $4,
              reviewed_at = now(),
              updated_at = now()
          WHERE id = $1
          RETURNING *
        `,
        [requestId, status, adminNote, admin.id]
      );

      return { request: updated.rows[0], previous: current };
    });

    await createNotification(
      result.request.requested_by,
      "social_resource_request",
      "Resource request updated",
      `Your request for ${result.previous.resource_name} was marked ${status}.`,
      "/social"
    );

    return sendJson(res, 200, { request: result.request });
  }

  const socialFundRequestStatusMatch = pathname.match(/^\/api\/admin\/social\/fund-requests\/(\d+)\/status$/);
  if (method === "PATCH" && socialFundRequestStatusMatch) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const requestId = parseId(socialFundRequestStatusMatch[1]);
    const payload = await readJson(req);
    const status = normalizeFundRequestStatus(payload.status);
    const adminNote = String(payload.adminNote || "").trim();

    const current = await getSocialFundRequest(requestId);
    if (!current) {
      return sendError(res, 404, "Fund request not found.");
    }

    const { rows } = await query(
      `
        UPDATE social_fund_requests
        SET status = $2,
            admin_note = $3,
            reviewed_by = CASE WHEN $2::text = 'pending' THEN NULL ELSE $4::bigint END,
            reviewed_at = CASE WHEN $2::text = 'pending' THEN NULL ELSE now() END,
            updated_at = now()
        WHERE id = $1
        RETURNING id
      `,
      [requestId, status, adminNote, admin.id]
    );

    await createNotification(
      current.requestedBy,
      "social_fund_request",
      "Social fund request updated",
      `Your fund request for ${current.itemDescription} was marked ${status}.`,
      "/social"
    );

    return sendJson(res, 200, { fundRequest: await getSocialFundRequest(rows[0].id) });
  }

  if (method === "POST" && pathname === "/api/questions") {
    const user = await requireActiveUser(req, res);
    if (!user) return;
    const payload = await readJson(req);
    requireFields(payload, ["title", "body"]);
    const contentType = payload.contentType === "article" ? "article" : "question";

    const { rows } = await query(
      `
        INSERT INTO member_questions (user_id, content_type, title, body)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `,
      [user.id, contentType, String(payload.title).trim(), String(payload.body).trim()]
    );

    return sendJson(res, 201, { question: rows[0] });
  }

  const commentMatch = pathname.match(/^\/api\/questions\/(\d+)\/comments$/);
  if (method === "POST" && commentMatch) {
    const user = await requireActiveUser(req, res);
    if (!user) return;
    const questionId = parseId(commentMatch[1]);
    const payload = await readJson(req);
    requireFields(payload, ["body"]);

    const questionResult = await query(
      "SELECT id FROM member_questions WHERE id = $1 AND status = 'published'",
      [questionId]
    );
    if (questionResult.rows.length === 0) {
      return sendError(res, 404, "Published question not found.");
    }

    const { rows } = await query(
      `
        INSERT INTO question_comments (question_id, user_id, body)
        VALUES ($1, $2, $3)
        RETURNING *
      `,
      [questionId, user.id, String(payload.body).trim()]
    );

    return sendJson(res, 201, { comment: rows[0] });
  }

  const adminQuestionAction = pathname.match(/^\/api\/admin\/questions\/(\d+)\/(publish|close)$/);
  if (method === "POST" && adminQuestionAction) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const questionId = parseId(adminQuestionAction[1]);
    const action = adminQuestionAction[2];
    const status = action === "publish" ? "published" : "closed";

    const { rows } = await query(
      `
        UPDATE member_questions
        SET status = $2,
            published_at = CASE WHEN $2 = 'published' THEN COALESCE(published_at, now()) ELSE published_at END,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [questionId, status]
    );

    if (rows.length === 0) {
      return sendError(res, 404, "Question not found.");
    }

    return sendJson(res, 200, { question: rows[0] });
  }

  const adminQuestionArticleMatch = pathname.match(/^\/api\/admin\/questions\/(\d+)\/publish-article$/);
  if (method === "POST" && adminQuestionArticleMatch) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const questionId = parseId(adminQuestionArticleMatch[1]);

    const questionResult = await query(
      `
        SELECT member_questions.*, users.full_name AS author_name
        FROM member_questions
        JOIN users ON users.id = member_questions.user_id
        WHERE member_questions.id = $1
      `,
      [questionId]
    );

    const question = questionResult.rows[0];
    if (!question) {
      return sendError(res, 404, "Question not found.");
    }

    const { rows } = await query(
      `
        INSERT INTO announcements (title, body, category, status, created_by, published_at)
        VALUES ($1, $2, 'article', 'published', $3, now())
        RETURNING *
      `,
      [
        question.title,
        `${question.body}\n\nSubmitted by ${question.author_name}.`,
        admin.id
      ]
    );

    await query(
      `
        UPDATE member_questions
        SET status = 'closed',
            published_at = COALESCE(published_at, now()),
            updated_at = now()
        WHERE id = $1
      `,
      [questionId]
    );

    await createAnnouncementNotifications(rows[0]);

    return sendJson(res, 201, { announcement: rows[0] });
  }

  if (method === "GET" && pathname === "/api/ballots") {
    const user = await requireActiveUser(req, res);
    if (!user) return;
    return sendJson(res, 200, { ballots: await listBallots(user, { includeDrafts: user.role === "admin" }) });
  }

  if (method === "POST" && pathname === "/api/admin/ballots") {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const payload = await readJson(req);
    requireFields(payload, ["title", "ballotType"]);

    const ballotType = payload.ballotType === "election" ? "election" : "issue";
    const status = ["draft", "open", "closed", "archived"].includes(payload.status) ? payload.status : "draft";
    const options = Array.isArray(payload.options)
      ? payload.options
          .map((option) => ({
            label: String(option.label || "").trim(),
            description: String(option.description || "").trim(),
            candidateUserId: option.candidateUserId ? Number(option.candidateUserId) : null
          }))
          .filter((option) => option.label)
      : [];

    const finalOptions = options.length > 0
      ? options
      : ballotType === "issue"
        ? [{ label: "Yes" }, { label: "No" }, { label: "Abstain" }]
        : [];

    if (finalOptions.length < 2) {
      return sendError(res, 400, "A ballot needs at least two options.");
    }

    if (status === "open" && payload.endsAt && new Date(payload.endsAt) <= new Date()) {
      return sendError(res, 400, "The last date to vote must be in the future for an open ballot.");
    }

    const ballot = await withTransaction(async (client) => {
      const ballotResult = await client.query(
        `
          INSERT INTO ballots (title, description, ballot_type, status, question_id, starts_at, ends_at, created_by)
          VALUES ($1, $2, $3, $4, NULLIF($5, 0), NULLIF($6, '')::timestamptz, NULLIF($7, '')::timestamptz, $8)
          RETURNING *
        `,
        [
          String(payload.title).trim(),
          String(payload.description || "").trim(),
          ballotType,
          status,
          payload.questionId ? Number(payload.questionId) : 0,
          payload.startsAt || "",
          payload.endsAt || "",
          admin.id
        ]
      );
      const ballotRow = ballotResult.rows[0];

      for (const option of finalOptions) {
        await client.query(
          `
            INSERT INTO ballot_options (ballot_id, label, description, candidate_user_id)
            VALUES ($1, $2, $3, $4)
          `,
          [ballotRow.id, option.label, option.description || "", option.candidateUserId || null]
        );
      }

      return ballotRow;
    });

    return sendJson(res, 201, { ballot });
  }

  const ballotStatusMatch = pathname.match(/^\/api\/admin\/ballots\/(\d+)\/(open|close)$/);
  if (method === "POST" && ballotStatusMatch) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const ballotId = parseId(ballotStatusMatch[1]);
    const status = ballotStatusMatch[2] === "open" ? "open" : "closed";
    if (status === "open") {
      const ballotResult = await query("SELECT ends_at FROM ballots WHERE id = $1", [ballotId]);
      const ballot = ballotResult.rows[0];
      if (!ballot) {
        return sendError(res, 404, "Ballot not found.");
      }
      if (ballot.ends_at && new Date(ballot.ends_at) <= new Date()) {
        return sendError(res, 400, "Update the last date to vote before reopening this ballot.");
      }
    }
    const { rows } = await query(
      `
        UPDATE ballots
        SET status = $2,
            starts_at = CASE WHEN $2 = 'open' THEN COALESCE(starts_at, now()) ELSE starts_at END,
            ends_at = CASE WHEN $2 = 'closed' THEN COALESCE(ends_at, now()) ELSE ends_at END,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [ballotId, status]
    );

    if (rows.length === 0) {
      return sendError(res, 404, "Ballot not found.");
    }

    return sendJson(res, 200, { ballot: rows[0] });
  }

  const ballotArchiveMatch = pathname.match(/^\/api\/admin\/ballots\/(\d+)\/archive$/);
  if (method === "POST" && ballotArchiveMatch) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const ballotId = parseId(ballotArchiveMatch[1]);
    const { rows } = await query(
      `
        UPDATE ballots
        SET status = 'archived',
            ends_at = COALESCE(ends_at, now()),
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [ballotId]
    );

    if (rows.length === 0) {
      return sendError(res, 404, "Ballot not found.");
    }

    return sendJson(res, 200, { ballot: rows[0] });
  }

  const voteMatch = pathname.match(/^\/api\/ballots\/(\d+)\/vote$/);
  if (method === "POST" && voteMatch) {
    const user = await requireActiveUser(req, res);
    if (!user) return;
    await closeExpiredBallots();
    const ballotId = parseId(voteMatch[1]);
    const payload = await readJson(req);
    const optionId = parseId(payload.optionId);

    const allowed = await query(
      `
        SELECT ballots.id
        FROM ballots
        JOIN ballot_options ON ballot_options.ballot_id = ballots.id
        WHERE ballots.id = $1
          AND ballot_options.id = $2
          AND ballots.status = 'open'
          AND (ballots.starts_at IS NULL OR ballots.starts_at <= now())
          AND (ballots.ends_at IS NULL OR ballots.ends_at >= now())
        LIMIT 1
      `,
      [ballotId, optionId]
    );

    if (allowed.rows.length === 0) {
      return sendError(res, 400, "This ballot is not open for that option.");
    }

    await query(
      `
        INSERT INTO votes (ballot_id, option_id, user_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (ballot_id, user_id)
        DO UPDATE SET option_id = EXCLUDED.option_id, updated_at = now()
      `,
      [ballotId, optionId, user.id]
    );

    return sendJson(res, 200, { ok: true });
  }

  if (method === "POST" && pathname === "/api/payments") {
    const user = await requireActiveUser(req, res);
    if (!user) return;
    const payload = await readJson(req);
    const purpose = payload.purpose === "donation" ? "donation" : "dues";
    const amountCents = dollarsToCents(payload.amount);
    const paymentMethod = normalizePaymentMethod(payload.method);
    const paymentDetails = normalizePaymentRecordDetails(payload);
    const organizationPaymentDetail = await requireEnabledPaymentDetail(paymentMethod);

    const { rows } = await query(
      `
        INSERT INTO payments (
          user_id,
          purpose,
          amount_cents,
          method,
          note,
          external_reference,
          payment_details,
          payment_detail_snapshot
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
        RETURNING *
      `,
      [
        user.id,
        purpose,
        amountCents,
        paymentMethod,
        String(payload.note || "").trim(),
        String(payload.externalReference || "").trim(),
        JSON.stringify(paymentDetails),
        paymentDetailSnapshot(organizationPaymentDetail)
      ]
    );

    return sendJson(res, 201, { payment: rows[0] });
  }

  const memberApproveMatch = pathname.match(/^\/api\/admin\/members\/(\d+)\/approve$/);
  if (method === "POST" && memberApproveMatch) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const memberId = parseId(memberApproveMatch[1]);
    const payload = await readJson(req);
    requireFields(payload, ["temporaryPassword"]);

    if (String(payload.temporaryPassword).length < 8) {
      return sendError(res, 400, "Temporary password must be at least 8 characters.");
    }

    const passwordHash = await hashPassword(payload.temporaryPassword);
    const { rows } = await query(
      `
        UPDATE users
        SET password_hash = $2,
            membership_status = 'pending_policy',
            password_must_change = TRUE,
            approved_at = now(),
            approved_by = $3,
            updated_at = now()
        WHERE id = $1
          AND role = 'member'
          AND membership_status = 'pending_approval'
          AND COALESCE(identity_document_data_url, '') <> ''
        RETURNING *
      `,
      [memberId, passwordHash, admin.id]
    );

    if (rows.length === 0) {
      return sendError(res, 404, "Pending member request not found.");
    }

    await createNotification(
      memberId,
      "account_approved",
      "Account approved",
      "Your 237 Ville account was approved. Use the temporary password provided by the admin, then update your password and complete onboarding.",
      "/"
    );

    return sendJson(res, 200, { member: toUser(rows[0]) });
  }

  const memberRejectMatch = pathname.match(/^\/api\/admin\/members\/(\d+)\/reject$/);
  if (method === "POST" && memberRejectMatch) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const memberId = parseId(memberRejectMatch[1]);
    const payload = await readJson(req);
    requireFields(payload, ["reason"]);
    const reason = String(payload.reason).trim();

    const { rows } = await query(
      `
        UPDATE users
        SET membership_status = 'rejected',
            rejection_reason = $2,
            rejected_at = now(),
            rejected_by = $3,
            updated_at = now()
        WHERE id = $1
          AND role = 'member'
          AND membership_status = 'pending_approval'
        RETURNING *
      `,
      [memberId, reason, admin.id]
    );

    if (rows.length === 0) {
      return sendError(res, 404, "Pending member request not found.");
    }

    await query("DELETE FROM sessions WHERE user_id = $1", [memberId]);

    return sendJson(res, 200, { member: toUser(rows[0]) });
  }

  const memberUpdateMatch = pathname.match(/^\/api\/admin\/members\/(\d+)$/);
  if (method === "PATCH" && memberUpdateMatch) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const memberId = parseId(memberUpdateMatch[1]);
    const payload = await readJson(req);
    const firstName = String(payload.firstName || "").trim();
    const lastName = String(payload.lastName || "").trim();
    const fullName = buildFullName(firstName, lastName);
    const role = payload.role === "admin" ? "admin" : "member";
    const allowedStatuses = ["pending_approval", "pending_policy", "pending_fee", "active", "inactive", "suspended", "rejected"];
    const membershipStatus = allowedStatuses.includes(payload.membershipStatus) ? payload.membershipStatus : "active";

    requireFields({ ...payload, firstName, lastName, fullName }, ["email", "firstName", "lastName"]);

    try {
      const { rows } = await query(
        `
          UPDATE users
          SET email = $2,
              first_name = $3,
              last_name = $4,
              full_name = $5,
              phone = $6,
              city = $7,
              state = $8,
              role = $9,
              membership_status = $10,
              updated_at = now()
          WHERE id = $1
          RETURNING *
        `,
        [
          memberId,
          normalizeEmail(payload.email),
          firstName,
          lastName,
          fullName,
          String(payload.phone || ""),
          String(payload.city || ""),
          String(payload.state || ""),
          role,
          membershipStatus
        ]
      );

      if (rows.length === 0) {
        return sendError(res, 404, "Member not found.");
      }

      return sendJson(res, 200, { member: toUser(rows[0]) });
    } catch (error) {
      if (error.code === "23505") {
        return sendError(res, 409, "Another account already uses that email.");
      }
      throw error;
    }
  }

  const paymentStatusMatch = pathname.match(/^\/api\/admin\/payments\/(\d+)\/status$/);
  if (method === "PATCH" && paymentStatusMatch) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const paymentId = parseId(paymentStatusMatch[1]);
    const payload = await readJson(req);
    const status = ["received", "cancelled"].includes(payload.status) ? payload.status : "";
    if (!status) {
      return sendError(res, 400, "Payment can only be finalized as received or cancelled.");
    }
    const payment = await withTransaction(async (client) => {
      const paymentResult = await client.query(
        `
          UPDATE payments
          SET status = $2,
              reviewed_by = $3,
              reviewed_at = now()
          WHERE id = $1
            AND status = 'pending'
          RETURNING *
        `,
        [paymentId, status, admin.id]
      );

      const row = paymentResult.rows[0];

      if (row?.purpose === "registration_fee" && row.user_id) {
        const nextStatus = status === "received" ? "active" : "pending_fee";
        await client.query(
          `
            UPDATE users
            SET membership_status = $2,
                updated_at = now()
            WHERE id = $1
          `,
          [row.user_id, nextStatus]
        );
      }

      return row;
    });

    if (!payment) {
      return sendError(res, 404, "Payment not found or already finalized.");
    }

    if (payment.purpose === "registration_fee" && status === "received" && payment.user_id) {
      await createNotification(
        payment.user_id,
        "registration_fee",
        "Registration fee processed",
        "Your registration fee has been received. Your 237 Ville member portal is now active.",
        "/"
      );
    }

    if (payment.purpose === "registration_fee" && status === "cancelled" && payment.user_id) {
      await createNotification(
        payment.user_id,
        "registration_fee",
        "Registration fee needs attention",
        "Your registration fee record was not accepted. Please submit an updated payment record.",
        "/payments"
      );
    }

    return sendJson(res, 200, { payment });
  }

  const paymentPublishMatch = pathname.match(/^\/api\/admin\/payments\/(\d+)\/publish$/);
  if (method === "POST" && paymentPublishMatch) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const paymentId = parseId(paymentPublishMatch[1]);
    const { rows } = await query(
      `
        UPDATE payments
        SET published_at = COALESCE(published_at, now())
        WHERE id = $1
          AND purpose = 'donation'
          AND status = 'received'
        RETURNING *
      `,
      [paymentId]
    );

    if (rows.length === 0) {
      return sendError(res, 404, "Received donation not found.");
    }

    await notifyActiveMembers(
      "financial",
      "Donation published",
      `A donation of $${centsToDollarAmount(rows[0].amount_cents)} was published for members to review.`,
      "/financials"
    );

    return sendJson(res, 200, { payment: rows[0] });
  }

  if (method === "POST" && pathname === "/api/admin/expenditures") {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const payload = await readJson(req);
    requireFields(payload, ["title", "amount"]);

    const amountCents = dollarsToCents(payload.amount);
    const status = payload.status === "published" ? "published" : "draft";
    const { rows } = await query(
      `
        INSERT INTO expenditures (
          title,
          category,
          vendor,
          amount_cents,
          expense_date,
          note,
          status,
          created_by,
          published_at
        )
        VALUES ($1, $2, $3, $4, COALESCE(NULLIF($5, '')::date, CURRENT_DATE), $6, $7, $8, CASE WHEN $7 = 'published' THEN now() ELSE NULL END)
        RETURNING *
      `,
      [
        String(payload.title).trim(),
        String(payload.category || "").trim(),
        String(payload.vendor || "").trim(),
        amountCents,
        String(payload.expenseDate || "").trim(),
        String(payload.note || "").trim(),
        status,
        admin.id
      ]
    );

    if (status === "published") {
      await notifyActiveMembers(
        "financial",
        "Expenditure published",
        `${rows[0].title} was published as a $${centsToDollarAmount(rows[0].amount_cents)} organization expenditure.`,
        "/financials"
      );
    }

    return sendJson(res, 201, { expenditure: toExpenditure(rows[0]) });
  }

  const expenditurePublishMatch = pathname.match(/^\/api\/admin\/expenditures\/(\d+)\/publish$/);
  if (method === "POST" && expenditurePublishMatch) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const expenditureId = parseId(expenditurePublishMatch[1]);
    const { rows } = await query(
      `
        UPDATE expenditures
        SET status = 'published',
            published_at = COALESCE(published_at, now()),
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [expenditureId]
    );

    if (rows.length === 0) {
      return sendError(res, 404, "Expenditure not found.");
    }

    await notifyActiveMembers(
      "financial",
      "Expenditure published",
      `${rows[0].title} was published as a $${centsToDollarAmount(rows[0].amount_cents)} organization expenditure.`,
      "/financials"
    );

    return sendJson(res, 200, { expenditure: toExpenditure(rows[0]) });
  }

  const notificationMatch = pathname.match(/^\/api\/notifications\/(\d+)\/read$/);
  if (method === "POST" && notificationMatch) {
    const user = await requireUser(req, res);
    if (!user) return;
    await query(
      "UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2",
      [parseId(notificationMatch[1]), user.id]
    );
    return sendJson(res, 200, { ok: true });
  }

  if (method === "POST" && pathname === "/api/admin/notifications/clear-old") {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const payload = await readJson(req);
    const days = Number(payload.days || 30);

    if (!Number.isInteger(days) || days < 1 || days > 365) {
      return sendError(res, 400, "Days must be a whole number between 1 and 365.");
    }

    const { rowCount } = await query(
      `
        DELETE FROM notifications
        WHERE user_id = $1
          AND created_at < now() - ($2 || ' days')::interval
      `,
      [admin.id, days]
    );

    return sendJson(res, 200, { deletedCount: rowCount });
  }

  if (method === "GET" && pathname === "/api/admin/payment-details") {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    return sendJson(res, 200, { paymentDetails: await listOrganizationPaymentDetails({ includeDisabled: true }) });
  }

  if (method === "PATCH" && pathname === "/api/admin/about") {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const payload = await readJson(req);
    requireFields(payload, ["summary", "purpose"]);
    const missionStatement = String(payload.missionStatement || "").trim();

    const { rows } = await query(
      `
        INSERT INTO organization_about (id, summary, mission_statement, purpose, updated_by, updated_at)
        VALUES (1, $1, $2, $3, $4, now())
        ON CONFLICT (id)
        DO UPDATE SET
          summary = EXCLUDED.summary,
          mission_statement = EXCLUDED.mission_statement,
          purpose = EXCLUDED.purpose,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
        RETURNING *
      `,
      [String(payload.summary).trim(), missionStatement, String(payload.purpose).trim(), admin.id]
    );

    return sendJson(res, 200, {
      about: {
        summary: rows[0].summary,
        missionStatement: rows[0].mission_statement || "",
        purpose: rows[0].purpose,
        updatedAt: rows[0].updated_at
      }
    });
  }

  if (method === "POST" && pathname === "/api/admin/about/positions") {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const payload = await readJson(req);
    requireFields(payload, ["title"]);
    const image = validateImageUpload(payload.image);
    const displayOrder = Number(payload.displayOrder || 0);

    const { rows } = await query(
      `
        INSERT INTO leadership_positions (
          title,
          holder_name,
          body,
          image_name,
          image_type,
            image_size,
            image_data_url,
            display_order,
            status,
            archived_at,
            created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'published', NULL, $9)
        RETURNING *
      `,
      [
        String(payload.title).trim(),
        String(payload.holderName || "").trim(),
        String(payload.body || "").trim(),
        image.name,
        image.type,
        image.size,
        image.dataUrl,
        Number.isFinite(displayOrder) ? Math.trunc(displayOrder) : 0,
        admin.id
      ]
    );

    return sendJson(res, 201, { position: toLeadershipPosition(rows[0]) });
  }

  const aboutPositionStatusMatch = pathname.match(/^\/api\/admin\/about\/positions\/(\d+)\/status$/);
  if (method === "PATCH" && aboutPositionStatusMatch) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const positionId = parseId(aboutPositionStatusMatch[1]);
    const payload = await readJson(req);
    const status = normalizeLeadershipStatus(payload.status);

    const { rows } = await query(
      `
        UPDATE leadership_positions
        SET status = $2,
            archived_at = CASE
              WHEN $2 = 'archived' AND status <> 'archived' THEN now()
              WHEN $2 = 'archived' THEN COALESCE(archived_at, now())
              ELSE NULL
            END,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [positionId, status]
    );

    if (rows.length === 0) {
      return sendError(res, 404, "Leadership position not found.");
    }

    return sendJson(res, 200, { position: toLeadershipPosition(rows[0]) });
  }

  const aboutPositionMatch = pathname.match(/^\/api\/admin\/about\/positions\/(\d+)$/);
  if (method === "PATCH" && aboutPositionMatch) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const positionId = parseId(aboutPositionMatch[1]);
    const payload = await readJson(req);
    requireFields(payload, ["title"]);
    const image = validateImageUpload(payload.image);
    const displayOrder = Number(payload.displayOrder || 0);
    const status = normalizeLeadershipStatus(payload.status);

    const { rows } = await query(
      `
        UPDATE leadership_positions
        SET title = $2,
            holder_name = $3,
            body = $4,
            image_name = CASE WHEN $5 <> '' THEN $5 ELSE image_name END,
            image_type = CASE WHEN $5 <> '' THEN $6 ELSE image_type END,
            image_size = CASE WHEN $5 <> '' THEN $7 ELSE image_size END,
            image_data_url = CASE WHEN $5 <> '' THEN $8 ELSE image_data_url END,
            display_order = $9,
            status = $10,
            archived_at = CASE
              WHEN $10 = 'archived' AND status <> 'archived' THEN now()
              WHEN $10 = 'archived' THEN COALESCE(archived_at, now())
              ELSE NULL
            END,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [
        positionId,
        String(payload.title).trim(),
        String(payload.holderName || "").trim(),
        String(payload.body || "").trim(),
        image.name,
        image.type,
        image.size,
        image.dataUrl,
        Number.isFinite(displayOrder) ? Math.trunc(displayOrder) : 0,
        status
      ]
    );

    if (rows.length === 0) {
      return sendError(res, 404, "Leadership position not found.");
    }

    return sendJson(res, 200, { position: toLeadershipPosition(rows[0]) });
  }

  if (method === "POST" && pathname === "/api/admin/about/articles") {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const payload = await readJson(req);
    requireFields(payload, ["title", "body"]);
    const image = validateImageUpload(payload.image);
    const displayOrder = Number(payload.displayOrder || 0);

    const { rows } = await query(
      `
        INSERT INTO public_about_articles (
          title,
          body,
          image_name,
          image_type,
          image_size,
          image_data_url,
          display_order,
          status,
          hidden_at,
          created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'published', NULL, $8)
        RETURNING *
      `,
      [
        String(payload.title).trim(),
        String(payload.body).trim(),
        image.name,
        image.type,
        image.size,
        image.dataUrl,
        Number.isFinite(displayOrder) ? Math.trunc(displayOrder) : 0,
        admin.id
      ]
    );

    return sendJson(res, 201, { article: toPublicAboutArticle(rows[0]) });
  }

  if (method === "POST" && pathname === "/api/admin/about/articles/cleanup-hidden") {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const deletedCount = await cleanupExpiredHiddenAboutArticles();
    return sendJson(res, 200, { deletedCount });
  }

  const aboutArticleStatusMatch = pathname.match(/^\/api\/admin\/about\/articles\/(\d+)\/status$/);
  if (method === "PATCH" && aboutArticleStatusMatch) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const articleId = parseId(aboutArticleStatusMatch[1]);
    const payload = await readJson(req);
    const status = payload.status === "hidden" ? "hidden" : "published";

    const { rows } = await query(
      `
        UPDATE public_about_articles
        SET status = $2,
            hidden_at = CASE
              WHEN $2 = 'hidden' AND status <> 'hidden' THEN now()
              WHEN $2 = 'hidden' THEN COALESCE(hidden_at, now())
              ELSE NULL
            END,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [articleId, status]
    );

    if (rows.length === 0) {
      return sendError(res, 404, "Public article not found.");
    }

    return sendJson(res, 200, { article: toPublicAboutArticle(rows[0]) });
  }

  const aboutArticleMatch = pathname.match(/^\/api\/admin\/about\/articles\/(\d+)$/);
  if (method === "PATCH" && aboutArticleMatch) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const articleId = parseId(aboutArticleMatch[1]);
    const payload = await readJson(req);
    requireFields(payload, ["title", "body"]);
    const image = validateImageUpload(payload.image);
    const displayOrder = Number(payload.displayOrder || 0);
    const status = payload.status === "hidden" ? "hidden" : "published";

    const { rows } = await query(
      `
        UPDATE public_about_articles
        SET title = $2,
            body = $3,
            image_name = CASE WHEN $4 <> '' THEN $4 ELSE image_name END,
            image_type = CASE WHEN $4 <> '' THEN $5 ELSE image_type END,
            image_size = CASE WHEN $4 <> '' THEN $6 ELSE image_size END,
            image_data_url = CASE WHEN $4 <> '' THEN $7 ELSE image_data_url END,
            display_order = $8,
            status = $9,
            hidden_at = CASE
              WHEN $9 = 'hidden' AND status <> 'hidden' THEN now()
              WHEN $9 = 'hidden' THEN COALESCE(hidden_at, now())
              ELSE NULL
            END,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [
        articleId,
        String(payload.title).trim(),
        String(payload.body).trim(),
        image.name,
        image.type,
        image.size,
        image.dataUrl,
        Number.isFinite(displayOrder) ? Math.trunc(displayOrder) : 0,
        status
      ]
    );

    if (rows.length === 0) {
      return sendError(res, 404, "Public article not found.");
    }

    return sendJson(res, 200, { article: toPublicAboutArticle(rows[0]) });
  }

  if (method === "DELETE" && aboutArticleMatch) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const articleId = parseId(aboutArticleMatch[1]);
    const { rowCount } = await query("DELETE FROM public_about_articles WHERE id = $1", [articleId]);

    if (rowCount === 0) {
      return sendError(res, 404, "Public article not found.");
    }

    return sendJson(res, 200, { deleted: true });
  }

  const paymentDetailMatch = pathname.match(/^\/api\/admin\/payment-details\/([a-z_]+)$/);
  if ((method === "PATCH" || method === "PUT") && paymentDetailMatch) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const paymentMethod = normalizePaymentMethod(paymentDetailMatch[1]);
    const payload = await readJson(req);
    const displayName = String(payload.displayName || "").trim();

    if (!displayName) {
      return sendError(res, 400, "Display name is required.");
    }

    const { rows } = await query(
      `
        INSERT INTO organization_payment_details (
          method,
          display_name,
          account_identifier,
          instructions,
          enabled,
          updated_by,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, now())
        ON CONFLICT (method)
        DO UPDATE SET
          display_name = EXCLUDED.display_name,
          account_identifier = EXCLUDED.account_identifier,
          instructions = EXCLUDED.instructions,
          enabled = EXCLUDED.enabled,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
        RETURNING *
      `,
      [
        paymentMethod,
        displayName,
        String(payload.accountIdentifier || "").trim(),
        String(payload.instructions || "").trim(),
        Boolean(payload.enabled),
        admin.id
      ]
    );

    return sendJson(res, 200, { paymentDetail: toPaymentDetail(rows[0]) });
  }

  if (method === "GET" && pathname === "/api/admin/notifications") {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const notifications = await listAdminNotifications({
      userId: url.searchParams.get("userId") || "",
      dateFrom: url.searchParams.get("dateFrom") || "",
      dateTo: url.searchParams.get("dateTo") || ""
    });

    return sendJson(res, 200, { notifications });
  }

  if (method === "GET" && pathname === "/api/admin/summary") {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const [members, questions, payments, ballots, announcements, events, expenditures, financialSummary, paymentDetails, about, social] = await Promise.all([
      listMembers(),
      listQuestions({ includePending: true }),
      listPayments(admin, { includeAll: true }),
      listBallots(admin, { includeDrafts: true, includeArchived: true }),
      listAdminAnnouncements(),
      listAdminEvents(),
      listExpenditures(),
      getFinancialSummary(),
      listOrganizationPaymentDetails({ includeDisabled: true }),
      getAboutContent({ includeHidden: true }),
      listSocialCoordinator(admin, { includeAll: true })
    ]);
    return sendJson(res, 200, { members, questions, payments, ballots, announcements, events, expenditures, financialSummary, paymentDetails, about, social });
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
});
