import net from "node:net";
import tls from "node:tls";
import { once } from "node:events";
import { config } from "./config.js";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatAddress(address, name = "") {
  const cleanAddress = String(address || "").trim();
  const cleanName = String(name || "").trim().replaceAll('"', "'");
  return cleanName ? `"${cleanName}" <${cleanAddress}>` : cleanAddress;
}

function normalizeEmailAddress(address = "") {
  return String(address || "").trim();
}

function encodeHeader(value = "") {
  return String(value || "").replace(/\r|\n/g, " ").trim();
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "") || "";
}

function buildAppLink(link = "") {
  const configuredBase = String(config.appUrl || "").trim() || "http://localhost:4174";
  const base = configuredBase.endsWith("/") ? configuredBase : `${configuredBase}/`;
  const cleanLink = String(link || "").trim();

  if (!cleanLink) {
    return configuredBase;
  }

  try {
    return new URL(cleanLink, base).toString();
  } catch {
    return configuredBase;
  }
}

function smtpResult(status, detail = "") {
  return { status, sent: status === "sent", detail };
}

function assertSmtpConfig() {
  if (!config.smtp.enabled) {
    return "SMTP is not enabled. Add SMTP_HOST and related settings in .env, then restart the app.";
  }

  if (!config.smtp.host) {
    return "SMTP_HOST is missing.";
  }

  if (!config.smtp.from) {
    return "SMTP_FROM or SMTP_USER is missing.";
  }

  return "";
}

async function readSmtpResponse(socket) {
  let buffer = "";

  while (true) {
    const [chunk] = await once(socket, "data");
    buffer += chunk.toString("utf8");
    const lines = buffer.split(/\r?\n/).filter(Boolean);
    const last = lines.at(-1) || "";

    if (/^\d{3} /.test(last)) {
      return {
        code: Number(last.slice(0, 3)),
        message: lines.join("\n")
      };
    }
  }
}

async function writeSmtpCommand(socket, command, expectedCodes = []) {
  socket.write(`${command}\r\n`);
  const response = await readSmtpResponse(socket);

  if (expectedCodes.length && !expectedCodes.includes(response.code)) {
    throw new Error(`SMTP command failed: ${response.message}`);
  }

  return response;
}

async function connectSmtp() {
  const socket = config.smtp.secure
    ? tls.connect({
        host: config.smtp.host,
        port: config.smtp.port,
        servername: config.smtp.host,
        timeout: config.smtp.timeoutMs
      })
    : net.connect({
        host: config.smtp.host,
        port: config.smtp.port,
        timeout: config.smtp.timeoutMs
      });

  socket.setEncoding("utf8");
  socket.setTimeout(config.smtp.timeoutMs);

  await once(socket, config.smtp.secure ? "secureConnect" : "connect");
  const greeting = await readSmtpResponse(socket);
  if (greeting.code !== 220) {
    throw new Error(`SMTP greeting failed: ${greeting.message}`);
  }

  return socket;
}

function upgradeToTls(socket) {
  return new Promise((resolve, reject) => {
    const secureSocket = tls.connect(
      {
        socket,
        servername: config.smtp.host
      },
      () => {
        secureSocket.setEncoding("utf8");
        secureSocket.setTimeout(config.smtp.timeoutMs);
        resolve(secureSocket);
      }
    );
    secureSocket.once("error", reject);
  });
}

function buildMessage({ to, subject, text, html }) {
  const from = formatAddress(config.smtp.from, config.smtp.fromName);
  const headers = [
    `From: ${from}`,
    `To: ${normalizeEmailAddress(to)}`,
    `Reply-To: ${normalizeEmailAddress(config.smtp.replyTo || config.smtp.from)}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: multipart/alternative; boundary=\"237-ville-boundary\""
  ];

  const body = [
    "--237-ville-boundary",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    String(text || ""),
    "",
    "--237-ville-boundary",
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    String(html || `<pre>${escapeHtml(text || "")}</pre>`),
    "",
    "--237-ville-boundary--"
  ];

  return [...headers, "", ...body]
    .join("\r\n")
    .replace(/^\./gm, "..");
}

export async function sendMail({ to, subject, text, html }) {
  const configError = assertSmtpConfig();
  if (configError) {
    return smtpResult("skipped", configError);
  }

  const recipient = normalizeEmailAddress(to);
  if (!recipient) {
    return smtpResult("skipped", "Recipient email is missing.");
  }

  let socket;
  try {
    socket = await connectSmtp();
    await writeSmtpCommand(socket, `EHLO ${config.smtp.host}`, [250]);

    if (!config.smtp.secure && config.smtp.startTls) {
      await writeSmtpCommand(socket, "STARTTLS", [220]);
      socket = await upgradeToTls(socket);
      await writeSmtpCommand(socket, `EHLO ${config.smtp.host}`, [250]);
    }

    if (config.smtp.user || config.smtp.pass) {
      const token = Buffer.from(`\u0000${config.smtp.user}\u0000${config.smtp.pass}`).toString("base64");
      await writeSmtpCommand(socket, `AUTH PLAIN ${token}`, [235]);
    }

    await writeSmtpCommand(socket, `MAIL FROM:<${config.smtp.from}>`, [250]);
    await writeSmtpCommand(socket, `RCPT TO:<${recipient}>`, [250, 251]);
    await writeSmtpCommand(socket, "DATA", [354]);
    socket.write(`${buildMessage({ to: recipient, subject, text, html })}\r\n.\r\n`);
    const dataResponse = await readSmtpResponse(socket);
    if (dataResponse.code !== 250) {
      throw new Error(`SMTP message was not accepted: ${dataResponse.message}`);
    }
    await writeSmtpCommand(socket, "QUIT", [221]);

    return smtpResult("sent", "Email sent.");
  } catch (error) {
    return smtpResult("failed", error.message || "SMTP delivery failed.");
  } finally {
    socket?.destroy();
  }
}

export async function sendAccountApprovedEmail(user, temporaryPassword) {
  const loginUrl = config.appUrl;
  return sendMail({
    to: user.email,
    subject: "Your 237 Ville account was approved",
    text: [
      `Hello ${user.fullName || user.firstName || "member"},`,
      "",
      "Your 237 Ville account was approved.",
      `Username: ${user.email}`,
      `Temporary password: ${temporaryPassword}`,
      "",
      `Sign in here: ${loginUrl}`,
      "",
      "You will be asked to create a private password, sign the organization policy, and complete registration fee onboarding."
    ].join("\n"),
    html: `
      <p>Hello ${escapeHtml(user.fullName || user.firstName || "member")},</p>
      <p>Your 237 Ville account was approved.</p>
      <p><strong>Username:</strong> ${escapeHtml(user.email)}<br>
      <strong>Temporary password:</strong> ${escapeHtml(temporaryPassword)}</p>
      <p><a href="${escapeHtml(loginUrl)}">Sign in to 237 Ville</a></p>
      <p>You will be asked to create a private password, sign the organization policy, and complete registration fee onboarding.</p>
    `
  });
}

export async function sendPasswordResetEmail(user, temporaryPassword) {
  const loginUrl = config.appUrl;
  return sendMail({
    to: user.email,
    subject: "Your 237 Ville temporary password",
    text: [
      `Hello ${user.fullName || user.firstName || "member"},`,
      "",
      "An admin reset your 237 Ville password.",
      `Username: ${user.email}`,
      `Temporary password: ${temporaryPassword}`,
      "",
      `Sign in here: ${loginUrl}`,
      "",
      "You will be asked to create a private password after signing in."
    ].join("\n"),
    html: `
      <p>Hello ${escapeHtml(user.fullName || user.firstName || "member")},</p>
      <p>An admin reset your 237 Ville password.</p>
      <p><strong>Username:</strong> ${escapeHtml(user.email)}<br>
      <strong>Temporary password:</strong> ${escapeHtml(temporaryPassword)}</p>
      <p><a href="${escapeHtml(loginUrl)}">Sign in to 237 Ville</a></p>
      <p>You will be asked to create a private password after signing in.</p>
    `
  });
}

export async function sendAccountRejectedEmail(user, reason) {
  return sendMail({
    to: user.email,
    subject: "237 Ville account request update",
    text: [
      `Hello ${user.fullName || user.firstName || "applicant"},`,
      "",
      "Your 237 Ville account request was not approved.",
      reason ? `Reason: ${reason}` : "",
      "",
      "If you believe this was a mistake, please contact the organization admin."
    ].filter(Boolean).join("\n"),
    html: `
      <p>Hello ${escapeHtml(user.fullName || user.firstName || "applicant")},</p>
      <p>Your 237 Ville account request was not approved.</p>
      ${reason ? `<p><strong>Reason:</strong> ${escapeHtml(reason)}</p>` : ""}
      <p>If you believe this was a mistake, please contact the organization admin.</p>
    `
  });
}

export async function sendNotificationEmail(user, notification) {
  const recipient = firstValue(user.email, user.user_email);
  const recipientName = firstValue(user.fullName, user.full_name, user.firstName, user.first_name, "member");
  const title = firstValue(notification.title, "237 Ville notification");
  const body = firstValue(notification.body);
  const link = buildAppLink(notification.link);

  return sendMail({
    to: recipient,
    subject: `237 Ville: ${title}`,
    text: [
      `Hello ${recipientName},`,
      "",
      title,
      body,
      "",
      `Open 237 Ville: ${link}`
    ].filter(Boolean).join("\n"),
    html: `
      <p>Hello ${escapeHtml(recipientName)},</p>
      <p><strong>${escapeHtml(title)}</strong></p>
      ${body ? `<p>${escapeHtml(body).replaceAll("\n", "<br>")}</p>` : ""}
      <p><a href="${escapeHtml(link)}">Open 237 Ville</a></p>
    `
  });
}
