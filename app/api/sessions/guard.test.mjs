/**
 * The guard on /api/sessions.
 *
 * This route serves raw session transcripts, which is precisely where the
 * 2026-09-27 credential sweep found 232 live secrets. An unguarded /api/sessions
 * is therefore not merely an information disclosure — it is the delivery
 * mechanism by which a local log becomes an external exposure. The route handler
 * is asserted to reject before it reads anything.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

function read(rel) {
  return readFileSync(join(here, rel), "utf8");
}

test("sessions route imports the shared request-security guard", () => {
  const src = read("route.ts");
  assert.match(src, /import \{ isApiRequestAllowed \} from "@\/lib\/request-security"/);
});

test("sessions route rejects an untrusted request with 403 before doing work", () => {
  const src = read("route.ts");
  const handlerAt = src.indexOf("export async function GET");
  assert.ok(handlerAt > -1, "GET handler must exist");
  const body = src.slice(handlerAt);
  const guardAt = body.indexOf("isApiRequestAllowed(req)");
  // The guard must be the first thing in the handler. If a read happened first,
  // the file would already be in memory before the check.
  assert.ok(guardAt > -1, "handler must call the guard");
  assert.ok(guardAt < body.indexOf("listAllSessions"), "guard must precede any session read");
  assert.match(body.slice(guardAt, guardAt + 200), /status: 403/);
});

test("every route the audit flagged as unguarded now calls the guard", () => {
  // These four were named in docs/phone-remote-access.md as having no auth, and
  // guarded only by Tailnet device isolation. On mobile data that is one
  // misconfiguration away from exposure.
  const flagged = [
    "app/api/transcribe/route.ts",
    "app/api/sessions/route.ts",
    "app/api/agent/new/route.ts",
    "app/api/git/status/route.ts",
    "app/api/git/diff/route.ts",
  ];
  const root = join(here, "..", "..", "..");
  for (const rel of flagged) {
    const src = readFileSync(join(root, rel), "utf8");
    assert.match(src, /isApiRequestAllowed\(/, `${rel} must call isApiRequestAllowed`);
  }
});
