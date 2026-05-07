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
