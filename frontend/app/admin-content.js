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
        ${renderAdminAnnouncementList(state.admin.announcements || [])}
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

function renderAdminAnnouncementList(announcements) {
  if (!announcements.length) return emptyState("No announcements have been published.");

  return `
    <div class="item-list">
      ${announcements
        .map(
          (announcement) => `
            <article class="item-card" id="announcement-${announcement.id}">
              <form class="form-stack announcement-edit-form" data-action="update-announcement" data-announcement-id="${announcement.id}">
                <label class="field">
                  <span>Title</span>
                  <input name="title" value="${escapeHtml(announcement.title)}" required>
                </label>
                <label class="field">
                  <span>Category</span>
                  <select name="category">
                    <option value="announcement" ${announcement.category === 'announcement' ? 'selected' : ''}>Announcement</option>
                    <option value="article" ${announcement.category === 'article' ? 'selected' : ''}>Article</option>
                    <option value="board_update" ${announcement.category === 'board_update' ? 'selected' : ''}>Board update</option>
                    <option value="event_assignment" ${announcement.category === 'event_assignment' ? 'selected' : ''}>Event assignment</option>
                    <option value="social" ${announcement.category === 'social' ? 'selected' : ''}>Monthly social meeting</option>
                  </select>
                </label>
                <label class="field">
                  <span>Body</span>
                  <textarea name="body" required>${escapeHtml(announcement.body)}</textarea>
                </label>
                <div class="item-meta">
                  <span>${escapeHtml(announcement.category)}</span>
                  <span>${escapeHtml(announcement.authorName)}</span>
                  <span>${formatDate(announcement.publishedAt || announcement.createdAt)}</span>
                </div>
                <div class="actions">
                  <button class="primary-button" type="submit">Save changes</button>
                  <button class="secondary-button" data-click="delete-announcement" data-announcement-id="${announcement.id}" type="button">Delete</button>
                </div>
              </form>
            </article>
          `
        )
        .join("")}
    </div>
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
          <option value="event_assignment">Event assignment</option>
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
                      : isFullAdmin()
                        ? `<button class="secondary-button" data-click="event-archive" data-event-id="${event.id}" type="button">Archive</button>`
                        : ""
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
