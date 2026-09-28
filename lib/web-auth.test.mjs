import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./web-auth.ts");
}

function authorization(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

test("enables password authentication only for a non-empty configured password", async () => {
  const { isWebPasswordEnabled } = await loadSubject();

  // The no-argument case reads process.env.PI_WEB_PASSWORD, so this test's
  // expectation depends on the ambient environment. It passed for months only
  // because no shell here had that variable set; setting it (as the pi-web
  // supervisor now does) made the suite fail for a reason unrelated to the code.
  //
  // Pin the case that is actually about the function's argument handling, and
  // cover the env fallback explicitly rather than incidentally.
  const saved = process.env.PI_WEB_PASSWORD;
  try {
    delete process.env.PI_WEB_PASSWORD;
    assert.equal(isWebPasswordEnabled(undefined), false, "unset env means disabled");
    process.env.PI_WEB_PASSWORD = "from-env";
    assert.equal(isWebPasswordEnabled(undefined), true, "set env means enabled");
  } finally {
    if (saved === undefined) delete process.env.PI_WEB_PASSWORD;
    else process.env.PI_WEB_PASSWORD = saved;
  }

  assert.equal(isWebPasswordEnabled(""), false, "empty string is not a password");
  assert.equal(isWebPasswordEnabled("secret"), true);
});

test("accepts only the fixed pi username and configured password", async () => {
  const { isValidBasicAuthorization } = await loadSubject();
  assert.equal(isValidBasicAuthorization(authorization("pi", "secret"), "secret"), true);
  assert.equal(isValidBasicAuthorization(authorization("admin", "secret"), "secret"), false);
  assert.equal(isValidBasicAuthorization(authorization("pi", "wrong"), "secret"), false);
});

test("supports UTF-8 passwords and colons in the password", async () => {
  const { isValidBasicAuthorization } = await loadSubject();
  const password = "口令:with:colons";
  assert.equal(isValidBasicAuthorization(authorization("pi", password), password), true);
});

test("rejects missing, malformed, and non-canonical authorization values", async () => {
  const { isValidBasicAuthorization } = await loadSubject();
  const valid = authorization("pi", "secret");

  assert.equal(isValidBasicAuthorization(null, "secret"), false);
  assert.equal(isValidBasicAuthorization("Bearer token", "secret"), false);
  assert.equal(isValidBasicAuthorization("Basic !!!", "secret"), false);
  assert.equal(isValidBasicAuthorization(`${valid}!`, "secret"), false);
  assert.equal(isValidBasicAuthorization(
    `Basic ${Buffer.from("missing-separator", "utf8").toString("base64")}`,
    "secret",
  ), false);
});

test("does not authenticate when password protection is disabled", async () => {
  const { isValidBasicAuthorization } = await loadSubject();
  assert.equal(isValidBasicAuthorization(authorization("pi", ""), ""), false);
  assert.equal(isValidBasicAuthorization(authorization("pi", "secret"), undefined), false);
});
