import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveVoiceConfig, type VoiceConfig } from "@/lib/voice-config";

export const dynamic = "force-dynamic";

const CONFIG_FILE = "voice-config.json";

/** Load + validate the voice config from the repo root. Pure enough to cache per call; cheap to read. */
export function loadVoiceConfig(baseDir: string = process.cwd()): VoiceConfig {
  try {
    const raw = JSON.parse(readFileSync(join(baseDir, CONFIG_FILE), "utf8"));
    return resolveVoiceConfig(raw);
  } catch {
    // Missing/unparseable config file → clean defaults. Bad config never breaks voice.
    return resolveVoiceConfig({});
  }
}

// GET /api/voice-config — the cleaned voice config, for hot-reload in the browser.
export async function GET() {
  return NextResponse.json(loadVoiceConfig(), {
    headers: { "Cache-Control": "no-store" },
  });
}
