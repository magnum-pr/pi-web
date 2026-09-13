import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const {
  isPseudoDeviceId,
  pickPreferredDevice,
  preferredTier,
  resolveDeviceChoice,
} = await jiti.import("./audio-devices.ts");

const airpods = { deviceId: "a1", label: "AirPods Pro" };
const macbook = { deviceId: "m1", label: "MacBook Pro Microphone" };
const macbookSpeakers = { deviceId: "s1", label: "MacBook Pro Speakers" };
const monitor = { deviceId: "x1", label: "LG Monitor" };
const pseudoDefault = { deviceId: "default", label: "Default" };
const pseudoComm = { deviceId: "communications", label: "Communications" };

test("preferredTier ranks AirPods above built-in and ignores everything else", () => {
  assert.equal(preferredTier("AirPods Pro"), "airpods");
  assert.equal(preferredTier("Air Pods Max"), "airpods");
  assert.equal(preferredTier("airpods"), "airpods");
  assert.equal(preferredTier("MacBook Pro Microphone"), "builtin");
  assert.equal(preferredTier("MacBook Pro Speakers"), "builtin");
  assert.equal(preferredTier("Built-in Audio"), "builtin");
  assert.equal(preferredTier("Internal Microphone"), "builtin");
  assert.equal(preferredTier("LG Monitor"), null);
  assert.equal(preferredTier(""), null);
});

test("pickPreferredDevice follows AirPods → built-in → null", () => {
  assert.equal(pickPreferredDevice([macbook, airpods, monitor])?.deviceId, "a1");
  assert.equal(pickPreferredDevice([macbook, monitor])?.deviceId, "m1");
  assert.equal(pickPreferredDevice([monitor]), null);
  assert.equal(pickPreferredDevice([]), null);
});

test("pickPreferredDevice never returns a pseudo device id", () => {
  // Only the pseudo entries exist -> no preference, let the platform decide.
  assert.equal(pickPreferredDevice([pseudoDefault, pseudoComm]), null);
  // A real device still wins over pseudo entries.
  assert.equal(
    pickPreferredDevice([pseudoDefault, pseudoComm, macbook])?.deviceId,
    "m1",
  );
});

test("resolveDeviceChoice: auto/undefined runs the chain, default means system default", () => {
  const pool = [macbook, airpods];
  assert.equal(resolveDeviceChoice("auto", pool), "a1");
  assert.equal(resolveDeviceChoice(undefined, pool), "a1");
  assert.equal(resolveDeviceChoice(null, pool), "a1");
  // Nothing preferred -> null (= no constraint / system default).
  assert.equal(resolveDeviceChoice("auto", [monitor]), null);
});

test("resolveDeviceChoice: explicit system-default and pseudo ids resolve to null", () => {
  const pool = [macbook, airpods];
  assert.equal(resolveDeviceChoice("default", pool), null);
  assert.equal(resolveDeviceChoice("communications", pool), null);
  assert.equal(resolveDeviceChoice("", pool), null);
});

test("resolveDeviceChoice: a manual pin passes through untouched", () => {
  const pool = [macbook, airpods];
  assert.equal(resolveDeviceChoice("m1", pool), "m1");
  assert.equal(resolveDeviceChoice("x1", pool), "x1");
});

test("isPseudoDeviceId flags the ids that must never be pinned", () => {
  assert.equal(isPseudoDeviceId("default"), true);
  assert.equal(isPseudoDeviceId("communications"), true);
  assert.equal(isPseudoDeviceId(null), true);
  assert.equal(isPseudoDeviceId(undefined), true);
  assert.equal(isPseudoDeviceId(""), true);
  assert.equal(isPseudoDeviceId("m1"), false);
});

test("output and input devices resolve through the same policy", () => {
  // Speakers labelled MacBook should outrank a monitor, same as microphones.
  assert.equal(pickPreferredDevice([monitor, macbookSpeakers])?.deviceId, "s1");
  assert.equal(pickPreferredDevice([macbookSpeakers, airpods])?.deviceId, "a1");
});
