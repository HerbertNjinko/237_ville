function renderShell() {
  const adminMode = isAdminPortalMode();
  const views = currentPortalViews();
  const currentTitle = views.find(([key]) => key === state.view)?.[1] || "Overview";
  const unread = (state.data.notifications || []).filter((notification) => !notification.readAt).length;
  const portalLabel = adminMode ? `${effectiveAdminRole()} portal` : "member portal";

  app.innerHTML = `
    <div class="dashboard-layout ${state.sidebarOpen ? "menu-open" : "menu-collapsed"}">
      ${state.sidebarOpen ? `<button class="sidebar-backdrop" data-click="toggle-menu" type="button" aria-label="Close menu"></button>` : ""}
      <aside class="sidebar">
        <div class="brand-row">
          <img src="${companyLogoSrc}" alt="237 Ville">
          <div>
            <strong>237 Ville</strong>
            <span>${escapeHtml(portalLabel)}</span>
          </div>
        </div>
        ${
          hasBothPortals()
            ? `<div class="portal-switcher" aria-label="Portal switcher">
                <button class="tab-button ${!adminMode ? "active" : ""}" data-click="switch-portal" data-portal-mode="member" type="button">Member</button>
                <button class="tab-button ${adminMode ? "active" : ""}" data-click="switch-portal" data-portal-mode="admin" type="button">Staff</button>
              </div>`
            : ""
        }
        <nav class="side-nav" aria-label="Main navigation">
          ${views
            .map(
              ([key, label]) => `
                <button class="nav-button ${state.view === key ? "active" : ""}" data-view="${key}" type="button" aria-current="${state.view === key ? "page" : "false"}">
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
          <div class="topbar-title">
            <button class="menu-toggle" data-click="toggle-menu" type="button" aria-label="${state.sidebarOpen ? "Hide menu" : "Open menu"}" aria-expanded="${state.sidebarOpen ? "true" : "false"}">
              <span></span>
              <span></span>
              <span></span>
            </button>
            <div>
              <h2>${escapeHtml(currentTitle)}</h2>
              <p>${escapeHtml(topbarSubtitle())}</p>
            </div>
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
  if (isAdminPortalMode()) {
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
      budgets: "Assign department budgets and publish budget spending for member transparency.",
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
    financials: "Organization balance, published donations, expenditures, and department budgets.",
    payments: "Record dues and donations for admin review.",
    profile: "Update your member account details.",
    admin: "Publish content, plan events, manage ballots, and review member activity.",
    notifications: "Filter and export organization notification records."
  };
  return map[state.view] || "";
}

function renderView() {
  if (isAdminPortalMode()) {
    if (!canAccessAdminView(state.view)) {
      state.view = "overview";
    }
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
      case "budgets":
        return renderAdminBudgets();
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
            ${isAdminPortalMode() && canEditAdminView("notifications") ? renderNotificationCleanupForm("overview") : ""}
            ${renderNotificationList(state.data.notifications || [])}
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderAnnouncements() {
  const socialMeetings = (state.data.social?.meetings || []).filter(isActiveSocialMeeting);

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
              ${renderRichText(announcement.body)}
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
    budgets: [],
    assignedBudgets: [],
    summary: {
      donationTotalCents: 0,
      expenditureTotalCents: 0,
      publishedBudgetAllocationCents: 0,
      publishedBudgetExpenseTotalCents: 0,
      publishedNetCents: 0,
      accountBalanceCents: 0
    }
  };
  const publishedExpenseCents = Number(financials.summary.expenditureTotalCents || 0);
  const assignedBudgets = financials.assignedBudgets || [];

  return `
    <section class="content-grid">
      <div class="metric-grid">
        <div class="metric"><span>Account balance</span><strong>${formatMoney(financials.summary.accountBalanceCents || 0)}</strong></div>
        <div class="metric"><span>Published donations</span><strong>${formatMoney(financials.summary.donationTotalCents || 0)}</strong></div>
        <div class="metric"><span>Published expenses</span><strong>${formatMoney(publishedExpenseCents)}</strong></div>
        <div class="metric"><span>Budget allocations</span><strong>${formatMoney(financials.summary.publishedBudgetAllocationCents || 0)}</strong></div>
        <div class="metric"><span>Published net</span><strong>${formatMoney(financials.summary.publishedNetCents)}</strong></div>
        <div class="metric"><span>Department budgets</span><strong>${(financials.budgets || []).length}</strong></div>
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
      <section class="two-column">
        <div class="panel">
          <div class="panel-header">
            <div>
              <h3>Department budgets</h3>
              <p>Published department allocations and itemized spending.</p>
            </div>
          </div>
          ${renderDepartmentBudgetTransparencyList(financials.budgets || [])}
        </div>
        ${
          assignedBudgets.length
            ? `<aside class="panel">
                <div class="panel-header">
                  <div>
                    <h3>Assigned budget expenses</h3>
                    <p>Submit expenses for budgets assigned to you for admin review.</p>
                  </div>
                </div>
                ${renderAssignedBudgetExpenseForms(assignedBudgets)}
              </aside>`
            : ""
        }
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

function formatBudgetPeriod(budget) {
  const dates = [
    budget.periodStart ? formatDate(budget.periodStart, { dateOnly: true }) : "",
    budget.periodEnd ? formatDate(budget.periodEnd, { dateOnly: true }) : ""
  ].filter(Boolean);
  return dates.length ? dates.join(" - ") : "No period set";
}

function renderDepartmentBudgetTransparencyList(budgets) {
  if (!budgets.length) return emptyState("No department budgets have been published.");

  return `
    <div class="item-list">
      ${budgets
        .map((budget) => {
          const publishedExpenses = (budget.expenses || []).filter((expense) => expense.status === "published");
          return `
            <article class="item-card">
              <div class="panel-header">
                <div>
                  <h4>${escapeHtml(budget.departmentName)} · ${escapeHtml(budget.title)}</h4>
                  <p>${escapeHtml(budget.purpose || "")}</p>
                </div>
                <strong>${formatMoney(budget.amountCents)}</strong>
              </div>
              <div class="item-meta">
                <span>${formatBudgetPeriod(budget)}</span>
                <span>Spent ${formatMoney(budget.spentCents || 0)}</span>
                <span>Remaining ${formatMoney(budget.remainingCents || 0)}</span>
              </div>
              ${renderBudgetExpenseList(publishedExpenses, { emptyText: "No budget expenses have been published yet." })}
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderBudgetExpenseList(expenses, { adminMode = false, emptyText = "No budget expenses yet." } = {}) {
  if (!expenses.length) return emptyState(emptyText);

  return `
    <div class="item-list compact-list">
      ${expenses
        .map(
          (expense) => `
            <div class="comment">
              <div class="panel-header">
                <div>
                  <strong>${escapeHtml(expense.title)}</strong>
                  <p>${escapeHtml(expense.note || "")}</p>
                </div>
                <strong>${formatMoney(expense.amountCents)}</strong>
              </div>
              <div class="item-meta">
                ${expense.vendor ? `<span>${escapeHtml(expense.vendor)}</span>` : ""}
                ${expense.createdByName ? `<span>${escapeHtml(expense.createdByName)}</span>` : ""}
                <span>${formatDate(expense.expenseDate, { dateOnly: true })}</span>
                <span>${escapeHtml(statusLabel(expense.status))}</span>
                ${expense.receipt?.dataUrl ? renderReceiptActions(expense.receipt) : ""}
              </div>
              ${
                adminMode && expense.status !== "published"
                  ? `<button class="secondary-button" data-click="budget-expense-publish" data-expense-id="${expense.id}" type="button">Publish expense</button>`
                  : ""
              }
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderAssignedBudgetExpenseForms(budgets) {
  return budgets
    .map(
      (budget) => `
        <article class="item-card">
          <div class="panel-header">
            <div>
              <h4>${escapeHtml(budget.departmentName)} · ${escapeHtml(budget.title)}</h4>
              <p>Remaining published balance ${formatMoney(budget.remainingCents || 0)}</p>
            </div>
            ${statusPill(budget.status)}
          </div>
          <form class="form-stack compact-form" data-action="member-budget-expense" data-budget-id="${budget.id}">
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
            <label class="field">
              <span>Vendor</span>
              <input name="vendor">
            </label>
            <label class="field">
              <span>Notes</span>
              <textarea name="note"></textarea>
            </label>
            <label class="field">
              <span>Receipt attachment</span>
              <input name="receipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf">
              <small>JPG, PNG, WebP, or PDF. 5 MB max.</small>
            </label>
            <button class="secondary-button" type="submit">Submit expense</button>
          </form>
          ${renderBudgetExpenseList(budget.expenses || [], { emptyText: "No expenses submitted for this budget yet." })}
        </article>
      `
    )
    .join("");
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
      ${renderRichText(question.body)}
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
                ${renderRichText(comment.body)}
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
