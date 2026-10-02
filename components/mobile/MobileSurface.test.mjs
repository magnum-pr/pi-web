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

test("drawer rows are real buttons with a 44pt minimum touch target", () => {
  assert.match(drawerSource, /<button/);
  assert.match(drawerSource, /minHeight:\s*56/);
});
