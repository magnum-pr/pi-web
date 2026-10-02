import { NextResponse } from "next/server";
import { PiperError } from "@/lib/piper-tts";
import { speakText } from "@/lib/speech-summary";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const MAX_INPUT_CHARS = 50_000;

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  let body: { text?: unknown; voice?: unknown };
  try {
    body = (await req.json()) as { text?: unknown; voice?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  if (text.length > MAX_INPUT_CHARS) {
    return NextResponse.json({ error: `text exceeds ${MAX_INPUT_CHARS} characters` }, { status: 400 });
  }
  const voice = typeof body.voice === "string" && body.voice.trim() ? body.voice.trim() : undefined;

  try {
    const wav = await speakText(text, voice);
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
    const status = error instanceof PiperError ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
