/**
 * Tests for the proxy gate — the actual enforcement point for PiWeb's security.
 *
 * Why this file exists: `lib/web-auth.ts` had tests but `proxy.ts` — the thing
 * that decides whether a request is served — had none. The helpers being correct
 * says nothing about the gate using them, and a gate that silently stops being
 * applied looks identical to one that works.
 *
 * The distinction these tests pin, which the docs previously blurred:
 *
 *   - The HOST check (`isApiRequestAllowed`) is always on. It rejects
 *     cross-site browser requests and unknown Host headers. It is NOT a login.
 *   - The PASSWORD check (`PI_WEB_PASSWORD`) is a login, and is OFF by default.
 *
 * With no password set, anyone who can reach the port is served — which is fine
 * on loopback and is exactly why Tailnet isolation was doing the real work.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createJiti } from "jiti";

// jiti, not a bare import: `next/server` does not resolve under plain Node ESM
// ("next/server.js" is required), and the other route tests in this repo use the
// same loader for the same reason.
const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});

async function loadProxy() {
  return jiti.import("./proxy.ts");
}

const { NextRequest } = await jiti.import("next/server");

function request(path, { host = "localhost", authorization, origin, fetchSite, headers: extraHeaders } = {}) {
  const headers = { host };
  if (authorization) headers.authorization = authorization;
  if (origin) headers.origin = origin;
  if (fetchSite) headers["sec-fetch-site"] = fetchSite;
  // Extra headers (e.g. a session cookie) — without this, passing `headers` to
  // request() was silently ignored and the assertion tested nothing.
  if (extraHeaders) Object.assign(headers, extraHeaders);
  // NextRequest, not Request: proxy() reads request.nextUrl.pathname, which a
  // plain Request does not expose.
  return new NextRequest(`http://${host}${path}`, { headers });
}

function basic(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

/** Run a proxy invocation with a specific PI_WEB_PASSWORD, restoring it after. */
function withPassword(password, fn) {
  const previous = process.env.PI_WEB_PASSWORD;
  if (password === undefined) delete process.env.PI_WEB_PASSWORD;
  else process.env.PI_WEB_PASSWORD = password;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.PI_WEB_PASSWORD;
    else process.env.PI_WEB_PASSWORD = previous;
  }
}

test("with no password configured, a local request is allowed (loopback is the boundary)", async () => {
  const { proxy } = await loadProxy();
  const response = withPassword(undefined, () => proxy(request("/api/sessions")));
  assert.notEqual(response.status, 401, "auth is off by default, by design");
});

test("an untrusted Host is rejected with 403 regardless of password", async () => {
  const { proxy } = await loadProxy();
  const response = withPassword(undefined, () =>
    proxy(request("/api/sessions", { host: "evil.example" })),
  );
  assert.equal(response.status, 403);
});

test("a cross-site browser request is rejected", async () => {
  const { proxy } = await loadProxy();
  const response = withPassword(undefined, () =>
    proxy(request("/api/sessions", {
      origin: "https://evil.example",
      fetchSite: "cross-site",
    })),
  );
  assert.equal(response.status, 403);
});

test("with a password configured, an unauthenticated request gets 401", async () => {
  const { proxy } = await loadProxy();
  const response = withPassword("a-long-random-password", () => proxy(request("/api/sessions")));
  assert.equal(response.status, 401);
  // The browser needs this header to prompt, or the pool never appears.
  assert.match(response.headers.get("www-authenticate") ?? "", /Basic realm="Pi Web"/);
});

test("with a password configured, a wrong password gets 401", async () => {
  const { proxy } = await loadProxy();
  const response = withPassword("correct-horse", () =>
    proxy(request("/api/sessions", { authorization: basic("pi", "wrong-password") })),
  );
  assert.equal(response.status, 401);
});

test("the username is fixed: any other username is rejected", async () => {
  const { proxy } = await loadProxy();
  const response = withPassword("correct-horse", () =>
    proxy(request("/api/sessions", { authorization: basic("admin", "correct-horse") })),
  );
  assert.equal(response.status, 401, "only the fixed 'pi' username may authenticate");
});

test("with the correct password the request passes the gate", async () => {
  const { proxy } = await loadProxy();
  const response = withPassword("correct-horse", () =>
    proxy(request("/api/sessions", { authorization: basic("pi", "correct-horse") })),
  );
  assert.notEqual(response.status, 401);
  assert.notEqual(response.status, 403);
});

test("the gate covers every /api route, not a hand-picked subset", async () => {
  // The docs previously claimed only a subset of routes were guarded. The
  // matcher is "/api/:path*", so this asserts the class of routes that claim was
  // about — including the ones that serve raw session transcripts.
  const { proxy } = await loadProxy();
  for (const path of ["/api/agent/new", "/api/sessions", "/api/git/status", "/api/transcribe"]) {
    const response = withPassword("correct-horse", () => proxy(request(path)));
    assert.equal(response.status, 401, `${path} must require auth when a password is set`);
  }
});

test("the root document is also gated, not just the API", async () => {
  const { proxy } = await loadProxy();
  const response = withPassword("correct-horse", () =>
    proxy(request("/", { host: "localhost" })),
  );
  assert.equal(response.status, 401, "the UI itself must not be servable unauthenticated");
});

// --- session cookie (added with lib/web-session.ts) -------------------------
//
// The cookie exists so the installed iOS PWA stops re-prompting for a password
// it cannot autofill. These assert the gate still refuses everything without a
// valid one — the cookie must not become a bypass.

async function loadSession() {
  return jiti.import("./lib/web-session.ts");
}

test("a request with no credentials at all is still rejected", async () => {
  const { proxy } = await loadProxy();
  const response = withPassword("correct-horse", () => proxy(request("/")));
  assert.equal(response.status, 401);
});

test("Basic Auth success issues a session cookie", async () => {
  const { proxy } = await loadProxy();
  const response = withPassword("correct-horse", () =>
    proxy(request("/", { authorization: basic("pi", "correct-horse") })),
  );
  assert.notEqual(response.status, 401);
  const cookie = response.headers.get("set-cookie") ?? "";
  assert.match(cookie, /pi_web_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
});

test("a valid session cookie is accepted without Basic Auth", async () => {
  const { proxy } = await loadProxy();
  const { createSessionValue } = await loadSession();
  const value = createSessionValue("correct-horse");
  const response = withPassword("correct-horse", () =>
    proxy(request("/", { headers: { cookie: `pi_web_session=${value}` } })),
  );
  assert.notEqual(response.status, 401);
});

test("a cookie signed with a different password is rejected", async () => {
  const { proxy } = await loadProxy();
  const { createSessionValue } = await loadSession();
  const value = createSessionValue("some-other-password");
  const response = withPassword("correct-horse", () =>
    proxy(request("/", { headers: { cookie: `pi_web_session=${value}` } })),
  );
  assert.equal(response.status, 401, "rotation of PI_WEB_PASSWORD revokes sessions");
});

test("a forged cookie is rejected", async () => {
  const { proxy } = await loadProxy();
  const response = withPassword("correct-horse", () =>
    proxy(request("/", { headers: { cookie: "pi_web_session=12345.forged" } })),
  );
  assert.equal(response.status, 401);
});

test("the mobile surface and the API are held to the same gate", async () => {
  const { proxy } = await loadProxy();
  for (const path of ["/m", "/api/sessions"]) {
    const response = withPassword("correct-horse", () => proxy(request(path, { host: "localhost" })));
    assert.equal(response.status, 401, `${path} must require auth when a password is set`);
  }
});

test("no password configured leaves the gate open (loopback/tailnet model)", async () => {
  const { proxy } = await loadProxy();
  const response = withPassword(undefined, () => proxy(request("/", { host: "localhost" })));
  assert.notEqual(response.status, 401);
});
