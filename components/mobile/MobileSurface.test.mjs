import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestSource = await readFile(new URL("../../app/manifest.ts", import.meta.url), "utf8");
const homeSource = await readFile(new URL("../../app/page.tsx", import.meta.url), "utf8");
const shellSource = await readFile(new URL("./MobileShell.tsx", import.meta.url), "utf8");
const drawerSource = await readFile(new URL("./MobileSessionDrawer.tsx", import.meta.url), "utf8");
const chatWindowSource = await readFile(new URL("../ChatWindow.tsx", import.meta.url), "utf8");

test("manifest launches the installed app straight into the mobile surface", () => {
  assert.match(manifestSource, /start_url:\s*"\/m"/);
  // Scope must still cover the mobile route.
  assert.match(manifestSource, /scope:\s*"\/"/);
});

test("the desktop route redirects phones to /m without bouncing desktops", () => {
  assert.match(homeSource, /isMobileUserAgent/);
  assert.match(homeSource, /redirect\("\/m"\)/);
  // Detection is by user agent, not viewport width — a narrow desktop window
  // must keep the desktop UI.
  assert.doesNotMatch(homeSource, /max-width|matchMedia/);
});

test("the mobile shell inherits the shared viewport plumbing instead of reimplementing it", () => {
  // Uses the shared variable and the safe-area insets rather than inventing a
  // second keyboard/viewport mechanism.
  assert.match(shellSource, /--app-viewport-height/);
  assert.match(shellSource, /env\(safe-area-inset-top\)/);
  assert.match(shellSource, /env\(safe-area-inset-left\)/);
  assert.match(shellSource, /env\(safe-area-inset-right\)/);
  // The bottom inset is handled by the inherited ChatWindow, not re-done here.
  assert.doesNotMatch(shellSource, /useViewportHeight\(\)/);
  assert.match(chatWindowSource, /paddingBottom: "env\(safe-area-inset-bottom\)"/);
  // Bottom is still respected somewhere on the mobile path.
  assert.match(drawerSource, /env\(safe-area-inset-bottom\)/);
});

test("the drawer opens from a button and the LEFT edge only", () => {
  assert.match(shellSource, /data-mobile-drawer-toggle/);
  assert.match(shellSource, /EDGE_ZONE_PX/);
  // No right-edge handling: the right edge stays free so a browser tab's back
  // gesture can never conflict.
  assert.doesNotMatch(shellSource, /clientX\s*>=\s*window\.innerWidth/);
});

test("the closed drawer is inert, not merely translated (guards the dead-click defect)", () => {
  assert.match(drawerSource, /visibility:\s*open\s*\?\s*"visible"\s*:\s*"hidden"/);
  assert.match(drawerSource, /pointerEvents:\s*open\s*\?\s*"auto"\s*:\s*"none"/);
  assert.match(drawerSource, /data-mobile-drawer/);
  assert.match(drawerSource, /data-mobile-drawer-backdrop/);
});

test("no drawer element hardcodes pointer-events: none", () => {
  // REGRESSION GUARD (owner-reported 2026-10-04: "I hit the button but then it
  // just closes the left side drawer").
  //
  // The previous test above passed the whole time this bug was live, because it
  // only asserted that the *pattern* `open ? "auto" : "none"` appears SOMEWHERE
  // in the file — and it does, on the backdrop. Meanwhile the clip window and the
  // <aside> hardcoded `pointerEvents: "none"`, so every button inside the drawer
  // was unclickable: taps fell through to the shell header underneath, whose
  // handler closed the drawer.
  //
  // This is the GL-021 failure mode in its purest form: the assertion checked
  // that a string existed, not that the interactive elements were interactive.
  //
  // A closed drawer must be inert, but that MUST be expressed conditionally. A
  // literal `none` on a container is never correct.
  const hardcoded = [...drawerSource.matchAll(/pointerEvents:\s*"none"/g)];
  assert.equal(
    hardcoded.length,
    0,
    `found ${hardcoded.length} hardcoded pointerEvents: "none" — a container that holds buttons must use open ? "auto" : "none"`,
  );
});

test("every element that holds drawer controls becomes interactive when open", () => {
  // The structural version of the guard above: count conditional pointerEvents
  // rather than literals. The drawer has two interactive layers (the clip window
  // and the aside); both must gate on `open`.
  const conditional = [...drawerSource.matchAll(/pointerEvents:\s*open\s*\?\s*"auto"\s*:\s*"none"/g)];
  assert.ok(
    conditional.length >= 3,
    `expected the backdrop AND both drawer layers to gate on open, found ${conditional.length}`,
  );
});

test("the new-chat control is reachable (its handler must not be pre-empted by a parent)", () => {
  // The specific symptom: pressing "+ New" did nothing and closed the drawer.
  // The button exists and has a handler; the failure was pointer-events on an
  // ancestor. Assert the control is a real button that reports its expanded
  // state, so a future refactor cannot quietly unmake it.
  assert.match(drawerSource, /data-mobile-new-chat="true"/);
  assert.match(drawerSource, /aria-expanded=\{newChatOpen\}/);
  assert.match(drawerSource, /data-mobile-project-list/);
});

test("drawer rows are real buttons with a 44pt minimum touch target", () => {
  assert.match(drawerSource, /<button/);
  assert.match(drawerSource, /minHeight:\s*56/);
});
