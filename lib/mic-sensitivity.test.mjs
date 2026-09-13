import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const {
  DEFAULT_MIC_SENSITIVITY,
  SENSITIVITY_MAX_DB,
  SENSITIVITY_MIN_DB,
  clampSensitivityDb,
  meterPct,
  parseMicSensitivity,
  silenceThreshold,
} = await jiti.import("./mic-sensitivity.ts");

const { DEFAULT_VOICE_CONFIG } = await jiti.import("./voice-config.ts");

const auto = { auto: true, volumeDb: -40 };
const manual = (db) => ({ auto: false, volumeDb: db });

test("manual mode returns the pinned threshold", () => {
  assert.equal(silenceThreshold(DEFAULT_VOICE_CONFIG, -55, manual(-30)), -30);
  // Floor is irrelevant in manual mode.
  assert.equal(silenceThreshold(DEFAULT_VOICE_CONFIG, null, manual(-45)), -45);
});

test("manual mode clamps to the slider's dB bounds", () => {
  assert.equal(silenceThreshold(DEFAULT_VOICE_CONFIG, -50, manual(0)), SENSITIVITY_MAX_DB);
  assert.equal(silenceThreshold(DEFAULT_VOICE_CONFIG, -50, manual(-999)), SENSITIVITY_MIN_DB);
});

test("auto mode uses the configured fallback before the floor is known", () => {
  const got = silenceThreshold(DEFAULT_VOICE_CONFIG, null, auto);
  assert.equal(got, DEFAULT_VOICE_CONFIG.vad.volumeDb);
});

test("auto mode is floor + calibration margin", () => {
  const cfg = { ...DEFAULT_VOICE_CONFIG, vad: { ...DEFAULT_VOICE_CONFIG.vad, calibrationMarginDb: 6 } };
  assert.equal(silenceThreshold(cfg, -50, auto), -44);
});

test("auto mode clamps to [-60, -28] so a noisy room can't gate out quiet speech", () => {
  const cfg = { ...DEFAULT_VOICE_CONFIG, vad: { ...DEFAULT_VOICE_CONFIG.vad, calibrationMarginDb: 6 } };
  // Very loud ambient floor -> clamped at the -28 upper bound.
  assert.equal(silenceThreshold(cfg, -10, auto), -28);
  // Very quiet floor -> clamped at the -60 lower bound.
  assert.equal(silenceThreshold(cfg, -90, auto), -60);
});

test("auto and manual diverge — the slider actually changes the gate", () => {
  const cfg = { ...DEFAULT_VOICE_CONFIG, vad: { ...DEFAULT_VOICE_CONFIG.vad, calibrationMarginDb: 6 } };
  const floor = -50;
  assert.equal(silenceThreshold(cfg, floor, auto), -44);
  assert.equal(silenceThreshold(cfg, floor, manual(-55)), -55);
});

test("clampSensitivityDb bounds and passes through", () => {
  assert.equal(clampSensitivityDb(-40), -40);
  assert.equal(clampSensitivityDb(-100), SENSITIVITY_MIN_DB);
  assert.equal(clampSensitivityDb(0), SENSITIVITY_MAX_DB);
});

test("parseMicSensitivity defaults on missing / malformed input", () => {
  assert.deepEqual(parseMicSensitivity(null), DEFAULT_MIC_SENSITIVITY);
  assert.deepEqual(parseMicSensitivity(""), DEFAULT_MIC_SENSITIVITY);
  assert.deepEqual(parseMicSensitivity("{not json"), DEFAULT_MIC_SENSITIVITY);
  assert.deepEqual(parseMicSensitivity("null"), DEFAULT_MIC_SENSITIVITY);
  assert.deepEqual(parseMicSensitivity('{"auto":"yes"}'), DEFAULT_MIC_SENSITIVITY);
});

test("parseMicSensitivity round-trips a stored override and clamps it", () => {
  assert.deepEqual(parseMicSensitivity('{"auto":false,"volumeDb":-52}'), { auto: false, volumeDb: -52 });
  assert.deepEqual(parseMicSensitivity('{"auto":false,"volumeDb":-500}'), {
    auto: false,
    volumeDb: SENSITIVITY_MIN_DB,
  });
  // Partial payload keeps the default for the missing half.
  assert.deepEqual(parseMicSensitivity('{"auto":false}'), {
    auto: false,
    volumeDb: DEFAULT_MIC_SENSITIVITY.volumeDb,
  });
});

test("meterPct maps -60..0 onto 0..100 and clamps out-of-range", () => {
  assert.equal(meterPct(-60), 0);
  assert.equal(meterPct(0), 100);
  assert.equal(meterPct(-30), 50);
  assert.equal(meterPct(-90), 0);
  assert.equal(meterPct(10), 100);
});
