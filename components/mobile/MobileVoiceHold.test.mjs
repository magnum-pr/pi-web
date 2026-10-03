import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const buttonSource = await readFile(new URL("./MobileVoiceButton.tsx", import.meta.url), "utf8");
const chatInputSource = await readFile(new URL("../ChatInput.tsx", import.meta.url), "utf8");
const voiceInputSource = await readFile(new URL("../../hooks/useVoiceInput.ts", import.meta.url), "utf8");

/**
 * Hold-to-talk (F17).
 *
 * The bug: `hold` mode drove `setEnabled`, which is the *power* flag. Pressing
 * turned the microphone on and put the hook in `armed` — waiting for the wake
 * word — so a held press could never capture speech. Releasing tore the stream
 * down. And because `onClick` also fires on release, `onToggle` ran afterwards
 * and re-enabled the mic, leaving it on despite the label.
 *
 * The contract these tests pin: hold is a CAPTURE gesture, not a power gesture.
 */

test("the hook exposes capture intent for hold-to-talk, not just the power flag", () => {
  // A hold must be able to start and end a capture directly. `setEnabled` is
  // the wrong primitive — it wires a stream lifecycle to a press.
  assert.match(voiceInputSource, /beginHold/);
  assert.match(voiceInputSource, /endHold/);
});

test("beginHold arms a real recording, so a held press can capture speech", () => {
  const begin = voiceInputSource.slice(
    voiceInputSource.indexOf("const beginHold"),
    voiceInputSource.indexOf("const endHold"),
  );
  assert.notEqual(begin, "", "beginHold should be defined before endHold");
  // It must reach the recording path, not merely enable the mic. Entering
  // `armed` (wake-word listening) is the original defect.
  assert.match(begin, /startRecording|gotoPhase\("recording"\)/);
});

test("endHold sends the capture rather than tearing the mic down", () => {
  const end = voiceInputSource.slice(voiceInputSource.indexOf("const endHold"));
  assert.match(end, /stopAndTranscribe/);
  // Tearing down the stream on release is the old broken behaviour.
  assert.doesNotMatch(end, /setEnabled\(false\)/);
});

test("hold handlers never latch the persistent power flag on", () => {
  const start = chatInputSource.slice(
    chatInputSource.indexOf("onHoldStart"),
    chatInputSource.indexOf("onHoldEnd"),
  );
  assert.notEqual(start, "", "onHoldStart should appear before onHoldEnd");
  // The old handler called setEnabled(true) and left the mic running.
  assert.doesNotMatch(start, /setEnabled\(true\)/);
});

test("the tap handler is not dispatched on the hold gesture path", () => {
  // `onClick` fires on release too, so leaving it bound in `hold` mode runs the
  // toggle after the hold ends. The pill must route tap vs hold explicitly.
  assert.match(buttonSource, /mode === "hold"\s*\?\s*undefined\s*:\s*onToggle|onPress/);
});

test("hold-to-talk has a visible label so the state is never colour alone", () => {
  assert.match(buttonSource, /Hold/);
});

/**
 * Long-press hijack (found on device 2026-10-04).
 *
 * On iOS a long press on selectable text opens the selection loupe, which takes
 * over the gesture and fires `touchcancel` — so the hold silently dropped. The
 * fix is twofold: make the pill not look selectable to the browser, and treat an
 * interrupted touch as the end of the hold rather than leaving it running.
 */

test("the pill opts out of text selection, so a long press cannot open the loupe", () => {
  assert.match(buttonSource, /userSelect:\s*"none"/, "text selection must be suppressed");
  assert.match(buttonSource, /WebkitUserSelect:\s*"none"/, "iOS needs the -webkit- prefixed form");
  // The iOS-specific long-press callout (Share / Copy menu on a held element).
  assert.match(buttonSource, /WebkitTouchCallout:\s*"none"/, "the iOS callout must be suppressed");
});

test("the hold button claims the touch gesture so the browser does not reinterpret it", () => {
  // Without `touch-action`, the browser may decide a held press is the start of
  // a scroll or selection gesture and cancel the touch.
  assert.match(buttonSource, /touchAction:\s*"none"/);
});

test("an interrupted touch ends the hold instead of stranding it", () => {
  // iOS fires `touchcancel`, NOT `touchend`, when the selection UI takes over.
  // Without a cancel handler the hold never ends from the UI's point of view.
  assert.match(
    buttonSource,
    /onTouchCancel={mode === "hold" \? onHoldEnd : undefined}/,
    "touchcancel must route to onHoldEnd",
  );
});
