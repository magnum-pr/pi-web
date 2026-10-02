import type { VoiceInputPhase } from "@/hooks/useVoiceInput";

/** The state the mobile voice pill renders. */
export type VoiceUiState = "off" | "armed" | "recording" | "sticky" | "working" | "transcribing" | "dead";

/** How the pill should present a given state. */
export interface VoicePresentation {
  state: VoiceUiState;
  /** Text label — the state must be legible WITHOUT colour and WITHOUT hover. */
  label: string;
  /** Resting states render compact; states the user must notice render expanded. */
  compact: boolean;
  /** Accent colour token. Never the sole carrier of meaning. */
  tone: string;
  /** True when tapping should (re)start listening rather than stop. */
  promptsTapToResume: boolean;
}

export const WAKE_WORD = "Oracle";

const PRESENTATIONS: Record<VoiceUiState, Omit<VoicePresentation, "state">> = {
  off: {
    label: "Voice off — tap to enable",
    compact: true,
    tone: "var(--text-dim)",
    promptsTapToResume: true,
  },
  armed: {
    label: `Listening for "${WAKE_WORD}"`,
    compact: true,
    tone: "var(--accent)",
    promptsTapToResume: false,
  },
  recording: {
    label: "Listening…",
    compact: false,
    tone: "#e01a4f",
    promptsTapToResume: false,
  },
  sticky: {
    label: "Speak now",
    compact: false,
    tone: "#e0a11a",
    promptsTapToResume: false,
  },
  transcribing: {
    label: "Transcribing…",
    compact: false,
    tone: "var(--accent)",
    promptsTapToResume: false,
  },
  working: {
    label: "Working…",
    compact: true,
    tone: "var(--text-dim)",
    promptsTapToResume: false,
  },
  dead: {
    label: "Not listening — tap to resume",
    compact: false,
    tone: "#e0a11a",
    promptsTapToResume: true,
  },
};

/**
 * Map the voice hook's phase (+ the dead-capture latch) to what the phone shows.
 *
 * `dead` wins over every phase: the proven iOS failure is that the hook still
 * believes it is `armed`/`recording` while nothing is captured, so the honest
 * label must override the optimistic one.
 */
export function voicePresentation(phase: VoiceInputPhase, opts: { dead?: boolean; enabled?: boolean } = {}): VoicePresentation {
  const enabled = opts.enabled ?? true;
  if (!enabled) return { state: "off", ...PRESENTATIONS.off };
  if (opts.dead) return { state: "dead", ...PRESENTATIONS.dead };

  const state: VoiceUiState =
    phase === "idle"
      ? "off"
      : phase === "armed"
        ? "armed"
        : phase === "recording"
          ? "recording"
          : phase === "sticky"
            ? "sticky"
            : phase === "transcribing"
              ? "transcribing"
              : "working";

  return { state, ...PRESENTATIONS[state] };
}
