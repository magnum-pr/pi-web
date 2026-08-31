import { NextResponse } from "next/server";
import { synthesizeSpeech, PiperError } from "@/lib/piper-tts";
import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const MAX_ACK_CHARS = 100;

// GET /api/speak/ack?text=Yes%3F[&voice=…] — short piper TTS for wake-word
// acknowledgements and other lightweight cues. No summarizer pass (unlike
// /api/speak), so it's instant and needs no model API key.
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  const url = new URL(req.url);
  const text = url.searchParams.get("text")?.trim() || "Yes?";
  if (text.length > MAX_ACK_CHARS) {
    return NextResponse.json({ error: "ack text too long" }, { status: 400 });
  }
  const voice = url.searchParams.get("voice")?.trim() || undefined;

  try {
    const wav = await synthesizeSpeech(text, voice);
    return new NextResponse(wav as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(wav.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: message },
      { status: error instanceof PiperError ? 503 : 500 },
    );
  }
}
