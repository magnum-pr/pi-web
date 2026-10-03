import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});

const { DEFAULT_VOICE_CONFIG, resolveVoiceConfig } = await jiti.import("./voice-config.ts");
const { mergeVoiceConfigs, readVoiceOverride, writeVoiceOverride } = await jiti.import(
  "./voice-config-store.ts",
);

const BASE = resolveVoiceConfig({
  wakeWord: { phrase: "oracle", threshold: 1e-8, ackEnabled: true, ack: "Yes?" },
  stopWord: { phrase: "that's all", threshold: 0.1 },
  vad: { silenceMs: 3000, volumeDb: -32, calibrationMarginDb: 4 },
  recording: { maxDurationS: 60 },
  sticky: { enabled: true, lapseS: 90, onsetDb: 6 },
});

function tempAgentDir() {
  const dir = mkdtempSync(join(tmpdir(), "piweb-voicecfg-"));
  return {
    dir,
    path: join(dir, "voice-config.json"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("an absent override leaves the base config untouched", () => {
  const t = tempAgentDir();
  try {
    assert.deepEqual(readVoiceOverride(t.path), {});
    assert.deepEqual(mergeVoiceConfigs(BASE, readVoiceOverride(t.path)), BASE);
  } finally {
    t.cleanup();
  }
});

test("a malformed override is ignored rather than thrown, matching the resolver's contract", () => {
  const t = tempAgentDir();
  try {
    writeFileSync(t.path, "{ not json at all");
    assert.deepEqual(readVoiceOverride(t.path), {});
    assert.deepEqual(mergeVoiceConfigs(BASE, readVoiceOverride(t.path)), BASE);
  } finally {
    t.cleanup();
  }
});

test("a partial override changes only the keys it names", () => {
  const t = tempAgentDir();
  try {
    writeFileSync(t.path, JSON.stringify({ wakeWord: { phrase: "computer" } }));
    const merged = mergeVoiceConfigs(BASE, readVoiceOverride(t.path));
    assert.equal(merged.wakeWord.phrase, "computer");
    // Everything the patch did not mention still comes from the base.
    assert.equal(merged.wakeWord.threshold, BASE.wakeWord.threshold);
    assert.equal(merged.stopWord.phrase, BASE.stopWord.phrase);
    assert.equal(merged.vad.silenceMs, BASE.vad.silenceMs);
    assert.equal(merged.sticky.lapseS, BASE.sticky.lapseS);
  } finally {
    t.cleanup();
  }
});

test("deep merge keeps sibling keys per section, not whole-section replacement", () => {
  const t = tempAgentDir();
  try {
    writeFileSync(t.path, JSON.stringify({ vad: { silenceMs: 1200 } }));
    const merged = mergeVoiceConfigs(BASE, readVoiceOverride(t.path));
    assert.equal(merged.vad.silenceMs, 1200);
    // The naive shallow spread would have dropped these to undefined.
    assert.equal(merged.vad.volumeDb, BASE.vad.volumeDb);
    assert.equal(merged.vad.calibrationMarginDb, BASE.vad.calibrationMarginDb);
  } finally {
    t.cleanup();
  }
});

test("out-of-range values are clamped to the schema bounds, not written through", () => {
  const t = tempAgentDir();
  try {
    writeFileSync(
      t.path,
      JSON.stringify({ vad: { silenceMs: 999999 }, recording: { maxDurationS: 0 }, sticky: { lapseS: 99999 } }),
    );
    const merged = mergeVoiceConfigs(BASE, readVoiceOverride(t.path));
    assert.equal(merged.vad.silenceMs, 15000);
    assert.equal(merged.recording.maxDurationS, 5);
    assert.equal(merged.sticky.lapseS, 300);
  } finally {
    t.cleanup();
  }
});

test("an override may not introduce keys the schema does not define", () => {
  const t = tempAgentDir();
  try {
    writeFileSync(
      t.path,
      JSON.stringify({ evil: { inject: true }, wakeWord: { phrase: "computer", bogus: 1 } }),
    );
    const merged = mergeVoiceConfigs(BASE, readVoiceOverride(t.path));
    assert.equal(merged.evil, undefined);
    assert.equal(merged.wakeWord.bogus, undefined);
    assert.equal(Object.keys(merged).sort().join(","), ["recording", "stopWord", "sticky", "vad", "wakeWord"].sort().join(","));
  } finally {
    t.cleanup();
  }
});

test("a written patch is merged over whatever was already on disk, not replacing it", () => {
  const t = tempAgentDir();
  try {
    writeVoiceOverride({ wakeWord: { phrase: "computer" } }, t.path);
    writeVoiceOverride({ recording: { maxDurationS: 120 } }, t.path);

    const onDisk = JSON.parse(readFileSync(t.path, "utf8"));
    // Both patches survive: the second write patched the first, it did not
    // clobber it.
    assert.equal(onDisk.wakeWord.phrase, "computer");
    assert.equal(onDisk.recording.maxDurationS, 120);
  } finally {
    t.cleanup();
  }
});

test("writing creates the directory when it does not exist yet", () => {
  const t = tempAgentDir();
  const nested = join(t.dir, "deeper", "voice-config.json");
  try {
    writeVoiceOverride({ wakeWord: { phrase: "computer" } }, nested);
    assert.ok(existsSync(nested), "expected the override to be created");
  } finally {
    t.cleanup();
  }
});

test("an unwritable path surfaces as a rejection the route can turn into a 500", () => {
  const t = tempAgentDir();
  try {
    // A directory where the file should be: the atomic rename cannot succeed.
    writeFileSync(join(t.dir, "blocked.json"), "x");
    assert.throws(() => writeVoiceOverride({ wakeWord: { phrase: "x" } }, t.dir));
  } finally {
    t.cleanup();
  }
});

test("the override never carries unrelated defaults into the file", () => {
  const t = tempAgentDir();
  try {
    writeVoiceOverride({ vad: { silenceMs: 1200 } }, t.path);
    const onDisk = JSON.parse(readFileSync(t.path, "utf8"));
    // Only what was patched is persisted. If the whole resolved config were
    // written, a later change to the tracked base would be shadowed forever.
    assert.deepEqual(onDisk, { vad: { silenceMs: 1200 } });
  } finally {
    t.cleanup();
  }
});

test("the defaults constant is unchanged by any of this", () => {
  assert.deepEqual(resolveVoiceConfig({}), DEFAULT_VOICE_CONFIG);
});
