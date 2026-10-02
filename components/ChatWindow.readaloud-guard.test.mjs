import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

/**
 * Regression guard for the phone read-aloud failure.
 *
 * `speak()` calls `stop()` on entry (see useReadAloud), so if the auto
 * read-aloud effect re-runs while an utterance is in flight it cancels the
 * playback it just started. Observed on iOS: the wake "ack" was audible but the
 * reply summary was not — the ack never goes through this effect.
 *
 * Two invariants keep it safe:
 *   1. the effect returns early while `speaking` is true, and
 *   2. `speaking` is in the dependency array, so the early return actually runs
 *      when playback starts.
 */
test("auto read-aloud effect cannot cancel its own utterance", () => {
  assert.match(
    source,
    /if \(readAloudSpeaking\) return;/,
    "the auto read-aloud effect must bail out while an utterance is playing",
  );
});

test("read-aloud speaking state is a dependency of the auto read-aloud effect", () => {
  const deps = source.match(/\}, \[agentRunning[^\]]*\]\);/);
  assert.ok(deps, "could not find the auto read-aloud effect dependency array");
  assert.match(
    deps[0],
    /readAloudSpeaking/,
    "readAloudSpeaking must be listed, or the early-return guard never fires",
  );
});

test("the auto read-aloud effect reads speaking before its transition guard", () => {
  const effectStart = source.indexOf("// Auto read-aloud: speak the latest assistant message");
  assert.ok(effectStart > -1, "could not find the auto read-aloud effect");
  const effect = source.slice(effectStart, effectStart + 2000);
  assert.match(effect, /const readAloudSpeaking = readAloud\.speaking;/);
});
