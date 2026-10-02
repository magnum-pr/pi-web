import { resolveVoiceConfig, type VoiceConfig } from "@/lib/voice-config";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CONFIG_FILE = "voice-config.json";

/**
 * Load + validate the voice config from the repo root.
 *
 * Lives in `lib/` rather than the route module: Next.js generates route types
 * that only permit HTTP-verb exports plus a small allowlist, so any other
 * export from an `app/**\/route.ts` fails the production build's type check.
 */
export function loadVoiceConfig(baseDir: string = process.cwd()): VoiceConfig {
  try {
    const raw = JSON.parse(readFileSync(join(baseDir, CONFIG_FILE), "utf8"));
    return resolveVoiceConfig(raw);
  } catch {
    // Missing/unparseable config file → clean defaults. Bad config never breaks voice.
    return resolveVoiceConfig({});
  }
}
