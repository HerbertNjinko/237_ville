export async function handlePublicRoutes(req, res, url, context) {
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

  if (method === "POST" && pathname === "/api/auth/forgot-password") {
    const payload = await readJson(req);
    requireFields(payload, ["email"]);
    const email = normalizeEmail(payload.email);
    const { rows } = await query(
      `
        SELECT id, full_name, email, membership_status
        FROM users
        WHERE email = $1
        LIMIT 1
      `,
      [email]
    );
    const user = rows[0];

    if (user && !["inactive", "suspended", "rejected"].includes(user.membership_status)) {
      await notifyAdmins(
        "password_reset",
        "Password reset requested",
        `${user.full_name} (${user.email}) requested a password reset. Open Members / Profile, generate a temporary password, and provide it to the member.`,
        "/admin"
      );
    }

    return sendJson(res, 200, {
      message: "If that email belongs to an active 237 Ville account, an admin will receive a reset request."
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
        social: { meetings: [], resources: [], resourceAdjustments: [], resourceRequests: [], fundRequests: [] },
        financials: { donations: [], expenditures: [], summary: { donationTotalCents: 0, expenditureTotalCents: 0, publishedNetCents: 0 } }
      });
    }

    const [announcements, events, questions, ballots, financials, social] = await Promise.all([
      listAnnouncements(10),
      listEvents(10),
      listQuestions(),
      listBallots(user, { includeDrafts: hasStaffPermission(user, "votes") }),
      listPublishedFinancials(user),
      listSocialCoordinator(user, { includeAll: hasStaffPermission(user, "social") })
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


}
