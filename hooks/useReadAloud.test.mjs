import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readAloud = await readFile(new URL("./useReadAloud.ts", import.meta.url), "utf8");
const chatWindow = await readFile(new URL("../components/ChatWindow.tsx", import.meta.url), "utf8");
const chatInput = await readFile(new URL("../components/ChatInput.tsx", import.meta.url), "utf8");

/**
 * Read-aloud failing silently (F18, owner-reported 2026-10-02).
 *
 * The owner: "Sometimes the read aloud does not play at all after a reply."
 *
 * The defining property of this defect is that it *cannot report itself*:
 *   - `useReadAloud` sets `error`, but nothing rendered it. A failed read-aloud
 *     was silent in both senses.
 *   - `playViaContext` — the path iOS Safari takes — attached only
 *     `src.onended`. `decodeAudioData` was awaited bare and `ctx.resume()` was
 *     fire-and-forget, so a failure there rejected into nothing.
 *
 * These tests pin the diagnostic contract rather than a guessed cause. The
 * cause is not yet known and must not be asserted here.
 */

test("playback failures on the AudioContext path are caught, not dropped", () => {
  const start = readAloud.indexOf("const playViaContext");
  const end = readAloud.indexOf("const playViaElement");
  assert.ok(start > -1 && end > start, "playViaContext should be defined before playViaElement");
  const body = readAloud.slice(start, end);

  // The whole body must be guarded: decodeAudioData and src.start() both throw
  // in real failure modes (undecodable payload, unsupported context).
  assert.match(body, /try\s*\{/, "the iOS playback path needs a try block");
  assert.match(body, /catch\s*\(/, "…and a catch that surfaces the reason");
});

test("a suspended AudioContext that refuses to resume is reported, not ignored", () => {
  const start = readAloud.indexOf("const playViaContext");
  const end = readAloud.indexOf("const playViaElement");
  const body = readAloud.slice(start, end);

  // The historical line was `await ctx.resume().catch(() => {})` — the leading
  // hypothesis (iOS only unlocks audio from a gesture) was precisely the case
  // that got swallowed. `ctx.state` must be inspected *after* the resume.
  assert.match(body, /resume\(\)/, "still attempts the resume");
  assert.match(body, /ctx\.state/, "must re-read the state after resuming");
  assert.doesNotMatch(
    body,
    /resume\(\)\s*\.catch\(\(\)\s*=>\s*\{\s*\}\s*\)\s*;?\s*$/m,
    "a bare swallowed resume is the defect",
  );
});

test("the failure carries the facts needed to tell the causes apart", () => {
  // "Playback failed" alone is useless: it cannot separate "no audio unlock"
  // from "server returned garbage" from "decode threw". The message must name
  // the condition.
  assert.match(readAloud, /Auto-play is blocked|audio is blocked|suspended/i);
});

test("useReadAloud exposes diagnostic state, not just an error string", () => {
  // The point of F18 is that the state was invisible. Exposing the inputs that
  // distinguish the hypotheses is what turns a mystery into a diagnosis.
  assert.match(readAloud, /lastFailure|diagnostics|lastError/i, "expose a structured last failure");
});

test("the read-aloud error is actually rendered somewhere", () => {
  // The unmet half of AC-9: nothing in components/ read `readAloud.error`, so
  // a failure had no way to reach the user.
  const consumed =
    /readAloud\.(error|lastFailure)|readAloudError/.test(chatWindow) ||
    /readAloud\.(error|lastFailure)|readAloudError/.test(chatInput);
  assert.ok(consumed, "the read-aloud error must reach the UI, not just the hook");
});

test("auto-read failure does not leave the follow-up window un-armed", () => {
  const start = chatWindow.indexOf("if (completionNotificationsEnabled && readAloudEnabled)");
  assert.ok(start > -1, "expected the auto-read branch");
  // Find the matching close of the branch rather than slicing a fixed number of
  // characters — a comment inside it must not change what this test inspects.
  const branch = chatWindow.slice(start, chatWindow.indexOf("setVoiceArmSignal", start) + 200);
  // If speaking fails, `speaking` never becomes true and the re-arm effect
  // never fires, so the follow-up window silently dies with the audio.
  assert.match(
    branch,
    /\.catch\(|\.finally\(|\.then\(/,
    "a rejected read-aloud must still re-arm voice follow-ups",
  );
});

/**
 * Autoplay policy rejection (owner, on device 2026-10-04).
 *
 * The decisive observation: "Read aloud failed, audio playback failed. Manual
 * read aloud works." Manual is a tap — a user gesture. Automatic fires when a
 * turn finishes, which is not. iOS rejects a non-gesture `play()` outright.
 *
 * So this is not a fault, it is a recoverable refusal, and the distinction has
 * to survive into the UI: the reply will play the instant it is tapped.
 */

test("a rejected play() is classified as autoplay policy, not a generic failure", () => {
  assert.match(readAloud, /isAutoplayBlock/, "the block must be identified specifically");
  // Safari rejects with NotAllowedError; some engines use AbortError, and the
  // message wording varies. Match broadly rather than on one constructor.
  assert.match(readAloud, /NotAllowedError/);
  assert.match(readAloud, /user gesture|user activation|not allowed/i);
});

test("the autoplay case says what is happening, not what to click", () => {
  assert.match(readAloud, /AUTOPLAY_BLOCKED_MESSAGE/);
  // The message must describe the condition and the recovery, without
  // directing the user at a control — the recovery is automatic now.
  assert.doesNotMatch(readAloud, /tap Read aloud to hear/i, "no button-directed wording");
  assert.match(readAloud, /will play once you tap|locked when this reply arrived/i);
});

test("the blocked case is tagged with its own stage", () => {
  const idx = readAloud.indexOf("_stage: \"blocked\" as const");
  assert.ok(idx > -1, "the autoplay path must tag stage=blocked");
});

test("a refused reply is remembered so it can be replayed automatically", () => {
  // This is what replaces the retry button: the app replays the reply itself.
  assert.match(readAloud, /blockedTextRef/, "the refused text must be held for replay");
  assert.match(readAloud, /replayRef/, "and there must be a replay hook");
  assert.match(
    readAloud,
    /blockedTextRef\.current = stage === "blocked"/,
    "only a gesture refusal is replayable — a real fault would fail identically",
  );
});

test("the unlock is taken on the first gesture anywhere in the app", () => {
  // WebKit lifts the gesture requirement permanently after the first gesture,
  // so obtaining one early is what lets AUTOMATIC read-aloud work later.
  assert.match(readAloud, /pointerdown/, "a first-tap listener is what earns the unlock");
  assert.match(readAloud, /removeEventListener\("pointerdown"/, "it must remove itself after firing");
});

test("the unlock plays a silent buffer, so the gesture is recorded without noise", () => {
  assert.match(readAloud, /createBuffer\(1, 1,/, "a one-sample buffer at zero gain unlocks silently");
  assert.match(readAloud, /gain\.value = 0/);
});

test("one audio element is reused rather than rebuilt per reply", () => {
  // A newly constructed element has to earn the gesture unlock again.
  assert.match(readAloud, /ensureAudioElement/);
  assert.doesNotMatch(readAloud, /new Audio\(url\)/, "per-reply elements lose the unlock");
});

test("there is no retry button in the UI", () => {
  const drawer = readFile(new URL("../components/mobile/MobileSettingsDrawer.tsx", import.meta.url), "utf8");
  return drawer.then((src) => {
    assert.doesNotMatch(src, /onRetryReadAloud|readaloud-retry/, "the button is not conducive to the UI");
    // The failure is still surfaced, though — that part was the whole point.
    assert.match(src, /readAloudError/);
    assert.match(src, /data-mobile-settings-readaloud-error/);
  });
});

test("the element's error event does not overwrite a more specific failure", () => {
  // Observed on device: the retry button was present (stage === blocked) while
  // the message read "Audio playback failed". The element's `onerror` fires
  // asynchronously and landed after `play()` had already rejected, so two
  // writers disagreed about the same failure.
  const start = readAloud.indexOf("const playViaElement");
  const body = readAloud.slice(start, readAloud.indexOf("}, []);", start));
  const onerrorAt = body.indexOf("el.onerror");
  assert.ok(onerrorAt > -1, "expected the element error handler");
  const handler = body.slice(onerrorAt, onerrorAt + 300);
  assert.doesNotMatch(
    handler,
    /setError\(/,
    "onerror must not write the user-facing error — it races the play() rejection",
  );
  assert.match(handler, /settled/, "it must defer when a failure is already recorded");
});

test("a genuine load failure outranks the play() rejection it causes", () => {
  // A failed load makes play() reject too, which would otherwise be classified
  // as an autoplay block and offer a retry that can never work.
  const start = readAloud.indexOf("const playViaElement");
  const body = readAloud.slice(start, readAloud.indexOf("}, []);", start));
  assert.match(body, /elementFailed/, "a load failure must be tracked separately");
  const decodeIdx = body.indexOf("could not be loaded");
  const blockIdx = body.indexOf("isAutoplayBlock(e)");
  assert.ok(decodeIdx > -1 && blockIdx > -1, "expected both classifications");
  assert.ok(decodeIdx < blockIdx, "load failure must be checked before the autoplay block");
});
