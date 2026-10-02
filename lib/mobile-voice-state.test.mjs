import assert from "node:assert/strict";
import test from "node:test";

import { WAKE_WORD, voicePresentation } from "./mobile-voice-state.ts";

test("the wake word is Oracle", () => {
  assert.equal(WAKE_WORD, "Oracle");
});

test("the armed state names the wake word rather than showing a bare glyph", () => {
  const p = voicePresentation("armed", { enabled: true });
  assert.equal(p.state, "armed");
  assert.match(p.label, /Oracle/);
  assert.equal(p.compact, true, "armed is the resting state and renders compact");
});

test("every phase has a non-empty text label — state is never colour alone", () => {
  for (const phase of ["idle", "armed", "recording", "sticky", "transcribing", "working"]) {
    const p = voicePresentation(phase, { enabled: true });
    assert.ok(p.label.trim().length > 0, `${phase} must have a label`);
    assert.ok(p.tone.trim().length > 0, `${phase} must have a tone`);
  }
});

test("capture states expand; resting states stay compact", () => {
  assert.equal(voicePresentation("recording", { enabled: true }).compact, false);
  assert.equal(voicePresentation("sticky", { enabled: true }).compact, false);
  assert.equal(voicePresentation("transcribing", { enabled: true }).compact, false);
  assert.equal(voicePresentation("armed", { enabled: true }).compact, true);
  assert.equal(voicePresentation("working", { enabled: true }).compact, true);
});

test("the sticky follow-up window reads as an invitation to speak", () => {
  assert.equal(voicePresentation("sticky", { enabled: true }).label, "Speak now");
});

test("disabled voice reports off and invites a tap", () => {
  const p = voicePresentation("armed", { enabled: false });
  assert.equal(p.state, "off");
  assert.equal(p.promptsTapToResume, true);
});

test("idle phase also reports off", () => {
  assert.equal(voicePresentation("idle", { enabled: true }).state, "off");
});

test("a dead capture overrides every optimistic phase", () => {
  // The proven iOS failure: the hook still believes it is armed/recording while
  // nothing is being captured, so the honest label must win.
  for (const phase of ["armed", "recording", "sticky"]) {
    const p = voicePresentation(phase, { enabled: true, dead: true });
    assert.equal(p.state, "dead");
    assert.match(p.label, /tap to resume/i);
    assert.equal(p.promptsTapToResume, true);
    assert.notEqual(p.label, voicePresentation(phase, { enabled: true }).label);
  }
});

test("dead is not reported while voice is off", () => {
  assert.equal(voicePresentation("idle", { enabled: false, dead: true }).state, "off");
});
