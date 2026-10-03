"use client";

import type { VoiceInputPhase } from "@/hooks/useVoiceInput";
import { voicePresentation } from "@/lib/mobile-voice-state";

export type VoiceMode = "wake" | "hold";

interface Props {
  phase: VoiceInputPhase;
  enabled: boolean;
  dead: boolean;
  mode: VoiceMode;
  onModeChange: (mode: VoiceMode) => void;
  /** Tap, `wake` mode only: enable/disable, or resume after a dead capture. */
  onToggle: () => void;
  /** Hold-to-talk, `hold` mode only. */
  onHoldStart: () => void;
  onHoldEnd: () => void;
}

/**
 * The mobile voice pill — the primary control on the phone surface.
 *
 * Replaces the desktop's seven-control strip (Stop, voice id, sink, wake word,
 * dictate, sound, collapse) with one control, and promotes it out of the "More
 * controls" disclosure it was buried in (findings F1/F2).
 *
 * Two rules it exists to enforce:
 *   1. **State is never colour alone** (F3 — the desktop already computes four
 *      phase colours, but communicates them only via colour and a `title`
 *      tooltip, and touch devices have no tooltips). The label is always
 *      rendered, and `aria-live` announces changes.
 *   2. **A dead capture must never look alive** (AC-4). `dead` overrides the
 *      optimistic phase label.
 *
 * Minimum target is 44pt; the pill is 48pt tall and sits above the safe area.
 */
export function MobileVoiceButton({
  phase,
  enabled,
  dead,
  mode,
  onModeChange,
  onToggle,
  onHoldStart,
  onHoldEnd,
}: Props) {
  const p = voicePresentation(phase, { dead, enabled });

  // In `hold` mode the resting/armed wording is a lie: nothing is listening for
  // the wake word, the pill is waiting to be pressed. Say what the gesture does.
  const holdIdle = mode === "hold" && (p.state === "off" || p.state === "armed" || p.state === "working");
  const label = holdIdle ? "Hold to talk" : p.label;
  const state = holdIdle ? "off" : p.state;

  return (
    <div
      data-mobile-voice="true"
      data-mobile-voice-state={state}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        paddingBottom: "calc(8px + env(safe-area-inset-bottom))",
        borderTop: "1px solid var(--border)",
        background: "var(--bg-panel)",
      }}
    >
      {/*
        In `hold` mode the tap handler is deliberately NOT bound. `onClick`
        fires on release as well as on a tap, so leaving it attached ran the
        toggle straight after the hold ended — which re-enabled the mic and left
        it running despite the label (F17).
      */}
      <button
        type="button"
        data-mobile-voice-button="true"
        aria-label={label}
        aria-pressed={mode === "hold" ? p.state === "recording" : enabled}
        onClick={mode === "hold" ? undefined : onToggle}
        onTouchStart={mode === "hold" ? onHoldStart : undefined}
        onTouchEnd={mode === "hold" ? onHoldEnd : undefined}
        onMouseDown={mode === "hold" ? onHoldStart : undefined}
        onMouseUp={mode === "hold" ? onHoldEnd : undefined}
        onMouseLeave={mode === "hold" ? onHoldEnd : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flex: 1,
          minWidth: 0,
          minHeight: 48,
          padding: "0 14px",
          background: "var(--bg)",
          border: `1px solid ${p.tone}`,
          borderRadius: 24,
          color: "var(--text)",
          cursor: "pointer",
          transition: "border-color 0.15s ease, background 0.15s ease",
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke={p.tone}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ flexShrink: 0 }}
        >
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
          <line x1="12" y1="18" x2="12" y2="22" />
        </svg>
        <span
          data-mobile-voice-label="true"
          aria-live="polite"
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 13,
            fontWeight: 600,
            color: p.state === "armed" || p.state === "working" ? "var(--text-muted)" : "var(--text)",
          }}
        >
          {label}
        </span>
      </button>

      {/* Mode chip — the crowded-room case is an in-the-moment change, so it
          must not require a trip to Settings (decision 10). */}
      <button
        type="button"
        data-mobile-voice-mode={mode}
        aria-label={`Voice mode: ${mode === "wake" ? "wake word" : "hold to talk"}. Tap to switch.`}
        onClick={() => onModeChange(mode === "wake" ? "hold" : "wake")}
        style={{
          minWidth: 64,
          minHeight: 48,
          padding: "0 12px",
          background: "none",
          border: "1px solid var(--border)",
          borderRadius: 24,
          color: "var(--text-muted)",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        {mode === "wake" ? "Wake" : "Hold"}
      </button>
    </div>
  );
}
