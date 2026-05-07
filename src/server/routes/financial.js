export async function handleFinancialRoutes(req, res, url, context) {
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
    const role = normalizeUserRole(payload.role);
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
    const admin = await requireStaffPermission(req, res, "payments");
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
    const admin = await requireStaffPermission(req, res, "payments");
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
    const admin = await requireStaffPermission(req, res, "expenditures");
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
    const admin = await requireStaffPermission(req, res, "expenditures");
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

  if (method === "POST" && pathname === "/api/admin/budgets") {
    const admin = await requireStaffPermission(req, res, "budgets");
    if (!admin) return;
    const payload = await readJson(req);
    requireFields(payload, ["departmentName", "title", "amount"]);
    const amountCents = dollarsToCents(payload.amount);
    const status = normalizeDepartmentBudgetStatus(payload.status);
    const assignedTo = payload.assignedTo ? parseId(payload.assignedTo) : null;

    if (assignedTo) {
      const memberResult = await query(
        "SELECT id FROM users WHERE id = $1 AND role = 'member' AND membership_status = 'active'",
        [assignedTo]
      );
      if (memberResult.rows.length === 0) {
        return sendError(res, 400, "Budget stewards must be active member accounts.");
      }
    }

    const { rows } = await query(
      `
        INSERT INTO department_budgets (
          department_name,
          title,
          amount_cents,
          period_start,
          period_end,
          purpose,
          assigned_to,
          status,
          created_by,
          published_at
        )
        VALUES ($1, $2, $3, NULLIF($4, '')::date, NULLIF($5, '')::date, $6, $7, $8, $9, CASE WHEN $8 = 'published' THEN now() ELSE NULL END)
        RETURNING *
      `,
      [
        String(payload.departmentName).trim(),
        String(payload.title).trim(),
        amountCents,
        String(payload.periodStart || "").trim(),
        String(payload.periodEnd || "").trim(),
        String(payload.purpose || "").trim(),
        assignedTo,
        status,
        admin.id
      ]
    );

    if (status === "published") {
      await notifyActiveMembers(
        "budget",
        "Department budget published",
        `${rows[0].department_name} was assigned a $${centsToDollarAmount(rows[0].amount_cents)} budget for ${rows[0].title}.`,
        "/financials"
      );
    }

    if (assignedTo) {
      await createNotification(
        assignedTo,
        "budget",
        "Department budget assigned",
        `You were assigned as steward for the ${rows[0].department_name} budget: ${rows[0].title}.`,
        "/financials"
      );
    }

    return sendJson(res, 201, { budget: toDepartmentBudget(rows[0]) });
  }

  const departmentBudgetMatch = pathname.match(/^\/api\/admin\/budgets\/(\d+)$/);
  if (method === "PATCH" && departmentBudgetMatch) {
    const admin = await requireStaffPermission(req, res, "budgets");
    if (!admin) return;
    const budgetId = parseId(departmentBudgetMatch[1]);
    const payload = await readJson(req);
    requireFields(payload, ["departmentName", "title", "amount"]);
    const amountCents = dollarsToCents(payload.amount);
    const status = normalizeDepartmentBudgetStatus(payload.status);
    const assignedTo = payload.assignedTo ? parseId(payload.assignedTo) : null;

    if (assignedTo) {
      const memberResult = await query(
        "SELECT id FROM users WHERE id = $1 AND role = 'member' AND membership_status = 'active'",
        [assignedTo]
      );
      if (memberResult.rows.length === 0) {
        return sendError(res, 400, "Budget stewards must be active member accounts.");
      }
    }

    const { rows } = await query(
      `
        UPDATE department_budgets
        SET department_name = $2,
            title = $3,
            amount_cents = $4,
            period_start = NULLIF($5, '')::date,
            period_end = NULLIF($6, '')::date,
            purpose = $7,
            assigned_to = $8,
            status = $9,
            published_at = CASE WHEN $9 = 'published' THEN COALESCE(published_at, now()) ELSE published_at END,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [
        budgetId,
        String(payload.departmentName).trim(),
        String(payload.title).trim(),
        amountCents,
        String(payload.periodStart || "").trim(),
        String(payload.periodEnd || "").trim(),
        String(payload.purpose || "").trim(),
        assignedTo,
        status
      ]
    );

    if (rows.length === 0) {
      return sendError(res, 404, "Department budget not found.");
    }

    if (status === "published") {
      await notifyActiveMembers(
        "budget",
        "Department budget updated",
        `${rows[0].department_name} has a $${centsToDollarAmount(rows[0].amount_cents)} published budget for ${rows[0].title}.`,
        "/financials"
      );
    }

    return sendJson(res, 200, { budget: toDepartmentBudget(rows[0]) });
  }

  const adminBudgetExpenseMatch = pathname.match(/^\/api\/admin\/budgets\/(\d+)\/expenses$/);
  if (method === "POST" && adminBudgetExpenseMatch) {
    const admin = await requireStaffPermission(req, res, "budgets");
    if (!admin) return;
    const budgetId = parseId(adminBudgetExpenseMatch[1]);
    const payload = await readJson(req);
    requireFields(payload, ["title", "amount"]);
    const amountCents = dollarsToCents(payload.amount);
    const status = normalizeDepartmentBudgetExpenseStatus(payload.status);

    const budgetResult = await query("SELECT * FROM department_budgets WHERE id = $1", [budgetId]);
    const budget = budgetResult.rows[0];
    if (!budget) {
      return sendError(res, 404, "Department budget not found.");
    }

    const { rows } = await query(
      `
        INSERT INTO department_budget_expenses (
          budget_id,
          title,
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
        budgetId,
        String(payload.title).trim(),
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
        "budget",
        "Budget expense published",
        `${budget.department_name} published a $${centsToDollarAmount(rows[0].amount_cents)} budget expense for ${rows[0].title}.`,
        "/financials"
      );
    }

    return sendJson(res, 201, { expense: toDepartmentBudgetExpense(rows[0]) });
  }

  const memberBudgetExpenseMatch = pathname.match(/^\/api\/budgets\/(\d+)\/expenses$/);
  if (method === "POST" && memberBudgetExpenseMatch) {
    const user = await requireActiveUser(req, res);
    if (!user) return;
    if (user.role !== "member") {
      return sendError(res, 403, "Only assigned department members can submit budget expenses.");
    }
    const budgetId = parseId(memberBudgetExpenseMatch[1]);
    const payload = await readJson(req);
    requireFields(payload, ["title", "amount"]);
    const amountCents = dollarsToCents(payload.amount);

    const budgetResult = await query(
      "SELECT * FROM department_budgets WHERE id = $1 AND assigned_to = $2 AND status = 'published'",
      [budgetId, user.id]
    );
    const budget = budgetResult.rows[0];
    if (!budget) {
      return sendError(res, 403, "You can only submit expenses for a published budget assigned to you.");
    }

    const { rows } = await query(
      `
        INSERT INTO department_budget_expenses (
          budget_id,
          title,
          vendor,
          amount_cents,
          expense_date,
          note,
          status,
          created_by
        )
        VALUES ($1, $2, $3, $4, COALESCE(NULLIF($5, '')::date, CURRENT_DATE), $6, 'draft', $7)
        RETURNING *
      `,
      [
        budgetId,
        String(payload.title).trim(),
        String(payload.vendor || "").trim(),
        amountCents,
        String(payload.expenseDate || "").trim(),
        String(payload.note || "").trim(),
        user.id
      ]
    );

    await notifyAdmins(
      "budget_expense",
      "Budget expense submitted",
      `${user.fullName} submitted a $${centsToDollarAmount(amountCents)} expense for the ${budget.department_name} budget.`,
      "/admin"
    );

    return sendJson(res, 201, { expense: toDepartmentBudgetExpense(rows[0]) });
  }

  const budgetExpensePublishMatch = pathname.match(/^\/api\/admin\/budget-expenses\/(\d+)\/publish$/);
  if (method === "POST" && budgetExpensePublishMatch) {
    const admin = await requireStaffPermission(req, res, "budgets");
    if (!admin) return;
    const expenseId = parseId(budgetExpensePublishMatch[1]);
    const { rows } = await query(
      `
        UPDATE department_budget_expenses
        SET status = 'published',
            published_at = COALESCE(published_at, now()),
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [expenseId]
    );

    if (rows.length === 0) {
      return sendError(res, 404, "Budget expense not found.");
    }

    await notifyActiveMembers(
      "budget",
      "Budget expense published",
      `${rows[0].title} was published as a $${centsToDollarAmount(rows[0].amount_cents)} department budget expense.`,
      "/financials"
    );

    return sendJson(res, 200, { expense: toDepartmentBudgetExpense(rows[0]) });
  }

  if (method === "GET" && pathname === "/api/admin/payment-details") {
    const admin = await requireStaffPermission(req, res, "payment-details");
    if (!admin) return;
    return sendJson(res, 200, { paymentDetails: await listOrganizationPaymentDetails({ includeDisabled: true }) });
  }

  const paymentDetailMatch = pathname.match(/^\/api\/admin\/payment-details\/([a-z_]+)$/);
  if ((method === "PATCH" || method === "PUT") && paymentDetailMatch) {
    const admin = await requireStaffPermission(req, res, "payment-details");
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


}
