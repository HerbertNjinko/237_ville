export async function handleNotificationRoutes(req, res, url, context) {
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
    const admin = await requireStaffPermission(req, res, "notifications:clear");
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
    const admin = await requireStaffPermission(req, res, "notifications:view");
    if (!admin) return;

    const notifications = await listAdminNotifications({
      userId: url.searchParams.get("userId") || "",
      dateFrom: url.searchParams.get("dateFrom") || "",
      dateTo: url.searchParams.get("dateTo") || ""
    });

    return sendJson(res, 200, { notifications });
  }

  if (method === "GET" && pathname === "/api/admin/summary") {
    const admin = await requireStaffPermission(req, res, "overview");
    if (!admin) return;
    const [members, questions, payments, ballots, announcements, events, expenditures, budgets, financialSummary, paymentDetails, about, social] = await Promise.all([
      listMembers(),
      listQuestions({ includePending: true }),
      listPayments(admin, { includeAll: true }),
      listBallots(admin, { includeDrafts: true, includeArchived: true }),
      listAdminAnnouncements(),
      listAdminEvents(),
      listExpenditures(),
      listDepartmentBudgets({ includeAll: true }),
      getFinancialSummary(),
      listOrganizationPaymentDetails({ includeDisabled: true }),
      getAboutContent({ includeHidden: true }),
      listSocialCoordinator(admin, { includeAll: true })
    ]);

    const canUseMembers =
      hasStaffPermission(admin, "profile:view") ||
      hasStaffPermission(admin, "payments") ||
      hasStaffPermission(admin, "budgets") ||
      hasStaffPermission(admin, "social") ||
      hasStaffPermission(admin, "notifications:view");
    const canUseFinancials =
      hasStaffPermission(admin, "payments") ||
      hasStaffPermission(admin, "expenditures") ||
      hasStaffPermission(admin, "budgets");
    const shouldUseFullMemberList =
      hasStaffPermission(admin, "profile:view") ||
      hasStaffPermission(admin, "payments") ||
      hasStaffPermission(admin, "notifications:view");
    const memberSummarySource = shouldUseFullMemberList
      ? members
      : members.filter((member) => member.role === "member" && member.membershipStatus === "active");

    return sendJson(res, 200, {
      members: canUseMembers ? membersForStaffSummary(memberSummarySource, admin) : [],
      questions: hasStaffPermission(admin, "questions") ? questions : [],
      payments: hasStaffPermission(admin, "payments") ? payments : [],
      ballots: hasStaffPermission(admin, "votes") ? ballots : [],
      announcements: hasStaffPermission(admin, "announcements") ? announcements : [],
      events: hasStaffPermission(admin, "events") ? events : [],
      expenditures: hasStaffPermission(admin, "expenditures") ? expenditures : [],
      budgets: hasStaffPermission(admin, "budgets") ? budgets : [],
      financialSummary: canUseFinancials ? financialSummary : null,
      paymentDetails: hasStaffPermission(admin, "payment-details") ? paymentDetails : [],
      about: hasStaffPermission(admin, "about") ? about : null,
      social: hasStaffPermission(admin, "social")
        ? social
        : { meetings: [], resources: [], resourceAdjustments: [], resourceRequests: [], fundRequests: [] }
    });
  }


}
