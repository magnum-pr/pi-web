import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { shouldUseVisualViewportHeight } = await jiti.import("./useViewportHeight.ts");

test("uses the visual viewport for a focused editor when the keyboard shrinks it", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    innerHeight: 844,
    viewportHeight: 510,
    viewportScale: 1,
  }), true);
});

test("does not keep the keyboard height after the visual viewport restores", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    innerHeight: 844,
    viewportHeight: 844,
    viewportScale: 1,
  }), false);
});

test("restores the dynamic height as soon as the editor loses focus", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: false,
    innerHeight: 844,
    viewportHeight: 510,
    viewportScale: 1,
  }), false);
});

// The old form of this test asserted `false` for a focused editor at
// viewportScale 2. That is the exact state iOS focus-zoom produces, so the
// assertion was encoding the F15 self-lockout rather than a requirement. What
// must stay true is that a pinch with **no editor focused** is not a keyboard.
test("does not turn a bare pinch into a keyboard height (no editor focused)", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: false,
    innerHeight: 844,
    viewportHeight: 422,
    viewportScale: 2,
  }), false);
});

// F15: iOS focus-zoom. Tapping the composer magnifies the page because the
// shell is a fixed 100dvh box with `overflow: hidden`, so Safari cannot scroll
// the composer above the keyboard and zooms instead. Once it has zoomed,
// `viewport.scale !== 1` — and the resize must still fire, or the shell never
// shrinks and the zoom is never relieved.
test("relieves the iOS focus zoom: editor focused, viewport reduced AND scaled", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    innerHeight: 844,
    viewportHeight: 422,
    viewportScale: 1.4,
  }), true);
});

test("keeps the dynamic viewport height when the visual viewport is not reduced", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    innerHeight: 844,
    viewportHeight: 844,
    viewportScale: 1,
  }), false);
});
