async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  if (response.status === 204) {
    return {};
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401 && typeof handleUnauthorizedSession === "function") {
      handleUnauthorizedSession();
    }
    throw new Error(payload.error || "Request failed.");
  }

  if (typeof resetInactivityLogoutTimer === "function") {
    resetInactivityLogoutTimer();
  }

  return payload;
}

async function loadMe() {
  try {
    const { user } = await api("/api/me");
    state.user = user;
  } catch {
    state.user = null;
  }
}

async function loadPublicPaymentDetails() {
  try {
    const payload = await api("/api/payment-details");
    state.publicPaymentDetails = payload.paymentDetails || defaultPaymentDetails;
  } catch {
    state.publicPaymentDetails = defaultPaymentDetails;
  }
}

async function loadPublicAbout() {
  try {
    const payload = await api("/api/about");
    state.publicAbout = payload.about || { summary: "", missionStatement: "", purpose: "", articles: [], positions: [] };
  } catch {
    state.publicAbout = { summary: "", missionStatement: "", purpose: "", articles: [], positions: [] };
  }
}

async function loadDashboard() {
  if (!state.user) return;
  const data = await api("/api/dashboard");
  state.user = data.user;
  state.data = data;
  if (!hasMemberPortal(state.user)) {
    state.portalMode = "admin";
  } else if (!isAdminPortalUser(state.user)) {
    state.portalMode = "member";
  }
  applyDashboardRouteFromHash();
  updateDashboardRoute({ replace: true });
  if (isAdminPortalUser(state.user) && !state.admin) {
    await loadAdminSummary();
  }
}

async function loadAdminSummary() {
  if (!isAdminPortalUser(state.user)) return;
  state.admin = await api("/api/admin/summary");
}

async function loadAdminNotifications() {
  if (!canAccessAdminView("notifications")) return;
  const params = new URLSearchParams();
  if (state.notificationFilters.userId) params.set("userId", state.notificationFilters.userId);
  if (state.notificationFilters.dateFrom) params.set("dateFrom", state.notificationFilters.dateFrom);
  if (state.notificationFilters.dateTo) params.set("dateTo", state.notificationFilters.dateTo);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const payload = await api(`/api/admin/notifications${suffix}`);
  state.adminNotifications = payload.notifications;
}

async function refreshAll({ includeAdmin = false } = {}) {
  await loadDashboard();
  if (includeAdmin || state.view === "admin") {
    state.admin = null;
    await loadAdminSummary();
  }
  if (state.view === "notifications") {
    await loadAdminNotifications();
  }
  render();
}

function render() {
  if (!state.user) {
    renderAuth();
    return;
  }

  if (!state.data) {
    app.innerHTML = `
      <main class="loading-view">
        <img src="${companyLogoSrc}" alt="237 Ville" class="loading-mark">
        <p>Loading member dashboard...</p>
      </main>
    `;
    return;
  }

  if (state.data.onboarding || state.user.passwordMustChange || state.user.membershipStatus !== "active") {
    renderOnboarding();
    return;
  }

  renderShell();
}
