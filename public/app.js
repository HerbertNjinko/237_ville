const app = document.querySelector("#app");

const state = {
  user: null,
  data: null,
  admin: null,
  adminNotifications: null,
  adminPaymentFilter: "all",
  memberFilter: {
    scope: "all",
    query: ""
  },
  voteArchiveQuery: "",
  notificationFilters: {
    userId: "",
    dateFrom: "",
    dateTo: ""
  },
  view: "overview",
  authMode: "login",
  message: "",
  messageType: ""
};

const memberViews = [
  ["overview", "Overview"],
  ["announcements", "Announcements"],
  ["votes", "Votes"],
  ["events", "Events"],
  ["questions", "Questions"],
  ["payments", "Dues and donations"],
  ["profile", "Profile"]
];

const adminViews = [
  ["overview", "Overview"],
  ["announcements", "Announcements"],
  ["questions", "Questions"],
  ["events", "Events"],
  ["votes", "Votes"],
  ["payments", "Dues and donations"],
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
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: options.dateOnly ? undefined : "numeric",
    minute: options.dateOnly ? undefined : "2-digit"
  }).format(date);
}

function formatMoney(cents = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(Number(cents || 0) / 100);
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
  return `<span class="status-pill ${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

function emptyState(text) {
  return `<div class="empty-state">${escapeHtml(text)}</div>`;
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
        <img src="/assets/237-mark.svg" alt="237 Ville" class="loading-mark">
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

function renderAuth() {
  const isRegister = state.authMode === "register";

  app.innerHTML = `
    <main class="auth-layout">
      <section class="auth-panel">
        <div class="auth-brand">
          <div>
            <img src="/assets/237-mark.svg" alt="237 Ville">
            <h1>237 Ville</h1>
            <p>Member hub for community updates, elections, events, dues, donations, and questions for the board.</p>
          </div>
          <p>Registered members receive in-app notifications when admins publish organization updates.</p>
        </div>
        <div class="auth-form-panel">
          <div class="auth-tabs" role="tablist" aria-label="Authentication">
            <button class="tab-button ${!isRegister ? "active" : ""}" data-auth-mode="login" type="button">Sign in</button>
            <button class="tab-button ${isRegister ? "active" : ""}" data-auth-mode="register" type="button">Register</button>
          </div>
          <h2>${isRegister ? "Create member account" : "Member sign in"}</h2>
          <form class="form-stack" data-action="${isRegister ? "register" : "login"}">
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
            <label class="field">
              <span>Email</span>
              <input name="email" type="email" autocomplete="email" required>
            </label>
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
              isRegister
                ? ""
                : `<label class="field">
                    <span>Password</span>
                    <input name="password" type="password" autocomplete="current-password" minlength="8" required>
                  </label>`
            }
            <button class="primary-button" type="submit">${isRegister ? "Create account" : "Sign in"}</button>
            <p class="message ${state.messageType === "ok" ? "ok" : ""}">${escapeHtml(state.message)}</p>
          </form>
        </div>
      </section>
    </main>
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
            <img src="/assets/237-mark.svg" alt="237 Ville">
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
        <label class="field">
          <span>Payment method</span>
          <select name="method">
            <option value="offline">Offline</option>
            <option value="cash">Cash</option>
            <option value="check">Check</option>
            <option value="zelle">Zelle</option>
            <option value="mobile_money">Mobile money</option>
          </select>
        </label>
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
          <img src="/assets/237-mark.svg" alt="237 Ville">
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
      announcements: "Publish and review organization announcements and member-sourced articles.",
      questions: "Review member questions, publish discussions, or turn submissions into articles.",
      events: "Create and manage organization events.",
      votes: "Create ballots, open voting, close voting, and review aggregate results.",
      payments: "Track dues, donations, pending payments, and members who have not paid dues.",
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
    questions: "Member questions approved for community discussion.",
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
      case "announcements":
        return renderAdminAnnouncements();
      case "questions":
        return renderAdminQuestionsPage();
      case "events":
        return renderAdminEvents();
      case "votes":
        return renderAdminVotes();
      case "payments":
        return renderAdminPayments();
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
    case "questions":
      return renderQuestions();
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
  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>Announcements and articles</h3>
          <p>Published by the executive team and organization admins.</p>
        </div>
      </div>
      ${renderAnnouncementList(state.data.announcements || [])}
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
            <p>Use this for dues, donations, or offline payment tracking.</p>
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
          <label class="field">
            <span>Method</span>
            <select name="method">
              <option value="offline">Offline</option>
              <option value="cash">Cash</option>
              <option value="check">Check</option>
              <option value="zelle">Zelle</option>
              <option value="mobile_money">Mobile money</option>
            </select>
          </label>
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
            .map(
              (payment) => `
                <tr>
                  ${adminMode ? `<td>${escapeHtml(payment.memberName)}<br><span class="muted">${escapeHtml(payment.memberEmail)}</span></td>` : ""}
                  <td>${escapeHtml(payment.purpose)}</td>
                  <td>${formatMoney(payment.amountCents)}</td>
                  <td>${escapeHtml(payment.method)}</td>
                  <td>${statusPill(payment.status)}</td>
                  <td>${formatDate(payment.createdAt)}</td>
                  ${
                    adminMode
                      ? `<td>
                          <div class="actions">
                            <button class="secondary-button" data-click="payment-status" data-payment-id="${payment.id}" data-status="received" type="button">Received</button>
                            <button class="danger-button" data-click="payment-status" data-payment-id="${payment.id}" data-status="cancelled" type="button">Cancel</button>
                          </div>
                        </td>`
                      : ""
                  }
                </tr>
              `
            )
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
    activeMembers,
    pendingApprovals,
    duesPaidIds,
    donors,
    pendingQuestions: (state.admin?.questions || []).filter((question) => question.status === "pending"),
    openBallots: (state.admin?.ballots || []).filter((ballot) => ballot.status === "open"),
    upcomingEvents: (state.admin?.events || []).filter((event) => new Date(event.startsAt) >= new Date())
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

  return `
    <section class="two-column">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>Organization events</h3>
            <p>Upcoming and past scheduled events.</p>
          </div>
        </div>
        ${renderEventList(state.admin.events || [])}
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

    if (action === "reset-member-filter") {
      state.memberFilter = { scope: "all", query: "" };
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

document.addEventListener("submit", handleSubmit);
document.addEventListener("click", handleClick);

await loadMe();
if (state.user) {
  await loadDashboard();
}
render();
