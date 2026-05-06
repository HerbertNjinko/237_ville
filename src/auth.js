import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const passwordKeyLength = 64;

export const sessionCookieName = "ville_session";
export const sessionMaxAgeSeconds = 60 * 60 * 24 * 7;

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, passwordKeyLength);
  return `scrypt$${salt}$${key.toString("hex")}`;
}

export async function verifyPassword(password, storedHash) {
  const [algorithm, salt, hash] = String(storedHash || "").split("$");

  if (algorithm !== "scrypt" || !salt || !hash) {
    return false;
  }

  const key = await scrypt(password, salt, passwordKeyLength);
  const expected = Buffer.from(hash, "hex");

  if (expected.length !== key.length) {
    return false;
  }

  return timingSafeEqual(expected, key);
}

export function createSessionToken() {
  return randomBytes(32).toString("hex");
}

export function hashSessionToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function parseCookies(cookieHeader = "") {
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const index = cookie.indexOf("=");
        const name = index === -1 ? cookie : cookie.slice(0, index);
        const value = index === -1 ? "" : cookie.slice(index + 1);
        return [decodeURIComponent(name), decodeURIComponent(value)];
      })
  );
}

export function buildSessionCookie(token, { clear = false } = {}) {
  const parts = [
    `${sessionCookieName}=${clear ? "" : encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${clear ? 0 : sessionMaxAgeSeconds}`
  ];

  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }

  return parts.join("; ");
}
