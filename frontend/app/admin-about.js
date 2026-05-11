function requireAdminData(label = "Loading admin tools...") {
  if (!isAdminPortalUser()) {
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
    budgetAllocationCents: 0,
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
  const showFinanceOverview = Boolean(state.admin?.financialSummary);

  return `
    <section class="admin-section">
      ${
        showFinanceOverview
          ? `<div class="metric-grid">
              <div class="metric"><span>Account balance</span><strong>${formatMoney(stats.financialSummary.accountBalanceCents)}</strong></div>
              <div class="metric"><span>Total received</span><strong>${formatMoney(stats.financialSummary.receivedTotalCents)}</strong></div>
              <div class="metric"><span>Total expenses</span><strong>${formatMoney(stats.financialSummary.expenditureTotalCents)}</strong></div>
              <div class="metric"><span>Active budget allocation</span><strong>${formatMoney(stats.financialSummary.budgetAllocationCents || 0)}</strong></div>
            </div>`
          : ""
      }
      ${
        stats.members.length
          ? `<div class="metric-grid">
              <div class="metric"><span>Total members</span><strong>${stats.members.length}</strong></div>
              <div class="metric"><span>Pending approvals</span><strong>${stats.pendingApprovals.length}</strong></div>
              <div class="metric"><span>Dues paid</span><strong>${stats.duesPaidIds.size}</strong></div>
              <div class="metric"><span>Dues unpaid</span><strong>${Math.max(stats.activeMembers.length - stats.duesPaidIds.size, 0)}</strong></div>
            </div>`
          : ""
      }
      <div class="metric-grid">
        <div class="metric"><span>Pending questions</span><strong>${stats.pendingQuestions.length}</strong></div>
        <div class="metric"><span>Upcoming events</span><strong>${stats.upcomingEvents.length}</strong></div>
        <div class="metric"><span>Open ballots</span><strong>${stats.openBallots.length}</strong></div>
        <div class="metric"><span>Unread notices</span><strong>${unread.length}</strong></div>
      </div>
      <section class="two-column">
        <div class="content-grid">
          ${
            canAccessAdminView("profile")
              ? `<div class="panel">
                  <div class="panel-header">
                    <div>
                      <h3>Account approvals</h3>
                      <p>Validate member applications and ID cards.</p>
                    </div>
                  </div>
                  ${renderPendingApprovals(stats.pendingApprovals)}
                </div>`
              : ""
          }
          ${
            canAccessAdminView("payments")
              ? `<div class="panel">
                  <div class="panel-header">
                    <div>
                      <h3>Payment review</h3>
                      <p>Pending dues, donations, and registration fees.</p>
                    </div>
                  </div>
                  ${renderPaymentTable(stats.payments.filter((payment) => payment.status === "pending").slice(0, 8), true)}
                </div>`
              : ""
          }
        </div>
        <div class="content-grid">
          ${
            canAccessAdminView("notifications")
              ? `<div class="panel">
                  <div class="panel-header">
                    <div>
                      <h3>Notifications</h3>
                      <p>Recent admin notices and cleanup.</p>
                    </div>
                  </div>
                  ${renderNotificationCleanupForm("overview")}
                  ${renderNotificationList(state.data.notifications || [])}
                </div>`
              : ""
          }
          ${
            canAccessAdminView("events")
              ? `<div class="panel">
                  <div class="panel-header">
                    <div>
                      <h3>Upcoming events</h3>
                      <p>Next organization dates.</p>
                    </div>
                  </div>
                  ${renderEventList(stats.upcomingEvents.slice(0, 5))}
                </div>`
              : ""
          }
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
        ${isFullAdmin() ? `<button class="danger-button" data-click="cleanup-hidden-about-articles" type="button">Drop hidden older than 30 days</button>` : ""}
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
          ${isFullAdmin() ? `<button class="danger-button" data-click="delete-about-article" data-article-id="${article.id}" type="button">Delete</button>` : ""}
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
                  ${isFullAdmin() ? `<option value="archived" ${position.status === "archived" ? "selected" : ""}>Archived</option>` : ""}
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
            position.status === "archived" || !isFullAdmin()
              ? ""
              : `<button class="ghost-button" data-click="leadership-position-status" data-position-id="${position.id}" data-status="archived" type="button">Archive</button>`
          }
        </div>
      </div>
    </article>
  `;
}
