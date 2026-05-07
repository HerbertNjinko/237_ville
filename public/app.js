// Bootstraps 237 Ville after the smaller files in /app load.
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
  render();
})();
