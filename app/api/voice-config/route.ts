import { NextResponse } from "next/server";
import { loadVoiceConfig } from "@/lib/voice-config-loader";
import { writeVoiceOverride } from "@/lib/voice-config-store";

export const dynamic = "force-dynamic";

/** GET /api/voice-config — the resolved voice config, for hot-reload in the browser. */
export async function GET() {
  return NextResponse.json(loadVoiceConfig(), {
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * PUT /api/voice-config — patch this machine's voice-config override.
 *
 * Writes `~/.pi/agent/voice-config.json`, never the repo's tracked
 * `voice-config.json`: the tracked file is shared with the PocketSphinx bridge
 * and the whisper pipeline, and letting a phone edit it would produce
 * uncommitted diffs in a file that is supposed to be authored deliberately.
 *
 * Values are *clamped*, not rejected. `resolveVoiceConfig` already owns the
 * bounds, so a request that names an out-of-range number gets the nearest legal
 * value rather than a 400 — the same tolerance the resolver applies to a
 * hand-edited file. Only a structurally invalid body fails.
 */
export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Expected an object" }, { status: 400 });
  }

  try {
    writeVoiceOverride(body as Record<string, Record<string, unknown>>);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }

  // Return the resolved result so the caller can render what actually took
  // effect — which may differ from what it sent, because of the clamps.
  //
  // Deliberately no filesystem path in the response: the write target is a
  // server-side detail and disclosing it hands every authed caller the server's
  // absolute home directory for no benefit.
  return NextResponse.json({ success: true, config: loadVoiceConfig() });
}
