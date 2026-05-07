const app = document.querySelector("#app");
const companyLogoSrc = "/assets/237ville%20logo.png";
const donateImageSrc = "/assets/donate.png";

const state = {
  user: null,
  data: null,
  admin: null,
  adminNotifications: null,
  publicPaymentDetails: null,
  publicAbout: null,
  adminPaymentFilter: "all",
  memberFilter: {
    scope: "all",
    query: ""
  },
  aboutArticleFilters: {
    status: "all",
    query: ""
  },
  editingAboutArticleId: null,
  leadershipFilters: {
    status: "all",
    query: ""
  },
  editingLeadershipPositionId: null,
  adminSocialSection: "meetings",
  voteArchiveQuery: "",
  notificationFilters: {
    userId: "",
    dateFrom: "",
    dateTo: ""
  },
  portalMode: "member",
  sidebarOpen: true,
  view: "overview",
  authMode: "home",
  message: "",
  messageType: ""
};

const memberViews = [
  ["overview", "Overview"],
  ["announcements", "Announcements"],
  ["votes", "Votes"],
  ["events", "Events"],
  ["social", "Request resources"],
  ["questions", "Questions"],
  ["financials", "Financials"],
  ["payments", "Dues and donations"],
  ["profile", "Profile"]
];

const adminViews = [
  ["overview", "Overview"],
  ["about", "Publish Articles"],
  ["announcements", "Announcements"],
  ["questions", "Questions"],
  ["events", "Events"],
  ["social", "Social coordinator"],
  ["votes", "Votes"],
  ["payments", "Dues and donations"],
  ["payment-details", "Payment details"],
  ["expenditures", "Expenditures"],
  ["budgets", "Budgets"],
  ["profile", "Members / Profile"],
  ["notifications", "Notifications"]
];

const adminRolePermissions = {
  admin: new Set(["overview", "about", "announcements", "questions", "events", "social", "votes", "payments", "payment-details", "expenditures", "budgets", "profile", "notifications"]),
  secretary: new Set(["overview", "about", "announcements", "questions", "votes", "profile", "notifications"]),
  treasurer: new Set(["overview", "announcements", "questions", "events", "votes", "payments", "payment-details", "expenditures", "budgets", "notifications"]),
  social: new Set(["overview", "announcements", "questions", "events", "social"])
};

function isFullAdmin(user = state.user) {
  return effectiveAdminRole(user) === "admin";
}

function effectiveAdminRole(user = state.user) {
  return user?.staffRole || (adminRolePermissions[user?.role] ? user.role : "");
}

function isAdminPortalUser(user = state.user) {
  return Boolean(user && adminRolePermissions[effectiveAdminRole(user)]);
}

function hasMemberPortal(user = state.user) {
  return user?.hasMemberPortal !== false && user?.role === "member";
}

function hasBothPortals(user = state.user) {
  return hasMemberPortal(user) && isAdminPortalUser(user);
}

function isAdminPortalMode(user = state.user) {
  return isAdminPortalUser(user) && (!hasMemberPortal(user) || state.portalMode === "admin");
}

function canAccessAdminView(view, user = state.user) {
  return adminRolePermissions[effectiveAdminRole(user)]?.has(view) || false;
}

function canEditAdminView(view, user = state.user) {
  if (isFullAdmin(user)) return true;
  const role = effectiveAdminRole(user);
  if (role === "secretary") return ["about", "announcements", "questions", "votes"].includes(view);
  if (role === "treasurer") return ["announcements", "questions", "events", "votes", "payments", "payment-details", "expenditures", "budgets", "notifications"].includes(view);
  if (role === "social") return ["announcements", "questions", "events", "social"].includes(view);
  return false;
}

function currentPortalViews() {
  return isAdminPortalMode()
    ? adminViews.filter(([key]) => canAccessAdminView(key))
    : memberViews;
}

function routePortalSegment() {
  return isAdminPortalMode() ? "staff" : "member";
}

function dashboardRouteFor(view = state.view) {
  return `#/${routePortalSegment()}/${encodeURIComponent(view)}`;
}

function updateDashboardRoute({ replace = false } = {}) {
  if (!state.user || state.data?.onboarding) return;
  const nextHash = dashboardRouteFor();
  if (window.location.hash === nextHash) return;
  window.history[replace ? "replaceState" : "pushState"](null, "", nextHash);
}

function applyDashboardRouteFromHash() {
  if (!state.user || !window.location.hash) return false;

  const match = window.location.hash.match(/^#\/(member|staff|admin)\/([A-Za-z0-9_-]+)$/);
  if (!match) return false;

  const requestedMode = match[1] === "member" ? "member" : "admin";
  if (requestedMode === "admin" && isAdminPortalUser()) {
    state.portalMode = "admin";
  } else if (requestedMode === "member" && hasMemberPortal()) {
    state.portalMode = "member";
  } else if (!hasMemberPortal() && isAdminPortalUser()) {
    state.portalMode = "admin";
  }

  const requestedView = decodeURIComponent(match[2]);
  const allowedViews = currentPortalViews().map(([key]) => key);
  state.view = allowedViews.includes(requestedView) ? requestedView : "overview";
  return true;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderRichText(value = "") {
  const normalized = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return "";

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return `
    <div class="rich-text">
      ${paragraphs
        .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`)
        .join("")}
    </div>
  `;
}

function formatDate(value, options = {}) {
  if (!value) return "Not set";
  const date = options.dateOnly && /^\d{4}-\d{2}-\d{2}/.test(String(value))
    ? new Date(Number(String(value).slice(0, 4)), Number(String(value).slice(5, 7)) - 1, Number(String(value).slice(8, 10)))
    : new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: options.dateOnly ? undefined : "numeric",
    minute: options.dateOnly ? undefined : "2-digit"
  }).format(date);
}

function toDatetimeLocalValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function formatMoney(cents = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(Number(cents || 0) / 100);
}

const defaultPaymentDetails = [
  { method: "cash", displayName: "Cash", accountIdentifier: "", instructions: "Enter the donor name and the person who received the cash.", enabled: true },
  { method: "cash_app", displayName: "Cash App", accountIdentifier: "", instructions: "", enabled: true },
  { method: "venmo", displayName: "Venmo", accountIdentifier: "", instructions: "", enabled: true },
  { method: "zelle", displayName: "Zelle", accountIdentifier: "", instructions: "", enabled: true },
  { method: "paypal", displayName: "PayPal", accountIdentifier: "", instructions: "", enabled: true },
  { method: "cheque", displayName: "Cheque", accountIdentifier: "", instructions: "Make cheques payable to 237 Ville and enter the cheque number or reference below.", enabled: true },
  { method: "bank_account", displayName: "Bank account", accountIdentifier: "", instructions: "Pay directly to the 237 Ville bank account using the account details configured here. Enter your bank details below for admin review.", enabled: true }
];

function availablePaymentDetails() {
  return (state.data?.paymentDetails || state.publicPaymentDetails || defaultPaymentDetails).filter((detail) => detail.enabled !== false);
}

function allAdminPaymentDetails() {
  return state.admin?.paymentDetails || defaultPaymentDetails;
}

function paymentMethodLabel(method) {
  const detail = [...availablePaymentDetails(), ...allAdminPaymentDetails()].find((item) => item.method === method);
  return detail?.displayName || String(method || "").replaceAll("_", " ");
}

function formatBytes(bytes = 0) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function renderReceiptActions(receipt) {
  if (!receipt?.name && !receipt?.dataUrl) return "";

  const name = receipt.name || "Receipt";
  const size = receipt.size ? ` (${formatBytes(receipt.size)})` : "";

  if (!receipt.dataUrl) {
    return `<span class="muted">Receipt: ${escapeHtml(name)}${escapeHtml(size)}</span>`;
  }

  const href = escapeHtml(receipt.dataUrl);
  const downloadName = escapeHtml(name);

  return `
    <span class="receipt-actions">
      <span class="muted">Receipt: ${escapeHtml(name)}${escapeHtml(size)}</span>
      <a href="${href}" target="_blank" rel="noopener">View</a>
      <a href="${href}" download="${downloadName}">Download</a>
    </span>
  `;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(new Error("Unable to read uploaded file.")));
    reader.readAsDataURL(file);
  });
}

function generateTemporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = new Uint32Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function downloadCsv(filename, rows) {
  const blob = new Blob([rows.map((row) => row.map(csvCell).join(",")).join("\n")], {
    type: "text/csv;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function statusPill(status) {
  return `<span class="status-pill ${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span>`;
}

function emptyState(text) {
  return `<div class="empty-state">${escapeHtml(text)}</div>`;
}

function statusLabel(status = "") {
  return String(status).replaceAll("_", " ");
}
