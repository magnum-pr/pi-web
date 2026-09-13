import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { isPseudoDeviceId, resolveMicConstraint, resolveMicDeviceId } = await jiti.import("./mic-routing.ts");

const airpodsInput = { deviceId: "a1", label: "AirPods Pro Microphone" };
const mbInput = { deviceId: "m1", label: "MacBook Pro Microphone" };

test("output-paired: AirPods output selects the AirPods mic", () => {
  const id = resolveMicDeviceId([airpodsInput, mbInput], "AirPods Pro");
  assert.equal(id, "a1");
});

test("output-paired: MacBook speakers stem-matches the MacBook mic", () => {
  const id = resolveMicDeviceId([airpodsInput, mbInput], "MacBook Pro Speakers");
  assert.equal(id, "m1");
});

test("output-paired: unknown output falls back to MacBook/built-in mic", () => {
  const id = resolveMicDeviceId([airpodsInput, mbInput], "LG Monitor");
  assert.equal(id, "m1");
});

test("ignores default/communications pseudo-ids", () => {
  const inputs = [
    { deviceId: "default", label: "Default" },
    { deviceId: "m1", label: "MacBook Pro Microphone" },
  ];
  const id = resolveMicDeviceId(inputs, "MacBook Pro Speakers");
  assert.equal(id, "m1");
});

test("empty inputs returns null; empty labels falls back to first concrete", () => {
  assert.equal(resolveMicDeviceId([], "AirPods Pro"), null);
  const inputs = [{ deviceId: "x", label: "" }, { deviceId: "y", label: "" }];
  assert.equal(resolveMicDeviceId(inputs, ""), "x");
});

// Regression: "System default" pinned the literal pseudo id "default" as an
// exact getUserMedia constraint, which yields a stream that captures nothing
// (mic appeared dead, wake word never fired).
test("resolveMicConstraint returns null for 'default' and 'communications'", () => {
  assert.equal(resolveMicConstraint("default", [airpodsInput, mbInput], "MacBook Pro Speakers"), null);
  assert.equal(resolveMicConstraint("communications", [airpodsInput, mbInput], "AirPods Pro"), null);
  // Even with no inputs known, it must not invent a pseudo id.
  assert.equal(resolveMicConstraint("default", [], ""), null);
});

test("resolveMicConstraint pairs the mic to the active output", () => {
  assert.equal(resolveMicConstraint("output", [airpodsInput, mbInput], "AirPods Pro"), "a1");
  assert.equal(resolveMicConstraint("output", [airpodsInput, mbInput], "MacBook Pro Speakers"), "m1");
});

test("resolveMicConstraint passes a manual pin through, empty string becomes null", () => {
  assert.equal(resolveMicConstraint("m1", [airpodsInput, mbInput], "AirPods Pro"), "m1");
  assert.equal(resolveMicConstraint("", [airpodsInput, mbInput], "AirPods Pro"), null);
});

test("isPseudoDeviceId flags the ids that must never be pinned", () => {
  assert.equal(isPseudoDeviceId("default"), true);
  assert.equal(isPseudoDeviceId("communications"), true);
  assert.equal(isPseudoDeviceId(null), true);
  assert.equal(isPseudoDeviceId(undefined), true);
  assert.equal(isPseudoDeviceId(""), true);
  assert.equal(isPseudoDeviceId("m1"), false);
});
