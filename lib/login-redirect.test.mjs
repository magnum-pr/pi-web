import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_POST_LOGIN_PATH, loginUrlFor, safeNextPath } from "./login-redirect.ts";

test("ordinary same-origin paths are preserved", () => {
  assert.equal(safeNextPath("/m"), "/m");
  assert.equal(safeNextPath("/"), "/");
  assert.equal(safeNextPath("/some/deep/path"), "/some/deep/path");
  assert.equal(safeNextPath("/m?x=1"), "/m?x=1");
});

test("absolute URLs are rejected — this is the open-redirect guard", () => {
  assert.equal(safeNextPath("https://evil.com"), DEFAULT_POST_LOGIN_PATH);
  assert.equal(safeNextPath("http://evil.com"), DEFAULT_POST_LOGIN_PATH);
  assert.equal(safeNextPath("javascript:alert(1)"), DEFAULT_POST_LOGIN_PATH);
  assert.equal(safeNextPath("data:text/html,x"), DEFAULT_POST_LOGIN_PATH);
});

test("protocol-relative URLs are rejected", () => {
  // "//evil.com" starts with "/" but a browser treats it as absolute.
  assert.equal(safeNextPath("//evil.com"), DEFAULT_POST_LOGIN_PATH);
  assert.equal(safeNextPath("//evil.com/path"), DEFAULT_POST_LOGIN_PATH);
});

test("backslash variants are rejected (browsers normalise \\ to /)", () => {
  assert.equal(safeNextPath("/\\evil.com"), DEFAULT_POST_LOGIN_PATH);
  assert.equal(safeNextPath("\\/evil.com"), DEFAULT_POST_LOGIN_PATH);
  assert.equal(safeNextPath("/path\\to"), DEFAULT_POST_LOGIN_PATH);
});

test("control characters and whitespace are rejected", () => {
  assert.equal(safeNextPath("/m\nSet-Cookie: x=1"), DEFAULT_POST_LOGIN_PATH);
  assert.equal(safeNextPath("/m\t"), DEFAULT_POST_LOGIN_PATH);
  assert.equal(safeNextPath("/m "), DEFAULT_POST_LOGIN_PATH);
  assert.equal(safeNextPath("/\u0000m"), DEFAULT_POST_LOGIN_PATH);
});

test("non-strings and empties fall back to root", () => {
  assert.equal(safeNextPath(undefined), DEFAULT_POST_LOGIN_PATH);
  assert.equal(safeNextPath(null), DEFAULT_POST_LOGIN_PATH);
  assert.equal(safeNextPath(""), DEFAULT_POST_LOGIN_PATH);
  assert.equal(safeNextPath(42), DEFAULT_POST_LOGIN_PATH);
  assert.equal(safeNextPath(["/m"]), DEFAULT_POST_LOGIN_PATH);
});

test("loginUrlFor omits the parameter when there is nothing to preserve", () => {
  assert.equal(loginUrlFor("/"), "/login");
  assert.equal(loginUrlFor("https://evil.com"), "/login");
});

test("loginUrlFor encodes the preserved path", () => {
  assert.equal(loginUrlFor("/m"), "/login?next=%2Fm");
  assert.equal(loginUrlFor("/m?x=1&y=2"), "/login?next=%2Fm%3Fx%3D1%26y%3D2");
});
