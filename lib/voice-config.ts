/**
 * Voice config — the cleaned, dependency-free subset of the whisper-vtt
 * schema that maps onto Pi-Web's browser dictation. Everything Pi-Web's
 * voice needs and nothing it doesn't (no hotkey / output modes / paste
 * target / compile sessions / drop box).
 *
 * Pure module (no `node:*`, no React) so it is unit-testable under
 * `node --test` and its `VoiceConfig` type is safe to import in browser
 * code (`hooks/useVoiceInput.ts`).
 */

export interface VoiceConfig {
  wakeWord: {
    /** Spoken phrase that arms recording. */
    phrase: string;
    /** PocketSphinx sensitivity — lower = stricter (fewer false triggers). */
    threshold: number;
    /** Play a short spoken ack when the wake word is heard (e.g. "Yes?"). */
    ackEnabled: boolean;
    /** The ack phrase to speak (via piper TTS). */
    ack: string;
  };
  vad: {
    /** Auto-stop after this much continuous quiet, in ms. */
    silenceMs: number;
    /** Static silence floor (dB) used until the noise floor calibrates. */
    volumeDb: number;
    /** Silence line = ambient noise floor + this margin (dB). */
    calibrationMarginDb: number;
  };
  recording: {
    /** Hard cap so a stuck recording can't run forever, in seconds. */
    maxDurationS: number;
  };
  sticky: {
    /** Stay armed for follow-ups after a turn (no repeat wake word). */
    enabled: boolean;
    /** How long the follow-up onset window stays open, in seconds. */
    lapseS: number;
    /** Speech onset triggers a follow-up when audio exceeds floor + this (dB). */
    onsetDb: number;
  };
}

export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  wakeWord: { phrase: "jarvis", threshold: 1e-20, ackEnabled: true, ack: "Yes?" },
  vad: { silenceMs: 3000, volumeDb: -28.0, calibrationMarginDb: 6.0 },
  recording: { maxDurationS: 45 },
  sticky: { enabled: true, lapseS: 20, onsetDb: 6.0 },
};

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isBool = (v: unknown): v is boolean => typeof v === "boolean";

function clampNum(v: unknown, fallback: number, min: number, max: number): number {
  if (!isNum(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function pick<T>(v: unknown, fallback: T, check: (x: unknown) => x is T): T {
  return check(v) ? v : fallback;
}

/**
 * Merge an unknown (partial, possibly hand-edited) config object onto the
 * defaults. Invalid/missing values fall back to defaults — a bad config
 * never throws, mirroring whisper-vtt's "invalid config warns, never crashes".
 */
export function resolveVoiceConfig(raw: unknown): VoiceConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const wake = (r.wakeWord && typeof r.wakeWord === "object" ? r.wakeWord : {}) as Record<string, unknown>;
  const vad = (r.vad && typeof r.vad === "object" ? r.vad : {}) as Record<string, unknown>;
  const rec = (r.recording && typeof r.recording === "object" ? r.recording : {}) as Record<string, unknown>;
  const sticky = (r.sticky && typeof r.sticky === "object" ? r.sticky : {}) as Record<string, unknown>;

  return {
    wakeWord: {
      phrase: pick(wake.phrase, DEFAULT_VOICE_CONFIG.wakeWord.phrase, isStr),
      threshold: clampNum(wake.threshold, DEFAULT_VOICE_CONFIG.wakeWord.threshold, 1e-40, 1),
      ackEnabled: pick(wake.ackEnabled, DEFAULT_VOICE_CONFIG.wakeWord.ackEnabled, isBool),
      ack: pick(wake.ack, DEFAULT_VOICE_CONFIG.wakeWord.ack, isStr),
    },
    vad: {
      silenceMs: clampNum(vad.silenceMs, DEFAULT_VOICE_CONFIG.vad.silenceMs, 500, 15000),
      volumeDb: clampNum(vad.volumeDb, DEFAULT_VOICE_CONFIG.vad.volumeDb, -80, -20),
      calibrationMarginDb: clampNum(
        vad.calibrationMarginDb,
        DEFAULT_VOICE_CONFIG.vad.calibrationMarginDb,
        0,
        30,
      ),
    },
    recording: {
      maxDurationS: clampNum(rec.maxDurationS, DEFAULT_VOICE_CONFIG.recording.maxDurationS, 5, 600),
    },
    sticky: {
      enabled: pick(sticky.enabled, DEFAULT_VOICE_CONFIG.sticky.enabled, isBool),
      lapseS: clampNum(sticky.lapseS, DEFAULT_VOICE_CONFIG.sticky.lapseS, 1, 300),
      onsetDb: clampNum(sticky.onsetDb, DEFAULT_VOICE_CONFIG.sticky.onsetDb, 0, 30),
    },
  };
}
