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
  ["about", "About"],
  ["announcements", "Announcements"],
  ["questions", "Questions"],
  ["events", "Events"],
  ["social", "Social coordinator"],
  ["votes", "Votes"],
  ["payments", "Dues and donations"],
  ["payment-details", "Payment details"],
  ["expenditures", "Expenditures"],
  ["profile", "Members / Profile"],
  ["notifications", "Notifications"]
];

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(new Error("Unable to read ID card file.")));
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
    throw new Error(payload.error || "Request failed.");
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
  if (state.user.role === "admin" && !state.admin) {
    await loadAdminSummary();
  }
}

async function loadAdminSummary() {
  if (!state.user || state.user.role !== "admin") return;
  state.admin = await api("/api/admin/summary");
}

async function loadAdminNotifications() {
  if (!state.user || state.user.role !== "admin") return;
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

function renderPaymentMethodSelect(details = availablePaymentDetails()) {
  return `
    <label class="field">
      <span>Payment method</span>
      <select name="method" data-payment-method-select required>
        ${details
          .map((detail) => `<option value="${escapeHtml(detail.method)}">${escapeHtml(detail.displayName)}</option>`)
          .join("")}
      </select>
    </label>
  `;
}

function renderPaymentGuides(details = availablePaymentDetails()) {
  if (!details.length) return emptyState("No payment methods are available.");
  const selectedMethod = details[0]?.method || "";

  return `
    <div class="payment-guide-list" data-payment-guide-list>
      ${details
        .map(
          (detail) => `
            <article class="payment-guide" data-payment-guide="${escapeHtml(detail.method)}" ${detail.method === selectedMethod ? "" : "hidden"}>
              <strong>${escapeHtml(detail.displayName)}</strong>
              ${detail.accountIdentifier ? `<span>${escapeHtml(detail.accountIdentifier)}</span>` : ""}
              ${detail.instructions ? `<p>${escapeHtml(detail.instructions)}</p>` : ""}
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderPaymentRecordFields({ includeBank = true } = {}) {
  const selectedMethod = availablePaymentDetails()[0]?.method || "";
  const visibleFor = (methods) => (methods.includes(selectedMethod) ? "" : "hidden");

  return `
    <div class="payment-method-fields" data-payment-fields="cash_app venmo zelle paypal cheque" ${visibleFor(["cash_app", "venmo", "zelle", "paypal", "cheque"])}>
      <label class="field">
        <span>Payment reference or cheque number</span>
        <input name="paymentReference">
      </label>
      <label class="field">
        <span>Sender username or payment email</span>
        <input name="payerHandle">
      </label>
    </div>
    ${
      includeBank
        ? `<div class="form-grid payment-method-fields" data-payment-fields="bank_account" ${visibleFor(["bank_account"])}>
            <label class="field">
              <span>Bank name</span>
              <input name="bankName">
            </label>
            <label class="field">
              <span>Account holder name</span>
              <input name="accountHolderName">
            </label>
            <label class="field">
              <span>Account type</span>
              <select name="bankAccountType">
                <option value="">Not a bank payment</option>
                <option value="checking">Checking</option>
                <option value="savings">Savings</option>
              </select>
            </label>
            <label class="field">
              <span>Account last 4</span>
              <input name="accountLast4" inputmode="numeric" maxlength="4" pattern="[0-9]{0,4}">
            </label>
          </div>`
        : ""
    }
    <div class="form-grid payment-method-fields" data-payment-fields="cash" ${visibleFor(["cash"])}>
      <label class="field">
        <span>Cash donor name</span>
        <input name="cashDonorName">
      </label>
      <label class="field">
        <span>Cash received by</span>
        <input name="cashReceivedBy">
      </label>
    </div>
  `;
}

function publicAboutFallback() {
  return state.publicAbout || { summary: "", missionStatement: "", purpose: "", articles: [], positions: [] };
}

function renderPublicMenu() {
  const mode = state.authMode || "home";
  const items = [
    ["login", "Sign in"],
    ["register", "Register"],
    ["donate", "Donate"],
    ["about", "About"]
  ];

  return `
    <header class="public-topbar">
      <button class="public-brand-link" data-auth-mode="home" type="button" aria-label="237 Ville home">
        <img src="${companyLogoSrc}" alt="">
        <span>237 Ville</span>
      </button>
      <nav class="public-menu" aria-label="Public navigation">
        ${items
          .map(
            ([key, label]) => `
              <button class="tab-button ${mode === key ? "active" : ""}" data-auth-mode="${key}" type="button">
                ${escapeHtml(label)}
              </button>
            `
          )
          .join("")}
      </nav>
    </header>
  `;
}

function renderAuth() {
  const about = publicAboutFallback();

  app.innerHTML = `
    <main class="public-layout">
      ${renderPublicMenu()}
      ${state.authMode === "about" ? renderPublicAboutPage(about) : state.authMode === "login" || state.authMode === "register" || state.authMode === "donate" ? renderPublicFormPage(about) : renderPublicHome(about)}
    </main>
  `;
}

function renderPublicHome(about) {
  return `
    <section class="public-hero">
      <div>
        <img src="${companyLogoSrc}" alt="237 Ville">
        <h1>237 Ville</h1>
        <p>${escapeHtml(about.summary || "Member hub for community updates, public articles, elections, events, dues, donations, and questions for the board.")}</p>
      </div>
    </section>
    <section class="public-section">
      <div class="panel-header">
        <div>
          <h2>Public articles</h2>
          <p>Articles and images published by the organization for members and anonymous visitors.</p>
        </div>
      </div>
      ${renderPublicAboutArticles(about.articles || [])}
    </section>
  `;
}

function renderPublicAboutPage(about) {
  return `
    <section class="public-content-panel">
      <h2>About 237 Ville</h2>
      ${renderPublicAbout(about)}
    </section>
  `;
}

function renderPublicFormPage(about) {
  const isRegister = state.authMode === "register";
  const isDonate = state.authMode === "donate";
  const formAction = isDonate ? "anonymous-donation" : isRegister ? "register" : "login";
  const heading = isDonate ? "Make a donation" : isRegister ? "Create member account" : "Member sign in";
  const introImageSrc = isDonate ? donateImageSrc : companyLogoSrc;
  const introImageAlt = isDonate ? "Donate to 237 Ville" : "237 Ville logo";

  return `
    <section class="public-action-layout">
      <aside class="public-intro">
        <div>
          <h1>237 Ville</h1>
          <p>${escapeHtml(about.summary || "Stay connected to the organization, participate in votes, follow events, and support the community.")}</p>
        </div>
        <img class="public-intro-logo ${isDonate ? "donate-image" : ""}" src="${introImageSrc}" alt="${introImageAlt}">
      </aside>
      <div class="public-form-card">
        <h2>${heading}</h2>
        <form class="form-stack" data-action="${formAction}">
          ${
            isRegister
              ? `<div class="form-grid">
                  <label class="field">
                    <span>First name</span>
                    <input name="firstName" autocomplete="given-name" required>
                  </label>
                  <label class="field">
                    <span>Last name</span>
                    <input name="lastName" autocomplete="family-name" required>
                  </label>
                </div>`
              : ""
          }
          ${
            isDonate
              ? `<div class="form-grid">
                  <label class="field">
                    <span>Name</span>
                    <input name="donorName" autocomplete="name">
                  </label>
                  <label class="field">
                    <span>Email</span>
                    <input name="donorEmail" type="email" autocomplete="email">
                  </label>
                </div>
                <label class="field">
                  <span>Donation amount</span>
                  <input name="amount" type="number" min="1" step="0.01" required>
                </label>
                ${renderPaymentMethodSelect(availablePaymentDetails())}
                ${renderPaymentGuides(availablePaymentDetails())}
                ${renderPaymentRecordFields()}
                <label class="field">
                  <span>Note</span>
                  <textarea name="note"></textarea>
                </label>`
              : `<label class="field">
                  <span>Email</span>
                  <input name="email" type="email" autocomplete="email" required>
                </label>`
          }
          ${
            isRegister
              ? `<label class="field">
                  <span>Who you are and why you want to join</span>
                  <textarea name="registrationStatement" minlength="40" required></textarea>
                </label>
                <label class="field">
                  <span>ID card for verification</span>
                  <input name="identityDocument" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" required>
                </label>
                <p class="muted">Accepted files: JPG, PNG, WebP, or PDF up to 3 MB.</p>`
              : ""
          }
          ${
            isRegister || isDonate
              ? ""
              : `<label class="field">
                  <span>Password</span>
                  <input name="password" type="password" autocomplete="current-password" minlength="8" required>
                </label>`
          }
          <button class="primary-button" type="submit">${isDonate ? "Donate" : isRegister ? "Create account" : "Sign in"}</button>
          <p class="message ${state.messageType === "ok" ? "ok" : ""}">${escapeHtml(state.message)}</p>
        </form>
      </div>
    </section>
  `;
}

function renderPublicAbout(about) {
  return `
    <section class="about-public">
      <article class="policy-document">
        <h3>Organization summary</h3>
        <p>${escapeHtml(about.summary || "237 Ville is a community organization focused on member participation and transparent leadership.")}</p>
      </article>
      <article class="policy-document">
        <h3>Mission statement</h3>
        <p>${escapeHtml(about.missionStatement || "Our mission is to build a connected, transparent, and active community where members can participate in decisions and support one another.")}</p>
      </article>
      <article class="policy-document">
        <h3>Organization purpose</h3>
        <p>${escapeHtml(about.purpose || "The organization supports community updates, events, voting, dues, donations, and member engagement.")}</p>
      </article>
      <div>
        <h3>Organization leadership</h3>
        ${renderLeadershipCards(about.positions || [])}
      </div>
    </section>
  `;
}

function renderPublicAboutArticles(articles) {
  if (!articles.length) return emptyState("No public articles have been published yet.");

  return `
    <div class="item-list">
      ${articles
        .map(
          (article) => `
            <article class="public-article-card ${article.image?.dataUrl ? "" : "without-image"}">
              ${
                article.image?.dataUrl
                  ? `<img src="${escapeHtml(article.image.dataUrl)}" alt="${escapeHtml(article.title)}">`
                  : ""
              }
              <div>
                <h4>${escapeHtml(article.title)}</h4>
                <p>${escapeHtml(article.body)}</p>
                <div class="item-meta">
                  <span>${formatDate(article.createdAt)}</span>
                </div>
              </div>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderLeadershipCards(positions) {
  if (!positions.length) return emptyState("Leadership information has not been published yet.");

  return `
    <div class="leadership-grid">
      ${positions
        .map(
          (position) => `
            <article class="leadership-card">
              ${
                position.image?.dataUrl
                  ? `<img src="${escapeHtml(position.image.dataUrl)}" alt="${escapeHtml(position.title)}">`
                  : `<div class="leadership-placeholder">${escapeHtml(position.title.slice(0, 1) || "2")}</div>`
              }
              <div>
                <h4>${escapeHtml(position.title)}</h4>
                ${position.holderName ? `<strong>${escapeHtml(position.holderName)}</strong>` : ""}
                ${position.body ? `<p>${escapeHtml(position.body)}</p>` : ""}
              </div>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function getRegistrationFeePayment() {
  return (state.data?.payments || []).find(
    (payment) => payment.purpose === "registration_fee" && ["pending", "received"].includes(payment.status)
  );
}

function renderOnboarding() {
  const user = state.user;
  const policy = state.data?.policy || {};
  const feePayment = getRegistrationFeePayment();
  const feeCents = state.data?.registrationFeeCents || 0;

  app.innerHTML = `
    <main class="auth-layout">
      <section class="auth-panel onboarding-panel">
        <div class="auth-brand">
          <div>
            <img src="${companyLogoSrc}" alt="237 Ville">
            <h1>237 Ville</h1>
            <p>${escapeHtml(user.fullName)} needs to complete account setup before the member portal opens.</p>
          </div>
          <button class="ghost-button" data-click="logout" type="button">Sign out</button>
        </div>
        <div class="auth-form-panel">
          <div class="panel-header">
            <div>
              <h2>${escapeHtml(onboardingTitle(user))}</h2>
              <p>${escapeHtml(onboardingSubtitle(user))}</p>
            </div>
            ${statusPill(user.membershipStatus)}
          </div>
          ${state.message ? `<p class="message ${state.messageType === "ok" ? "ok" : ""}">${escapeHtml(state.message)}</p>` : ""}
          ${renderOnboardingStep(user, policy, feePayment, feeCents)}
          <div class="onboarding-notices">
            <h3>Notifications</h3>
            ${renderNotificationList(state.data?.notifications || [])}
          </div>
        </div>
      </section>
    </main>
  `;
}

function onboardingTitle(user) {
  if (user.passwordMustChange) return "Update temporary password";
  if (user.membershipStatus === "pending_policy") return "Acknowledge member policy";
  if (user.membershipStatus === "pending_fee") return "Submit registration fee";
  if (user.membershipStatus === "pending_approval") return "Account pending approval";
  return "Account unavailable";
}

function onboardingSubtitle(user) {
  if (user.passwordMustChange) return "Create a private password before continuing.";
  if (user.membershipStatus === "pending_policy") return "Review and sign the current organization policy.";
  if (user.membershipStatus === "pending_fee") return "Your portal opens after the registration fee is processed.";
  if (user.membershipStatus === "pending_approval") return "An admin still needs to approve this account.";
  return "Contact an admin for help with this account.";
}

function renderOnboardingStep(user, policy, feePayment, feeCents) {
  if (user.passwordMustChange) {
    return `
      <form class="form-stack" data-action="change-password">
        <label class="field">
          <span>New password</span>
          <input name="newPassword" type="password" autocomplete="new-password" minlength="8" required>
        </label>
        <label class="field">
          <span>Confirm new password</span>
          <input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required>
        </label>
        <button class="primary-button" type="submit">Update password</button>
      </form>
    `;
  }

  if (user.membershipStatus === "pending_policy") {
    return `
      <div class="policy-document">
        <h3>${escapeHtml(policy.title || "Member Policy")}</h3>
        <span class="muted">Version ${escapeHtml(policy.version || "")}</span>
        <p>${escapeHtml(policy.body || "")}</p>
      </div>
      <form class="form-stack" data-action="accept-policy">
        <label class="field">
          <span>Signature name</span>
          <input name="signatureName" value="${escapeHtml(user.fullName)}" required>
        </label>
        <label class="inline-label">
          <input name="accepted" type="checkbox" required>
          <span>I acknowledge and agree to the 237 Ville organization policy.</span>
        </label>
        <button class="primary-button" type="submit">Sign policy</button>
      </form>
    `;
  }

  if (user.membershipStatus === "pending_fee") {
    if (feePayment) {
      return `
        <div class="item-card">
          <h3>Registration fee under review</h3>
          <p>Your ${formatMoney(feePayment.amountCents)} registration fee record is ${feePayment.status}. The member portal opens after an admin marks it received.</p>
          <div class="item-meta">
            <span>${escapeHtml(feePayment.method)}</span>
            <span>${formatDate(feePayment.createdAt)}</span>
          </div>
        </div>
      `;
    }

    return `
      <form class="form-stack" data-action="submit-registration-fee">
        <div class="metric">
          <span>Registration fee</span>
          <strong>${formatMoney(feeCents)}</strong>
        </div>
        ${renderPaymentMethodSelect(availablePaymentDetails())}
        ${renderPaymentGuides(availablePaymentDetails())}
        ${renderPaymentRecordFields()}
        <label class="field">
          <span>Reference or note</span>
          <textarea name="note"></textarea>
        </label>
        <button class="primary-button" type="submit">Submit fee record</button>
      </form>
    `;
  }

  return emptyState("This account is not ready for member portal access.");
}

function renderShell() {
  const views = state.user.role === "admin" ? adminViews : memberViews;
  const currentTitle = views.find(([key]) => key === state.view)?.[1] || "Overview";
  const unread = (state.data.notifications || []).filter((notification) => !notification.readAt).length;

  app.innerHTML = `
    <div class="dashboard-layout">
      <aside class="sidebar">
        <div class="brand-row">
          <img src="${companyLogoSrc}" alt="237 Ville">
          <div>
            <strong>237 Ville</strong>
            <span>${escapeHtml(state.user.role)} portal</span>
          </div>
        </div>
        <nav class="side-nav" aria-label="Main navigation">
          ${views
            .map(
              ([key, label]) => `
                <button class="nav-button ${state.view === key ? "active" : ""}" data-view="${key}" type="button">
                  ${escapeHtml(label)}
                </button>
              `
            )
            .join("")}
        </nav>
        <div class="sidebar-footer">
          <span>${escapeHtml(state.user.fullName)}</span>
          <span>${unread} unread notification${unread === 1 ? "" : "s"}</span>
          <button class="ghost-button" data-click="logout" type="button">Sign out</button>
        </div>
      </aside>
      <main class="main-panel">
        <header class="topbar">
          <div>
            <h2>${escapeHtml(currentTitle)}</h2>
            <p>${escapeHtml(topbarSubtitle())}</p>
          </div>
          <button class="ghost-button" data-click="refresh" type="button">Refresh</button>
        </header>
        ${state.message ? `<p class="message ${state.messageType === "ok" ? "ok" : ""}">${escapeHtml(state.message)}</p>` : ""}
        ${renderView()}
      </main>
    </div>
  `;
}

function topbarSubtitle() {
  if (state.user?.role === "admin") {
    const adminMap = {
      overview: "Backend statistics across members, money, content, events, votes, and notifications.",
      about: "Manage the public home articles, About page content, and leadership position images.",
      announcements: "Publish and review organization announcements and member-sourced articles.",
      questions: "Review member questions, publish discussions, or turn submissions into articles.",
      events: "Create and manage organization events.",
      social: "Assign monthly meeting food, drinks, hosting, and resource requests.",
      votes: "Create ballots, open voting, close voting, and review aggregate results.",
      payments: "Track dues, donations, pending payments, and members who have not paid dues.",
      "payment-details": "Update the payment handles and instructions shown during payment submission.",
      expenditures: "Enter expenses and publish financial records for member transparency.",
      profile: "Update member and admin account details.",
      notifications: "Filter and export notification records for audit."
    };
    return adminMap[state.view] || "";
  }

  const map = {
    overview: "Current organization activity at a glance.",
    announcements: "Published updates and articles from 237 Ville.",
    votes: "Open and closed issues, elections, and aggregate results.",
    events: "Upcoming community meetings, programs, and planned events.",
    social: "Request organization resources for meetings where you have an assigned task.",
    questions: "Member questions approved for community discussion.",
    financials: "Published donations and organization expenditures.",
    payments: "Record dues and donations for admin review.",
    profile: "Update your member account details.",
    admin: "Publish content, plan events, manage ballots, and review member activity.",
    notifications: "Filter and export organization notification records."
  };
  return map[state.view] || "";
}

function renderView() {
  if (state.user.role === "admin") {
    switch (state.view) {
      case "about":
        return renderAdminAbout();
      case "announcements":
        return renderAdminAnnouncements();
      case "questions":
        return renderAdminQuestionsPage();
      case "events":
        return renderAdminEvents();
      case "social":
        return renderAdminSocialCoordinator();
      case "votes":
        return renderAdminVotes();
      case "payments":
        return renderAdminPayments();
      case "payment-details":
        return renderAdminPaymentDetails();
      case "expenditures":
        return renderAdminExpenditures();
      case "profile":
        return renderAdminProfiles();
      case "notifications":
        return renderAdminNotifications();
      default:
        return renderAdminOverview();
    }
  }

  switch (state.view) {
    case "announcements":
      return renderAnnouncements();
    case "votes":
      return renderVotes();
    case "events":
      return renderEvents();
    case "social":
      return renderSocialCoordinator();
    case "questions":
      return renderQuestions();
    case "financials":
      return renderFinancials();
    case "payments":
      return renderPayments();
    case "profile":
      return renderProfile();
    default:
      return renderOverview();
  }
}

function renderOverview() {
  const announcements = state.data.announcements || [];
  const events = state.data.events || [];
  const ballots = state.data.ballots || [];
  const openBallots = ballots.filter((ballot) => ballot.status === "open");
  const unread = (state.data.notifications || []).filter((notification) => !notification.readAt);

  return `
    <div class="content-grid">
      <section class="metric-grid" aria-label="Dashboard metrics">
        <div class="metric"><span>Announcements</span><strong>${announcements.length}</strong></div>
        <div class="metric"><span>Upcoming events</span><strong>${events.length}</strong></div>
        <div class="metric"><span>Open votes</span><strong>${openBallots.length}</strong></div>
        <div class="metric"><span>Unread notices</span><strong>${unread.length}</strong></div>
      </section>
      <section class="two-column">
        <div class="content-grid">
          <div class="panel">
            <div class="panel-header">
              <div>
                <h3>Latest announcements</h3>
                <p>Recent published updates.</p>
              </div>
            </div>
            ${renderAnnouncementList(announcements.slice(0, 3))}
          </div>
          <div class="panel">
            <div class="panel-header">
              <div>
                <h3>Votes needing attention</h3>
                <p>Totals are public. Voter names are not shown.</p>
              </div>
            </div>
            ${openBallots.length ? openBallots.map(renderBallotCard).join("") : emptyState("No open votes right now.")}
          </div>
        </div>
        <div class="content-grid">
          <div class="panel">
            <div class="panel-header">
              <div>
                <h3>Upcoming events</h3>
                <p>Next planned organization dates.</p>
              </div>
            </div>
            ${renderEventList(events.slice(0, 4))}
          </div>
          <div class="panel">
            <div class="panel-header">
              <div>
                <h3>Notifications</h3>
                <p>Published updates for your account.</p>
              </div>
            </div>
            ${state.user.role === "admin" ? renderNotificationCleanupForm("overview") : ""}
            ${renderNotificationList(state.data.notifications || [])}
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderAnnouncements() {
  const socialMeetings = state.data.social?.meetings || [];

  return `
    <section class="content-grid">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>Monthly social meetings</h3>
            <p>Food, drinks, hosting, and setup assignments for first-Saturday meetings.</p>
          </div>
        </div>
        ${renderMemberSocialMeetings(socialMeetings)}
      </div>
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>Announcements and articles</h3>
            <p>Published by the executive team and organization admins.</p>
          </div>
        </div>
        ${renderAnnouncementList(state.data.announcements || [])}
      </div>
    </section>
  `;
}

function renderAnnouncementList(announcements) {
  if (!announcements.length) return emptyState("No announcements have been published.");

  return `
    <div class="item-list">
      ${announcements
        .map(
          (announcement) => `
            <article class="item-card" id="announcement-${announcement.id}">
              <h4>${escapeHtml(announcement.title)}</h4>
              <p>${escapeHtml(announcement.body)}</p>
              <div class="item-meta">
                <span>${escapeHtml(announcement.category)}</span>
                <span>${escapeHtml(announcement.authorName)}</span>
                <span>${formatDate(announcement.publishedAt || announcement.createdAt)}</span>
              </div>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderFinancials() {
  const financials = state.data.financials || {
    donations: [],
    expenditures: [],
    summary: { donationTotalCents: 0, expenditureTotalCents: 0, publishedNetCents: 0 }
  };

  return `
    <section class="content-grid">
      <div class="metric-grid">
        <div class="metric"><span>Published donations</span><strong>${formatMoney(financials.summary.donationTotalCents)}</strong></div>
        <div class="metric"><span>Published expenses</span><strong>${formatMoney(financials.summary.expenditureTotalCents)}</strong></div>
        <div class="metric"><span>Published net</span><strong>${formatMoney(financials.summary.publishedNetCents)}</strong></div>
        <div class="metric"><span>Records</span><strong>${(financials.donations || []).length + (financials.expenditures || []).length}</strong></div>
      </div>
      <section class="two-column">
        <div class="panel">
          <div class="panel-header">
            <div>
              <h3>Published donations</h3>
              <p>Donation records shared by the admin.</p>
            </div>
          </div>
          ${renderPublishedDonationList(financials.donations || [])}
        </div>
        <div class="panel">
          <div class="panel-header">
            <div>
              <h3>Published expenditures</h3>
              <p>Organization expenses shared by the admin.</p>
            </div>
          </div>
          ${renderPublishedExpenditureList(financials.expenditures || [])}
        </div>
      </section>
    </section>
  `;
}

function renderPublishedDonationList(donations) {
  if (!donations.length) return emptyState("No donation records have been published.");

  return `
    <div class="item-list">
      ${donations
        .map(
          (donation) => `
            <article class="item-card">
              <div class="panel-header">
                <div>
                  <h4>${escapeHtml(donation.donorName || "Anonymous donor")}</h4>
                  <p>${escapeHtml(donation.note || "")}</p>
                </div>
                <strong>${formatMoney(donation.amountCents)}</strong>
              </div>
              <div class="item-meta">
                <span>Donation</span>
                <span>${formatDate(donation.publishedAt || donation.createdAt)}</span>
              </div>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderPublishedExpenditureList(expenditures) {
  if (!expenditures.length) return emptyState("No expenditures have been published.");

  return `
    <div class="item-list">
      ${expenditures
        .map(
          (expense) => `
            <article class="item-card">
              <div class="panel-header">
                <div>
                  <h4>${escapeHtml(expense.title)}</h4>
                  <p>${escapeHtml(expense.note || "")}</p>
                </div>
                <strong>${formatMoney(expense.amountCents)}</strong>
              </div>
              <div class="item-meta">
                ${expense.category ? `<span>${escapeHtml(expense.category)}</span>` : ""}
                ${expense.vendor ? `<span>${escapeHtml(expense.vendor)}</span>` : ""}
                <span>${formatDate(expense.expenseDate, { dateOnly: true })}</span>
              </div>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderVotes() {
  const ballots = state.data.ballots || [];
  const activeBallots = ballots.filter((ballot) => ballot.status === "open");
  const pastBallots = ballots.filter((ballot) => ballot.status !== "open");

  return `
    <section class="content-grid">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>Open votes</h3>
            <p>Current issues and elections available for voting.</p>
          </div>
        </div>
        ${activeBallots.length ? activeBallots.map(renderBallotCard).join("") : emptyState("No open votes right now.")}
      </div>
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>Past vote results</h3>
            <p>Closed votes show aggregate results only.</p>
          </div>
        </div>
        ${pastBallots.length ? pastBallots.map(renderBallotCard).join("") : emptyState("No past vote results yet.")}
      </div>
    </section>
  `;
}

function renderBallotCard(ballot) {
  const totalVotes = Number(ballot.totalVotes || 0);
  const isOpen = ballot.status === "open";

  return `
    <article class="item-card">
      <div class="panel-header">
        <div>
          <h3>${escapeHtml(ballot.title)}</h3>
          <p>${escapeHtml(ballot.description || ballot.questionTitle || "")}</p>
        </div>
        ${statusPill(ballot.status)}
      </div>
      <div class="item-meta">
        <span>${ballot.ballotType === "election" ? "Executive board election" : "Issue vote"}</span>
        <span>${totalVotes} total vote${totalVotes === 1 ? "" : "s"}</span>
        ${ballot.endsAt ? `<span>Ends ${formatDate(ballot.endsAt)}</span>` : ""}
      </div>
      <div>
        ${(ballot.options || [])
          .map((option) => {
            const percent = totalVotes ? Math.round((Number(option.voteCount || 0) / totalVotes) * 100) : 0;
            const selected = Number(ballot.userVoteOptionId) === Number(option.id);
            return `
              <div class="vote-option">
                <div class="vote-line">
                  <strong>${escapeHtml(option.label)}</strong>
                  <span>${option.voteCount} vote${option.voteCount === 1 ? "" : "s"} (${percent}%)</span>
                </div>
                ${option.description ? `<p class="muted">${escapeHtml(option.description)}</p>` : ""}
                <div class="progress" aria-label="${percent}%"><span style="width: ${percent}%"></span></div>
                ${
                  isOpen
                    ? `<button class="vote-button ${selected ? "selected" : ""}" data-click="vote" data-ballot-id="${ballot.id}" data-option-id="${option.id}" type="button">
                        ${selected ? "Selected" : "Vote"}
                      </button>`
                    : ""
                }
              </div>
            `;
          })
          .join("")}
      </div>
    </article>
  `;
}

function renderEvents() {
  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>Event calendar</h3>
          <p>Meetings, community programs, and organization dates.</p>
        </div>
      </div>
      ${renderEventList(state.data.events || [])}
    </section>
  `;
}

function renderEventList(events) {
  if (!events.length) return emptyState("No upcoming events are planned.");

  return `
    <div class="item-list">
      ${events
        .map(
          (event) => `
            <article class="item-card">
              <h4>${escapeHtml(event.title)}</h4>
              <p>${escapeHtml(event.description || "")}</p>
              <div class="item-meta">
                <span>${formatDate(event.startsAt)}</span>
                ${event.endsAt ? `<span>Ends ${formatDate(event.endsAt)}</span>` : ""}
                ${event.location ? `<span>${escapeHtml(event.location)}</span>` : ""}
              </div>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderNotificationList(notifications) {
  if (!notifications.length) return emptyState("No notifications yet.");

  return `
    <div class="item-list">
      ${notifications
        .slice(0, 6)
        .map(
          (notification) => `
            <article class="item-card">
              <h4>${escapeHtml(notification.title)}</h4>
              <p>${escapeHtml(notification.body)}</p>
              <div class="item-meta">
                <span>${formatDate(notification.createdAt)}</span>
                <span>${notification.readAt ? "Read" : "Unread"}</span>
              </div>
              ${
                notification.readAt
                  ? ""
                  : `<div class="actions"><button class="secondary-button" data-click="read-notification" data-notification-id="${notification.id}" type="button">Mark read</button></div>`
              }
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderNotificationCleanupForm(scope = "admin") {
  return `
    <form class="notification-cleanup compact-form" data-action="clear-old-notifications" data-scope="${escapeHtml(scope)}">
      <label class="field">
        <span>Clear notifications older than days</span>
        <input name="days" type="number" min="1" max="365" value="30" required>
      </label>
      <button class="danger-button" type="submit">Clear old notifications</button>
    </form>
  `;
}

function renderQuestions() {
  const questions = state.data.questions || [];
  const articles = (state.data.announcements || []).filter((announcement) => announcement.category === "article");

  return `
    <section class="content-grid">
      <div class="two-column">
        <div class="panel">
          <div class="panel-header">
            <div>
              <h3>Published questions</h3>
              <p>Community discussion starts after admin approval.</p>
            </div>
          </div>
          ${
            questions.length
              ? `<div class="item-list">${questions.map(renderQuestionCard).join("")}</div>`
              : emptyState("No member questions have been published.")
          }
        </div>
        <aside class="panel">
          <div class="panel-header">
            <div>
              <h3>Submit to admin</h3>
              <p>Questions and articles are reviewed before publication.</p>
            </div>
          </div>
          <form class="form-stack" data-action="create-question">
            <label class="field">
              <span>Submission type</span>
              <select name="contentType">
                <option value="question">Question</option>
                <option value="article">Article</option>
              </select>
            </label>
            <label class="field">
              <span>Title</span>
              <input name="title" required>
            </label>
            <label class="field">
              <span>Details</span>
              <textarea name="body" required></textarea>
            </label>
            <button class="primary-button" type="submit">Submit for review</button>
          </form>
        </aside>
      </div>
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>Published articles</h3>
            <p>Member and organization articles approved by admins.</p>
          </div>
        </div>
        ${renderAnnouncementList(articles)}
      </div>
    </section>
  `;
}

function renderQuestionCard(question) {
  return `
    <article class="item-card">
      <h4>${escapeHtml(question.title)}</h4>
      <p>${escapeHtml(question.body)}</p>
      <div class="item-meta">
        <span>${escapeHtml(question.authorName)}</span>
        <span>${formatDate(question.publishedAt || question.createdAt)}</span>
      </div>
      <div class="comment-list">
        ${(question.comments || [])
          .map(
            (comment) => `
              <div class="comment">
                <strong>${escapeHtml(comment.authorName)}</strong>
                <p>${escapeHtml(comment.body)}</p>
                <span class="muted">${formatDate(comment.createdAt)}</span>
              </div>
            `
          )
          .join("")}
      </div>
      <form class="form-stack" data-action="add-comment" data-question-id="${question.id}">
        <label class="field">
          <span>Comment</span>
          <textarea name="body" required></textarea>
        </label>
        <button class="secondary-button" type="submit">Post comment</button>
      </form>
    </article>
  `;
}

function renderPayments() {
  const payments = state.data.payments || [];

  return `
    <section class="two-column">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>Dues and donation history</h3>
            <p>Payment records are reviewed by admins.</p>
          </div>
        </div>
        ${renderPaymentTable(payments, false)}
      </div>
      <aside class="panel">
        <div class="panel-header">
          <div>
            <h3>Record payment</h3>
            <p>Use this for dues, donations, or payment tracking.</p>
          </div>
        </div>
        <form class="form-stack" data-action="record-payment">
          <label class="field">
            <span>Purpose</span>
            <select name="purpose">
              <option value="dues">Membership dues</option>
              <option value="donation">Donation</option>
            </select>
          </label>
          <label class="field">
            <span>Amount</span>
            <input name="amount" type="number" min="1" step="0.01" required>
          </label>
          ${renderPaymentMethodSelect(availablePaymentDetails())}
          ${renderPaymentGuides(availablePaymentDetails())}
          ${renderPaymentRecordFields()}
          <label class="field">
            <span>Reference or note</span>
            <textarea name="note"></textarea>
          </label>
          <button class="primary-button" type="submit">Submit record</button>
        </form>
      </aside>
    </section>
  `;
}

function renderPaymentTable(payments, adminMode) {
  if (!payments.length) return emptyState("No payment records yet.");

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            ${adminMode ? "<th>Member</th>" : ""}
            <th>Purpose</th>
            <th>Amount</th>
            <th>Method</th>
            <th>Status</th>
            <th>Date</th>
            ${adminMode ? "<th>Action</th>" : ""}
          </tr>
        </thead>
        <tbody>
          ${payments
            .map((payment) => {
              const memberMeta = payment.memberEmail
                ? `<br><span class="muted">${escapeHtml(payment.memberEmail)}</span>`
                : "";
              const processorMeta = [payment.processorStatus, payment.dwollaTransferUrl || payment.externalReference]
                .filter(Boolean)
                .join(" | ");
              const submittedDetails = payment.paymentDetails || {};
              const submittedMeta = [
                submittedDetails.paymentReference ? `Ref: ${submittedDetails.paymentReference}` : "",
                submittedDetails.payerHandle ? `Sender: ${submittedDetails.payerHandle}` : "",
                submittedDetails.bankName ? `Bank: ${submittedDetails.bankName}` : "",
                submittedDetails.accountLast4 ? `Last 4: ${submittedDetails.accountLast4}` : "",
                submittedDetails.cashDonorName ? `Cash donor: ${submittedDetails.cashDonorName}` : "",
                submittedDetails.cashReceivedBy ? `Received by: ${submittedDetails.cashReceivedBy}` : ""
              ]
                .filter(Boolean)
                .join(" | ");
              const actions = [];
              if (payment.status === "pending") {
                actions.push(`<button class="secondary-button" data-click="payment-status" data-payment-id="${payment.id}" data-status="received" type="button">Received</button>`);
              }
              if (payment.purpose === "donation" && payment.status === "received") {
                actions.push(
                  payment.publishedAt
                    ? `<span class="muted">Published</span>`
                    : `<button class="secondary-button" data-click="payment-publish" data-payment-id="${payment.id}" type="button">Publish</button>`
                );
              }
              const actionCell = actions.length ? actions.join("") : `<span class="muted">Finalized</span>`;

              return `
                <tr>
                  ${adminMode ? `<td>${escapeHtml(payment.memberName)}${memberMeta}</td>` : ""}
                  <td>${escapeHtml(payment.purpose)}</td>
                  <td>${formatMoney(payment.amountCents)}</td>
                  <td>
                    ${escapeHtml(paymentMethodLabel(payment.method))}
                    ${processorMeta ? `<br><span class="muted">${escapeHtml(processorMeta)}</span>` : ""}
                    ${submittedMeta ? `<br><span class="muted">${escapeHtml(submittedMeta)}</span>` : ""}
                    ${payment.paymentDetailSnapshot ? `<br><span class="muted">${escapeHtml(payment.paymentDetailSnapshot)}</span>` : ""}
                  </td>
                  <td>${statusPill(payment.status)}</td>
                  <td>${formatDate(payment.createdAt)}</td>
                  ${
                    adminMode
                      ? `<td>
                          <div class="actions">
                            ${actionCell}
                          </div>
                        </td>`
                      : ""
                  }
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderProfile() {
  const user = state.user;

  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>Member profile</h3>
          <p>${escapeHtml(user.email)}</p>
        </div>
        ${statusPill(user.membershipStatus)}
      </div>
      <form class="form-stack" data-action="update-profile">
        <div class="form-grid">
          <label class="field">
            <span>First name</span>
            <input name="firstName" value="${escapeHtml(user.firstName)}" required>
          </label>
          <label class="field">
            <span>Last name</span>
            <input name="lastName" value="${escapeHtml(user.lastName)}" required>
          </label>
          <label class="field">
            <span>Phone</span>
            <input name="phone" value="${escapeHtml(user.phone)}">
          </label>
          <label class="field">
            <span>City</span>
            <input name="city" value="${escapeHtml(user.city)}">
          </label>
          <label class="field">
            <span>State</span>
            <input name="state" value="${escapeHtml(user.state)}">
          </label>
        </div>
        <label class="field">
          <span>Address</span>
          <input name="address" value="${escapeHtml(user.address)}">
        </label>
        <label class="field">
          <span>Profile details</span>
          <textarea name="bio">${escapeHtml(user.bio)}</textarea>
        </label>
        <label class="inline-label">
          <input name="notificationOptIn" type="checkbox" ${user.notificationOptIn ? "checked" : ""}>
          <span>Receive in-app notifications for new announcements</span>
        </label>
        <button class="primary-button" type="submit">Save profile</button>
      </form>
    </section>
  `;
}

function requireAdminData(label = "Loading admin tools...") {
  if (state.user.role !== "admin") {
    return emptyState("Admin access is required.");
  }

  if (!state.admin) {
    queueMicrotask(async () => {
      await loadAdminSummary();
      render();
    });
    return emptyState(label);
  }

  return "";
}

function adminStats() {
  const members = state.admin?.members || [];
  const payments = state.admin?.payments || [];
  const expenditures = state.admin?.expenditures || [];
  const financialSummary = state.admin?.financialSummary || {
    receivedTotalCents: 0,
    donationTotalCents: 0,
    pendingPaymentTotalCents: 0,
    expenditureTotalCents: 0,
    accountBalanceCents: 0
  };
  const activeMembers = members.filter((member) => member.membershipStatus === "active");
  const pendingApprovals = members.filter((member) => member.membershipStatus === "pending_approval");
  const duesPaidIds = new Set(
    payments
      .filter((payment) => payment.purpose === "dues" && payment.status === "received")
      .map((payment) => Number(payment.userId))
  );
  const donors = new Set(
    payments
      .filter((payment) => payment.purpose === "donation" && payment.status === "received")
      .map((payment) => Number(payment.userId))
  );

  return {
    members,
    payments,
    expenditures,
    financialSummary,
    activeMembers,
    pendingApprovals,
    duesPaidIds,
    donors,
    pendingQuestions: (state.admin?.questions || []).filter((question) => question.status === "pending"),
    openBallots: (state.admin?.ballots || []).filter((ballot) => ballot.status === "open"),
    upcomingEvents: (state.admin?.events || []).filter((event) => event.status !== "archived" && new Date(event.startsAt) >= new Date())
  };
}

function renderAdminOverview() {
  const loading = requireAdminData("Loading admin overview...");
  if (loading) return loading;

  const stats = adminStats();
  const unread = (state.data.notifications || []).filter((notification) => !notification.readAt);

  return `
    <section class="admin-section">
      <div class="metric-grid">
        <div class="metric"><span>Account balance</span><strong>${formatMoney(stats.financialSummary.accountBalanceCents)}</strong></div>
        <div class="metric"><span>Total received</span><strong>${formatMoney(stats.financialSummary.receivedTotalCents)}</strong></div>
        <div class="metric"><span>Total expenses</span><strong>${formatMoney(stats.financialSummary.expenditureTotalCents)}</strong></div>
        <div class="metric"><span>Pending payments</span><strong>${formatMoney(stats.financialSummary.pendingPaymentTotalCents)}</strong></div>
      </div>
      <div class="metric-grid">
        <div class="metric"><span>Total members</span><strong>${stats.members.length}</strong></div>
        <div class="metric"><span>Pending approvals</span><strong>${stats.pendingApprovals.length}</strong></div>
        <div class="metric"><span>Dues paid</span><strong>${stats.duesPaidIds.size}</strong></div>
        <div class="metric"><span>Dues unpaid</span><strong>${Math.max(stats.activeMembers.length - stats.duesPaidIds.size, 0)}</strong></div>
      </div>
      <div class="metric-grid">
        <div class="metric"><span>Pending questions</span><strong>${stats.pendingQuestions.length}</strong></div>
        <div class="metric"><span>Upcoming events</span><strong>${stats.upcomingEvents.length}</strong></div>
        <div class="metric"><span>Open ballots</span><strong>${stats.openBallots.length}</strong></div>
        <div class="metric"><span>Unread notices</span><strong>${unread.length}</strong></div>
      </div>
      <section class="two-column">
        <div class="content-grid">
          <div class="panel">
            <div class="panel-header">
              <div>
                <h3>Account approvals</h3>
                <p>Validate member applications and ID cards.</p>
              </div>
            </div>
            ${renderPendingApprovals(stats.pendingApprovals)}
          </div>
          <div class="panel">
            <div class="panel-header">
              <div>
                <h3>Payment review</h3>
                <p>Pending dues, donations, and registration fees.</p>
              </div>
            </div>
            ${renderPaymentTable(stats.payments.filter((payment) => payment.status === "pending").slice(0, 8), true)}
          </div>
        </div>
        <div class="content-grid">
          <div class="panel">
            <div class="panel-header">
              <div>
                <h3>Notifications</h3>
                <p>Recent admin notices and cleanup.</p>
              </div>
            </div>
            ${renderNotificationCleanupForm("overview")}
            ${renderNotificationList(state.data.notifications || [])}
          </div>
          <div class="panel">
            <div class="panel-header">
              <div>
                <h3>Upcoming events</h3>
                <p>Next organization dates.</p>
              </div>
            </div>
            ${renderEventList(stats.upcomingEvents.slice(0, 5))}
          </div>
        </div>
      </section>
    </section>
  `;
}

function renderAdminAbout() {
  const loading = requireAdminData("Loading about page...");
  if (loading) return loading;

  const about = state.admin.about || { summary: "", missionStatement: "", purpose: "", articles: [], positions: [] };

  return `
    <section class="content-grid">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>About page content</h3>
            <p>These details are shown to anonymous visitors and members.</p>
          </div>
        </div>
        <form class="form-stack" data-action="update-about">
          <label class="field">
            <span>Organization summary</span>
            <textarea name="summary" required>${escapeHtml(about.summary || "")}</textarea>
          </label>
          <label class="field">
            <span>Mission statement</span>
            <textarea name="missionStatement" required>${escapeHtml(about.missionStatement || "")}</textarea>
          </label>
          <label class="field">
            <span>Organization purpose</span>
            <textarea name="purpose" required>${escapeHtml(about.purpose || "")}</textarea>
          </label>
          <button class="primary-button" type="submit">Save about content</button>
        </form>
      </div>
      <section class="two-column">
        <div class="panel">
          <div class="panel-header">
            <div>
              <h3>Public publications</h3>
              <p>Manage home page articles, images, visibility, and removal.</p>
            </div>
          </div>
          ${renderAboutPublicationManager(about.articles || [])}
        </div>
        <aside class="panel">
          <div class="panel-header">
            <div>
              <h3>Add publication</h3>
              <p>Publish an article and optional image on the public home page.</p>
            </div>
          </div>
          ${renderPublicArticleForm()}
        </aside>
      </section>
      <section class="two-column">
        <div class="panel">
          <div class="panel-header">
            <div>
              <h3>Leadership positions</h3>
              <p>Manage current, hidden, and archived organization leaders.</p>
            </div>
          </div>
          ${renderLeadershipPositionManager(about.positions || [])}
        </div>
        <aside class="panel">
          <div class="panel-header">
            <div>
              <h3>Add position</h3>
              <p>Upload an image and describe who is running the organization.</p>
            </div>
          </div>
          ${renderLeadershipPositionForm()}
        </aside>
      </section>
    </section>
  `;
}

function renderPublicArticleForm(article = null) {
  const isEdit = Boolean(article);
  return `
    <form class="form-stack" data-action="${isEdit ? "update-about-article" : "create-about-article"}" ${isEdit ? `data-article-id="${article.id}"` : ""}>
      <label class="field">
        <span>Article title</span>
        <input name="title" value="${escapeHtml(article?.title || "")}" required>
      </label>
      <label class="field">
        <span>Article body</span>
        <textarea name="body" required>${escapeHtml(article?.body || "")}</textarea>
      </label>
      <div class="form-grid">
        <label class="field">
          <span>Display order</span>
          <input name="displayOrder" type="number" step="1" value="${escapeHtml(article?.displayOrder ?? 0)}">
        </label>
        ${
          isEdit
            ? `<label class="field">
                <span>Status</span>
                <select name="status">
                  <option value="published" ${article.status === "published" ? "selected" : ""}>Published</option>
                  <option value="hidden" ${article.status === "hidden" ? "selected" : ""}>Hidden</option>
                </select>
              </label>`
            : ""
        }
      </div>
      <label class="field">
        <span>${isEdit ? "Replace article image" : "Article image"}</span>
        <input name="image" type="file" accept="image/png,image/jpeg,image/webp">
      </label>
      ${article?.image?.dataUrl ? `<img class="leadership-thumb" src="${escapeHtml(article.image.dataUrl)}" alt="${escapeHtml(article.title)}">` : ""}
      <div class="actions">
        <button class="primary-button" type="submit">${isEdit ? "Save publication" : "Publish article"}</button>
        ${isEdit ? `<button class="ghost-button" data-click="cancel-about-article-edit" type="button">Cancel</button>` : ""}
      </div>
    </form>
  `;
}

function renderAboutPublicationManager(articles) {
  const counts = {
    all: articles.length,
    published: articles.filter((article) => article.status === "published").length,
    hidden: articles.filter((article) => article.status === "hidden").length
  };

  return `
    <div class="metric-grid compact-metrics">
      <div class="metric"><span>Total</span><strong>${counts.all}</strong></div>
      <div class="metric"><span>Published</span><strong>${counts.published}</strong></div>
      <div class="metric"><span>Hidden</span><strong>${counts.hidden}</strong></div>
      <div class="metric"><span>Showing</span><strong>${filteredAboutArticles(articles).length}</strong></div>
    </div>
    <form class="publication-toolbar" data-action="filter-about-articles">
      <label class="field">
        <span>Status</span>
        <select name="status">
          <option value="all" ${state.aboutArticleFilters.status === "all" ? "selected" : ""}>All publications</option>
          <option value="published" ${state.aboutArticleFilters.status === "published" ? "selected" : ""}>Published only</option>
          <option value="hidden" ${state.aboutArticleFilters.status === "hidden" ? "selected" : ""}>Hidden only</option>
        </select>
      </label>
      <label class="field">
        <span>Search title or body</span>
        <input name="query" value="${escapeHtml(state.aboutArticleFilters.query)}" placeholder="Search publications">
      </label>
      <div class="filter-actions">
        <button class="secondary-button" type="submit">Apply</button>
        <button class="ghost-button" data-click="reset-about-article-filters" type="button">Reset</button>
        <button class="danger-button" data-click="cleanup-hidden-about-articles" type="button">Drop hidden older than 30 days</button>
      </div>
    </form>
    ${renderAdminPublicArticleList(filteredAboutArticles(articles))}
  `;
}

function filteredAboutArticles(articles) {
  const status = state.aboutArticleFilters.status;
  const query = state.aboutArticleFilters.query.trim().toLowerCase();

  return articles.filter((article) => {
    const matchesStatus = status === "all" || article.status === status;
    const matchesQuery = !query || `${article.title} ${article.body}`.toLowerCase().includes(query);
    return matchesStatus && matchesQuery;
  });
}

function renderAdminPublicArticleList(articles) {
  if (!articles.length) return emptyState("No matching public home publications.");

  return `
    <div class="item-list">
      ${articles.map(renderAdminPublicArticleCard).join("")}
    </div>
  `;
}

function renderAdminPublicArticleCard(article) {
  const isEditing = Number(state.editingAboutArticleId) === Number(article.id);

  if (isEditing) {
    return `
      <article class="publication-card editing">
        ${renderPublicArticleForm(article)}
      </article>
    `;
  }

  const preview = article.body.length > 260 ? `${article.body.slice(0, 260)}...` : article.body;
  const nextStatus = article.status === "hidden" ? "published" : "hidden";

  return `
    <article class="publication-card ${article.image?.dataUrl ? "" : "without-image"}">
      ${
        article.image?.dataUrl
          ? `<img src="${escapeHtml(article.image.dataUrl)}" alt="${escapeHtml(article.title)}">`
          : ""
      }
      <div class="publication-body">
        <div class="panel-header">
          <div>
            <h4>${escapeHtml(article.title)}</h4>
            <p>${escapeHtml(preview)}</p>
          </div>
          ${statusPill(article.status)}
        </div>
        <div class="item-meta">
          <span>Order ${article.displayOrder}</span>
          <span>Created ${formatDate(article.createdAt)}</span>
          <span>Updated ${formatDate(article.updatedAt)}</span>
          ${article.hiddenAt ? `<span>Hidden ${formatDate(article.hiddenAt)}</span>` : ""}
        </div>
        <div class="actions publication-actions">
          <button class="secondary-button" data-click="edit-about-article" data-article-id="${article.id}" type="button">Edit</button>
          <button class="ghost-button" data-click="about-article-status" data-article-id="${article.id}" data-status="${nextStatus}" type="button">
            ${article.status === "hidden" ? "Publish" : "Hide"}
          </button>
          <button class="danger-button" data-click="delete-about-article" data-article-id="${article.id}" type="button">Delete</button>
        </div>
      </div>
    </article>
  `;
}

function renderLeadershipPositionForm(position = null) {
  const isEdit = Boolean(position);
  return `
    <form class="form-stack" data-action="${isEdit ? "update-leadership-position" : "create-leadership-position"}" ${isEdit ? `data-position-id="${position.id}"` : ""}>
      <label class="field">
        <span>Position title</span>
        <input name="title" value="${escapeHtml(position?.title || "")}" required>
      </label>
      <label class="field">
        <span>Person holding position</span>
        <input name="holderName" value="${escapeHtml(position?.holderName || "")}">
      </label>
      <label class="field">
        <span>Summary or article</span>
        <textarea name="body">${escapeHtml(position?.body || "")}</textarea>
      </label>
      <div class="form-grid">
        <label class="field">
          <span>Display order</span>
          <input name="displayOrder" type="number" step="1" value="${escapeHtml(position?.displayOrder ?? 0)}">
        </label>
        ${
          isEdit
            ? `<label class="field">
                <span>Status</span>
                <select name="status">
                  <option value="published" ${position.status === "published" ? "selected" : ""}>Published</option>
                  <option value="hidden" ${position.status === "hidden" ? "selected" : ""}>Hidden</option>
                  <option value="archived" ${position.status === "archived" ? "selected" : ""}>Archived</option>
                </select>
              </label>`
            : ""
        }
      </div>
      <label class="field">
        <span>${isEdit ? "Replace image" : "Position image"}</span>
        <input name="image" type="file" accept="image/png,image/jpeg,image/webp">
      </label>
      ${position?.image?.dataUrl ? `<img class="leadership-thumb" src="${escapeHtml(position.image.dataUrl)}" alt="${escapeHtml(position.title)}">` : ""}
      <div class="actions">
        <button class="primary-button" type="submit">${isEdit ? "Save position" : "Add position"}</button>
        ${isEdit ? `<button class="ghost-button" data-click="cancel-leadership-position-edit" type="button">Cancel</button>` : ""}
      </div>
    </form>
  `;
}

function renderLeadershipPositionManager(positions) {
  const counts = {
    all: positions.length,
    published: positions.filter((position) => position.status === "published").length,
    hidden: positions.filter((position) => position.status === "hidden").length,
    archived: positions.filter((position) => position.status === "archived").length
  };

  return `
    <div class="metric-grid compact-metrics">
      <div class="metric"><span>Total</span><strong>${counts.all}</strong></div>
      <div class="metric"><span>Current</span><strong>${counts.published}</strong></div>
      <div class="metric"><span>Hidden</span><strong>${counts.hidden}</strong></div>
      <div class="metric"><span>Archived</span><strong>${counts.archived}</strong></div>
    </div>
    <form class="publication-toolbar" data-action="filter-leadership-positions">
      <label class="field">
        <span>Status</span>
        <select name="status">
          <option value="all" ${state.leadershipFilters.status === "all" ? "selected" : ""}>All positions</option>
          <option value="published" ${state.leadershipFilters.status === "published" ? "selected" : ""}>Current only</option>
          <option value="hidden" ${state.leadershipFilters.status === "hidden" ? "selected" : ""}>Hidden only</option>
          <option value="archived" ${state.leadershipFilters.status === "archived" ? "selected" : ""}>Archived only</option>
        </select>
      </label>
      <label class="field">
        <span>Search title, name, or bio</span>
        <input name="query" value="${escapeHtml(state.leadershipFilters.query)}" placeholder="Search leaders">
      </label>
      <div class="filter-actions">
        <button class="secondary-button" type="submit">Apply</button>
        <button class="ghost-button" data-click="reset-leadership-filters" type="button">Reset</button>
      </div>
    </form>
    ${renderAdminLeadershipList(filteredLeadershipPositions(positions))}
  `;
}

function filteredLeadershipPositions(positions) {
  const status = state.leadershipFilters.status;
  const query = state.leadershipFilters.query.trim().toLowerCase();

  return positions.filter((position) => {
    const matchesStatus = status === "all" || position.status === status;
    const matchesQuery = !query || `${position.title} ${position.holderName} ${position.body}`.toLowerCase().includes(query);
    return matchesStatus && matchesQuery;
  });
}

function renderAdminLeadershipList(positions) {
  if (!positions.length) return emptyState("No matching leadership positions.");

  return `
    <div class="item-list">
      ${positions.map(renderAdminLeadershipCard).join("")}
    </div>
  `;
}

function renderAdminLeadershipCard(position) {
  const isEditing = Number(state.editingLeadershipPositionId) === Number(position.id);

  if (isEditing) {
    return `
      <article class="publication-card editing">
        ${renderLeadershipPositionForm(position)}
      </article>
    `;
  }

  const preview = position.body.length > 220 ? `${position.body.slice(0, 220)}...` : position.body;

  return `
    <article class="publication-card ${position.image?.dataUrl ? "" : "without-image"}">
      ${
        position.image?.dataUrl
          ? `<img src="${escapeHtml(position.image.dataUrl)}" alt="${escapeHtml(position.title)}">`
          : ""
      }
      <div class="publication-body">
        <div class="panel-header">
          <div>
            <h4>${escapeHtml(position.title)}</h4>
            ${position.holderName ? `<strong>${escapeHtml(position.holderName)}</strong>` : ""}
            ${preview ? `<p>${escapeHtml(preview)}</p>` : ""}
          </div>
          ${statusPill(position.status)}
        </div>
        <div class="item-meta">
          <span>Order ${position.displayOrder}</span>
          <span>Created ${formatDate(position.createdAt)}</span>
          <span>Updated ${formatDate(position.updatedAt)}</span>
          ${position.archivedAt ? `<span>Archived ${formatDate(position.archivedAt)}</span>` : ""}
        </div>
        <div class="actions publication-actions">
          <button class="secondary-button" data-click="edit-leadership-position" data-position-id="${position.id}" type="button">Edit</button>
          ${
            position.status === "published"
              ? `<button class="ghost-button" data-click="leadership-position-status" data-position-id="${position.id}" data-status="hidden" type="button">Hide</button>`
              : `<button class="ghost-button" data-click="leadership-position-status" data-position-id="${position.id}" data-status="published" type="button">Publish</button>`
          }
          ${
            position.status === "archived"
              ? ""
              : `<button class="ghost-button" data-click="leadership-position-status" data-position-id="${position.id}" data-status="archived" type="button">Archive</button>`
          }
        </div>
      </div>
    </article>
  `;
}

function renderAdminAnnouncements() {
  const loading = requireAdminData("Loading announcements...");
  if (loading) return loading;

  return `
    <section class="two-column">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>Published announcements and articles</h3>
            <p>Review what has been sent to members.</p>
          </div>
        </div>
        ${renderAnnouncementList(state.admin.announcements || [])}
      </div>
      <aside class="panel">
        <div class="panel-header">
          <div>
            <h3>Publish announcement</h3>
            <p>Published items create member notifications.</p>
          </div>
        </div>
        ${renderAnnouncementForm()}
      </aside>
    </section>
  `;
}

function renderAnnouncementForm() {
  return `
    <form class="form-stack" data-action="create-announcement">
      <label class="field">
        <span>Title</span>
        <input name="title" required>
      </label>
      <label class="field">
        <span>Category</span>
        <select name="category">
          <option value="announcement">Announcement</option>
          <option value="article">Article</option>
          <option value="board_update">Board update</option>
        </select>
      </label>
      <label class="field">
        <span>Body</span>
        <textarea name="body" required></textarea>
      </label>
      <button class="primary-button" type="submit">Publish</button>
    </form>
  `;
}

function renderAdminQuestionsPage() {
  const loading = requireAdminData("Loading questions...");
  if (loading) return loading;

  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>Member questions and articles</h3>
          <p>Publish questions for discussion, close resolved submissions, or publish a member article submission.</p>
        </div>
      </div>
      ${renderAdminQuestions()}
    </section>
  `;
}

function renderAdminEvents() {
  const loading = requireAdminData("Loading events...");
  if (loading) return loading;
  const events = state.admin.events || [];

  return `
    <section class="two-column">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>Organization events</h3>
            <p>Create, edit, and archive organization events.</p>
          </div>
        </div>
        ${renderAdminEventManager(events)}
      </div>
      <aside class="panel">
        <div class="panel-header">
          <div>
            <h3>Create event</h3>
            <p>Plan meetings, programs, and community gatherings.</p>
          </div>
        </div>
        ${renderEventForm()}
      </aside>
    </section>
  `;
}

function renderEventForm() {
  return `
    <form class="form-stack" data-action="create-event">
      <label class="field">
        <span>Title</span>
        <input name="title" required>
      </label>
      <label class="field">
        <span>Location</span>
        <input name="location">
      </label>
      <div class="form-grid">
        <label class="field">
          <span>Starts</span>
          <input name="startsAt" type="datetime-local" required>
        </label>
        <label class="field">
          <span>Ends</span>
          <input name="endsAt" type="datetime-local">
        </label>
      </div>
      <label class="field">
        <span>Description</span>
        <textarea name="description"></textarea>
      </label>
      <button class="primary-button" type="submit">Create event</button>
    </form>
  `;
}

function renderAdminEventManager(events) {
  if (!events.length) return emptyState("No events are planned.");

  return `
    <div class="item-list">
      ${events
        .map(
          (event) => `
            <article class="item-card event-admin-card">
              <div class="panel-header">
                <div>
                  <h4>${escapeHtml(event.title)}</h4>
                  <p>${escapeHtml(event.location || "No venue set")}</p>
                </div>
                ${statusPill(event.status || "active")}
              </div>
              <form class="form-stack event-edit-form" data-action="update-event" data-event-id="${event.id}">
                <label class="field">
                  <span>Title</span>
                  <input name="title" value="${escapeHtml(event.title)}" required>
                </label>
                <label class="field">
                  <span>Venue</span>
                  <input name="location" value="${escapeHtml(event.location || "")}">
                </label>
                <div class="form-grid">
                  <label class="field">
                    <span>Starts</span>
                    <input name="startsAt" type="datetime-local" value="${toDatetimeLocalValue(event.startsAt)}" required>
                  </label>
                  <label class="field">
                    <span>Ends</span>
                    <input name="endsAt" type="datetime-local" value="${toDatetimeLocalValue(event.endsAt)}">
                  </label>
                </div>
                <label class="field">
                  <span>Description</span>
                  <textarea name="description">${escapeHtml(event.description || "")}</textarea>
                </label>
                <div class="actions">
                  <button class="primary-button" type="submit">Save changes</button>
                  ${
                    event.status === "archived"
                      ? `<span class="muted">Archived ${formatDate(event.archivedAt)}</span>`
                      : `<button class="secondary-button" data-click="event-archive" data-event-id="${event.id}" type="button">Archive</button>`
                  }
                </div>
              </form>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function dateOnlyValue(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function currentMonthValue() {
  return new Date().toISOString().slice(0, 7);
}

function socialTaskLabel(taskType) {
  const labels = {
    food: "Food team",
    drinks: "Drinks team",
    host: "Meeting host",
    setup: "Setup",
    cleanup: "Cleanup",
    other: "Other"
  };
  return labels[taskType] || "Other";
}

function socialTaskOptions(selected = "food") {
  return ["food", "drinks", "host", "setup", "cleanup", "other"]
    .map((taskType) => `<option value="${taskType}" ${selected === taskType ? "selected" : ""}>${socialTaskLabel(taskType)}</option>`)
    .join("");
}

function socialStatusOptions(statuses, selected) {
  return statuses
    .map((status) => `<option value="${status}" ${selected === status ? "selected" : ""}>${escapeHtml(statusLabel(status))}</option>`)
    .join("");
}

function activeMemberOptions(selectedId = "") {
  const members = (state.admin?.members || []).filter((member) => member.role === "member" && member.membershipStatus === "active");
  return `
    <option value="">Unassigned</option>
    ${members
      .map((member) => `<option value="${member.id}" ${Number(selectedId) === Number(member.id) ? "selected" : ""}>${escapeHtml(member.fullName)} (${escapeHtml(member.email)})</option>`)
      .join("")}
  `;
}

function socialMeetingOptions(meetings = [], selectedId = "") {
  const openMeetings = meetings.filter((meeting) => !["completed", "cancelled"].includes(meeting.status));
  return `
    <option value="">Choose monthly meeting</option>
    ${openMeetings
      .map(
        (meeting) => `
          <option value="${meeting.id}" ${Number(selectedId) === Number(meeting.id) ? "selected" : ""}>
            ${escapeHtml(meeting.title)} - ${formatDate(meeting.meetingDate, { dateOnly: true })}
          </option>
        `
      )
      .join("")}
  `;
}

function flattenSocialAssignments(meetings = []) {
  return meetings.flatMap((meeting) =>
    (meeting.assignments || []).map((assignment) => ({
      ...assignment,
      meetingTitle: meeting.title,
      meetingDate: meeting.meetingDate,
      meetingStatus: meeting.status
    }))
  );
}

function renderAdminSocialCoordinator() {
  const loading = requireAdminData("Loading social coordinator...");
  if (loading) return loading;

  const social = state.admin.social || { meetings: [], resources: [], resourceRequests: [], resourceAdjustments: [], fundRequests: [] };
  const assignments = flattenSocialAssignments(social.meetings || []);
  const pendingRequests = (social.resourceRequests || []).filter((request) => request.status === "pending");
  const checkedOutRequests = (social.resourceRequests || []).filter((request) => request.status === "delivered");
  const pendingFundRequests = (social.fundRequests || []).filter((request) => request.status === "pending");
  const currentMeetings = (social.meetings || []).filter((meeting) => meeting.status !== "completed" && meeting.status !== "cancelled");
  const checkedOutResources = (social.resources || []).reduce(
    (total, resource) => total + Math.max(0, Number(resource.totalQuantity || 0) - Number(resource.availableQuantity || 0)),
    0
  );

  return `
    <section class="content-grid">
      <div class="metric-grid">
        <div class="metric"><span>Meetings tracked</span><strong>${(social.meetings || []).length}</strong></div>
        <div class="metric"><span>Open meetings</span><strong>${currentMeetings.length}</strong></div>
        <div class="metric"><span>Assignments</span><strong>${assignments.length}</strong></div>
        <div class="metric"><span>Pending requests</span><strong>${pendingRequests.length}</strong></div>
        <div class="metric"><span>Checked out</span><strong>${checkedOutRequests.length}</strong></div>
        <div class="metric"><span>Pending funds</span><strong>${pendingFundRequests.length}</strong></div>
        <div class="metric"><span>Resources</span><strong>${(social.resources || []).length}</strong></div>
        <div class="metric"><span>Out quantity</span><strong>${checkedOutResources}</strong></div>
      </div>
      ${renderAdminSocialTabs()}
      ${renderAdminSocialSection(social, assignments)}
    </section>
  `;
}

function renderAdminSocialTabs() {
  const tabs = [
    ["meetings", "Monthly meetings"],
    ["assignments", "Assignments"],
    ["funds", "Fund requests"],
    ["resources", "Resources"],
    ["checked-out", "Checked out"],
    ["requests", "Resource requests"]
  ];

  return `
    <div class="view-tabs social-admin-tabs" aria-label="Social coordinator sections">
      ${tabs
        .map(
          ([key, label]) => `
            <button class="tab-button ${state.adminSocialSection === key ? "active" : ""}" data-click="admin-social-section" data-section="${key}" type="button">
              ${escapeHtml(label)}
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function renderAdminSocialSection(social, assignments) {
  switch (state.adminSocialSection) {
    case "assignments":
      return renderAdminSocialAssignmentsSection(social, assignments);
    case "funds":
      return renderAdminSocialFundRequestsSection(social.fundRequests || []);
    case "resources":
      return renderAdminSocialResourcesSection(social.resources || [], social.resourceAdjustments || []);
    case "checked-out":
      return renderAdminSocialCheckedOutSection(social.resourceRequests || []);
    case "requests":
      return renderAdminSocialRequestsSection(social.resourceRequests || []);
    default:
      return renderAdminSocialMeetingsSection(social.meetings || []);
  }
}

function renderAdminSocialMeetingsSection(meetings) {
  return `
    <section class="two-column">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>Monthly meetings</h3>
            <p>Meetings are planned for the first Saturday of each month.</p>
          </div>
        </div>
        ${renderAdminSocialMeetingList(meetings)}
      </div>
      <aside class="panel">
        <div class="panel-header">
          <div>
            <h3>Create monthly meeting</h3>
            <p>Choose a month and the system uses that month&apos;s first Saturday.</p>
          </div>
        </div>
        ${renderSocialMeetingForm()}
      </aside>
    </section>
  `;
}

function renderAdminSocialAssignmentsSection(social, assignments) {
  return `
    <section class="two-column">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>Assignments</h3>
            <p>Manage food, drinks, hosting, setup, and cleanup tasks across monthly meetings.</p>
          </div>
        </div>
        ${renderSocialAssignmentList(assignments)}
      </div>
      <aside class="panel">
        <div class="panel-header">
          <div>
            <h3>Assign task</h3>
            <p>Choose a meeting and assign responsibility to an active member.</p>
          </div>
        </div>
        ${renderSocialAssignmentForm("", social.meetings || [])}
      </aside>
    </section>
  `;
}

function renderAdminSocialResourcesSection(resources, adjustments = []) {
  return `
    <section class="two-column">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>Resource inventory</h3>
            <p>Update existing resources when the organization buys more instead of creating duplicates.</p>
          </div>
        </div>
        ${renderSocialResourceList(resources)}
      </div>
      <aside class="panel">
        <div class="panel-header">
          <div>
            <h3>Add new resource</h3>
            <p>Create a resource once, then use add quantity for future purchases.</p>
          </div>
        </div>
        ${renderSocialResourceCreateForm()}
        <div class="social-subsection">
          <div class="panel-header">
            <div>
              <h3>Inventory adjustments</h3>
              <p>Recent purchases and destroyed resource records.</p>
            </div>
          </div>
          ${renderSocialResourceAdjustments(adjustments)}
        </div>
      </aside>
    </section>
  `;
}

function renderAdminSocialCheckedOutSection(requests) {
  const delivered = requests.filter((request) => request.status === "delivered");
  const reserved = requests.filter((request) => request.status === "approved");

  return `
    <section class="two-column">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>Checked out resources</h3>
            <p>Resources currently in member possession.</p>
          </div>
        </div>
        ${renderAdminCheckedOutResourceRequests(delivered)}
      </div>
      <aside class="panel">
        <div class="panel-header">
          <div>
            <h3>Approved for pickup</h3>
            <p>Mark delivered after the member picks up the approved resource.</p>
          </div>
        </div>
        ${renderAdminCheckedOutResourceRequests(reserved)}
      </aside>
    </section>
  `;
}

function renderAdminSocialFundRequestsSection(requests) {
  const pending = requests.filter((request) => request.status === "pending");
  const reviewed = requests.filter((request) => request.status !== "pending");

  return `
    <section class="two-column">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>Pending fund requests</h3>
            <p>Review funds requested for expensive dishes or drinks.</p>
          </div>
        </div>
        ${renderAdminSocialFundRequests(pending)}
      </div>
      <aside class="panel">
        <div class="panel-header">
          <div>
            <h3>Fund request history</h3>
            <p>Approved and rejected requests remain available for audit.</p>
          </div>
        </div>
        ${renderAdminSocialFundRequests(reviewed)}
      </aside>
    </section>
  `;
}

function renderAdminSocialRequestsSection(requests) {
  const pending = requests.filter((request) => request.status === "pending");
  const reviewed = requests.filter((request) => request.status !== "pending");

  return `
    <section class="two-column">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>Pending resource requests</h3>
            <p>Approve resource reservations before members pick them up.</p>
          </div>
        </div>
        ${renderAdminSocialResourceRequests(pending)}
      </div>
      <aside class="panel">
        <div class="panel-header">
          <div>
            <h3>Request history</h3>
            <p>Approved, delivered, checked in, and declined requests remain available for follow-up.</p>
          </div>
        </div>
        ${renderAdminSocialResourceRequests(reviewed)}
      </aside>
    </section>
  `;
}

function renderSocialMeetingForm() {
  return `
    <form class="form-stack" data-action="create-social-meeting">
      <label class="field">
        <span>Meeting month</span>
        <input name="meetingMonth" type="month" value="${currentMonthValue()}" required>
      </label>
      <label class="field">
        <span>Title</span>
        <input name="title" value="237 Ville monthly meeting" required>
      </label>
      <label class="field">
        <span>Location</span>
        <input name="location">
      </label>
      <label class="field">
        <span>Notes</span>
        <textarea name="notes"></textarea>
      </label>
      <button class="primary-button" type="submit">Create meeting</button>
    </form>
  `;
}

function renderAdminSocialMeetingList(meetings) {
  if (!meetings.length) return emptyState("No social meetings have been created.");

  return `
    <div class="item-list">
      ${meetings.map(renderAdminSocialMeetingCard).join("")}
    </div>
  `;
}

function renderAdminSocialMeetingCard(meeting) {
  const assignments = meeting.assignments || [];

  return `
    <article class="item-card social-meeting-card">
      <div class="panel-header">
        <div>
          <h4>${escapeHtml(meeting.title)}</h4>
          <p>${formatDate(meeting.meetingDate, { dateOnly: true })}${meeting.location ? ` · ${escapeHtml(meeting.location)}` : ""}</p>
        </div>
        ${statusPill(meeting.status)}
      </div>
      <form class="form-stack" data-action="update-social-meeting" data-meeting-id="${meeting.id}">
        <div class="form-grid">
          <label class="field">
            <span>Title</span>
            <input name="title" value="${escapeHtml(meeting.title)}" required>
          </label>
          <label class="field">
            <span>Meeting date</span>
            <input name="meetingDate" type="date" value="${dateOnlyValue(meeting.meetingDate)}" required>
          </label>
          <label class="field">
            <span>Location</span>
            <input name="location" value="${escapeHtml(meeting.location || "")}">
          </label>
          <label class="field">
            <span>Status</span>
            <select name="status">${socialStatusOptions(["draft", "published", "completed", "cancelled"], meeting.status)}</select>
          </label>
        </div>
        <label class="field">
          <span>Notes</span>
          <textarea name="notes">${escapeHtml(meeting.notes || "")}</textarea>
        </label>
        <div class="actions">
          <button class="primary-button" type="submit">Save meeting</button>
          <button class="secondary-button" data-click="publish-social-meeting" data-meeting-id="${meeting.id}" type="button">Publish as announcement</button>
        </div>
      </form>
      <div class="social-subsection">
        <div class="panel-header">
          <div>
            <h4>Assignment summary</h4>
            <p>${assignments.length} task${assignments.length === 1 ? "" : "s"} assigned for this meeting.</p>
          </div>
        </div>
        ${renderSocialAssignmentSummary(assignments)}
      </div>
    </article>
  `;
}

function renderSocialAssignmentList(assignments) {
  if (!assignments.length) return emptyState("No assignments yet.");

  return `
    <div class="item-list compact-list">
      ${assignments
        .map(
          (assignment) => `
            <form class="item-card compact-card" data-action="update-social-assignment" data-assignment-id="${assignment.id}">
              ${
                assignment.meetingTitle
                  ? `<div class="panel-header">
                      <div>
                        <h4>${escapeHtml(assignment.meetingTitle)}</h4>
                        <p>${formatDate(assignment.meetingDate, { dateOnly: true })}</p>
                      </div>
                      ${assignment.meetingStatus ? statusPill(assignment.meetingStatus) : ""}
                    </div>`
                  : ""
              }
              <div class="form-grid">
                <label class="field">
                  <span>Member</span>
                  <select name="userId">${activeMemberOptions(assignment.userId || "")}</select>
                </label>
                <label class="field">
                  <span>Task</span>
                  <select name="taskType">${socialTaskOptions(assignment.taskType)}</select>
                </label>
                <label class="field">
                  <span>Group</span>
                  <input name="groupName" value="${escapeHtml(assignment.groupName || "")}">
                </label>
                <label class="field">
                  <span>Status</span>
                  <select name="status">${socialStatusOptions(["assigned", "completed", "cancelled"], assignment.status)}</select>
                </label>
              </div>
              <label class="field">
                <span>Assignment title</span>
                <input name="title" value="${escapeHtml(assignment.title)}" required>
              </label>
              <label class="field">
                <span>Note</span>
                <input name="note" value="${escapeHtml(assignment.note || "")}">
              </label>
              ${renderSocialAssignmentResponseDetails(assignment)}
              <button class="secondary-button" type="submit">Save assignment</button>
            </form>
          `
        )
        .join("")}
    </div>
  `;
}

function renderSocialAssignmentForm(meetingId = "", meetings = []) {
  const meetingField = meetingId
    ? ""
    : `<label class="field">
        <span>Monthly meeting</span>
        <select name="meetingId" required>${socialMeetingOptions(meetings)}</select>
      </label>`;

  if (!meetingId && !meetings.filter((meeting) => !["completed", "cancelled"].includes(meeting.status)).length) {
    return emptyState("Create an open monthly meeting before assigning tasks.");
  }

  return `
    <form class="form-stack social-assignment-form" data-action="create-social-assignment" ${meetingId ? `data-meeting-id="${meetingId}"` : ""}>
      ${meetingField}
      <div class="form-grid">
        <label class="field">
          <span>Member</span>
          <select name="userId">${activeMemberOptions()}</select>
        </label>
        <label class="field">
          <span>Task</span>
          <select name="taskType">
            <option value="food">Food team (women)</option>
            <option value="drinks">Drinks team (men)</option>
            <option value="host">Meeting host</option>
            <option value="setup">Setup</option>
            <option value="cleanup">Cleanup</option>
            <option value="other">Other</option>
          </select>
        </label>
      </div>
      <label class="field">
        <span>Assignment title</span>
        <input name="title" placeholder="Bring food, provide drinks, host meeting..." required>
      </label>
      <label class="field">
        <span>Note</span>
        <input name="note">
      </label>
      <button class="secondary-button" type="submit">Assign task</button>
    </form>
  `;
}

function renderSocialResourceManager(resources) {
  return renderAdminSocialResourcesSection(resources);
}

function renderSocialResourceCreateForm() {
  return `
    <form class="form-stack" data-action="create-social-resource">
      <label class="field">
        <span>Resource name</span>
        <input name="name" placeholder="Chairs, tables, coolers..." required>
      </label>
      <div class="form-grid">
        <label class="field">
          <span>Total quantity</span>
          <input name="totalQuantity" type="number" min="0" step="1" value="0">
        </label>
        <label class="field">
          <span>Available quantity</span>
          <input name="availableQuantity" type="number" min="0" step="1" value="0">
        </label>
      </div>
      <label class="field">
        <span>Storage location</span>
        <input name="storageLocation">
      </label>
      <label class="field">
        <span>Description</span>
        <textarea name="description"></textarea>
      </label>
      <button class="primary-button" type="submit">Add resource</button>
    </form>
  `;
}

function renderSocialResourceList(resources) {
  if (!resources.length) return emptyState("No resources have been added.");

  return `
    <div class="item-list">
      ${resources
        .map(
          (resource) => {
            const checkedOut = Math.max(0, Number(resource.totalQuantity || 0) - Number(resource.availableQuantity || 0));
            return `
            <article class="item-card compact-card">
              <div class="panel-header">
                <div>
                  <h4>${escapeHtml(resource.name)}</h4>
                  <p>${escapeHtml(resource.description || "")}</p>
                </div>
                ${statusPill(resource.status)}
              </div>
              <div class="item-meta">
                <span>Total ${resource.totalQuantity}</span>
                <span>Available ${resource.availableQuantity}</span>
                <span>Checked out ${checkedOut}</span>
                ${resource.storageLocation ? `<span>${escapeHtml(resource.storageLocation)}</span>` : ""}
              </div>
              <form class="form-grid resource-stock-form" data-action="add-social-resource-stock" data-resource-id="${resource.id}">
                <label class="field">
                  <span>Add purchased quantity</span>
                  <input name="quantity" type="number" min="1" step="1" value="1" required>
                </label>
                <label class="field">
                  <span>Purchase note</span>
                  <input name="note" placeholder="Optional receipt or purchase note">
                </label>
                <div class="filter-actions">
                  <button class="primary-button" type="submit">Add quantity</button>
                </div>
              </form>
              <form class="form-grid resource-stock-form danger-form" data-action="destroy-social-resource-stock" data-resource-id="${resource.id}">
                <label class="field">
                  <span>Destroyed quantity</span>
                  <input name="quantity" type="number" min="1" max="${resource.availableQuantity}" step="1" value="1" required>
                </label>
                <label class="field">
                  <span>Reason</span>
                  <input name="note" placeholder="Broken, lost, unsafe, etc." required>
                </label>
                <div class="filter-actions">
                  <button class="secondary-button danger-button" type="submit" ${Number(resource.availableQuantity || 0) < 1 ? "disabled" : ""}>Mark destroyed</button>
                </div>
              </form>
              <form class="form-stack" data-action="update-social-resource" data-resource-id="${resource.id}">
              <div class="form-grid">
                <label class="field">
                  <span>Name</span>
                  <input name="name" value="${escapeHtml(resource.name)}" required>
                </label>
                <label class="field">
                  <span>Status</span>
                  <select name="status">${socialStatusOptions(["active", "retired"], resource.status)}</select>
                </label>
                <label class="field">
                  <span>Total</span>
                  <input name="totalQuantity" type="number" min="0" step="1" value="${resource.totalQuantity}">
                </label>
                <label class="field">
                  <span>Available</span>
                  <input name="availableQuantity" type="number" min="0" step="1" value="${resource.availableQuantity}">
                </label>
              </div>
              <label class="field">
                <span>Storage location</span>
                <input name="storageLocation" value="${escapeHtml(resource.storageLocation || "")}">
              </label>
              <label class="field">
                <span>Description</span>
                <textarea name="description">${escapeHtml(resource.description || "")}</textarea>
              </label>
              <button class="secondary-button" type="submit">Save resource</button>
            </form>
            </article>
          `;
          }
        )
        .join("")}
    </div>
  `;
}

function renderSocialResourceAdjustments(adjustments) {
  if (!adjustments.length) return emptyState("No inventory adjustments recorded yet.");

  return `
    <div class="item-list compact-list">
      ${adjustments
        .map(
          (adjustment) => `
            <div class="comment">
              <strong>${escapeHtml(adjustment.resourceName)} · ${escapeHtml(statusLabel(adjustment.adjustmentType))} ${adjustment.quantity}</strong>
              <p>${escapeHtml(adjustment.note || "")}</p>
              <div class="item-meta">
                ${adjustment.adjustedByName ? `<span>${escapeHtml(adjustment.adjustedByName)}</span>` : ""}
                <span>${formatDate(adjustment.createdAt)}</span>
              </div>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderAdminCheckedOutResourceRequests(requests) {
  if (!requests.length) return emptyState("No resources match this status.");

  return `
    <div class="item-list">
      ${requests
        .map(
          (request) => `
            <article class="item-card">
              <div class="panel-header">
                <div>
                  <h4>${escapeHtml(request.resourceName)}</h4>
                  <p>${escapeHtml(request.requesterName)} has ${request.quantity}${request.meetingTitle ? ` for ${escapeHtml(request.meetingTitle)}` : ""}</p>
                </div>
                ${statusPill(request.status)}
              </div>
              <div class="item-meta">
                ${request.deliveredAt ? `<span>Delivered ${formatDate(request.deliveredAt)}</span>` : ""}
                ${request.neededDate ? `<span>Needed ${formatDate(request.neededDate, { dateOnly: true })}</span>` : ""}
                ${request.returnDate ? `<span>Expected return ${formatDate(request.returnDate, { dateOnly: true })}</span>` : ""}
              </div>
              ${request.note ? `<p>${escapeHtml(request.note)}</p>` : ""}
              <div class="actions">
                ${
                  request.status === "approved"
                    ? `<button class="secondary-button" data-click="resource-request-status" data-request-id="${request.id}" data-status="delivered" type="button">Mark delivered</button>`
                    : ""
                }
                ${
                  request.status === "delivered"
                    ? `<button class="primary-button" data-click="resource-request-status" data-request-id="${request.id}" data-status="checked_in" type="button">Mark checked in</button>`
                    : ""
                }
              </div>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderAdminSocialFundRequests(requests) {
  if (!requests.length) return emptyState("No fund requests yet.");

  return `
    <div class="item-list">
      ${requests
        .map(
          (request) => `
            <article class="item-card">
              <div class="panel-header">
                <div>
                  <h4>${escapeHtml(request.itemDescription)}</h4>
                  <p>${escapeHtml(request.requesterName)} requested ${formatMoney(request.amountCents)}${request.meetingTitle ? ` for ${escapeHtml(request.meetingTitle)}` : ""}</p>
                </div>
                ${statusPill(request.status)}
              </div>
              <div class="item-meta">
                ${request.assignmentTitle ? `<span>${escapeHtml(request.assignmentTitle)}</span>` : ""}
                ${request.taskType ? `<span>${escapeHtml(socialTaskLabel(request.taskType))}</span>` : ""}
                <span>${formatDate(request.createdAt)}</span>
              </div>
              <p>${escapeHtml(request.reason || "")}</p>
              <form class="form-stack compact-form" data-action="update-social-fund-request" data-request-id="${request.id}">
                <label class="field">
                  <span>Status</span>
                  <select name="status">${socialStatusOptions(["pending", "approved", "rejected"], request.status)}</select>
                </label>
                <label class="field">
                  <span>Admin note</span>
                  <input name="adminNote" value="${escapeHtml(request.adminNote || "")}">
                </label>
                <button class="secondary-button" type="submit">Update fund request</button>
              </form>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderAdminSocialResourceRequests(requests) {
  if (!requests.length) return emptyState("No resource requests yet.");

  return `
    <div class="item-list">
      ${requests
        .map(
          (request) => `
            <article class="item-card">
              <div class="panel-header">
                <div>
                  <h4>${escapeHtml(request.resourceName)}</h4>
                  <p>${escapeHtml(request.requesterName)} requested ${request.quantity}${request.meetingTitle ? ` for ${escapeHtml(request.meetingTitle)}` : ""}</p>
                </div>
                ${statusPill(request.status)}
              </div>
              <div class="item-meta">
                ${request.neededDate ? `<span>Needed ${formatDate(request.neededDate, { dateOnly: true })}</span>` : ""}
                ${request.returnDate ? `<span>Return ${formatDate(request.returnDate, { dateOnly: true })}</span>` : ""}
                ${request.deliveredAt ? `<span>Delivered ${formatDate(request.deliveredAt)}</span>` : ""}
                ${request.checkedInAt ? `<span>Checked in ${formatDate(request.checkedInAt)}</span>` : ""}
                <span>${formatDate(request.createdAt)}</span>
              </div>
              ${request.note ? `<p>${escapeHtml(request.note)}</p>` : ""}
              <form class="form-stack compact-form" data-action="update-social-resource-request" data-request-id="${request.id}">
                <label class="field">
                  <span>Status</span>
                  <select name="status">${socialStatusOptions(["pending", "approved", "delivered", "checked_in", "declined"], request.status)}</select>
                </label>
                <label class="field">
                  <span>Admin note</span>
                  <input name="adminNote" value="${escapeHtml(request.adminNote || "")}">
                </label>
                <button class="secondary-button" type="submit">Update request</button>
              </form>
              <div class="actions">
                ${
                  request.status === "approved"
                    ? `<button class="secondary-button" data-click="resource-request-status" data-request-id="${request.id}" data-status="delivered" type="button">Mark delivered</button>`
                    : ""
                }
                ${
                  request.status === "delivered"
                    ? `<button class="primary-button" data-click="resource-request-status" data-request-id="${request.id}" data-status="checked_in" type="button">Mark checked in</button>`
                    : ""
                }
              </div>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderSocialCoordinator() {
  const social = state.data.social || { meetings: [], resources: [], resourceRequests: [], fundRequests: [] };
  const meetings = social.meetings || [];
  const resources = social.resources || [];
  const fundRequests = social.fundRequests || [];
  const myAssignments = meetings.flatMap((meeting) =>
    (meeting.assignments || [])
      .filter((assignment) => Number(assignment.userId) === Number(state.user.id))
      .map((assignment) => ({ ...assignment, meeting }))
  );
  const assignedMeetingIds = new Set(
    myAssignments
      .filter((assignment) => assignment.status === "assigned")
      .map((assignment) => Number(assignment.meeting.id))
  );
  const requestableMeetings = meetings.filter((meeting) => assignedMeetingIds.has(Number(meeting.id)));

  return `
    <section class="content-grid">
      <section class="two-column">
        <div class="panel">
          <div class="panel-header">
            <div>
              <h3>My assignments</h3>
              <p>Tasks assigned to you by the social coordinator.</p>
            </div>
          </div>
          ${renderMemberSocialAssignments(myAssignments, fundRequests)}
        </div>
        <aside class="content-grid">
          <div class="panel">
            <div class="panel-header">
              <div>
                <h3>Request resources</h3>
                <p>Requests are available only for meetings where you have an assigned task.</p>
              </div>
            </div>
            ${renderResourceRequestForm(requestableMeetings, resources)}
          </div>
          <div class="panel">
            <div class="panel-header">
              <div>
                <h3>My resource requests</h3>
                <p>Review request status and admin notes.</p>
              </div>
            </div>
            ${renderMemberResourceRequests(social.resourceRequests || [])}
          </div>
        </aside>
      </section>
    </section>
  `;
}

function renderMemberSocialMeetings(meetings) {
  if (!meetings.length) return emptyState("No social meeting schedule has been published.");

  return `
    <div class="item-list">
      ${meetings
        .map(
          (meeting) => `
            <article class="item-card">
              <div class="panel-header">
                <div>
                  <h4>${escapeHtml(meeting.title)}</h4>
                  <p>${formatDate(meeting.meetingDate, { dateOnly: true })}${meeting.location ? ` · ${escapeHtml(meeting.location)}` : ""}</p>
                </div>
                ${statusPill(meeting.status)}
              </div>
              ${meeting.notes ? `<p>${escapeHtml(meeting.notes)}</p>` : ""}
              ${renderSocialAssignmentSummary(meeting.assignments || [])}
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderSocialAssignmentSummary(assignments) {
  if (!assignments.length) return emptyState("Assignments have not been published yet.");

  return `
    <div class="item-list compact-list">
      ${assignments
        .map(
          (assignment) => `
            <div class="comment">
              <strong>${escapeHtml(socialTaskLabel(assignment.taskType))}</strong>
              <p>${escapeHtml(assignment.memberName || "Unassigned")}${assignment.groupName ? ` · ${escapeHtml(assignment.groupName)}` : ""}${assignment.note ? ` · ${escapeHtml(assignment.note)}` : ""}</p>
              ${renderSocialAssignmentResponseDetails(assignment)}
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderSocialAssignmentResponseDetails(assignment) {
  const foodContribution = String(assignment.foodContribution || "").trim();
  const drinkBottleCount = Number(assignment.drinkBottleCount || 0);
  const drinkBrand = String(assignment.drinkBrand || "").trim();
  const responseNote = String(assignment.responseNote || "").trim();
  const details = [];

  if (foodContribution) {
    details.push(`<span><strong>Dishes:</strong> ${escapeHtml(foodContribution)}</span>`);
  }

  if (drinkBottleCount > 0 || drinkBrand) {
    const drinkParts = [];
    if (drinkBottleCount > 0) {
      drinkParts.push(`${drinkBottleCount} bottle${drinkBottleCount === 1 ? "" : "s"}`);
    }
    drinkParts.push(assignment.drinkIsAlcoholic ? "alcoholic" : "non-alcoholic");
    if (drinkBrand) {
      drinkParts.push(`Brands: ${escapeHtml(drinkBrand)}`);
    }
    details.push(`<span><strong>Drinks:</strong> ${drinkParts.join(", ")}</span>`);
  }

  if (responseNote) {
    details.push(`<span><strong>Member note:</strong> ${escapeHtml(responseNote)}</span>`);
  }

  if (!details.length) return "";
  return `<div class="assignment-response">${details.join("")}</div>`;
}

function renderMemberSocialAssignments(assignments, fundRequests = []) {
  if (!assignments.length) return emptyState("No social meeting tasks are assigned to you right now.");

  return `
    <div class="item-list">
      ${assignments
        .map((assignment) => {
          const assignmentFundRequests = fundRequests.filter((request) => Number(request.assignmentId) === Number(assignment.id));
          return `
            <article class="item-card">
              <h4>${escapeHtml(assignment.title)}</h4>
              <p>${escapeHtml(assignment.meeting.title)} · ${formatDate(assignment.meeting.meetingDate, { dateOnly: true })}</p>
              <div class="item-meta">
                <span>${escapeHtml(socialTaskLabel(assignment.taskType))}</span>
                <span>${escapeHtml(assignment.groupName || "general")}</span>
                <span>${escapeHtml(assignment.status)}</span>
              </div>
              ${assignment.note ? `<p>${escapeHtml(assignment.note)}</p>` : ""}
              ${renderSocialAssignmentResponseDetails(assignment)}
              ${renderSocialAssignmentResponseForm(assignment)}
              ${renderSocialFundRequestForm(assignment)}
              ${renderMemberSocialFundRequests(assignmentFundRequests)}
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderSocialFundRequestForm(assignment) {
  if (assignment.status !== "assigned" || !["food", "drinks"].includes(assignment.taskType)) {
    return "";
  }

  return `
    <form class="form-stack compact-form assignment-response-form" data-action="create-social-fund-request" data-assignment-id="${assignment.id}">
      <h4>Request preparation funds</h4>
      <label class="field">
        <span>Dish or drink needing funds</span>
        <input name="itemDescription" placeholder="Examples: roasted fish, premium drinks" required>
      </label>
      <label class="field">
        <span>Amount requested</span>
        <input name="amount" type="number" min="1" step="0.01" required>
      </label>
      <label class="field">
        <span>Reason</span>
        <textarea name="reason" placeholder="Explain why this item needs organization funds." required></textarea>
      </label>
      <button class="secondary-button" type="submit">Submit fund request</button>
    </form>
  `;
}

function renderMemberSocialFundRequests(requests) {
  if (!requests.length) return "";

  return `
    <div class="comment-list">
      ${requests
        .map(
          (request) => `
            <div class="comment">
              <strong>${escapeHtml(request.itemDescription)} · ${formatMoney(request.amountCents)}</strong>
              <p>${escapeHtml(request.reason || "")}</p>
              <div class="item-meta">
                <span>${escapeHtml(request.status)}</span>
                <span>${formatDate(request.createdAt)}</span>
              </div>
              ${request.adminNote ? `<p><strong>Admin note:</strong> ${escapeHtml(request.adminNote)}</p>` : ""}
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderSocialAssignmentResponseForm(assignment) {
  const isFoodAssignment = assignment.taskType === "food";
  const isDrinkAssignment = assignment.taskType === "drinks";
  if (assignment.status !== "assigned" || (!isFoodAssignment && !isDrinkAssignment)) {
    return "";
  }

  return `
    <form class="form-stack compact-form assignment-response-form" data-action="respond-social-assignment" data-assignment-id="${assignment.id}">
      ${
        isFoodAssignment
          ? `<label class="field">
              <span>Dishes you will bring</span>
              <textarea name="foodContribution" placeholder="List each dish on a new line or separate dishes with commas." required>${escapeHtml(assignment.foodContribution || "")}</textarea>
            </label>`
          : ""
      }
      ${
        isDrinkAssignment
          ? `<div class="form-grid">
              <label class="field">
                <span>Total number of bottles</span>
                <input name="drinkBottleCount" type="number" min="1" step="1" value="${Number(assignment.drinkBottleCount || 0) || ""}" required>
              </label>
              <label class="field">
                <span>Drink brands you will bring</span>
                <textarea name="drinkBrand" placeholder="List each brand on a new line or separate brands with commas." required>${escapeHtml(assignment.drinkBrand || "")}</textarea>
              </label>
            </div>
            <label class="checkbox-row">
              <input name="drinkIsAlcoholic" type="checkbox" ${assignment.drinkIsAlcoholic ? "checked" : ""}>
              <span>Includes alcoholic drink(s)</span>
            </label>`
          : ""
      }
      <label class="field">
        <span>Optional note</span>
        <textarea name="responseNote">${escapeHtml(assignment.responseNote || "")}</textarea>
      </label>
      <button class="secondary-button" type="submit">Save task response</button>
    </form>
  `;
}

function renderResourceRequestForm(meetings, resources) {
  if (!meetings.length) return emptyState("You can request resources after the admin assigns you a task for a meeting.");
  const activeResources = resources.filter((resource) => resource.status === "active");
  if (!activeResources.length) return emptyState("No active organization resources are available to request.");

  return `
    <form class="form-stack" data-action="create-social-resource-request">
      <label class="field">
        <span>Meeting</span>
        <select name="meetingId" required>
          ${meetings
            .map((meeting) => `<option value="${meeting.id}">${escapeHtml(meeting.title)} - ${formatDate(meeting.meetingDate, { dateOnly: true })}</option>`)
            .join("")}
        </select>
      </label>
      <label class="field">
        <span>Resource</span>
        <select name="resourceId" required>
          ${activeResources
            .map((resource) => `<option value="${resource.id}">${escapeHtml(resource.name)} (${resource.availableQuantity} available)</option>`)
            .join("")}
        </select>
      </label>
      <label class="field">
        <span>Quantity</span>
        <input name="quantity" type="number" min="1" step="1" value="1" required>
      </label>
      <div class="form-grid">
        <label class="field">
          <span>Needed date</span>
          <input name="neededDate" type="date">
        </label>
        <label class="field">
          <span>Return date</span>
          <input name="returnDate" type="date">
        </label>
      </div>
      <label class="field">
        <span>Note</span>
        <textarea name="note"></textarea>
      </label>
      <button class="primary-button" type="submit">Submit request</button>
    </form>
  `;
}

function renderMemberResourceRequests(requests) {
  if (!requests.length) return emptyState("You have not requested resources yet.");

  return `
    <div class="item-list">
      ${requests
        .map(
          (request) => `
            <article class="item-card">
              <div class="panel-header">
                <div>
                  <h4>${escapeHtml(request.resourceName)}</h4>
                  <p>Quantity ${request.quantity}${request.meetingTitle ? ` · ${escapeHtml(request.meetingTitle)}` : ""}</p>
                </div>
                ${statusPill(request.status)}
              </div>
              <div class="item-meta">
                ${request.neededDate ? `<span>Needed ${formatDate(request.neededDate, { dateOnly: true })}</span>` : ""}
                ${request.returnDate ? `<span>Return ${formatDate(request.returnDate, { dateOnly: true })}</span>` : ""}
                ${request.deliveredAt ? `<span>Delivered ${formatDate(request.deliveredAt)}</span>` : ""}
                ${request.checkedInAt ? `<span>Checked in ${formatDate(request.checkedInAt)}</span>` : ""}
              </div>
              ${request.note ? `<p>${escapeHtml(request.note)}</p>` : ""}
              ${request.adminNote ? `<p class="muted">${escapeHtml(request.adminNote)}</p>` : ""}
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderAdminVotes() {
  const loading = requireAdminData("Loading ballots...");
  if (loading) return loading;
  const ballots = state.admin.ballots || [];
  const currentBallots = ballots.filter((ballot) => ballot.status !== "archived");
  const archivedBallots = ballots.filter((ballot) => ballot.status === "archived");
  const query = state.voteArchiveQuery.trim().toLowerCase();
  const filteredArchived = query
    ? archivedBallots.filter((ballot) =>
        `${ballot.title} ${ballot.description} ${ballot.ballotType}`.toLowerCase().includes(query)
      )
    : archivedBallots;

  return `
    <section class="content-grid">
      <div class="two-column">
        <div class="content-grid">
          ${currentBallots.length ? currentBallots.map(renderBallotCard).join("") : emptyState("No active or closed ballots have been created.")}
        </div>
        <aside class="content-grid">
          <div class="panel">
            <div class="panel-header">
              <div>
                <h3>Create ballot</h3>
                <p>Create issue votes or executive board elections.</p>
              </div>
            </div>
            ${renderBallotForm()}
          </div>
          <div class="panel">
            <div class="panel-header">
              <div>
                <h3>Ballot controls</h3>
                <p>Open, close, or archive voting periods.</p>
              </div>
            </div>
            ${renderAdminBallots(currentBallots)}
          </div>
        </aside>
      </div>
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>Archived vote results</h3>
            <p>Query past vote results without reopening or changing ballots.</p>
          </div>
        </div>
        <form class="form-stack compact-form" data-action="filter-archived-votes">
          <label class="field">
            <span>Search archived votes</span>
            <input name="query" value="${escapeHtml(state.voteArchiveQuery)}" placeholder="Search title, description, or type">
          </label>
          <div class="actions">
            <button class="primary-button" type="submit">Search results</button>
            <button class="ghost-button" data-click="reset-archived-votes" type="button">Reset</button>
          </div>
        </form>
        <div class="content-grid">
          ${filteredArchived.length ? filteredArchived.map(renderBallotCard).join("") : emptyState("No archived vote results match this query.")}
        </div>
      </div>
    </section>
  `;
}

function renderBallotForm() {
  return `
    <form class="form-stack" data-action="create-ballot">
      <div class="form-grid">
        <label class="field">
          <span>Title</span>
          <input name="title" required>
        </label>
        <label class="field">
          <span>Type</span>
          <select name="ballotType">
            <option value="issue">Issue vote</option>
            <option value="election">Executive board election</option>
          </select>
        </label>
        <label class="field">
          <span>Status</span>
          <select name="status">
            <option value="draft">Draft</option>
            <option value="open">Open now</option>
          </select>
        </label>
        <label class="field">
          <span>Related question ID</span>
          <input name="questionId" type="number" min="1">
        </label>
        <label class="field">
          <span>Last date to vote</span>
          <input name="endsAt" type="datetime-local">
        </label>
      </div>
      <label class="field">
        <span>Description</span>
        <textarea name="description"></textarea>
      </label>
      <label class="field">
        <span>Options, one per line</span>
        <textarea name="options" placeholder="Yes&#10;No&#10;Abstain"></textarea>
      </label>
      <button class="primary-button" type="submit">Create ballot</button>
    </form>
  `;
}

function renderAdminPayments() {
  const loading = requireAdminData("Loading dues and donations...");
  if (loading) return loading;

  const rows = buildMemberPaymentRows();
  const filteredRows = filterPaymentRows(rows);

  return `
    <section class="content-grid">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>Dues and donations</h3>
            <p>Track who has paid dues, who has donated, and what still needs review.</p>
          </div>
        </div>
        <div class="view-tabs">
          ${[
            ["all", "All"],
            ["dues_paid", "Dues paid"],
            ["dues_unpaid", "Dues unpaid"],
            ["donors", "Donors"],
            ["pending", "Pending review"]
          ]
            .map(
              ([key, label]) => `
                <button class="tab-button ${state.adminPaymentFilter === key ? "active" : ""}" data-click="payment-filter" data-filter="${key}" type="button">
                  ${label}
                </button>
              `
            )
            .join("")}
        </div>
        ${renderPaymentStatusTable(filteredRows)}
      </div>
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>Payment review</h3>
            <p>Confirm or cancel pending dues, donations, and registration fees.</p>
          </div>
        </div>
        ${renderPaymentTable(state.admin.payments || [], true)}
      </div>
    </section>
  `;
}

function renderAdminPaymentDetails() {
  const loading = requireAdminData("Loading payment details...");
  if (loading) return loading;

  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>Organization payment details</h3>
          <p>These details are shown to members and anonymous donors when they submit payment records.</p>
        </div>
      </div>
      <div class="item-list">
        ${allAdminPaymentDetails()
          .map(
            (detail) => `
              <article class="item-card">
                <form class="form-stack" data-action="update-payment-detail" data-method="${escapeHtml(detail.method)}">
                  <div class="panel-header">
                    <div>
                      <h4>${escapeHtml(detail.displayName)}</h4>
                      <p>${escapeHtml(detail.method)}</p>
                    </div>
                    ${statusPill(detail.enabled ? "active" : "inactive")}
                  </div>
                  <div class="form-grid">
                    <label class="field">
                      <span>Display name</span>
                      <input name="displayName" value="${escapeHtml(detail.displayName)}" required>
                    </label>
                    <label class="field">
                      <span>Payment handle or account</span>
                      <input name="accountIdentifier" value="${escapeHtml(detail.accountIdentifier || "")}">
                    </label>
                  </div>
                  <label class="field">
                    <span>Payment guide</span>
                    <textarea name="instructions">${escapeHtml(detail.instructions || "")}</textarea>
                  </label>
                  <label class="inline-label">
                    <input name="enabled" type="checkbox" ${detail.enabled ? "checked" : ""}>
                    <span>Enable this payment method</span>
                  </label>
                  <button class="primary-button" type="submit">Save payment detail</button>
                </form>
              </article>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderAdminExpenditures() {
  const loading = requireAdminData("Loading expenditures...");
  if (loading) return loading;

  const expenditures = state.admin.expenditures || [];
  const summary = state.admin.financialSummary || {
    expenditureTotalCents: 0,
    publishedExpenditureTotalCents: 0,
    accountBalanceCents: 0
  };

  return `
    <section class="content-grid">
      <div class="metric-grid">
        <div class="metric"><span>Account balance</span><strong>${formatMoney(summary.accountBalanceCents)}</strong></div>
        <div class="metric"><span>Total expenses</span><strong>${formatMoney(summary.expenditureTotalCents)}</strong></div>
        <div class="metric"><span>Published expenses</span><strong>${formatMoney(summary.publishedExpenditureTotalCents)}</strong></div>
        <div class="metric"><span>Expense records</span><strong>${expenditures.length}</strong></div>
      </div>
      <section class="two-column">
        <div class="panel">
          <div class="panel-header">
            <div>
              <h3>Organization expenditures</h3>
              <p>Entered expenses can be published for member visibility.</p>
            </div>
          </div>
          ${renderExpenditureTable(expenditures)}
        </div>
        <aside class="panel">
          <div class="panel-header">
            <div>
              <h3>Enter expense</h3>
              <p>Record organization spending and choose whether to publish it now.</p>
            </div>
          </div>
          ${renderExpenditureForm()}
        </aside>
      </section>
    </section>
  `;
}

function renderExpenditureForm() {
  return `
    <form class="form-stack" data-action="create-expenditure">
      <label class="field">
        <span>Expense title</span>
        <input name="title" required>
      </label>
      <div class="form-grid">
        <label class="field">
          <span>Amount</span>
          <input name="amount" type="number" min="0.01" step="0.01" required>
        </label>
        <label class="field">
          <span>Expense date</span>
          <input name="expenseDate" type="date">
        </label>
      </div>
      <div class="form-grid">
        <label class="field">
          <span>Category</span>
          <input name="category" placeholder="Venue, supplies, outreach">
        </label>
        <label class="field">
          <span>Vendor</span>
          <input name="vendor">
        </label>
      </div>
      <label class="field">
        <span>Notes</span>
        <textarea name="note"></textarea>
      </label>
      <label class="field">
        <span>Visibility</span>
        <select name="status">
          <option value="draft">Admin only</option>
          <option value="published">Publish to members</option>
        </select>
      </label>
      <button class="primary-button" type="submit">Save expense</button>
    </form>
  `;
}

function renderExpenditureTable(expenditures) {
  if (!expenditures.length) return emptyState("No expenditures have been entered.");

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Expense</th>
            <th>Amount</th>
            <th>Date</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${expenditures
            .map(
              (expense) => `
                <tr>
                  <td>
                    ${escapeHtml(expense.title)}
                    <br><span class="muted">${escapeHtml([expense.category, expense.vendor].filter(Boolean).join(" | "))}</span>
                    ${expense.note ? `<br><span class="muted">${escapeHtml(expense.note)}</span>` : ""}
                  </td>
                  <td>${formatMoney(expense.amountCents)}</td>
                  <td>${formatDate(expense.expenseDate, { dateOnly: true })}</td>
                  <td>${statusPill(expense.status)}</td>
                  <td>
                    ${
                      expense.status === "published"
                        ? `<span class="muted">Published</span>`
                        : `<button class="secondary-button" data-click="expenditure-publish" data-expenditure-id="${expense.id}" type="button">Publish</button>`
                    }
                  </td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function buildMemberPaymentRows() {
  const payments = state.admin.payments || [];
  return (state.admin.members || []).map((member) => {
    const memberPayments = payments.filter((payment) => Number(payment.userId) === Number(member.id));
    const duesTotal = memberPayments
      .filter((payment) => payment.purpose === "dues" && payment.status === "received")
      .reduce((sum, payment) => sum + Number(payment.amountCents || 0), 0);
    const donationTotal = memberPayments
      .filter((payment) => payment.purpose === "donation" && payment.status === "received")
      .reduce((sum, payment) => sum + Number(payment.amountCents || 0), 0);
    const pendingCount = memberPayments.filter((payment) => payment.status === "pending").length;

    return {
      ...member,
      duesPaid: duesTotal > 0,
      duesTotal,
      donationTotal,
      pendingCount
    };
  });
}

function filterPaymentRows(rows) {
  switch (state.adminPaymentFilter) {
    case "dues_paid":
      return rows.filter((row) => row.duesPaid);
    case "dues_unpaid":
      return rows.filter((row) => row.membershipStatus === "active" && !row.duesPaid);
    case "donors":
      return rows.filter((row) => row.donationTotal > 0);
    case "pending":
      return rows.filter((row) => row.pendingCount > 0);
    default:
      return rows;
  }
}

function renderPaymentStatusTable(rows) {
  if (!rows.length) return emptyState("No members match this payment filter.");

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Member</th>
            <th>Status</th>
            <th>Dues</th>
            <th>Donations</th>
            <th>Pending records</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>
                  <td>${escapeHtml(row.fullName)}<br><span class="muted">${escapeHtml(row.email)}</span></td>
                  <td>${statusPill(row.membershipStatus)}</td>
                  <td>${row.duesPaid ? `Paid ${formatMoney(row.duesTotal)}` : "Not paid"}</td>
                  <td>${formatMoney(row.donationTotal)}</td>
                  <td>${row.pendingCount}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderAdminProfiles() {
  const loading = requireAdminData("Loading member profiles...");
  if (loading) return loading;

  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>Members and users</h3>
          <p>Update contact details, roles, and account status.</p>
        </div>
      </div>
      <form class="form-grid notification-filter-form" data-action="filter-members">
        <label class="field">
          <span>Filter</span>
          <select name="scope">
            <option value="all" ${state.memberFilter.scope === "all" ? "selected" : ""}>All users</option>
            <option value="name" ${state.memberFilter.scope === "name" ? "selected" : ""}>User name</option>
          </select>
        </label>
        <label class="field">
          <span>User name</span>
          <input name="query" value="${escapeHtml(state.memberFilter.query)}" placeholder="Search first or last name">
        </label>
        <div class="filter-actions">
          <button class="primary-button" type="submit">Apply filter</button>
          <button class="ghost-button" data-click="reset-member-filter" type="button">Reset</button>
        </div>
      </form>
      ${renderMembersTable()}
    </section>
  `;
}

function renderAdminNotifications() {
  if (state.user.role !== "admin") {
    return emptyState("Admin access is required.");
  }

  if (!state.admin || !state.adminNotifications) {
    queueMicrotask(async () => {
      if (!state.admin) await loadAdminSummary();
      if (!state.adminNotifications) await loadAdminNotifications();
      render();
    });
    return emptyState("Loading notification audit records...");
  }

  const notifications = state.adminNotifications || [];

  return `
    <section class="admin-section">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>Notification audit</h3>
            <p>Filter notifications by date and member, then export the result.</p>
          </div>
          <button class="secondary-button" data-click="export-notifications" type="button">Export CSV</button>
        </div>
        <form class="form-grid notification-filter-form" data-action="filter-notifications">
          <label class="field">
            <span>User</span>
            <select name="userId">
              <option value="">All users</option>
              ${(state.admin.members || [])
                .map(
                  (member) => `
                    <option value="${member.id}" ${String(state.notificationFilters.userId) === String(member.id) ? "selected" : ""}>
                      ${escapeHtml(member.fullName)} (${escapeHtml(member.email)})
                    </option>
                  `
                )
                .join("")}
            </select>
          </label>
          <label class="field">
            <span>From date</span>
            <input name="dateFrom" type="date" value="${escapeHtml(state.notificationFilters.dateFrom)}">
          </label>
          <label class="field">
            <span>To date</span>
            <input name="dateTo" type="date" value="${escapeHtml(state.notificationFilters.dateTo)}">
          </label>
          <div class="filter-actions">
            <button class="primary-button" type="submit">Apply filters</button>
            <button class="ghost-button" data-click="reset-notification-filters" type="button">Reset</button>
          </div>
        </form>
      </div>
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>Results</h3>
            <p>${notifications.length} notification${notifications.length === 1 ? "" : "s"} found.</p>
          </div>
        </div>
        ${renderAdminNotificationTable(notifications)}
      </div>
    </section>
  `;
}

function renderAdminNotificationTable(notifications) {
  if (!notifications.length) return emptyState("No notifications match the selected filters.");

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>User</th>
            <th>Type</th>
            <th>Title</th>
            <th>Body</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${notifications
            .map(
              (notification) => `
                <tr>
                  <td>${formatDate(notification.createdAt)}</td>
                  <td>${escapeHtml(notification.userName)}<br><span class="muted">${escapeHtml(notification.userEmail)}</span></td>
                  <td>${escapeHtml(notification.type)}</td>
                  <td>${escapeHtml(notification.title)}</td>
                  <td>${escapeHtml(notification.body)}</td>
                  <td>${notification.readAt ? `Read ${formatDate(notification.readAt)}` : "Unread"}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderAdminQuestions() {
  const questions = state.admin.questions || [];
  if (!questions.length) return emptyState("No questions have been submitted.");

  return `
    <div class="item-list">
      ${questions
        .map(
          (question) => `
            <article class="item-card">
              <div class="panel-header">
                <div>
                  <h4>#${question.id} ${escapeHtml(question.title)}</h4>
                  <p>${escapeHtml(question.body)}</p>
                </div>
                ${statusPill(question.status)}
              </div>
              <div class="item-meta">
                <span>${question.contentType === "article" ? "Article submission" : "Question"}</span>
                <span>${escapeHtml(question.authorName)}</span>
                <span>${formatDate(question.createdAt)}</span>
              </div>
              <div class="actions">
                <button class="secondary-button" data-click="question-action" data-question-id="${question.id}" data-action-name="publish" type="button">Publish</button>
                <button class="secondary-button" data-click="question-article" data-question-id="${question.id}" type="button">Publish as article</button>
                <button class="danger-button" data-click="question-action" data-question-id="${question.id}" data-action-name="close" type="button">Close</button>
              </div>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderPendingApprovals(members) {
  if (!members.length) return emptyState("No member registrations are waiting for approval.");

  return `
    <div class="item-list">
      ${members
        .map(
          (member) => `
            <article class="item-card">
              <div class="panel-header">
                <div>
                  <h4>${escapeHtml(member.fullName)}</h4>
                  <p>${escapeHtml(member.email)}</p>
                </div>
                ${statusPill(member.membershipStatus)}
              </div>
              <div class="application-detail">
                <strong>Application statement</strong>
                <p>${escapeHtml(member.registrationStatement || "No application statement provided.")}</p>
                ${
                  member.identityDocument?.dataUrl
                    ? `<a class="document-link" href="${escapeHtml(member.identityDocument.dataUrl)}" target="_blank" rel="noopener" download="${escapeHtml(member.identityDocument.name)}">
                        Review ID card (${escapeHtml(member.identityDocument.name)}, ${formatBytes(member.identityDocument.size)})
                      </a>`
                    : `<span class="muted">No ID card uploaded.</span>`
                }
              </div>
              <form class="form-stack" data-action="approve-member" data-member-id="${member.id}">
                <label class="field">
                  <span>Temporary password</span>
                  <input name="temporaryPassword" type="text" minlength="8" required>
                </label>
                <div class="actions">
                  <button class="ghost-button" data-click="generate-temp-password" type="button">Generate password</button>
                  <button class="primary-button" type="submit">Approve account</button>
                </div>
              </form>
              <form class="form-stack rejection-form" data-action="reject-member" data-member-id="${member.id}">
                <label class="field">
                  <span>Rejection reason</span>
                  <textarea name="reason" required></textarea>
                </label>
                <button class="danger-button" type="submit">Reject account</button>
              </form>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderAdminBallots(ballots = state.admin.ballots || []) {
  if (!ballots.length) return emptyState("No ballots have been created.");

  return `
    <div class="item-list">
      ${ballots
        .map(
          (ballot) => `
            <article class="item-card">
              <div class="panel-header">
                <div>
                  <h4>${escapeHtml(ballot.title)}</h4>
                  <p>${ballot.totalVotes} aggregate vote${ballot.totalVotes === 1 ? "" : "s"}</p>
                </div>
                ${statusPill(ballot.status)}
              </div>
              <div class="actions">
                <button class="secondary-button" data-click="ballot-status" data-ballot-id="${ballot.id}" data-status="open" type="button">Open</button>
                <button class="danger-button" data-click="ballot-status" data-ballot-id="${ballot.id}" data-status="close" type="button">Close</button>
                <button class="ghost-button" data-click="ballot-archive" data-ballot-id="${ballot.id}" type="button">Archive</button>
              </div>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderMembersTable() {
  const members = filteredMembers();
  if (!members.length) return emptyState("No members are registered.");

  return `
    <div class="item-list">
      ${members
        .map(
          (member) => `
            <article class="item-card">
              <div class="panel-header">
                <div>
                  <h4>${escapeHtml(member.fullName)}</h4>
                  <p>${escapeHtml(member.email)} · Joined ${formatDate(member.createdAt, { dateOnly: true })}</p>
                </div>
                ${statusPill(member.membershipStatus)}
              </div>
              <form class="form-stack" data-action="admin-update-member" data-member-id="${member.id}">
                <div class="form-grid">
                  <label class="field">
                    <span>First name</span>
                    <input name="firstName" value="${escapeHtml(member.firstName)}" required>
                  </label>
                  <label class="field">
                    <span>Last name</span>
                    <input name="lastName" value="${escapeHtml(member.lastName)}" required>
                  </label>
                  <label class="field">
                    <span>Email</span>
                    <input name="email" type="email" value="${escapeHtml(member.email)}" required>
                  </label>
                  <label class="field">
                    <span>Phone</span>
                    <input name="phone" value="${escapeHtml(member.phone)}">
                  </label>
                  <label class="field">
                    <span>City</span>
                    <input name="city" value="${escapeHtml(member.city)}">
                  </label>
                  <label class="field">
                    <span>State</span>
                    <input name="state" value="${escapeHtml(member.state)}">
                  </label>
                  <label class="field">
                    <span>Role</span>
                    <select name="role">
                      <option value="member" ${member.role === "member" ? "selected" : ""}>Member</option>
                      <option value="admin" ${member.role === "admin" ? "selected" : ""}>Admin</option>
                    </select>
                  </label>
                  <label class="field">
                    <span>Account status</span>
                    <select name="membershipStatus">
                      ${["pending_approval", "pending_policy", "pending_fee", "active", "inactive", "suspended", "rejected"]
                        .map((status) => `<option value="${status}" ${member.membershipStatus === status ? "selected" : ""}>${status}</option>`)
                        .join("")}
                    </select>
                  </label>
                </div>
                <div class="item-meta">
                  <span>${member.passwordMustChange ? "Password reset required" : "Password set"}</span>
                  <span>${member.policyAcceptedAt ? "Policy signed" : "Policy not signed"}</span>
                </div>
                <button class="primary-button" type="submit">Save user details</button>
              </form>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

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
      await refreshAll({ includeAdmin: state.user.role === "admin" });
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
      await refreshAll({ includeAdmin: state.user.role === "admin" });
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
      await refreshAll({ includeAdmin: state.user.role === "admin" });
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
      await refreshAll({ includeAdmin: state.user.role === "admin" });
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
      await refreshAll({ includeAdmin: state.user.role === "admin" });
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
    if (state.user?.role === "admin" && !state.admin) {
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
      await refreshAll({ includeAdmin: state.user?.role === "admin" });
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
      await refreshAll({ includeAdmin: state.user.role === "admin" });
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

document.addEventListener("submit", handleSubmit);
document.addEventListener("change", handleChange);
document.addEventListener("click", handleClick);

await loadMe();
if (state.user) {
  await loadDashboard();
} else {
  await loadPublicPaymentDetails();
  await loadPublicAbout();
}
render();
