// Bootstraps 237 Ville after the smaller files in /app load.
document.addEventListener("submit", handleSubmit);
document.addEventListener("change", handleChange);
document.addEventListener("click", handleClick);

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
