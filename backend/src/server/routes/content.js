export async function handleContentRoutes(req, res, url, context) {
  const {
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
    hasStaffPermission,
    parseId,
    dollarsToCents,
    centsToDollarAmount,
    normalizePaymentMethod,
    normalizePaymentRecordDetails,
    validateIdentityDocument,
    validateImageUpload,
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
  } = context;
  const method = req.method || "GET";
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/api/announcements") {
    const user = await requireActiveUser(req, res);
    if (!user) return;
    return sendJson(res, 200, { announcements: await listAnnouncements(50) });
  }

  if (method === "POST" && pathname === "/api/admin/announcements") {
    const admin = await requireStaffPermission(req, res, "announcements");
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

  const announcementUpdateMatch = pathname.match(/^\/api\/admin\/announcements\/(\d+)$/);
  if (method === "PATCH" && announcementUpdateMatch) {
    const admin = await requireStaffPermission(req, res, "announcements");
    if (!admin) return;
    const announcementId = parseId(announcementUpdateMatch[1]);
    const payload = await readJson(req);
    requireFields(payload, ["title", "body"]);

    const { rows: existingRows } = await query(
      "SELECT * FROM announcements WHERE id = $1",
      [announcementId]
    );

    if (existingRows.length === 0) {
      return sendError(res, 404, "Announcement not found.");
    }

    const existing = existingRows[0];
    const status = payload.status === "draft" ? "draft" : "published";
    const wasPublished = existing.status === "published";
    const isNowPublished = status === "published";

    const { rows } = await query(
      `
        UPDATE announcements
        SET title = $2,
            body = $3,
            category = $4,
            status = $5,
            published_at = CASE WHEN $5 = 'published' AND published_at IS NULL THEN now() ELSE published_at END,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [
        announcementId,
        String(payload.title).trim(),
        String(payload.body).trim(),
        String(payload.category || "announcement").trim(),
        status
      ]
    );

    if (isNowPublished && !wasPublished) {
      await createAnnouncementNotifications(rows[0]);
    }

    return sendJson(res, 200, { announcement: rows[0] });
  }

  const announcementDeleteMatch = pathname.match(/^\/api\/admin\/announcements\/(\d+)$/);
  if (method === "DELETE" && announcementDeleteMatch) {
    const admin = await requireStaffPermission(req, res, "announcements");
    if (!admin) return;
    const announcementId = parseId(announcementDeleteMatch[1]);

    const { rows } = await query(
      "DELETE FROM announcements WHERE id = $1 RETURNING id",
      [announcementId]
    );

    if (rows.length === 0) {
      return sendError(res, 404, "Announcement not found.");
    }

    return sendNoContent(res, 204);
  }

  if (method === "GET" && pathname === "/api/events") {
    const user = await requireActiveUser(req, res);
    if (!user) return;
    return sendJson(res, 200, { events: await listEvents(50) });
  }

  if (method === "POST" && pathname === "/api/admin/events") {
    const admin = await requireStaffPermission(req, res, "events");
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
    const admin = await requireStaffPermission(req, res, "events");
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
    const admin = await requireStaffPermission(req, res, "questions");
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
    const admin = await requireStaffPermission(req, res, "questions");
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
    return sendJson(res, 200, { ballots: await listBallots(user, { includeDrafts: hasStaffPermission(user, "votes") }) });
  }

  if (method === "POST" && pathname === "/api/admin/ballots") {
    const admin = await requireStaffPermission(req, res, "votes");
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
    const admin = await requireStaffPermission(req, res, "votes");
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


}
