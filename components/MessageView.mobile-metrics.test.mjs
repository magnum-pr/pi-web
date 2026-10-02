import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const messageView = await readFile(new URL("./MessageView.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("the per-turn metrics line is tagged so it can be hidden per-surface", () => {
  assert.match(messageView, /className="message-usage"/);
  // The function itself stays pure — the gate lives at the render site / CSS,
  // not inside formatUsage.
  assert.match(messageView, /function formatUsage\(/);
});

test("metrics are hidden on the mobile breakpoint", () => {
  const block = css.match(/@media \(max-width: 640px\) \{[\s\S]*?\n\}/g) ?? [];
  const hidesUsage = block.some((b) => /\.message-usage\s*\{[^}]*display:\s*none\s*!important/.test(b));
  assert.ok(hidesUsage, "`.message-usage` must be display:none at <=640px");
});
