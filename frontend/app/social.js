function dateOnlyValue(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function currentMonthValue() {
  return new Date().toISOString().slice(0, 7);
}

function isDateBeforeToday(value) {
  const dateValue = dateOnlyValue(value);
  return Boolean(dateValue && dateValue < new Date().toISOString().slice(0, 10));
}

function isActiveSocialMeeting(meeting) {
  return meeting.status === "published" && !isDateBeforeToday(meeting.meetingDate);
}

function isActiveSocialAssignment(assignment) {
  return assignment.status === "assigned" && !assignment.archivedAt && !isDateBeforeToday(assignment.targetDate || assignment.eventDate || assignment.meeting?.meetingDate || assignment.meetingDate);
}

function isActiveMemberResourceRequest(request) {
  return request.status !== "checked_in" && !request.archivedAt;
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
  const openMeetings = meetings.filter((meeting) => !["completed", "cancelled"].includes(meeting.status) && !isDateBeforeToday(meeting.meetingDate));
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

function upcomingEventOptions(events = [], selectedId = "") {
  const openEvents = events.filter((event) => event.status === "active" && !isDateBeforeToday(event.endsAt || event.startsAt));
  return openEvents
    .map(
      (event) => `
        <option value="${event.id}" ${Number(selectedId) === Number(event.id) ? "selected" : ""}>
          ${escapeHtml(event.title)} - ${formatDate(event.startsAt, { dateOnly: true })}
        </option>
      `
    )
    .join("");
}

function socialTargetOptions(meetings = [], events = []) {
  const openMeetings = meetings.filter((meeting) => !["completed", "cancelled"].includes(meeting.status) && !isDateBeforeToday(meeting.meetingDate));
  const openEvents = events.filter((event) => event.status === "active" && !isDateBeforeToday(event.endsAt || event.startsAt));

  return `
    <option value="">Choose meeting or event</option>
    ${openMeetings.length
      ? `<optgroup label="Monthly meetings">
          ${openMeetings
            .map((meeting) => `<option value="meeting:${meeting.id}">${escapeHtml(meeting.title)} - ${formatDate(meeting.meetingDate, { dateOnly: true })}</option>`)
            .join("")}
        </optgroup>`
      : ""}
    ${openEvents.length
      ? `<optgroup label="Upcoming events">
          ${openEvents
            .map((event) => `<option value="event:${event.id}">${escapeHtml(event.title)} - ${formatDate(event.startsAt, { dateOnly: true })}</option>`)
            .join("")}
        </optgroup>`
      : ""}
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

function socialAssignmentsForDisplay(social = {}) {
  if (Array.isArray(social.assignments)) {
    return social.assignments.map((assignment) => ({
      ...assignment,
      meetingTitle: assignment.meetingTitle || assignment.targetTitle,
      meetingDate: assignment.meetingDate || assignment.targetDate,
      meetingStatus: assignment.meetingStatus || assignment.targetStatus
    }));
  }

  return flattenSocialAssignments(social.meetings || []);
}

function renderAdminSocialCoordinator() {
  const loading = requireAdminData("Loading social coordinator...");
  if (loading) return loading;

  const social = state.admin.social || { meetings: [], events: [], assignments: [], resources: [], resourceRequests: [], resourceAdjustments: [], fundRequests: [] };
  const assignments = socialAssignmentsForDisplay(social);
  const pendingRequests = (social.resourceRequests || []).filter((request) => request.status === "pending");
  const checkedOutRequests = (social.resourceRequests || []).filter((request) => request.status === "delivered");
  const pendingFundRequests = (social.fundRequests || []).filter((request) => request.status === "pending");
  const currentMeetings = (social.meetings || []).filter((meeting) => meeting.status !== "completed" && meeting.status !== "cancelled");
  const currentEvents = (social.events || []).filter((event) => event.status === "active" && !isDateBeforeToday(event.endsAt || event.startsAt));
  const checkedOutResources = (social.resources || []).reduce(
    (total, resource) => total + Math.max(0, Number(resource.totalQuantity || 0) - Number(resource.availableQuantity || 0)),
    0
  );

  return `
    <section class="content-grid">
      <div class="metric-grid">
        <div class="metric"><span>Meetings tracked</span><strong>${(social.meetings || []).length}</strong></div>
        <div class="metric"><span>Open meetings</span><strong>${currentMeetings.length}</strong></div>
        <div class="metric"><span>Upcoming events</span><strong>${currentEvents.length}</strong></div>
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
  const activeAssignments = assignments.filter((assignment) => assignment.status !== "archived");
  const archivedAssignments = assignments.filter((assignment) => assignment.status === "archived");

  return `
    <section class="two-column">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>Assignments</h3>
            <p>Manage food, drinks, hosting, setup, and cleanup tasks across monthly meetings and upcoming events.</p>
          </div>
        </div>
        ${renderSocialAssignmentList(activeAssignments, "No active assignments yet.")}
        <div class="social-subsection">
          <div class="panel-header">
            <div>
              <h3>Archived assignments</h3>
              <p>Assignments are archived automatically after the meeting or event date passes.</p>
            </div>
          </div>
          ${renderSocialAssignmentList(archivedAssignments, "No archived assignments yet.")}
        </div>
      </div>
      <aside class="panel">
        <div class="panel-header">
          <div>
            <h3>Assign task</h3>
            <p>Choose a monthly meeting or upcoming event and assign responsibility to an active member.</p>
          </div>
        </div>
        ${renderSocialAssignmentForm("", social.meetings || [], social.events || [])}
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
          ${
            meeting.status === "cancelled"
              ? `<span class="muted">Cancelled</span>`
              : `<button class="secondary-button" data-click="publish-social-meeting" data-meeting-id="${meeting.id}" type="button">Publish as announcement</button>
                 <button class="secondary-button" data-click="cancel-social-meeting" data-meeting-id="${meeting.id}" type="button">Cancel meeting</button>`
          }
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

function renderSocialAssignmentList(assignments, emptyText = "No assignments yet.") {
  if (!assignments.length) return emptyState(emptyText);

  return `
    <div class="item-list compact-list">
      ${assignments
        .map(
          (assignment) => `
            <form class="item-card compact-card" data-action="update-social-assignment" data-assignment-id="${assignment.id}">
              ${
                assignment.targetTitle || assignment.meetingTitle
                  ? `<div class="panel-header">
                      <div>
                        <h4>${escapeHtml(assignment.targetTitle || assignment.meetingTitle)}</h4>
                        <p>${assignment.targetType === "event" ? "Event" : "Monthly meeting"} · ${formatDate(assignment.targetDate || assignment.meetingDate, { dateOnly: true })}</p>
                      </div>
                      ${assignment.targetStatus || assignment.meetingStatus ? statusPill(assignment.targetStatus || assignment.meetingStatus) : ""}
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
                  <select name="status">${socialStatusOptions(["assigned", "completed", "cancelled", "archived"], assignment.status)}</select>
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

function renderSocialAssignmentForm(meetingId = "", meetings = [], events = []) {
  const targetField = meetingId
    ? ""
    : `<label class="field">
        <span>Monthly meeting or upcoming event</span>
        <select name="target" required>${socialTargetOptions(meetings, events)}</select>
      </label>`;
  const openMeetings = meetings.filter((meeting) => !["completed", "cancelled"].includes(meeting.status) && !isDateBeforeToday(meeting.meetingDate));
  const openEvents = events.filter((event) => event.status === "active" && !isDateBeforeToday(event.endsAt || event.startsAt));

  if (!meetingId && !openMeetings.length && !openEvents.length) {
    return emptyState("Create an open monthly meeting or upcoming event before assigning tasks.");
  }

  return `
    <form class="form-stack social-assignment-form" data-action="create-social-assignment" ${meetingId ? `data-meeting-id="${meetingId}"` : ""}>
      ${targetField}
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
                  <p>${escapeHtml(request.requesterName)} has ${request.quantity}${request.targetTitle ? ` for ${escapeHtml(request.targetTitle)}` : ""}</p>
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
                  <p>${escapeHtml(request.requesterName)} requested ${formatMoney(request.amountCents)}${request.targetTitle ? ` for ${escapeHtml(request.targetTitle)}` : ""}</p>
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
                  <p>${escapeHtml(request.requesterName)} requested ${request.quantity}${request.targetTitle ? ` for ${escapeHtml(request.targetTitle)}` : ""}</p>
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
  const social = state.data.social || { meetings: [], events: [], assignments: [], resources: [], resourceRequests: [], fundRequests: [] };
  const meetings = social.meetings || [];
  const resources = social.resources || [];
  const fundRequests = social.fundRequests || [];
  const myAssignments = socialAssignmentsForDisplay(social)
    .filter((assignment) => Number(assignment.userId) === Number(state.user.id))
    .filter(isActiveSocialAssignment);
  const activeResourceRequests = (social.resourceRequests || []).filter(isActiveMemberResourceRequest);
  const requestableTargets = Array.from(
    new Map(
      myAssignments
        .map((assignment) => {
          const targetType = assignment.eventId ? "event" : "meeting";
          const targetId = assignment.eventId || assignment.meetingId;
          if (!targetId) return null;
          return [
            `${targetType}:${targetId}`,
            {
              key: `${targetType}:${targetId}`,
              type: targetType,
              id: targetId,
              title: assignment.targetTitle || assignment.eventTitle || assignment.meetingTitle,
              date: assignment.targetDate || assignment.eventDate || assignment.meetingDate
            }
          ];
        })
        .filter(Boolean)
    ).values()
  );

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
                <p>Requests are available only for meetings or events where you have an assigned task.</p>
              </div>
            </div>
            ${renderResourceRequestForm(requestableTargets, resources)}
          </div>
          <div class="panel">
            <div class="panel-header">
              <div>
                <h3>My resource requests</h3>
                <p>Review request status and admin notes.</p>
              </div>
            </div>
            ${renderMemberResourceRequests(activeResourceRequests)}
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
              <p>${escapeHtml(assignment.memberName || "Unassigned")}${assignment.groupName ? ` · ${escapeHtml(assignment.groupName)}` : ""}</p>
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
              <p>${escapeHtml(assignment.targetTitle || assignment.eventTitle || assignment.meetingTitle)} · ${assignment.targetType === "event" ? "Event" : "Monthly meeting"} · ${formatDate(assignment.targetDate || assignment.eventDate || assignment.meetingDate, { dateOnly: true })}</p>
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

function renderResourceRequestForm(targets, resources) {
  if (!targets.length) return emptyState("You can request resources after the admin assigns you a task for a meeting or event.");
  const activeResources = resources.filter((resource) => resource.status === "active");
  if (!activeResources.length) return emptyState("No active organization resources are available to request.");

  return `
    <form class="form-stack" data-action="create-social-resource-request">
      <label class="field">
        <span>Meeting or event</span>
        <select name="target" required>
          ${targets
            .map((target) => `<option value="${escapeHtml(target.key)}">${escapeHtml(target.title)} - ${target.type === "event" ? "Event" : "Meeting"} - ${formatDate(target.date, { dateOnly: true })}</option>`)
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
                  <p>Quantity ${request.quantity}${request.targetTitle ? ` · ${escapeHtml(request.targetTitle)}` : ""}</p>
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
