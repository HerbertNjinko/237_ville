const app = document.querySelector("#app");

const state = {
  user: null,
  data: null,
  admin: null,
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

const adminViews = [["admin", "Admin"]];

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
}

async function loadAdminSummary() {
  if (!state.user || state.user.role !== "admin") return;
  state.admin = await api("/api/admin/summary");
}

async function refreshAll({ includeAdmin = false } = {}) {
  await loadDashboard();
  if (includeAdmin || state.view === "admin") {
    state.admin = null;
    await loadAdminSummary();
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
  const views = state.user.role === "admin" ? [...memberViews, ...adminViews] : memberViews;
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
  const map = {
    overview: "Current organization activity at a glance.",
    announcements: "Published updates and articles from 237 Ville.",
    votes: "Open and closed issues, elections, and aggregate results.",
    events: "Upcoming community meetings, programs, and planned events.",
    questions: "Member questions approved for community discussion.",
    payments: "Record dues and donations for admin review.",
    profile: "Update your member account details.",
    admin: "Publish content, plan events, manage ballots, and review member activity."
  };
  return map[state.view] || "";
}

function renderView() {
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
    case "admin":
      return renderAdmin();
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

  return `
    <section class="content-grid">
      ${
        ballots.length
          ? ballots.map(renderBallotCard).join("")
          : emptyState("No ballots have been created.")
      }
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

function renderQuestions() {
  const questions = state.data.questions || [];

  return `
    <section class="two-column">
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
            <h3>Ask the admin</h3>
            <p>Submitted questions are reviewed before publication.</p>
          </div>
        </div>
        <form class="form-stack" data-action="create-question">
          <label class="field">
            <span>Question title</span>
            <input name="title" required>
          </label>
          <label class="field">
            <span>Details</span>
            <textarea name="body" required></textarea>
          </label>
          <button class="primary-button" type="submit">Submit question</button>
        </form>
      </aside>
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

function renderAdmin() {
  if (state.user.role !== "admin") {
    return emptyState("Admin access is required.");
  }

  if (!state.admin) {
    queueMicrotask(async () => {
      await loadAdminSummary();
      render();
    });
    return emptyState("Loading admin tools...");
  }

  const pendingApprovals = (state.admin.members || []).filter((member) => member.membershipStatus === "pending_approval");

  return `
    <section class="admin-section">
      <div class="metric-grid">
        <div class="metric"><span>Members</span><strong>${state.admin.members.length}</strong></div>
        <div class="metric"><span>Pending approvals</span><strong>${pendingApprovals.length}</strong></div>
        <div class="metric"><span>Questions</span><strong>${state.admin.questions.length}</strong></div>
        <div class="metric"><span>Ballots</span><strong>${state.admin.ballots.length}</strong></div>
      </div>
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>Account approvals</h3>
            <p>Approve registered members and issue a temporary password.</p>
          </div>
        </div>
        ${renderPendingApprovals(pendingApprovals)}
      </div>
      <div class="two-column">
        <div class="panel">
          <div class="panel-header">
            <div>
              <h3>Publish announcement</h3>
              <p>Published announcements create member notifications.</p>
            </div>
          </div>
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
        </div>
        <div class="panel">
          <div class="panel-header">
            <div>
              <h3>Plan event</h3>
              <p>Add meetings, programs, and community gatherings.</p>
            </div>
          </div>
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
        </div>
      </div>
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>Create ballot</h3>
            <p>Use issue votes for decisions and election ballots for board members.</p>
          </div>
        </div>
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
      </div>
      <div class="two-column">
        <div class="panel">
          <div class="panel-header">
            <div>
              <h3>Member questions</h3>
              <p>Approve public discussion or close resolved items.</p>
            </div>
          </div>
          ${renderAdminQuestions()}
        </div>
        <div class="panel">
          <div class="panel-header">
            <div>
              <h3>Ballot controls</h3>
              <p>Open or close voting periods.</p>
            </div>
          </div>
          ${renderAdminBallots()}
        </div>
      </div>
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>Payment review</h3>
            <p>Confirm received dues and donations.</p>
          </div>
        </div>
        ${renderPaymentTable(state.admin.payments || [], true)}
      </div>
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>Members</h3>
            <p>Registered organization accounts.</p>
          </div>
        </div>
        ${renderMembersTable()}
      </div>
    </section>
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
                <span>${escapeHtml(question.authorName)}</span>
                <span>${formatDate(question.createdAt)}</span>
              </div>
              <div class="actions">
                <button class="secondary-button" data-click="question-action" data-question-id="${question.id}" data-action-name="publish" type="button">Publish</button>
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
              <form class="form-stack" data-action="approve-member" data-member-id="${member.id}">
                <label class="field">
                  <span>Temporary password</span>
                  <input name="temporaryPassword" type="text" minlength="8" required>
                </label>
                <button class="primary-button" type="submit">Approve account</button>
              </form>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderAdminBallots() {
  const ballots = state.admin.ballots || [];
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
              </div>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderMembersTable() {
  const members = state.admin.members || [];
  if (!members.length) return emptyState("No members are registered.");

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th>Onboarding</th>
            <th>Location</th>
            <th>Joined</th>
          </tr>
        </thead>
        <tbody>
          ${members
            .map(
              (member) => `
                <tr>
                  <td>${escapeHtml(member.fullName)}</td>
                  <td>${escapeHtml(member.email)}</td>
                  <td>${escapeHtml(member.role)}</td>
                  <td>${statusPill(member.membershipStatus)}</td>
                  <td>
                    ${member.passwordMustChange ? "Password reset required" : "Password set"}<br>
                    <span class="muted">${member.policyAcceptedAt ? "Policy signed" : "Policy not signed"}</span>
                  </td>
                  <td>${escapeHtml([member.city, member.state].filter(Boolean).join(", "))}</td>
                  <td>${formatDate(member.createdAt, { dateOnly: true })}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
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
      state.message = "Question submitted for admin review.";
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
    if (state.view === "admin" && !state.admin) {
      await loadAdminSummary();
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
      state.message = "";
      state.messageType = "";
      render();
      return;
    }

    if (action === "refresh") {
      await refreshAll({ includeAdmin: state.view === "admin" });
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
