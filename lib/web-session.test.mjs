import assert from "node:assert/strict";
import test from "node:test";

import { createJiti } from "jiti";

// jiti, not a bare import: `web-session.ts` imports `@/lib/web-auth`, and that
// alias does not resolve under plain Node ESM. Same loader the proxy tests use.
const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});

const {
  SESSION_MAX_AGE_MS,
  SESSION_RENEW_AFTER_MS,
  buildSessionCookie,
  createSessionValue,
  isValidSessionValue,
  readSessionCookie,
  sessionNeedsRenewal,
} = await jiti.import("./web-session.ts");

const PASSWORD = "correct-horse-battery-staple";

test("a freshly issued session is valid for its own password", () => {
  const value = createSessionValue(PASSWORD);
  assert.equal(isValidSessionValue(value, PASSWORD), true);
});

test("a session is rejected under a different password (rotation revokes it)", () => {
  const value = createSessionValue(PASSWORD);
  assert.equal(isValidSessionValue(value, "a-different-password"), false);
});

test("a tampered payload is rejected — the signature covers the timestamp", () => {
  const value = createSessionValue(PASSWORD);
  const signature = value.slice(value.lastIndexOf(".") + 1);
  // Push the issue date forward, hoping the ceiling check passes.
  const forged = `${Date.now() + 10_000_000}.${signature}`;
  assert.equal(isValidSessionValue(forged, PASSWORD), false);
});

test("a forged signature is rejected", () => {
  const issuedAt = Date.now();
  assert.equal(isValidSessionValue(`${issuedAt}.not-a-real-signature`, PASSWORD), false);
  assert.equal(isValidSessionValue(`${issuedAt}.`, PASSWORD), false);
  assert.equal(isValidSessionValue("garbage", PASSWORD), false);
  assert.equal(isValidSessionValue("", PASSWORD), false);
  assert.equal(isValidSessionValue(undefined, PASSWORD), false);
});

test("an expired session past the ceiling is rejected", () => {
  const old = Date.now() - SESSION_MAX_AGE_MS - 1;
  const value = createSessionValue(PASSWORD, old);
  assert.equal(isValidSessionValue(value, PASSWORD), false, "past the ceiling");
});

test("a future-dated session is rejected (clock skew / tampering)", () => {
  const value = createSessionValue(PASSWORD, Date.now() + 60_000);
  assert.equal(isValidSessionValue(value, PASSWORD), false);
});

test("a session inside the ceiling is accepted", () => {
  const value = createSessionValue(PASSWORD, Date.now() - 60_000);
  assert.equal(isValidSessionValue(value, PASSWORD), true);
});

test("no session is valid when the password is disabled", () => {
  const value = createSessionValue(PASSWORD);
  assert.equal(isValidSessionValue(value, undefined), false);
  assert.equal(isValidSessionValue(value, ""), false);
});

test("renewal is due before the ceiling, so daily use never re-prompts", () => {
  const fresh = createSessionValue(PASSWORD, Date.now());
  assert.equal(sessionNeedsRenewal(fresh), false);

  const stale = createSessionValue(PASSWORD, Date.now() - SESSION_RENEW_AFTER_MS - 1);
  assert.equal(sessionNeedsRenewal(stale), true);
  // ...and still valid, so renewal is a refresh rather than a forced re-login.
  assert.equal(isValidSessionValue(stale, PASSWORD), true);
  assert.ok(SESSION_RENEW_AFTER_MS < SESSION_MAX_AGE_MS);
});

test("the cookie is hardened: HttpOnly, Secure, SameSite=Strict", () => {
  const cookie = buildSessionCookie("value");
  assert.match(cookie, /^pi_web_session=value/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=\d+/);
});

test("the cookie value is read out of a multi-cookie header", () => {
  const value = createSessionValue(PASSWORD);
  assert.equal(readSessionCookie(`a=1; ${"pi_web_session"}=${value}; b=2`), value);
  assert.equal(readSessionCookie("other=1"), undefined);
  assert.equal(readSessionCookie(null), undefined);
  assert.equal(readSessionCookie(""), undefined);
  // A prefix-colliding name must not be mistaken for the session cookie.
  assert.equal(readSessionCookie("pi_web_session_other=evil"), undefined);
});
