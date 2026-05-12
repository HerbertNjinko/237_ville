// Bootstraps 237 Ville after the smaller files in /app load.
const inactivityLogoutMs = 5 * 60 * 1000;
let inactivityLogoutTimer = null;

function clearInactivityLogoutTimer() {
  if (inactivityLogoutTimer) {
    clearTimeout(inactivityLogoutTimer);
    inactivityLogoutTimer = null;
  }
}

async function signOutInactiveUser() {
  if (!state.user) return;
  try {
    await api("/api/auth/logout", { method: "POST", body: "{}" });
  } catch {
    // The server may have already expired the session.
  }
  clearInactivityLogoutTimer();
  state.user = null;
  state.data = null;
  state.admin = null;
  state.adminNotifications = null;
  state.portalMode = "member";
  state.sidebarOpen = true;
  state.authMode = "login";
  state.message = "You were signed out after 5 minutes of inactivity.";
  state.messageType = "error";
  await loadPublicPaymentDetails();
  await loadPublicAbout();
  render();
}

function resetInactivityLogoutTimer() {
  clearInactivityLogoutTimer();
  if (state.user) {
    inactivityLogoutTimer = setTimeout(signOutInactiveUser, inactivityLogoutMs);
  }
}

function handleUnauthorizedSession() {
  clearInactivityLogoutTimer();
  if (!state.user) return;
  state.user = null;
  state.data = null;
  state.admin = null;
  state.adminNotifications = null;
  state.portalMode = "member";
  state.sidebarOpen = true;
  state.authMode = "login";
  state.message = "Your session expired. Please sign in again.";
  state.messageType = "error";
  loadPublicPaymentDetails()
    .then(loadPublicAbout)
    .finally(render);
}

["click", "keydown", "mousemove", "mousedown", "scroll", "touchstart", "submit", "change"].forEach((eventName) => {
  document.addEventListener(eventName, resetInactivityLogoutTimer, { passive: true, capture: true });
});

document.addEventListener("submit", handleSubmit);
document.addEventListener("change", handleChange);
document.addEventListener("click", handleClick);
window.addEventListener("hashchange", async () => {
  if (!state.user || !state.data || state.data.onboarding) return;
  if (!applyDashboardRouteFromHash()) return;
  state.sidebarOpen = false;
  if (isAdminPortalMode() && !state.admin) {
    await loadAdminSummary();
  }
  if (isAdminPortalMode() && state.view === "notifications" && !state.adminNotifications) {
    await loadAdminNotifications();
  }
  render();
});

(async function bootstrapApp() {
  await loadMe();
  if (state.user) {
    await loadDashboard();
  } else {
    await loadPublicPaymentDetails();
    await loadPublicAbout();
  }
  resetInactivityLogoutTimer();
  render();
})();
