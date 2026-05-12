export async function handleSocialRoutes(req, res, url, context) {
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
    socialAssignmentResponseDetails,
    buildSocialAnnouncementBody,
    updateEventAssignmentAnnouncement,
    updateSocialMeetingAnnouncement
  } = context;
  const method = req.method || "GET";
  const pathname = url.pathname;

  async function publishEventAssignmentsFromResponse(assignment, user) {
    if (!assignment.event_id) return null;
    return updateEventAssignmentAnnouncement(assignment.event_id, {
      createIfMissing: true,
      notify: true,
      actor: user,
      notificationBody: `${user.fullName} updated ${socialTaskLabel(assignment.task_type).toLowerCase()} details for ${assignment.event_title}.`
    });
  }

  if (method === "POST" && pathname === "/api/admin/social/meetings") {
    const admin = await requireStaffPermission(req, res, "social");
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
    const admin = await requireStaffPermission(req, res, "social");
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

    const announcement = await updateSocialMeetingAnnouncement(meetingId);
    await notifyActiveMembers(
      "social_meeting_update",
      `Monthly social meeting updated: ${rows[0].title}`,
      `${rows[0].title} meeting details were updated. Please review the latest monthly social meeting assignments.`,
      announcement ? `/announcements/${announcement.id}` : "/social"
    );

    return sendJson(res, 200, { meeting: toSocialMeeting(rows[0]) });
  }

  const socialMeetingCancelMatch = pathname.match(/^\/api\/admin\/social\/meetings\/(\d+)\/cancel$/);
  if (method === "POST" && socialMeetingCancelMatch) {
    const admin = await requireStaffPermission(req, res, "social");
    if (!admin) return;
    const meetingId = parseId(socialMeetingCancelMatch[1]);
    const meetingResult = await query("SELECT * FROM social_meetings WHERE id = $1 LIMIT 1", [meetingId]);
    const meeting = meetingResult.rows[0];
    if (!meeting) {
      return sendError(res, 404, "Social meeting not found.");
    }

    const { rows } = await query(
      `
        UPDATE social_meetings
        SET status = 'cancelled',
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [meetingId]
    );

    await query(
      `
        UPDATE social_assignments
        SET status = 'cancelled',
            updated_at = now()
        WHERE meeting_id = $1
          AND status IN ('assigned', 'completed')
      `,
      [meetingId]
    );

    const announcement = await updateSocialMeetingAnnouncement(meetingId);
    await notifyActiveMembers(
      "social_meeting_cancelled",
      `Monthly social meeting cancelled: ${rows[0].title}`,
      `${rows[0].title} has been cancelled. Assigned meeting tasks are cancelled.`,
      announcement ? `/announcements/${announcement.id}` : "/social"
    );

    return sendJson(res, 200, { meeting: toSocialMeeting(rows[0]), announcement });
  }

  const socialAssignmentCreateMatch = pathname.match(/^\/api\/admin\/social\/(meetings|events)\/(\d+)\/assignments$/);
  if (method === "POST" && socialAssignmentCreateMatch) {
    const admin = await requireStaffPermission(req, res, "social");
    if (!admin) return;
    const targetType = socialAssignmentCreateMatch[1] === "events" ? "event" : "meeting";
    const targetId = parseId(socialAssignmentCreateMatch[2]);
    const meetingId = targetType === "meeting" ? targetId : null;
    const eventId = targetType === "event" ? targetId : null;
    const payload = await readJson(req);
    requireFields(payload, ["title"]);
    const taskType = normalizeSocialTaskType(payload.taskType);
    const memberId = payload.userId ? parseId(payload.userId) : null;

    const targetResult = targetType === "meeting"
      ? await query("SELECT id, title, meeting_date AS target_date, status FROM social_meetings WHERE id = $1", [targetId])
      : await query(
          `
            SELECT id, title, starts_at::date AS target_date, status
            FROM events
            WHERE id = $1
              AND status = 'active'
              AND COALESCE(ends_at, starts_at) >= now()
          `,
          [targetId]
        );
    if (targetResult.rows.length === 0) {
      return sendError(res, 404, targetType === "event" ? "Upcoming active event not found." : "Social meeting not found.");
    }
    const target = targetResult.rows[0];

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
        INSERT INTO social_assignments (meeting_id, event_id, user_id, task_type, group_name, title, note, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'assigned')
        RETURNING *
      `,
      [
        meetingId,
        eventId,
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
        targetType === "event" ? "Event assignment" : "Social meeting assignment",
        `You were assigned ${socialTaskLabel(taskType).toLowerCase()} for ${target.title} on ${target.target_date}.`,
        "/social"
      );
    }

    if (eventId) {
      await updateEventAssignmentAnnouncement(eventId, { createIfMissing: true, actor: admin });
    } else if (meetingId) {
      await updateSocialMeetingAnnouncement(meetingId);
    }

    return sendJson(res, 201, { assignment: toSocialAssignment(rows[0]) });
  }

  const socialAssignmentMatch = pathname.match(/^\/api\/admin\/social\/assignments\/(\d+)$/);
  if (method === "PATCH" && socialAssignmentMatch) {
    const admin = await requireStaffPermission(req, res, "social");
    if (!admin) return;
    const assignmentId = parseId(socialAssignmentMatch[1]);
    const payload = await readJson(req);
    requireFields(payload, ["title"]);
    const taskType = normalizeSocialTaskType(payload.taskType);
    const memberId = payload.userId ? parseId(payload.userId) : null;
    const status = normalizeSocialAssignmentStatus(payload.status);

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
            archived_at = CASE WHEN $7 = 'archived' THEN COALESCE(archived_at, now()) ELSE NULL END,
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

    if (rows[0].event_id) {
      await updateEventAssignmentAnnouncement(rows[0].event_id, { createIfMissing: true, actor: admin });
    } else if (rows[0].meeting_id) {
      await updateSocialMeetingAnnouncement(rows[0].meeting_id);
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
               social_meetings.status AS meeting_status,
               events.title AS event_title,
               events.starts_at AS event_starts_at,
               events.status AS event_status
        FROM social_assignments
        LEFT JOIN social_meetings ON social_meetings.id = social_assignments.meeting_id
        LEFT JOIN events ON events.id = social_assignments.event_id
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
    const targetStatusOk = assignment.event_id ? assignment.event_status === "active" : assignment.meeting_status === "published";
    const targetDate = String(assignment.event_starts_at || assignment.meeting_date || "").slice(0, 10);
    if (!targetStatusOk || targetDate < new Date().toISOString().slice(0, 10)) {
      return sendError(res, 403, "You can only respond before a published meeting or active event date passes.");
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
      `${user.fullName} updated ${socialTaskLabel(assignment.task_type).toLowerCase()} details for ${assignment.event_title || assignment.meeting_title}.`,
      "/admin"
    );

    if (assignment.event_id) {
      await publishEventAssignmentsFromResponse(assignment, user);
    } else if (assignment.meeting_id) {
      await updateSocialMeetingAnnouncement(assignment.meeting_id);
    }

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
               social_meetings.status AS meeting_status,
               social_meetings.meeting_date,
               events.title AS event_title,
               events.starts_at AS event_starts_at,
               events.status AS event_status
        FROM social_assignments
        LEFT JOIN social_meetings ON social_meetings.id = social_assignments.meeting_id
        LEFT JOIN events ON events.id = social_assignments.event_id
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
    const targetStatusOk = assignment.event_id ? assignment.event_status === "active" : assignment.meeting_status === "published";
    const targetDate = String(assignment.event_starts_at || assignment.meeting_date || "").slice(0, 10);
    if (!targetStatusOk || targetDate < new Date().toISOString().slice(0, 10)) {
      return sendError(res, 403, "You can only request funds before a published meeting or active event date passes.");
    }
    if (!["food", "drinks"].includes(assignment.task_type)) {
      return sendError(res, 400, "Only food and drinks assignments can request preparation funds.");
    }

    const { rows } = await query(
      `
        INSERT INTO social_fund_requests (meeting_id, event_id, assignment_id, requested_by, item_description, amount_cents, reason)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `,
      [assignment.meeting_id, assignment.event_id, assignmentId, user.id, itemDescription, amountCents, reason]
    );

    await notifyAdmins(
      "social_fund_request",
      "New social fund request",
      `${user.fullName} requested $${centsToDollarAmount(amountCents)} for ${itemDescription} for ${assignment.event_title || assignment.meeting_title}.`,
      "/admin"
    );

    return sendJson(res, 201, { fundRequest: await getSocialFundRequest(rows[0].id) });
  }

  const socialPublishMatch = pathname.match(/^\/api\/admin\/social\/meetings\/(\d+)\/publish$/);
  if (method === "POST" && socialPublishMatch) {
    const admin = await requireStaffPermission(req, res, "social");
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
    const admin = await requireStaffPermission(req, res, "social");
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
    const admin = await requireStaffPermission(req, res, "social");
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
    const admin = await requireStaffPermission(req, res, "social");
    if (!admin) return;
    const resourceId = parseId(socialResourceStockMatch[1]);
    const payload = await readJson(req);
    const quantity = Math.trunc(Number(payload.quantity || 0));
    const note = String(payload.note || "").trim();

    if (quantity < 1) {
      return sendError(res, 400, "Enter a quantity of at least 1.");
    }

    const resource = await withTransaction(async (client) => {
      const { rows } = await client.query(
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
        throw Object.assign(new Error("Resource not found."), { statusCode: 404 });
      }

      await client.query(
        `
          INSERT INTO social_resource_adjustments (resource_id, adjustment_type, quantity, note, adjusted_by)
          VALUES ($1, 'purchase', $2, $3, $4)
        `,
        [resourceId, quantity, note, admin.id]
      );

      return rows[0];
    });

    return sendJson(res, 200, { resource: toSocialResource(resource) });
  }

  const socialResourceDestroyedMatch = pathname.match(/^\/api\/admin\/social\/resources\/(\d+)\/destroyed$/);
  if (method === "POST" && socialResourceDestroyedMatch) {
    const admin = await requireStaffPermission(req, res, "social");
    if (!admin) return;
    const resourceId = parseId(socialResourceDestroyedMatch[1]);
    const payload = await readJson(req);
    const quantity = Math.trunc(Number(payload.quantity || 0));
    const note = String(payload.note || "").trim();

    if (quantity < 1) {
      return sendError(res, 400, "Enter a destroyed quantity of at least 1.");
    }
    if (!note) {
      return sendError(res, 400, "Enter a note explaining why the resource was marked destroyed.");
    }

    const resource = await withTransaction(async (client) => {
      const currentResult = await client.query(
        "SELECT * FROM social_resources WHERE id = $1 FOR UPDATE",
        [resourceId]
      );
      const current = currentResult.rows[0];
      if (!current) {
        throw Object.assign(new Error("Resource not found."), { statusCode: 404 });
      }
      if (Number(current.available_quantity) < quantity) {
        throw Object.assign(new Error("Destroyed quantity cannot be greater than available quantity. Check in returned items first."), {
          statusCode: 400
        });
      }

      const { rows } = await client.query(
        `
          UPDATE social_resources
          SET total_quantity = total_quantity - $2,
              available_quantity = available_quantity - $2,
              updated_at = now()
          WHERE id = $1
          RETURNING *
        `,
        [resourceId, quantity]
      );

      await client.query(
        `
          INSERT INTO social_resource_adjustments (resource_id, adjustment_type, quantity, note, adjusted_by)
          VALUES ($1, 'destroyed', $2, $3, $4)
        `,
        [resourceId, quantity, note, admin.id]
      );

      return rows[0];
    });

    return sendJson(res, 200, { resource: toSocialResource(resource) });
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
    const eventId = payload.eventId ? parseId(payload.eventId) : null;
    const quantity = Math.max(1, Math.trunc(Number(payload.quantity || 1)));

    if (!meetingId && !eventId) {
      return sendError(res, 400, "Choose the meeting or event tied to your assigned task before requesting resources.");
    }
    if (meetingId && eventId) {
      return sendError(res, 400, "Choose either a meeting or an event, not both.");
    }

    const resourceResult = await query("SELECT id, name, status FROM social_resources WHERE id = $1 AND status = 'active'", [resourceId]);
    if (resourceResult.rows.length === 0) {
      return sendError(res, 404, "Active resource not found.");
    }

    const assignmentResult = await query(
      `
        SELECT social_assignments.id
        FROM social_assignments
        LEFT JOIN social_meetings ON social_meetings.id = social_assignments.meeting_id
        LEFT JOIN events ON events.id = social_assignments.event_id
        WHERE social_assignments.user_id = $3
          AND social_assignments.status = 'assigned'
          AND social_assignments.archived_at IS NULL
          AND (
            (
              $1::bigint IS NOT NULL
              AND social_assignments.meeting_id = $1
              AND social_meetings.status = 'published'
              AND social_meetings.meeting_date >= CURRENT_DATE
            )
            OR (
              $2::bigint IS NOT NULL
              AND social_assignments.event_id = $2
              AND events.status = 'active'
              AND COALESCE(events.ends_at, events.starts_at) >= now()
            )
          )
        LIMIT 1
      `,
      [meetingId, eventId, user.id]
    );
    if (assignmentResult.rows.length === 0) {
      return sendError(res, 403, "You can only request resources for an active meeting or event where you have an assigned task.");
    }

    const { rows } = await query(
      `
        INSERT INTO social_resource_requests (meeting_id, event_id, resource_id, requested_by, quantity, needed_date, return_date, note)
        VALUES ($1, $2, $3, $4, $5, NULLIF($6, '')::date, NULLIF($7, '')::date, $8)
        RETURNING *
      `,
      [
        meetingId,
        eventId,
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
      `${user.fullName} requested ${quantity} ${resourceResult.rows[0].name} for ${eventId ? "an event" : "a social meeting"}.`,
      "/admin"
    );

    return sendJson(res, 201, { request: rows[0] });
  }

  const socialResourceRequestStatusMatch = pathname.match(/^\/api\/admin\/social\/resource-requests\/(\d+)\/status$/);
  if (method === "PATCH" && socialResourceRequestStatusMatch) {
    const admin = await requireStaffPermission(req, res, "social");
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

      const currentReservesInventory = resourceRequestReservesInventory(current.status);
      const nextReservesInventory = resourceRequestReservesInventory(status);

      if (nextReservesInventory && !currentReservesInventory && Number(current.available_quantity) < Number(current.quantity)) {
        throw Object.assign(new Error("Not enough available resource quantity to approve this request."), { statusCode: 400 });
      }

      if (nextReservesInventory && !currentReservesInventory) {
        await client.query(
          "UPDATE social_resources SET available_quantity = available_quantity - $2, updated_at = now() WHERE id = $1",
          [current.resource_id, current.quantity]
        );
      }

      if (!nextReservesInventory && currentReservesInventory) {
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
              delivered_at = CASE WHEN $2 = 'delivered' THEN COALESCE(delivered_at, now()) ELSE delivered_at END,
              checked_in_at = CASE WHEN $2 = 'checked_in' THEN now() ELSE checked_in_at END,
              archived_at = CASE
                WHEN $2 = 'checked_in' THEN COALESCE(archived_at, now())
                WHEN $2 IN ('pending', 'approved', 'delivered') THEN NULL
                ELSE archived_at
              END,
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
      `Your request for ${result.previous.resource_name} was marked ${status.replaceAll("_", " ")}.`,
      "/social"
    );

    return sendJson(res, 200, { request: result.request });
  }

  const socialFundRequestStatusMatch = pathname.match(/^\/api\/admin\/social\/fund-requests\/(\d+)\/status$/);
  if (method === "PATCH" && socialFundRequestStatusMatch) {
    const admin = await requireStaffPermission(req, res, "social");
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


}
