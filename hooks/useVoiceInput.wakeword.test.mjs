import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const voiceInput = await readFile(new URL("./useVoiceInput.ts", import.meta.url), "utf8");

/**
 * Wake word going quiet after the app is backgrounded (F16, re-opened
 * 2026-10-04).
 *
 * The owner: "Sometimes it responds, sometimes it doesn't. What seems to fix it
 * is enabling and re-enabling the wake word and/or microphone … I think maybe it
 * is lag or response time."
 *
 * That "toggling fixes it" observation is what identified the defect. A toggle
 * changes no threshold — it rebuilds the audio graph. So the failure had to be
 * state lost in the *running* graph. Reading the source found it:
 * `useVoiceInput` handled no `visibilitychange` at all, while iOS suspends an
 * AudioContext on backgrounding. A suspended context fires no
 * `onaudioprocess`, so the rolling buffer froze and the spotter went deaf until
 * something rebuilt the graph.
 *
 * Note what this is NOT: the mute path (purely subtractive, cannot cause it) and
 * the mic-sensitivity slider (feeds the VAD gate, not the spotter threshold) are
 * both ruled out above.
 */

test("the voice graph resumes its AudioContext when the app returns to the foreground", () => {
  assert.match(
    voiceInput,
    /visibilitychange/,
    "a suspended AudioContext must be revived on foregrounding, or the wake word dies until a rebuild",
  );
  assert.match(
    voiceInput,
    /visibilityState\s*!==\s*"visible"/,
    "only resume when actually visible — resuming while hidden is wasted work",
  );
});

test("the foreground handler resumes rather than rebuilding the graph", () => {
  // Rebuilding would re-prompt for the microphone, which is the behaviour the
  // owner explicitly asked to avoid. A resume is silent.
  const start = voiceInput.indexOf("const onVisibility");
  assert.ok(start > -1, "expected a visibility handler");
  const handler = voiceInput.slice(start, start + 400);
  assert.match(handler, /resume\(\)/, "the handler should resume the existing context");
  assert.doesNotMatch(handler, /getUserMedia/, "must not re-request the microphone");
});

test("the visibility listener is removed when the graph is torn down", () => {
  // Otherwise every rebuild leaks a listener holding a dead AudioContext.
  assert.match(voiceInput, /visibilityCleanup/, "the listener needs a cleanup handle");
  assert.match(
    voiceInput,
    /removeEventListener\(\s*"visibilitychange"/,
    "the listener must be removed on teardown",
  );
});

test("resuming is safe when the context is already running", () => {
  // resume() is idempotent, but only attempt it when it is not already running
  // so the common case is a cheap state read rather than a promise per focus.
  const start = voiceInput.indexOf("const onVisibility");
  const handler = voiceInput.slice(start, start + 400);
  assert.match(handler, /state\s*!==\s*"running"/, "guard on the context state");
});

test("the KWS in-flight guard cannot latch permanently (suspect ruled out)", () => {
  // The first hypothesis was that a never-settling request latched this flag and
  // stopped polling forever. Reading the source disproved it: every early return
  // happens BEFORE the flag is set, and it is cleared in a `finally`. This test
  // pins that ordering so a future edit cannot silently reintroduce the latch.
  const start = voiceInput.indexOf("const pollKws = useCallback");
  const body = voiceInput.slice(start, voiceInput.indexOf("}, [playAck, startRecording, stopAndTranscribe]);", start));
  const flagSetAt = body.indexOf("kwsInFlightRef.current = true");
  assert.ok(flagSetAt > -1, "expected the in-flight flag to be set");

  // The guard read must come before the set, and every `return` before the set
  // is harmless because the flag is still false there.
  const guardAt = body.indexOf("if (kwsInFlightRef.current) return");
  assert.ok(guardAt > -1 && guardAt < flagSetAt, "the guard must be read before the flag is set");
  assert.match(body, /finally/, "the flag must be cleared in a finally so no throw can strand it");
});
