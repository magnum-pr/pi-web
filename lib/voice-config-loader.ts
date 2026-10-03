import { resolveVoiceConfig, type VoiceConfig } from "@/lib/voice-config";
import { mergeVoiceConfigs, readVoiceOverride } from "@/lib/voice-config-store";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CONFIG_FILE = "voice-config.json";

/**
 * Load + validate the voice config from the repo root, then layer the
 * machine-local override on top.
 *
 * Lives in `lib/` rather than the route module: Next.js generates route types
 * that only permit HTTP-verb exports plus a small allowlist, so any other
 * export from an `app/**\/route.ts` fails the production build's type check.
 *
 * The repo file is the tracked base and is only ever read. Anything this
 * machine sets for itself lives in `~/.pi/agent/voice-config.json` (see
 * `voice-config-store`) and is merged here, so every consumer — including the
 * browser's `useVoiceInput` — receives one already-resolved object and needs no
 * knowledge of the layering.
 */
export function loadVoiceConfig(baseDir: string = process.cwd()): VoiceConfig {
  let base: VoiceConfig;
  try {
    const raw = JSON.parse(readFileSync(join(baseDir, CONFIG_FILE), "utf8"));
    base = resolveVoiceConfig(raw);
  } catch {
    // Missing/unparseable config file → clean defaults. Bad config never breaks voice.
    base = resolveVoiceConfig({});
  }

  try {
    return mergeVoiceConfigs(base, readVoiceOverride());
  } catch {
    // An unreadable override must not take the base config down with it.
    return base;
  }
}
