import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const deadCapture = await readFile(new URL("./useDeadCapture.ts", import.meta.url), "utf8");
const voiceInput = await readFile(new URL("./useVoiceInput.ts", import.meta.url), "utf8");
const micSensitivity = await readFile(new URL("../lib/mic-sensitivity.ts", import.meta.url), "utf8");

/**
 * Dead-capture detection (AC-4, reinforced 2026-10-04).
 *
 * The owner, on device: after locking the phone the wake word stops working
 * permanently, while "the pill still stays blue and says Listening for Oracle".
 * That is the exact failure this hook exists to catch — and it was not catching
 * it. This test file exists because the detector had no tests, which is why the
 * flaw below survived.
 *
 * The flaw: the detector compared the meter's `db` / `threshold` / `active`
 * values against their previous values, treating a change as proof of life.
 * But a dead capture loop does not produce changing values — it stops writing
 * the meter entirely. The values FREEZE, still carrying `active: true` from the
 * last live frame, so the check read "unchanged, looks alive" forever.
 */

test("the meter carries a monotonic frame counter", () => {
  assert.match(micSensitivity, /frames:\s*number/, "MicMeter needs a liveness counter");
});

test("the capture loop increments the frame counter on every audio frame", () => {
  // Only the audio callback may advance it. If anything else did, a dead loop
  // would still look alive.
  const write = voiceInput.slice(voiceInput.indexOf("meterRef.current = {"));
  const literal = write.slice(0, write.indexOf("};"));
  assert.match(literal, /frames:\s*\+\+frameCountRef\.current/, "the loop must bump the counter");
});

test("detection is by counter movement, not by comparing values", () => {
  // The regression guard. Comparing db/threshold/active cannot detect death,
  // because death means they stop changing.
  assert.match(deadCapture, /m\.frames !== lastFramesRef\.current/, "advance is judged on the counter");
  assert.doesNotMatch(
    deadCapture,
    /prev\.db !== m\.db/,
    "value comparison is the bug — a frozen meter still reads as alive",
  );
});

test("`active` is never treated as proof of life on its own", () => {
  // The specific trap: `active` stays true on the frozen last frame.
  assert.doesNotMatch(
    deadCapture,
    /if \(m\.active\)/,
    "`active` freezes true when the loop dies and must not imply liveness",
  );
});

test("death latches after the frame counter stalls for the threshold window", () => {
  assert.match(deadCapture, /DEAD_AFTER_MS/);
  assert.match(deadCapture, /now - lastAdvanceAtRef\.current >= DEAD_AFTER_MS/);
});

test("legitimate quiet is not mistaken for death", () => {
  // `armed` is silent by design — nobody is talking. Only a stalled counter
  // proves death, so a low dB reading must not latch.
  assert.doesNotMatch(deadCapture, /db\s*[<>]=?\s*-?\d/, "silence must not be read as death");
});

test("leaving the listening phases clears the latch", () => {
  // Recovery matters because the owner reports the failure is one-way: the app
  // must be able to say \"alive again\" after a real rebuild.
  assert.match(deadCapture, /phase === \"idle\" \|\| phase === \"working\"/);
  assert.match(deadCapture, /setDead\(false\)/);
});

test("the UI consumes the dead flag, so a dead capture is visible", () => {
  // The owner's complaint is that the pill stayed blue and claimed to listen.
  // Detection is worthless if nothing renders it.
  const chatInput = readFile(new URL("../components/ChatInput.tsx", import.meta.url), "utf8");
  const chatWindow = readFile(new URL("../components/ChatWindow.tsx", import.meta.url), "utf8");
  return Promise.all([chatInput, chatWindow]).then(([ci, cw]) => {
    const consumed = /deadCapture|dead=\{/.test(ci) || /deadCapture|dead=\{/.test(cw);
    assert.ok(consumed, "the dead state must reach the UI, or the pill keeps lying");
  });
});
