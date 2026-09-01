import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { resolveMicDeviceId } = await jiti.import("./mic-routing.ts");

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
