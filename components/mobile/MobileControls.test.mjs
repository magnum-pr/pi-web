import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const chatInputSource = await readFile(new URL("../ChatInput.tsx", import.meta.url), "utf8");
const drawerSource = await readFile(new URL("./MobileSettingsDrawer.tsx", import.meta.url), "utf8");
const headerSource = await readFile(new URL("../ProjectStateHeader.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../../app/globals.css", import.meta.url), "utf8");

/**
 * Mobile stop control, the hidden cost bar, and the reasoning-level row.
 */

test("stop is on the pill row and only while a turn is running", () => {
  // Placed with the voice pill, NOT in the settings drawer: a runaway agent must
  // be stoppable in one tap, without opening a panel.
  assert.match(chatInputSource, /data-mobile-stop/);
  // Same condition as the desktop button.
  assert.match(chatInputSource, /\{isStreaming && onAbort && \(/);
});

test("stop reuses the desktop abort handler so a stopped turn is not read aloud", () => {
  const block = chatInputSource.slice(chatInputSource.indexOf("data-mobile-stop"));
  // The handler is `onAbort` — the one ChatWindow wires to its read-aloud-aware
  // abort, not a raw RPC cancel.
  assert.match(block, /onClick=\{onAbort\}/);
});

test("stop carries a word, not a bare glyph", () => {
  const block = chatInputSource.slice(chatInputSource.indexOf("data-mobile-stop"));
  assert.match(block, /\{t\("chat\.stop"\)\}/);
  assert.match(block, /minWidth:\s*\d+/);
});

test("the cost/context bar is hidden on mobile by CSS, matching the metrics gate", () => {
  // A class hook is required — the element is inline-styled, which is why the
  // existing `.chat-stats-center` rule never caught it.
  assert.match(headerSource, /className="project-state-stats"/);
  const block = cssSource.slice(cssSource.indexOf(".project-state-stats"));
  assert.match(block, /display:\s*none\s*!important/);
  // It must sit inside a max-width media query, or it hides on desktop too.
  const mediaIdx = cssSource.lastIndexOf("@media (max-width: 640px)", cssSource.indexOf(".project-state-stats"));
  assert.notEqual(mediaIdx, -1, ".project-state-stats must be inside a max-width: 640px block");
});

test("the project-state header itself is kept — only the numbers are hidden", () => {
  // The header carries phases and open questions, which are useful on a phone.
  assert.doesNotMatch(headerSource, /project-state-header[^"]*"[^>]*display:\s*"none"/);
});

test("reasoning level is offered in the drawer", () => {
  assert.match(drawerSource, /data-mobile-settings-reasoning/);
  assert.match(drawerSource, /onThinkingLevelChange/);
});

test("reasoning options are filtered by what the model supports, keeping auto", () => {
  // Mirrors the desktop filter exactly: `auto` is always offered, everything
  // else only when the current model advertises it.
  assert.match(drawerSource, /availableThinkingLevels/);
  assert.match(drawerSource, /lvl === "auto"\) return true/);
});
