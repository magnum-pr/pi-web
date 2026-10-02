import { createHmac, timingSafeEqual } from "node:crypto";

import { PI_WEB_AUTH_USERNAME, isWebPasswordEnabled } from "@/lib/web-auth";

/**
 * A signed session cookie, issued after a successful Basic Auth login.
 *
 * Why this exists: an iOS **standalone PWA** does not reliably reuse Safari's
 * saved Basic Auth credentials and cannot offer a password manager for a
 * browser-level auth dialog, so the installed app asked for the password every
 * launch. Basic Auth remains supported for curl/scripts; the cookie is what
 * makes the installed app usable.
 *
 * Security posture — deliberately conservative:
 *   - **Signed, not encrypted.** The payload holds no secrets, only an issued-at
 *     timestamp, so signing is sufficient to prevent forgery.
 *   - **HMAC keyed on the password**, so the cookie is invalidated by rotating
 *     `PI_WEB_PASSWORD` — the credential is the revocation mechanism, nothing
 *     extra to manage or leak.
 *   - **Unforgeable without the password**; equality is timing-safe.
 *   - Cookie attributes (`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`) are
 *     set at the call site in `proxy.ts`.
 */

export const SESSION_COOKIE_NAME = "pi_web_session";

/** Interactive logins are renewed past this age, so daily use never re-prompts. */
export const SESSION_RENEW_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
/** Hard ceiling: past this the cookie is refused and Basic Auth is required. */
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SESSION_COOKIE_MAX_AGE_S = Math.floor(SESSION_MAX_AGE_MS / 1000);

function sign(payload: string, password: string): Buffer {
  return createHmac("sha256", `pi-web-session-v1:${password}`).update(payload, "utf8").digest();
}

/** Mint a cookie value: `<issuedAtMs>.<base64url hmac>`. */
export function createSessionValue(password: string, issuedAt: number = Date.now()): string {
  const payload = String(issuedAt);
  return `${payload}.${sign(payload, password).toString("base64url")}`;
}

function parseSessionValue(value: string | undefined): { issuedAt: number } | null {
  if (!value) return null;
  const separator = value.lastIndexOf(".");
  if (separator <= 0 || separator === value.length - 1) return null;
  const issuedAt = Number(value.slice(0, separator));
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) return null;
  return { issuedAt };
}

/** True when the cookie is well-formed, correctly signed, and within its ceiling. */
export function isValidSessionValue(
  value: string | undefined,
  password = process.env.PI_WEB_PASSWORD,
  now: number = Date.now(),
): boolean {
  if (!isWebPasswordEnabled(password)) return false;
  const parsed = parseSessionValue(value);
  if (!parsed) return false;

  const expected = sign(String(parsed.issuedAt), password);
  const supplied = Buffer.from(value!.slice(value!.lastIndexOf(".") + 1), "base64url");
  // Buffer compare requires equal lengths; timingSafeEqual throws otherwise.
  if (supplied.length !== expected.length) return false;
  if (!timingSafeEqual(supplied, expected)) return false;

  const age = now - parsed.issuedAt;
  // Reject future-dated values (clock skew / tampering) and expired ones.
  if (age < 0 || age > SESSION_MAX_AGE_MS) return false;
  return true;
}

/** True when a valid session is old enough that we should re-issue it. */
export function sessionNeedsRenewal(
  value: string | undefined,
  now: number = Date.now(),
): boolean {
  const parsed = parseSessionValue(value);
  if (!parsed) return true;
  return now - parsed.issuedAt >= SESSION_RENEW_AFTER_MS;
}

/** Read one cookie value from a raw Cookie header. */
export function readSessionCookie(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE_NAME) {
      return part.slice(eq + 1).trim();
    }
  }
  return undefined;
}

/**
 * Build the Set-Cookie header value.
 *
 * `Secure` is set because the owner reaches PiWeb over Tailscale Serve (`https`),
 * and it is checked by the browser — not here — so local http testing still works
 * with the flag present.
 */
export function buildSessionCookie(value: string, maxAgeSeconds: number = SESSION_COOKIE_MAX_AGE_S): string {
  return [
    `${SESSION_COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}

/** Username accessor kept here so tests can assert the fixed identity. */
export { PI_WEB_AUTH_USERNAME };
