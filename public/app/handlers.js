function filteredMembers() {
  const members = state.admin.members || [];
  const query = state.memberFilter.query.trim().toLowerCase();

  if (state.memberFilter.scope !== "name" || !query) {
    return members;
  }

  return members.filter((member) =>
    `${member.firstName} ${member.lastName} ${member.fullName}`.toLowerCase().includes(query)
  );
}

function formPayload(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function parseOptions(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, ...descriptionParts] = line.split(" - ");
      return {
        label: label.trim(),
        description: descriptionParts.join(" - ").trim()
      };
    });
}

async function imagePayloadFromInput(input) {
  const file = input?.files?.[0];
  if (!file) return null;

  if (file.size > 3_000_000) {
    throw new Error("Image file must be 3 MB or smaller.");
  }

  const acceptedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!acceptedTypes.includes(file.type)) {
    throw new Error("Image must be a JPG, PNG, or WebP file.");
  }

  return {
    name: file.name,
    type: file.type,
    size: file.size,
    dataUrl: await fileToDataUrl(file)
  };
}

async function receiptPayloadFromInput(input) {
  const file = input?.files?.[0];
  if (!file) return null;

  if (file.size > 5_000_000) {
    throw new Error("Receipt file must be 5 MB or smaller.");
  }

  const acceptedTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  if (!acceptedTypes.includes(file.type)) {
    throw new Error("Receipt must be a JPG, PNG, WebP, or PDF file.");
  }

  return {
    name: file.name,
    type: file.type,
    size: file.size,
    dataUrl: await fileToDataUrl(file)
  };
}

async function handleSubmit(event) {
  const form = event.target.closest("form[data-action]");
  if (!form) return;
  event.preventDefault();
  const action = form.dataset.action;
  const payload = formPayload(form);

  try {
    if (action === "login") {
      const { user } = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      state.user = user;
      state.message = "";
      state.messageType = "";
      await loadDashboard();
      render();
      return;
    }

    if (action === "register") {
      const file = form.elements.identityDocument?.files?.[0];

      if (!file) {
        throw new Error("ID card upload is required.");
      }

      if (file.size > 3_000_000) {
        throw new Error("ID card file must be 3 MB or smaller.");
      }

      const acceptedTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
      if (!acceptedTypes.includes(file.type)) {
        throw new Error("ID card must be a JPG, PNG, WebP, or PDF file.");
      }

      payload.identityDocument = {
        name: file.name,
        type: file.type,
        size: file.size,
        dataUrl: await fileToDataUrl(file)
      };

      const result = await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      state.authMode = "login";
      state.message = result.message || "Registration submitted. Wait for admin approval and a temporary password.";
      state.messageType = "ok";
      render();
      return;
    }

    if (action === "anonymous-donation") {
      const result = await api("/api/donations/anonymous", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      form.reset();
      state.message = result.message || "Donation submitted.";
      state.messageType = "ok";
      render();
      return;
    }

    if (action === "change-password") {
      if (payload.newPassword !== payload.confirmPassword) {
        throw new Error("New password and confirmation do not match.");
      }
      const { user } = await api("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ newPassword: payload.newPassword })
      });
      state.user = user;
      state.message = "Password updated.";
      state.messageType = "ok";
      await loadDashboard();
      render();
      return;
    }

    if (action === "accept-policy") {
      if (!form.elements.accepted?.checked) {
        throw new Error("You need to acknowledge the policy before continuing.");
      }
      const { user } = await api("/api/onboarding/policy", {
        method: "POST",
        body: JSON.stringify({ signatureName: payload.signatureName })
      });
      state.user = user;
      state.message = "Policy signed. Submit your registration fee for review.";
      state.messageType = "ok";
      await loadDashboard();
      render();
      return;
    }

    if (action === "submit-registration-fee") {
      await api("/api/onboarding/registration-fee", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      state.message = "Registration fee submitted for admin review.";
      state.messageType = "ok";
      await loadDashboard();
      render();
      return;
    }

    if (action === "update-profile") {
      payload.notificationOptIn = Boolean(form.elements.notificationOptIn?.checked);
      const { user } = await api("/api/me", {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      state.user = user;
      state.message = "Profile saved.";
      state.messageType = "ok";
      await refreshAll();
      return;
    }

    if (action === "create-question") {
      await api("/api/questions", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      form.reset();
      state.message = payload.contentType === "article" ? "Article submitted for admin review." : "Question submitted for admin review.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: isAdminPortalUser() });
      return;
    }

    if (action === "add-comment") {
      await api(`/api/questions/${form.dataset.questionId}/comments`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      state.message = "Comment posted.";
      state.messageType = "ok";
      await refreshAll();
      return;
    }

    if (action === "record-payment") {
      await api("/api/payments", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      form.reset();
      state.message = "Payment record submitted.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: isAdminPortalUser() });
      return;
    }

    if (action === "update-about") {
      await api("/api/admin/about", {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      state.message = "About page content saved.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "create-leadership-position") {
      const image = await imagePayloadFromInput(form.elements.image);
      await api("/api/admin/about/positions", {
        method: "POST",
        body: JSON.stringify({ ...payload, image })
      });
      form.reset();
      state.editingLeadershipPositionId = null;
      state.message = "Leadership position added.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "update-leadership-position") {
      const image = await imagePayloadFromInput(form.elements.image);
      await api(`/api/admin/about/positions/${form.dataset.positionId}`, {
        method: "PATCH",
        body: JSON.stringify({ ...payload, image })
      });
      state.editingLeadershipPositionId = null;
      state.message = "Leadership position saved.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "create-about-article") {
      const image = await imagePayloadFromInput(form.elements.image);
      await api("/api/admin/about/articles", {
        method: "POST",
        body: JSON.stringify({ ...payload, image })
      });
      form.reset();
      state.editingAboutArticleId = null;
      state.message = "Public home article published.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "update-about-article") {
      const image = await imagePayloadFromInput(form.elements.image);
      await api(`/api/admin/about/articles/${form.dataset.articleId}`, {
        method: "PATCH",
        body: JSON.stringify({ ...payload, image })
      });
      state.editingAboutArticleId = null;
      state.message = "Public home article saved.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "create-announcement") {
      await api("/api/admin/announcements", {
        method: "POST",
        body: JSON.stringify({ ...payload, status: "published" })
      });
      form.reset();
      state.message = "Announcement published.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "create-event") {
      await api("/api/admin/events", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      form.reset();
      state.message = "Event created.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "update-event") {
      await api(`/api/admin/events/${form.dataset.eventId}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      state.message = "Event updated.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "create-social-meeting") {
      await api("/api/admin/social/meetings", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      form.reset();
      state.message = "Social meeting created.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "update-social-meeting") {
      await api(`/api/admin/social/meetings/${form.dataset.meetingId}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      state.message = "Social meeting saved.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "create-social-assignment") {
      const meetingId = form.dataset.meetingId || payload.meetingId;
      if (!meetingId) {
        state.message = "Choose a monthly meeting before assigning the task.";
        state.messageType = "error";
        render();
        return;
      }
      delete payload.meetingId;
      await api(`/api/admin/social/meetings/${meetingId}/assignments`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      form.reset();
      state.message = "Social assignment added.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "update-social-assignment") {
      await api(`/api/admin/social/assignments/${form.dataset.assignmentId}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      state.message = "Social assignment saved.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "respond-social-assignment") {
      payload.drinkIsAlcoholic = Boolean(form.elements.drinkIsAlcoholic?.checked);
      payload.drinkBottleCount = Number(payload.drinkBottleCount || 0);
      await api(`/api/social/assignments/${form.dataset.assignmentId}/response`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      state.message = "Task response saved.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: isAdminPortalUser() });
      return;
    }

    if (action === "create-social-fund-request") {
      payload.assignmentId = Number(form.dataset.assignmentId);
      await api("/api/social/fund-requests", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      form.reset();
      state.message = "Fund request submitted.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: isAdminPortalUser() });
      return;
    }

    if (action === "create-social-resource") {
      await api("/api/admin/social/resources", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      form.reset();
      state.message = "Resource added.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "add-social-resource-stock") {
      payload.quantity = Number(payload.quantity || 0);
      await api(`/api/admin/social/resources/${form.dataset.resourceId}/stock`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      form.reset();
      state.message = "Resource quantity updated.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "destroy-social-resource-stock") {
      payload.quantity = Number(payload.quantity || 0);
      await api(`/api/admin/social/resources/${form.dataset.resourceId}/destroyed`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      form.reset();
      state.message = "Destroyed resource quantity recorded.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "update-social-resource") {
      await api(`/api/admin/social/resources/${form.dataset.resourceId}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      state.message = "Resource saved.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "create-social-resource-request") {
      await api("/api/social/resource-requests", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      form.reset();
      state.message = "Resource request submitted.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: isAdminPortalUser() });
      return;
    }

    if (action === "update-social-resource-request") {
      await api(`/api/admin/social/resource-requests/${form.dataset.requestId}/status`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      state.message = "Resource request updated.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "update-social-fund-request") {
      await api(`/api/admin/social/fund-requests/${form.dataset.requestId}/status`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      state.message = "Fund request updated.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "create-expenditure") {
      payload.receipt = await receiptPayloadFromInput(form.elements.receipt);
      await api("/api/admin/expenditures", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      form.reset();
      state.message = payload.status === "published" ? "Expense saved and published." : "Expense saved.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "create-department-budget") {
      await api("/api/admin/budgets", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      form.reset();
      state.message = payload.status === "published" ? "Budget created and published." : "Budget created.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "update-department-budget") {
      await api(`/api/admin/budgets/${form.dataset.budgetId}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      state.message = "Budget saved.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "admin-budget-expense") {
      payload.receipt = await receiptPayloadFromInput(form.elements.receipt);
      await api(`/api/admin/budgets/${form.dataset.budgetId}/expenses`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      form.reset();
      state.message = payload.status === "published" ? "Budget expense saved and published." : "Budget expense saved.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "member-budget-expense") {
      payload.receipt = await receiptPayloadFromInput(form.elements.receipt);
      await api(`/api/budgets/${form.dataset.budgetId}/expenses`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      form.reset();
      state.message = "Budget expense submitted for admin review.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: isAdminPortalUser() });
      return;
    }

    if (action === "update-payment-detail") {
      payload.enabled = Boolean(form.elements.enabled?.checked);
      await api(`/api/admin/payment-details/${form.dataset.method}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      state.message = "Payment detail saved.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "create-ballot") {
      await api("/api/admin/ballots", {
        method: "POST",
        body: JSON.stringify({
          ...payload,
          questionId: payload.questionId ? Number(payload.questionId) : null,
          options: parseOptions(payload.options)
        })
      });
      form.reset();
      state.message = "Ballot created.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "approve-member") {
      await api(`/api/admin/members/${form.dataset.memberId}/approve`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      form.reset();
      state.message = "Member approved. Provide the temporary password to the member.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "reject-member") {
      await api(`/api/admin/members/${form.dataset.memberId}/reject`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      form.reset();
      state.message = "Member registration rejected.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "admin-update-member") {
      await api(`/api/admin/members/${form.dataset.memberId}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      state.message = "User details updated.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "clear-old-notifications") {
      const result = await api("/api/admin/notifications/clear-old", {
        method: "POST",
        body: JSON.stringify({ days: Number(payload.days) })
      });
      state.message = `${result.deletedCount} old notification${result.deletedCount === 1 ? "" : "s"} cleared.`;
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "filter-notifications") {
      state.notificationFilters = {
        userId: payload.userId || "",
        dateFrom: payload.dateFrom || "",
        dateTo: payload.dateTo || ""
      };
      await loadAdminNotifications();
      render();
      return;
    }

    if (action === "filter-members") {
      state.memberFilter = {
        scope: payload.scope === "name" ? "name" : "all",
        query: payload.query || ""
      };
      render();
      return;
    }

    if (action === "filter-about-articles") {
      state.aboutArticleFilters = {
        status: ["published", "hidden"].includes(payload.status) ? payload.status : "all",
        query: payload.query || ""
      };
      render();
      return;
    }

    if (action === "filter-leadership-positions") {
      state.leadershipFilters = {
        status: ["published", "hidden", "archived"].includes(payload.status) ? payload.status : "all",
        query: payload.query || ""
      };
      render();
      return;
    }

    if (action === "filter-archived-votes") {
      state.voteArchiveQuery = payload.query || "";
      render();
    }
  } catch (error) {
    state.message = error.message;
    state.messageType = "error";
    render();
  }
}

async function handleClick(event) {
  const authMode = event.target.closest("[data-auth-mode]");
  if (authMode) {
    state.authMode = authMode.dataset.authMode;
    state.message = "";
    state.messageType = "";
    render();
    return;
  }

  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    state.view = viewButton.dataset.view;
    if (isAdminPortalUser(state.user) && !state.admin) {
      await loadAdminSummary();
    }
    if (state.view === "notifications") {
      if (!state.admin) await loadAdminSummary();
      if (!state.adminNotifications) await loadAdminNotifications();
    }
    render();
    return;
  }

  const button = event.target.closest("[data-click]");
  if (!button) return;

  const action = button.dataset.click;

  try {
    if (action === "logout") {
      await api("/api/auth/logout", { method: "POST", body: "{}" });
      state.user = null;
      state.data = null;
      state.admin = null;
      state.adminNotifications = null;
      state.authMode = "home";
      await loadPublicPaymentDetails();
      await loadPublicAbout();
      state.message = "";
      state.messageType = "";
      render();
      return;
    }

    if (action === "refresh") {
      await refreshAll({ includeAdmin: isAdminPortalUser(state.user) });
      return;
    }

    if (action === "payment-filter") {
      state.adminPaymentFilter = button.dataset.filter || "all";
      render();
      return;
    }

    if (action === "admin-social-section") {
      state.adminSocialSection = button.dataset.section || "meetings";
      render();
      return;
    }

    if (action === "reset-member-filter") {
      state.memberFilter = { scope: "all", query: "" };
      render();
      return;
    }

    if (action === "reset-about-article-filters") {
      state.aboutArticleFilters = { status: "all", query: "" };
      render();
      return;
    }

    if (action === "reset-leadership-filters") {
      state.leadershipFilters = { status: "all", query: "" };
      render();
      return;
    }

    if (action === "edit-about-article") {
      state.editingAboutArticleId = Number(button.dataset.articleId);
      render();
      return;
    }

    if (action === "edit-leadership-position") {
      state.editingLeadershipPositionId = Number(button.dataset.positionId);
      render();
      return;
    }

    if (action === "cancel-about-article-edit") {
      state.editingAboutArticleId = null;
      render();
      return;
    }

    if (action === "cancel-leadership-position-edit") {
      state.editingLeadershipPositionId = null;
      render();
      return;
    }

    if (action === "reset-archived-votes") {
      state.voteArchiveQuery = "";
      render();
      return;
    }

    if (action === "reset-notification-filters") {
      state.notificationFilters = { userId: "", dateFrom: "", dateTo: "" };
      await loadAdminNotifications();
      render();
      return;
    }

    if (action === "export-notifications") {
      const rows = [
        ["Notification ID", "Created At", "Read At", "User ID", "User Name", "User Email", "Type", "Title", "Body", "Link"],
        ...(state.adminNotifications || []).map((notification) => [
          notification.id,
          notification.createdAt,
          notification.readAt || "",
          notification.userId,
          notification.userName,
          notification.userEmail,
          notification.type,
          notification.title,
          notification.body,
          notification.link
        ])
      ];
      downloadCsv(`237-ville-notifications-${new Date().toISOString().slice(0, 10)}.csv`, rows);
      return;
    }

    if (action === "generate-temp-password") {
      const form = button.closest("form");
      const input = form?.elements.temporaryPassword;
      if (input) {
        input.value = generateTemporaryPassword();
        input.focus();
        input.select();
      }
      return;
    }

    if (action === "cleanup-hidden-about-articles") {
      const result = await api("/api/admin/about/articles/cleanup-hidden", {
        method: "POST",
        body: "{}"
      });
      state.editingAboutArticleId = null;
      state.message = `${result.deletedCount} hidden publication${result.deletedCount === 1 ? "" : "s"} older than 30 days dropped.`;
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "about-article-status") {
      await api(`/api/admin/about/articles/${button.dataset.articleId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: button.dataset.status })
      });
      state.editingAboutArticleId = null;
      state.message = button.dataset.status === "hidden" ? "Publication hidden." : "Publication published.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "leadership-position-status") {
      await api(`/api/admin/about/positions/${button.dataset.positionId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: button.dataset.status })
      });
      state.editingLeadershipPositionId = null;
      state.message =
        button.dataset.status === "archived"
          ? "Leadership position archived."
          : button.dataset.status === "hidden"
            ? "Leadership position hidden."
            : "Leadership position published.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "delete-about-article") {
      if (!window.confirm("Delete this publication permanently?")) {
        return;
      }
      await api(`/api/admin/about/articles/${button.dataset.articleId}`, {
        method: "DELETE"
      });
      state.editingAboutArticleId = null;
      state.message = "Publication deleted.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "vote") {
      await api(`/api/ballots/${button.dataset.ballotId}/vote`, {
        method: "POST",
        body: JSON.stringify({ optionId: Number(button.dataset.optionId) })
      });
      state.message = "Vote recorded.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: isAdminPortalUser() });
      return;
    }

    if (action === "read-notification") {
      await api(`/api/notifications/${button.dataset.notificationId}/read`, {
        method: "POST",
        body: "{}"
      });
      await refreshAll();
      return;
    }

    if (action === "question-action") {
      await api(`/api/admin/questions/${button.dataset.questionId}/${button.dataset.actionName}`, {
        method: "POST",
        body: "{}"
      });
      state.message = "Question updated.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "question-article") {
      await api(`/api/admin/questions/${button.dataset.questionId}/publish-article`, {
        method: "POST",
        body: "{}"
      });
      state.message = "Member submission published as an article.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "ballot-status") {
      await api(`/api/admin/ballots/${button.dataset.ballotId}/${button.dataset.status}`, {
        method: "POST",
        body: "{}"
      });
      state.message = "Ballot updated.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "ballot-archive") {
      await api(`/api/admin/ballots/${button.dataset.ballotId}/archive`, {
        method: "POST",
        body: "{}"
      });
      state.message = "Ballot archived.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "event-archive") {
      await api(`/api/admin/events/${button.dataset.eventId}/archive`, {
        method: "POST",
        body: "{}"
      });
      state.message = "Event archived.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "publish-social-meeting") {
      await api(`/api/admin/social/meetings/${button.dataset.meetingId}/publish`, {
        method: "POST",
        body: "{}"
      });
      state.message = "Social meeting assignments published as an announcement.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "resource-request-status") {
      await api(`/api/admin/social/resource-requests/${button.dataset.requestId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: button.dataset.status })
      });
      state.message = button.dataset.status === "delivered" ? "Resource marked delivered." : "Resource marked checked in.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "payment-publish") {
      await api(`/api/admin/payments/${button.dataset.paymentId}/publish`, {
        method: "POST",
        body: "{}"
      });
      state.message = "Donation published for members.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "expenditure-publish") {
      await api(`/api/admin/expenditures/${button.dataset.expenditureId}/publish`, {
        method: "POST",
        body: "{}"
      });
      state.message = "Expenditure published for members.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "budget-expense-publish") {
      await api(`/api/admin/budget-expenses/${button.dataset.expenseId}/publish`, {
        method: "POST",
        body: "{}"
      });
      state.message = "Budget expense published for members.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
      return;
    }

    if (action === "payment-status") {
      await api(`/api/admin/payments/${button.dataset.paymentId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: button.dataset.status })
      });
      state.message = "Payment status updated.";
      state.messageType = "ok";
      await refreshAll({ includeAdmin: true });
    }
  } catch (error) {
    state.message = error.message;
    state.messageType = "error";
    render();
  }
}

function updatePaymentGuideVisibility(select) {
  const form = select.closest("form");
  const guideList = form?.querySelector("[data-payment-guide-list]");
  if (guideList) {
    for (const guide of guideList.querySelectorAll("[data-payment-guide]")) {
      guide.hidden = guide.dataset.paymentGuide !== select.value;
    }
  }

  for (const fieldGroup of form?.querySelectorAll("[data-payment-fields]") || []) {
    const methods = (fieldGroup.dataset.paymentFields || "").split(/\s+/);
    const isHidden = !methods.includes(select.value);
    fieldGroup.hidden = isHidden;
    for (const field of fieldGroup.querySelectorAll("input, select, textarea")) {
      field.disabled = isHidden;
    }
  }
}

function handleChange(event) {
  const select = event.target.closest("[data-payment-method-select]");
  if (!select) return;
  updatePaymentGuideVisibility(select);
}
