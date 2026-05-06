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

async function listEvents(limit = 30) {
  const { rows } = await query(
    `
      SELECT events.*, users.full_name AS author_name
      FROM events
      LEFT JOIN users ON users.id = events.created_by
      WHERE events.starts_at >= now() - interval '1 day'
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
    authorName: row.author_name || "237 Ville"
  }));
}

async function listAdminEvents(limit = 100) {
  const { rows } = await query(
    `
      SELECT events.*, users.full_name AS author_name
      FROM events
      LEFT JOIN users ON users.id = events.created_by
      ORDER BY events.starts_at DESC
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
    authorName: row.author_name || "237 Ville"
  }));
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
          JOIN users ON users.id = payments.user_id
          ORDER BY payments.created_at DESC
          LIMIT 100
        `
      )
    : await query(
        `
          SELECT payments.*, users.full_name, users.email
          FROM payments
          JOIN users ON users.id = payments.user_id
          WHERE payments.user_id = $1
          ORDER BY payments.created_at DESC
          LIMIT 50
        `,
        [user.id]
      );

  return rows.map((row) => ({
    id: Number(row.id),
    userId: Number(row.user_id),
    memberName: row.full_name,
    memberEmail: row.email,
    purpose: row.purpose,
    amountCents: Number(row.amount_cents),
    method: row.method,
    status: row.status,
    note: row.note || "",
    externalReference: row.external_reference || "",
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at
  }));
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

async function handleApi(req, res, url) {
  const method = req.method || "GET";
  const pathname = url.pathname;

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

    const [notifications, payments] = await Promise.all([
      listNotifications(user),
      listPayments(user)
    ]);

    if (isOnboardingUser(user)) {
      return sendJson(res, 200, {
        user,
        onboarding: true,
        policy: config.organizationPolicy,
        registrationFeeCents: config.registrationFeeCents,
        payments,
        notifications,
        announcements: [],
        events: [],
        questions: [],
        ballots: []
      });
    }

    const [announcements, events, questions, ballots] = await Promise.all([
      listAnnouncements(10),
      listEvents(10),
      listQuestions(),
      listBallots(user, { includeDrafts: user.role === "admin" })
    ]);

    return sendJson(res, 200, {
      user,
      onboarding: false,
      announcements,
      events,
      questions,
      ballots,
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
    const { rows } = await query(
      `
        INSERT INTO payments (user_id, purpose, amount_cents, method, note, external_reference)
        VALUES ($1, 'registration_fee', $2, $3, $4, $5)
        RETURNING *
      `,
      [
        user.id,
        config.registrationFeeCents,
        String(payload.method || "offline").trim(),
        String(payload.note || "").trim(),
        String(payload.externalReference || "").trim()
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

    const { rows } = await query(
      `
        INSERT INTO payments (user_id, purpose, amount_cents, method, note, external_reference)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `,
      [
        user.id,
        purpose,
        amountCents,
        String(payload.method || "offline").trim(),
        String(payload.note || "").trim(),
        String(payload.externalReference || "").trim()
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
    const status = ["pending", "received", "cancelled"].includes(payload.status) ? payload.status : "pending";
    const payment = await withTransaction(async (client) => {
      const paymentResult = await client.query(
        `
          UPDATE payments
          SET status = $2,
              reviewed_by = $3,
              reviewed_at = now()
          WHERE id = $1
          RETURNING *
        `,
        [paymentId, status, admin.id]
      );

      const row = paymentResult.rows[0];

      if (row?.purpose === "registration_fee") {
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
      return sendError(res, 404, "Payment not found.");
    }

    if (payment.purpose === "registration_fee" && status === "received") {
      await createNotification(
        payment.user_id,
        "registration_fee",
        "Registration fee processed",
        "Your registration fee has been received. Your 237 Ville member portal is now active.",
        "/"
      );
    }

    if (payment.purpose === "registration_fee" && status === "cancelled") {
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
    const [members, questions, payments, ballots, announcements, events] = await Promise.all([
      listMembers(),
      listQuestions({ includePending: true }),
      listPayments(admin, { includeAll: true }),
      listBallots(admin, { includeDrafts: true, includeArchived: true }),
      listAdminAnnouncements(),
      listAdminEvents()
    ]);
    return sendJson(res, 200, { members, questions, payments, ballots, announcements, events });
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
