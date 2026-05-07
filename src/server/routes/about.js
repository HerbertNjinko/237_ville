export async function handleAboutRoutes(req, res, url, context) {
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

  if (method === "PATCH" && pathname === "/api/admin/about") {
    const admin = await requireStaffPermission(req, res, "about");
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
    const admin = await requireStaffPermission(req, res, "about");
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
    const admin = await requireStaffPermission(req, res, "about");
    if (!admin) return;
    const positionId = parseId(aboutPositionStatusMatch[1]);
    const payload = await readJson(req);
    const status = normalizeLeadershipStatus(payload.status);
    if (status === "archived" && admin.role !== "admin") {
      return sendError(res, 403, "Only full admins can archive leadership positions.");
    }

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
    const admin = await requireStaffPermission(req, res, "about");
    if (!admin) return;
    const positionId = parseId(aboutPositionMatch[1]);
    const payload = await readJson(req);
    requireFields(payload, ["title"]);
    const image = validateImageUpload(payload.image);
    const displayOrder = Number(payload.displayOrder || 0);
    const status = normalizeLeadershipStatus(payload.status);
    if (status === "archived" && admin.role !== "admin") {
      return sendError(res, 403, "Only full admins can archive leadership positions.");
    }

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
    const admin = await requireStaffPermission(req, res, "about");
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
    const admin = await requireStaffPermission(req, res, "about");
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
    const admin = await requireStaffPermission(req, res, "about");
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


}
