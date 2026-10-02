import { NextResponse } from "next/server";
import { transcribeWav, WhisperError } from "@/lib/whisper-server";
import { isApiRequestAllowed } from "@/lib/request-security";
import { isWav } from "@/lib/wav";

const MAX_WAV_BYTES = 50 * 1024 * 1024; // 50MB guard

// POST /api/transcribe — raw WAV body (16kHz mono PCM) → { text }.
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  let wav: Uint8Array;
  try {
    wav = new Uint8Array(await req.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "Invalid audio body" }, { status: 400 });
  }

  if (!isWav(wav)) {
    return NextResponse.json({ error: "Expected WAV audio" }, { status: 400 });
  }
  if (wav.byteLength > MAX_WAV_BYTES) {
    return NextResponse.json({ error: "Audio too large" }, { status: 413 });
  }

  try {
    const text = await transcribeWav(wav);
    return NextResponse.json({ text });
  } catch (error) {
    const message = error instanceof WhisperError ? error.message : "Transcription failed";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
