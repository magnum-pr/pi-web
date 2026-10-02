import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./proxy.ts", import.meta.url), "utf8");

/**
 * The route matcher is `config`, not code — so calling `proxy()` in a test
 * exercises the gate but never the list of paths the gate is applied to. That
 * is exactly how `/m` shipped unauthenticated: the matcher was `["/", ...]`,
 * and `"/"` is a literal match, NOT a prefix, so the new mobile route was never
 * gated even though the auth code was correct.
 *
 * These assertions read the real file so any new top-level route has to be added
 * here too.
 */
test("the auth matcher covers every top-level surface, not just the root", () => {
  const match = source.match(/matcher:\s*\[([^\]]*)\]/);
  assert.ok(match, "could not find the matcher in proxy.ts");
  const matcher = match[1];

  assert.match(matcher, /"\/"/, "the root document must stay gated");
  assert.match(matcher, /"\/m"/, "the mobile surface must be gated — '/' is a literal match, not a prefix");
  assert.match(matcher, /"\/api\/:path\*"/, "the API tree must stay gated");
});

test("the matcher is not relying on the root path matching as a prefix", () => {
  // Guards the reasoning, not just the value: if someone later assumes "/"
  // covers everything and removes "/m", this fails and points at the cause.
  const match = source.match(/matcher:\s*\[([^\]]*)\]/);
  const matcher = match?.[1] ?? "";
  const segments = matcher.split(",").map((s) => s.trim()).filter(Boolean);
  assert.ok(
    segments.includes('"/m"'),
    "a distinct top-level route must be listed explicitly; '/' does not prefix-match it",
  );
});
