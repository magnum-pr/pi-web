import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});

const { DEFAULT_VOICE_CONFIG, resolveVoiceConfig } = await jiti.import("./voice-config.ts");

test("resolveVoiceConfig returns defaults for empty / non-object input", () => {
  assert.deepEqual(resolveVoiceConfig({}), DEFAULT_VOICE_CONFIG);
  assert.deepEqual(resolveVoiceConfig(null), DEFAULT_VOICE_CONFIG);
  assert.deepEqual(resolveVoiceConfig("junk"), DEFAULT_VOICE_CONFIG);
});

test("resolveVoiceConfig preserves valid values", () => {
  const cfg = resolveVoiceConfig({
    wakeWord: { phrase: "computer", threshold: 1e-10, ackEnabled: false, ack: "Ready" },
    vad: { silenceMs: 1500, volumeDb: -30, calibrationMarginDb: 8 },
    recording: { maxDurationS: 60 },
    sticky: { enabled: true, lapseS: 10, onsetDb: 4 },
  });
  assert.equal(cfg.wakeWord.phrase, "computer");
  assert.equal(cfg.wakeWord.threshold, 1e-10);
  assert.equal(cfg.wakeWord.ackEnabled, false);
  assert.equal(cfg.wakeWord.ack, "Ready");
  assert.equal(cfg.vad.silenceMs, 1500);
  assert.equal(cfg.vad.volumeDb, -30);
  assert.equal(cfg.vad.calibrationMarginDb, 8);
  assert.equal(cfg.recording.maxDurationS, 60);
  assert.equal(cfg.sticky.lapseS, 10);
  assert.equal(cfg.sticky.onsetDb, 4);
});

test("resolveVoiceConfig clamps out-of-range numeric values", () => {
  const cfg = resolveVoiceConfig({
    wakeWord: { threshold: -1 },
    vad: { silenceMs: 1, volumeDb: 0, calibrationMarginDb: 999 },
    recording: { maxDurationS: 0 },
    sticky: { lapseS: -5 },
  });
  assert.equal(cfg.wakeWord.threshold, 1e-40); // clamped low
  assert.equal(cfg.vad.silenceMs, 500); // clamped low
  assert.equal(cfg.vad.volumeDb, -20); // clamped high
  assert.equal(cfg.vad.calibrationMarginDb, 30); // clamped high
  assert.equal(cfg.recording.maxDurationS, 5); // clamped low
  assert.equal(cfg.sticky.lapseS, 1); // clamped low
});

test("resolveVoiceConfig falls back to defaults for missing subsections / bad types", () => {
  const cfg = resolveVoiceConfig({
    wakeWord: { phrase: 42, threshold: "high" },
    vad: { silenceMs: "now" },
    sticky: { enabled: "yes" },
  });
  assert.equal(cfg.wakeWord.phrase, DEFAULT_VOICE_CONFIG.wakeWord.phrase);
  assert.equal(cfg.wakeWord.threshold, DEFAULT_VOICE_CONFIG.wakeWord.threshold);
  assert.equal(cfg.vad.silenceMs, DEFAULT_VOICE_CONFIG.vad.silenceMs);
  assert.equal(cfg.sticky.enabled, DEFAULT_VOICE_CONFIG.sticky.enabled);
});
