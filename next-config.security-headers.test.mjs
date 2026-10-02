import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const config = await readFile(new URL("./next.config.ts", import.meta.url), "utf8");

/**
 * Baseline security headers.
 *
 * These were entirely absent before the 2026-10-01 audit — a sweep of a running
 * production build returned only `X-Powered-By: Next.js`. Static assertions
 * because `headers()` is configuration, and the failure mode is silent: the app
 * works perfectly with no headers at all.
 */
test("clickjacking is refused", () => {
  assert.match(config, /X-Frame-Options[\s\S]{0,40}DENY/);
  assert.match(config, /frame-ancestors 'none'/);
});

test("content-type sniffing is disabled", () => {
  assert.match(config, /X-Content-Type-Options[\s\S]{0,40}nosniff/);
});

test("referrers are not leaked (URLs can carry session ids)", () => {
  assert.match(config, /Referrer-Policy[\s\S]{0,40}no-referrer/);
});

test("powerful browser features are denied by default", () => {
  assert.match(config, /Permissions-Policy/);
  for (const feature of ["camera", "geolocation", "payment", "usb"]) {
    assert.match(config, new RegExp(`${feature}=\\(\\)`));
  }
});

test("the framework is not advertised", () => {
  assert.match(config, /poweredByHeader:\s*false/);
});

test("security headers are applied to the catch-all, not just named routes", () => {
  // A per-route list would silently miss /m, /api/* or static assets — which is
  // exactly the class of bug that left /m unauthenticated.
  assert.match(config, /source:\s*"\/:path\*"[\s\S]{0,80}securityHeaders/);
});

test("API responses are not cacheable by shared caches", () => {
  assert.match(config, /source:\s*"\/api\/:path\*"[\s\S]{0,120}no-store/);
});

test("the mobile surface is covered by the header rules", () => {
  assert.match(config, /source:\s*"\/m"/);
});
