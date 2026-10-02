import { NextResponse } from "next/server";
import { loadVoiceConfig } from "@/lib/voice-config-loader";

export const dynamic = "force-dynamic";

// GET /api/voice-config — the cleaned voice config, for hot-reload in the browser.
export async function GET() {
  return NextResponse.json(loadVoiceConfig(), {
    headers: { "Cache-Control": "no-store" },
  });
}
