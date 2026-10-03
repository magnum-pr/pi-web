import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const drawerSource = await readFile(new URL("./MobileSettingsDrawer.tsx", import.meta.url), "utf8");
const chatInputSource = await readFile(new URL("../ChatInput.tsx", import.meta.url), "utf8");
const voiceInputSource = await readFile(new URL("../../hooks/useVoiceInput.ts", import.meta.url), "utf8");

/**
 * Mobile settings drawer.
 *
 * Holds the controls that are unreachable on `/m`: model selection (absent
 * entirely), the read-aloud speaker voice, the sticky follow-up toggle, and
 * completion sound. Opened by a button, never by a competing edge gesture.
 */

test("the drawer is opened by a button, not a second edge swipe", () => {
  assert.match(chatInputSource, /data-mobile-settings-toggle/);
  // A second competable edge gesture is how you get a panel that only sometimes
  // opens; the left edge already belongs to the session drawer.
  assert.doesNotMatch(drawerSource, /onTouchStart|onTouchMove|EDGE_ZONE/);
});

test("the closed drawer is inert, not merely translated (guards the dead-click defect)", () => {
  assert.match(drawerSource, /visibility:\s*open\s*\?\s*"visible"\s*:\s*"hidden"/);
  assert.match(drawerSource, /pointerEvents:\s*open\s*\?\s*"auto"\s*:\s*"none"/);
  assert.match(drawerSource, /data-mobile-settings-backdrop/);
});

test("the drawer never parks offscreen — it is clipped in place", () => {
  // The F15 left-drift was traced to a panel parked offscreen-left. This one
  // must stay inside the viewport at all times.
  assert.doesNotMatch(drawerSource, /translateX\(\s*-/);
  assert.doesNotMatch(drawerSource, /left:\s*-\d/);
});

test("model selection lives in the drawer and reports provider + model id", () => {
  assert.match(drawerSource, /data-mobile-settings-model/);
  assert.match(drawerSource, /onModelChange/);
  // Provider and id are carried together — a bare model id is ambiguous across
  // providers.
  assert.match(drawerSource, /provider.*::.*modelId|::/);
});

test("the read-aloud speaker voice is selectable from the drawer", () => {
  assert.match(drawerSource, /data-mobile-settings-voice/);
  assert.match(drawerSource, /onReadAloudVoiceChange/);
  assert.match(drawerSource, /readAloudVoices/);
});

test("sticky follow-up is a drawer toggle", () => {
  assert.match(drawerSource, /data-mobile-settings-sticky/);
  assert.match(drawerSource, /onStickyChange/);
});

test("sticky is a browser-local preference, so desktop and the config file are untouched", () => {
  // Server config stays the default; the local override only layers over it.
  assert.match(voiceInputSource, /pi-voice-sticky-enabled/);
  assert.match(voiceInputSource, /stickyOverride/);
  // No write path to voice-config.json was introduced.
  assert.doesNotMatch(voiceInputSource, /voice-config\.json/);
});

test("toggles state themselves in words, never by colour alone", () => {
  // Every switch renders an On/Off label rather than relying on the fill.
  assert.match(drawerSource, /"On" : "Off"|On\" : \"Off/);
  assert.match(drawerSource, /role="switch"/);
});

test("controls meet the 44pt minimum touch target", () => {
  const minHeights = drawerSource.match(/minHeight:\s*44/g) ?? [];
  assert.ok(minHeights.length >= 4, `expected several 44pt targets, found ${minHeights.length}`);
});
