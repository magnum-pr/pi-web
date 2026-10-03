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
