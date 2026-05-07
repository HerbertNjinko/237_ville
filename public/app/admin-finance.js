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

function renderAdminBudgets() {
  const loading = requireAdminData("Loading department budgets...");
  if (loading) return loading;

  const budgets = state.admin.budgets || [];
  const budgetExpenses = budgets.flatMap((budget) => budget.expenses || []);
  const allocatedCents = budgets.reduce((sum, budget) => sum + Number(budget.amountCents || 0), 0);
  const publishedSpentCents = budgets.reduce((sum, budget) => sum + Number(budget.spentCents || 0), 0);
  const draftExpenseCents = budgetExpenses
    .filter((expense) => expense.status !== "published")
    .reduce((sum, expense) => sum + Number(expense.amountCents || 0), 0);

  return `
    <section class="content-grid">
      <div class="metric-grid">
        <div class="metric"><span>Budget allocated</span><strong>${formatMoney(allocatedCents)}</strong></div>
        <div class="metric"><span>Published budget spend</span><strong>${formatMoney(publishedSpentCents)}</strong></div>
        <div class="metric"><span>Pending budget expenses</span><strong>${formatMoney(draftExpenseCents)}</strong></div>
        <div class="metric"><span>Budget records</span><strong>${budgets.length}</strong></div>
      </div>
      <section class="two-column">
        <div class="panel">
          <div class="panel-header">
            <div>
              <h3>Department budgets</h3>
              <p>Assign budgets to departments and publish expense details for members.</p>
            </div>
          </div>
          ${renderAdminDepartmentBudgetList(budgets)}
        </div>
        <aside class="panel">
          <div class="panel-header">
            <div>
              <h3>Create department budget</h3>
              <p>Assign a budget steward when a department member should submit expenses.</p>
            </div>
          </div>
          ${renderDepartmentBudgetForm()}
        </aside>
      </section>
    </section>
  `;
}

function renderAdminDepartmentBudgetList(budgets) {
  if (!budgets.length) return emptyState("No department budgets have been created.");

  return `
    <div class="item-list">
      ${budgets.map(renderAdminDepartmentBudgetCard).join("")}
    </div>
  `;
}

function renderAdminDepartmentBudgetCard(budget) {
  return `
    <article class="item-card">
      <div class="panel-header">
        <div>
          <h4>${escapeHtml(budget.departmentName)} · ${escapeHtml(budget.title)}</h4>
          <p>${escapeHtml(budget.purpose || "")}</p>
        </div>
        ${statusPill(budget.status)}
      </div>
      <div class="item-meta">
        <span>Allocated ${formatMoney(budget.amountCents)}</span>
        <span>Published spend ${formatMoney(budget.spentCents || 0)}</span>
        <span>Remaining ${formatMoney(budget.remainingCents || 0)}</span>
        <span>${formatBudgetPeriod(budget)}</span>
        ${budget.assignedToName ? `<span>Steward ${escapeHtml(budget.assignedToName)}</span>` : ""}
      </div>
      ${renderDepartmentBudgetForm(budget)}
      <div class="social-subsection">
        <div class="panel-header">
          <div>
            <h4>Budget expenses</h4>
            <p>Publish expense records when they are ready for member visibility.</p>
          </div>
        </div>
        ${renderBudgetExpenseList(budget.expenses || [], { adminMode: true })}
      </div>
      <div class="social-subsection">
        <h4>Enter budget expense</h4>
        ${renderBudgetExpenseForm(budget)}
      </div>
    </article>
  `;
}

function renderDepartmentBudgetForm(budget = null) {
  const action = budget ? "update-department-budget" : "create-department-budget";
  const amountValue = budget ? (Number(budget.amountCents || 0) / 100).toFixed(2) : "";

  return `
    <form class="form-stack ${budget ? "compact-form" : ""}" data-action="${action}" ${budget ? `data-budget-id="${budget.id}"` : ""}>
      <label class="field">
        <span>Department</span>
        <input name="departmentName" value="${escapeHtml(budget?.departmentName || "")}" placeholder="Social department, events, outreach..." required>
      </label>
      <label class="field">
        <span>Budget title</span>
        <input name="title" value="${escapeHtml(budget?.title || "")}" required>
      </label>
      <div class="form-grid">
        <label class="field">
          <span>Amount</span>
          <input name="amount" type="number" min="0.01" step="0.01" value="${amountValue}" required>
        </label>
        <label class="field">
          <span>Budget steward</span>
          <select name="assignedTo">${activeMemberOptions(budget?.assignedTo || "")}</select>
        </label>
      </div>
      <div class="form-grid">
        <label class="field">
          <span>Period start</span>
          <input name="periodStart" type="date" value="${dateOnlyValue(budget?.periodStart)}">
        </label>
        <label class="field">
          <span>Period end</span>
          <input name="periodEnd" type="date" value="${dateOnlyValue(budget?.periodEnd)}">
        </label>
      </div>
      <label class="field">
        <span>Purpose</span>
        <textarea name="purpose">${escapeHtml(budget?.purpose || "")}</textarea>
      </label>
      <label class="field">
        <span>Status</span>
        <select name="status">${socialStatusOptions(["draft", "published", "closed"], budget?.status || "draft")}</select>
      </label>
      <button class="primary-button" type="submit">${budget ? "Save budget" : "Create budget"}</button>
    </form>
  `;
}

function renderBudgetExpenseForm(budget) {
  return `
    <form class="form-stack compact-form" data-action="admin-budget-expense" data-budget-id="${budget.id}">
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
      <label class="field">
        <span>Visibility</span>
        <select name="status">
          <option value="draft">Admin only</option>
          <option value="published">Publish to members</option>
        </select>
      </label>
      <button class="secondary-button" type="submit">Save budget expense</button>
    </form>
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
        <span>Receipt attachment</span>
        <input name="receipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf">
        <small>JPG, PNG, WebP, or PDF. 5 MB max.</small>
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
                    ${expense.receipt?.name || expense.receipt?.dataUrl ? `<br>${renderReceiptActions(expense.receipt)}` : ""}
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
  const canManage = isFullAdmin();

  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>Members and users</h3>
          <p>${canManage ? "Update contact details, roles, and account status." : "Review member and staff account details."}</p>
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
  if (!canAccessAdminView("notifications")) {
    return emptyState("Notification access is required.");
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
                  ${renderRichText(question.body)}
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
              ${
                isFullAdmin()
                  ? `<form class="form-stack" data-action="approve-member" data-member-id="${member.id}">
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
                    </form>`
                  : `<p class="muted">Only a full admin can approve or reject applications.</p>`
              }
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
	                ${isFullAdmin() ? `<button class="ghost-button" data-click="ballot-archive" data-ballot-id="${ballot.id}" type="button">Archive</button>` : ""}
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
  const canManage = isFullAdmin();

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
              ${
                canManage
                  ? `<form class="form-stack" data-action="admin-update-member" data-member-id="${member.id}">
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
                          <span>Account type</span>
                          <select name="accountRole">
                            <option value="member" ${member.role === "member" ? "selected" : ""}>Member account</option>
                            <option value="admin" ${member.role === "admin" ? "selected" : ""}>Independent admin account</option>
                          </select>
                        </label>
                        <label class="field">
                          <span>Elevated portal access</span>
                          <select name="staffRole">
                            <option value="" ${!member.staffRole ? "selected" : ""}>No staff access</option>
                            <option value="admin" ${member.staffRole === "admin" ? "selected" : ""}>Admin</option>
                            <option value="secretary" ${member.staffRole === "secretary" ? "selected" : ""}>Secretary</option>
                            <option value="treasurer" ${member.staffRole === "treasurer" ? "selected" : ""}>Treasurer</option>
                            <option value="social" ${member.staffRole === "social" ? "selected" : ""}>Social coordinator</option>
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
                        <label class="field">
                          <span>Staff access note</span>
                          <input name="staffRoleNote" value="${escapeHtml(member.staffRoleNote || "")}" placeholder="Election, handover, or replacement note">
                        </label>
                      </div>
                      <div class="item-meta">
                        <span>${member.staffRole ? `Staff access: ${escapeHtml(member.staffRole)}` : "No staff access"}</span>
                        ${member.staffRoleAssignedAt ? `<span>Assigned ${formatDate(member.staffRoleAssignedAt)}</span>` : ""}
                        ${member.staffRoleRevokedAt && !member.staffRole ? `<span>Revoked ${formatDate(member.staffRoleRevokedAt)}</span>` : ""}
                        <span>${member.passwordMustChange ? "Password reset required" : "Password set"}</span>
                        <span>${member.policyAcceptedAt ? "Policy signed" : "Policy not signed"}</span>
                      </div>
                      <button class="primary-button" type="submit">Save user details</button>
                    </form>`
                  : `<div class="item-meta">
                      <span>${escapeHtml(member.role)}</span>
                      ${member.staffRole ? `<span>Staff access: ${escapeHtml(member.staffRole)}</span>` : ""}
                      <span>${escapeHtml(member.phone || "No phone")}</span>
                      <span>${escapeHtml([member.city, member.state].filter(Boolean).join(", ") || "No location")}</span>
                      <span>${member.passwordMustChange ? "Password reset required" : "Password set"}</span>
                      <span>${member.policyAcceptedAt ? "Policy signed" : "Policy not signed"}</span>
                    </div>`
              }
              ${
                canManage && Number(member.id) !== Number(state.user.id) && !["pending_approval", "inactive", "suspended", "rejected"].includes(member.membershipStatus)
                  ? `<form class="form-stack compact-form" data-action="admin-reset-password" data-member-id="${member.id}">
                      <label class="field">
                        <span>Temporary password</span>
                        <input name="temporaryPassword" type="text" minlength="8" required>
                      </label>
                      <div class="actions">
                        <button class="ghost-button" data-click="generate-temp-password" type="button">Generate password</button>
                        <button class="secondary-button" type="submit">Reset password</button>
                      </div>
                    </form>`
                  : ""
              }
              ${
                canManage && member.membershipStatus === "pending_approval"
                  ? `<form class="form-stack compact-form rejection-form" data-action="reject-member" data-member-id="${member.id}">
                      <label class="field">
                        <span>Reject account creation reason</span>
                        <textarea name="reason" required placeholder="User is not recognized, ID could not be validated, or application details do not match."></textarea>
                      </label>
                      <button class="danger-button" type="submit">Reject account creation</button>
                    </form>`
                  : ""
              }
            </article>
          `
        )
        .join("")}
    </div>
  `;
}
