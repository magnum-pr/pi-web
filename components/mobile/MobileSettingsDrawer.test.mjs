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

// ---------------------------------------------------------------------------
// Sections + the expanded settings surface
// ---------------------------------------------------------------------------

test("the controls are grouped into labelled sections, not one flat list", () => {
  // Four sections, each addressable, each with a visible text header. A flat
  // list is what made the previous drawer's ordering arbitrary.
  assert.match(drawerSource, /data-mobile-settings-section=\{section\}/, "sections must carry an addressable marker");
  for (const section of ["model", "audio", "voice", "advanced"]) {
    assert.match(
      drawerSource,
      new RegExp(`section="${section}"`),
      `missing the ${section} section`,
    );
  }
  assert.match(drawerSource, /<Section\b/, "sections must render through one header component, not ad-hoc markup");
});

test("reasoning sits directly beneath model, in the same section", () => {
  const model = drawerSource.indexOf("data-mobile-settings-model");
  const reasoning = drawerSource.indexOf("data-mobile-settings-reasoning");
  const audio = drawerSource.indexOf('section="audio"');
  assert.ok(model > -1 && reasoning > -1 && audio > -1, "expected all three markers to exist");
  // Model → Reasoning, and nothing from the next section in between.
  assert.ok(model < reasoning, "reasoning must follow model");
  assert.ok(reasoning < audio, "reasoning must stay in the model section, not leak into audio");
});

test("the drawer can choose the output device, where the platform supports it", () => {
  assert.match(drawerSource, /data-mobile-settings-sink/);
  assert.match(drawerSource, /onReadAloudSinkChange/);
  // Gated on the feature flag the caller already computes — the row must be
  // absent rather than broken where setSinkId is unavailable (iOS/Safari).
  assert.match(drawerSource, /readAloudSinkSupported/);
  assert.match(drawerSource, /useAudioOutputs\(\s*open\s*\)/);
});

test("hands-free listening can be switched from the drawer", () => {
  // F12: the wake-word on/off state had no phone control at all.
  assert.match(drawerSource, /data-mobile-settings-voiceenabled/);
  assert.match(drawerSource, /onVoiceEnabledChange/);
});

test("microphone source is selectable from the drawer", () => {
  assert.match(drawerSource, /data-mobile-settings-mic/);
  assert.match(drawerSource, /micMode/);
  assert.match(drawerSource, /onMicModeChange/);
  // The resolved device is shown, not just the mode label — "Automatic" alone
  // hides whether it picked the AirPods or the built-in mic.
  assert.match(drawerSource, /resolvedMicDeviceId/);
});

test("input sensitivity reuses the existing control, mounted only while open", () => {
  assert.match(drawerSource, /data-mobile-settings-sensitivity/);
  assert.match(drawerSource, /MicSensitivityControl/);
  // The meter polls at ~16fps; it must not run while the drawer is closed.
  assert.match(drawerSource, /\{open &&/, "body must be gated on open so the meter does not poll while closed");
});

test("file-level voice values are editable, but only through the override file", () => {
  // Wake/stop phrase, VAD window and the recording cap live in the server voice
  // config; the drawer patches this machine's override, never the tracked file.
  for (const key of ["wakeword", "stopphrase", "silence", "maxduration", "lapse"]) {
    assert.match(
      drawerSource,
      new RegExp(`data-mobile-settings-advanced="${key}"`),
      `missing the editable ${key} row`,
    );
  }
  assert.match(drawerSource, /onVoiceConfigChange/);
  assert.match(drawerSource, /voiceConfig/);
  // Text edits must not fire a request per keystroke.
  assert.match(drawerSource, /onBlur=/, "phrase edits must commit on blur, not on every keystroke");
});

test("the Advanced block is collapsed by default, and opens in place", () => {
  // The settings a phone user touches once must not push the everyday controls
  // off the first screen — that is what made Advanced the longest section.
  // A disclosure ROW, not a collapsed section: one boolean, and the other
  // sections keep their always-visible headers.
  assert.match(drawerSource, /data-mobile-settings-advanced-toggle="true"/);
  assert.match(drawerSource, /advancedOpen/, "the disclosure must be real state, not a CSS hide");
  // Collapsed by default: the initial value is false, never true.
  assert.match(drawerSource, /useState\(\s*false\s*\)/, "Advanced must start collapsed");
  // aria-expanded so the state is not conveyed by the chevron alone.
  assert.match(drawerSource, /aria-expanded=\{advancedOpen/);
});

test("the collapsed Advanced rows are not rendered, so no hidden control is tabbable", () => {
  // `hidden` alone still leaves focusable inputs in the a11y tree on some
  // browsers; not rendering them is the only reliable answer.
  assert.match(drawerSource, /\{advancedOpen &&/);
});

test("a failed config save is reported, not swallowed", () => {
  assert.match(drawerSource, /voiceConfigError/);
  assert.match(drawerSource, /data-mobile-settings-advanced-error/);
});

test("the drawer never touches the filesystem itself", () => {
  // The write path lives behind /api/voice-config. The UI must not import fs or
  // name a config path — if it does, the override-file boundary has been crossed.
  assert.doesNotMatch(drawerSource, /^import .*(node:fs|"fs")/m, "the drawer must not import fs");
  assert.doesNotMatch(drawerSource, /writeFileSync|writeFile\b/, "the drawer must not write files");
});
