import { completeSimple, type AssistantMessage } from "@earendil-works/pi-ai/compat";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { synthesizeSpeech } from "@/lib/piper-tts";

const SUMMARIZER_PROVIDER = "deepseek";
const SUMMARIZER_MODEL = "deepseek-v4-flash";

/** Build the plain-spoken condensation prompt for the summarizer. */
export function buildSummarizePrompt(text: string): string {
  return [
    "You are turning a written answer into a short spoken summary.",
    "Rewrite the message below as 2-3 natural, conversational sentences — what a person would actually say out loud.",
    "Plain prose only: no markdown, no backticks, no lists, no code, no emoji.",
    "Expand acronyms. Lead with the outcome, then the single most useful thing to know.",
    "",
    "Message:",
    text,
  ].join("\n");
}

function getAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

async function summarizeForSpeech(text: string): Promise<string> {
  const modelRuntime = await ModelRuntime.create();
  const model = modelRuntime.getModel(SUMMARIZER_PROVIDER, SUMMARIZER_MODEL);
  if (!model) {
    throw new Error(`Summarizer model not found: ${SUMMARIZER_PROVIDER}/${SUMMARIZER_MODEL}`);
  }
  const resolved = await modelRuntime.getAuth(model);
  if (!resolved?.auth.apiKey) {
    throw new Error(`No API key configured for "${SUMMARIZER_PROVIDER}"`);
  }

  const message = await completeSimple(model, {
    messages: [{ role: "user", content: buildSummarizePrompt(text), timestamp: Date.now() }],
  }, {
    apiKey: resolved.auth.apiKey,
    headers: resolved.auth.headers,
    maxTokens: 400,
    timeoutMs: 30_000,
    maxRetries: 0,
    cacheRetention: "none",
  });

  if (message.stopReason === "error" || message.stopReason === "aborted") {
    throw new Error(message.errorMessage ?? "Summarization failed");
  }
  const summary = getAssistantText(message).trim();
  if (!summary) throw new Error("Summarization returned empty text");
  return summary;
}

/** Summarize the latest output into speech and return it as a WAV. */
export async function speakText(text: string, voice?: string): Promise<Uint8Array> {
  const summary = await summarizeForSpeech(text);
  return synthesizeSpeech(summary, voice);
}
