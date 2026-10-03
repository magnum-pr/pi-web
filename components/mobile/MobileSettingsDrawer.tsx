"use client";

import { useState } from "react";

export interface MobileSettingsModelOption {
  provider: string;
  modelId: string;
  name: string;
}

/** Same set the desktop selector offers, including `auto`. */
const THINKING_LEVELS = ["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
/** Matches ChatInput's own prop type so the handler can be passed straight through. */
type ThinkingLevel = (typeof THINKING_LEVELS)[number];

interface Props {
  open: boolean;
  onClose: () => void;

  // Model selection — the reason this drawer exists. `/m` has no model control
  // anywhere else (the composer's left cluster does not render on mobile).
  model?: { provider: string; modelId: string } | null;
  modelOptions: MobileSettingsModelOption[];
  onModelChange?: (provider: string, modelId: string) => void;
  modelSwitching?: boolean;

  // Read-aloud: on/off plus the piper voice that reads replies.
  readAloudEnabled?: boolean;
  onReadAloudToggle?: () => void;
  readAloudVoices?: string[];
  readAloudVoice?: string;
  onReadAloudVoiceChange?: (voice: string) => void;

  // Sticky follow-up. Browser-local on mobile; the desktop and the server
  // config file are deliberately unaffected.
  stickyEnabled: boolean;
  onStickyChange: (enabled: boolean) => void;

  // Reasoning / thinking level.
  thinkingLevel?: ThinkingLevel;
  onThinkingLevelChange?: (level: ThinkingLevel) => void;
  /** Levels this model actually supports; null = don't filter. */
  availableThinkingLevels?: string[] | null;
  /** Provider-specific display names for a level (e.g. "xhigh" → "Extra high"). */
  thinkingLevelMap?: Record<string, string | null> | null;

  // Completion sound. When the caller supplies the props they win; otherwise
  // the drawer owns the same `pi-sound-enabled` preference the desktop
  // `useAudio` hook reads, so the setting stays consistent across surfaces
  // without drilling a second copy of the hook through the mobile shell.
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
}

const SOUND_KEY = "pi-sound-enabled";

/**
 * Right-hand settings drawer for the mobile surface.
 *
 * Reached from a ⚙ button in the shell header — there is deliberately **no edge
 * swipe**. The left edge already owns one gesture (the session drawer), and iOS
 * claims part of that edge in a browser tab; a second competable edge gesture is
 * how you get a panel that only sometimes opens. A button cannot be swallowed.
 *
 * Built **inert when closed**, like the session drawer: `visibility` +
 * `pointer-events`, never a bare transform transition. A closed panel must not
 * be hit-testable, or it swallows taps (the F13/D1 dead-click defect).
 *
 * Nothing here is desktop-affecting: every control maps to state the mobile
 * tree already owns.
 */
export function MobileSettingsDrawer({
  open,
  onClose,
  model,
  modelOptions,
  onModelChange,
  modelSwitching = false,
  readAloudEnabled,
  onReadAloudToggle,
  readAloudVoices,
  readAloudVoice,
  onReadAloudVoiceChange,
  stickyEnabled,
  onStickyChange,
  thinkingLevel,
  onThinkingLevelChange,
  availableThinkingLevels,
  thinkingLevelMap,
  soundEnabled,
  onSoundToggle,
}: Props) {
  // Fall back to the shared preference when no props are supplied (`/m` renders
  // ChatWindow without the AppShell-owned audio pair).
  const [localSound, setLocalSound] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      return localStorage.getItem(SOUND_KEY) !== "false";
    } catch {
      return true;
    }
  });
  const soundOn = soundEnabled ?? localSound;
  const toggleSound = () => {
    if (onSoundToggle) {
      onSoundToggle();
      return;
    }
    setLocalSound((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SOUND_KEY, String(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };
  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "12px 0",
    borderBottom: "1px solid var(--border)",
  };
  const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "var(--text)" };
  const hintStyle: React.CSSProperties = { fontSize: 11, color: "var(--text-dim)", marginTop: 2, lineHeight: 1.35 };
  const selectStyle: React.CSSProperties = {
    maxWidth: 170,
    minHeight: 44,
    padding: "0 8px",
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    color: "var(--text)",
    fontSize: 13,
    cursor: "pointer",
  };

  return (
    <>
      <div
        data-mobile-settings-backdrop={open ? "open" : "closed"}
        onClick={onClose}
        aria-hidden={!open}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 199,
          background: "rgba(0,0,0,0.45)",
          opacity: open ? 1 : 0,
          // Set together, neither animated: the backdrop can never be
          // interactive while invisible, nor invisible while blocking.
          pointerEvents: open ? "auto" : "none",
          visibility: open ? "visible" : "hidden",
          transition: "opacity 0.2s ease, visibility 0.2s ease",
        }}
      />

      <aside
        data-mobile-settings={open ? "open" : "closed"}
        aria-hidden={!open}
        aria-label="Settings"
        style={{
          position: "fixed",
          top: 0,
          bottom: 0,
          // Anchored to the RIGHT edge. Parked flush (no negative offset) so no
          // element is ever offscreen — the F15 left-drift was traced to an
          // offscreen-parked panel, so this one never leaves the viewport.
          right: 0,
          zIndex: 200,
          width: "min(88vw, 340px)",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-panel)",
          borderLeft: "1px solid var(--border)",
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
          paddingRight: "env(safe-area-inset-right)",
          // The load-bearing line: closed means not hit-testable and out of the
          // a11y tree.
          visibility: open ? "visible" : "hidden",
          pointerEvents: open ? "auto" : "none",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "12px 12px 8px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <strong style={{ fontSize: 15, letterSpacing: "-0.01em" }}>Settings</strong>
          <button
            type="button"
            data-mobile-settings-close="true"
            onClick={onClose}
            aria-label="Close settings"
            style={{
              minWidth: 44,
              minHeight: 44,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: 10,
              color: "var(--text)",
              fontSize: 16,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: "0 12px 12px", overflowY: "auto" }}>
          {/* Model */}
          {(modelOptions.length > 0 || model) && onModelChange && (
            <div style={rowStyle}>
              <span>
                <span style={labelStyle}>Model</span>
                <span style={{ ...hintStyle, display: "block" }}>
                  {modelSwitching ? "Switching…" : "Which model answers"}
                </span>
              </span>
              <select
                data-mobile-settings-model="true"
                aria-label="Model"
                value={model ? `${model.provider}::${model.modelId}` : ""}
                disabled={modelSwitching}
                onChange={(e) => {
                  const [provider, modelId] = e.target.value.split("::");
                  if (provider && modelId) onModelChange(provider, modelId);
                }}
                style={selectStyle}
              >
                {modelOptions.map((m) => (
                  <option key={`${m.provider}::${m.modelId}`} value={`${m.provider}::${m.modelId}`}>
                    {m.name || m.modelId}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Read-aloud on/off */}
          {onReadAloudToggle !== undefined && (
            <div style={rowStyle}>
              <span>
                <span style={labelStyle}>Read replies aloud</span>
                <span style={{ ...hintStyle, display: "block" }}>Speak the summary when a turn finishes</span>
              </span>
              <button
                type="button"
                data-mobile-settings-readaloud="true"
                role="switch"
                aria-checked={readAloudEnabled ? "true" : "false"}
                aria-label="Read replies aloud"
                onClick={onReadAloudToggle}
                style={{
                  minWidth: 64,
                  minHeight: 44,
                  padding: "0 12px",
                  background: readAloudEnabled ? "var(--accent)" : "none",
                  border: `1px solid ${readAloudEnabled ? "var(--accent)" : "var(--border)"}`,
                  borderRadius: 22,
                  // Text, not colour alone — the state must be legible without
                  // relying on the fill.
                  color: readAloudEnabled ? "#0b1220" : "var(--text-muted)",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {readAloudEnabled ? "On" : "Off"}
              </button>
            </div>
          )}

          {/* Read-aloud voice — the piper speaker voice. */}
          {(readAloudVoices?.length ?? 0) > 0 && onReadAloudVoiceChange !== undefined && (
            <div style={rowStyle}>
              <span>
                <span style={labelStyle}>Speaking voice</span>
                <span style={{ ...hintStyle, display: "block" }}>Voice used for read-aloud</span>
              </span>
              <select
                data-mobile-settings-voice="true"
                aria-label="Speaking voice"
                value={readAloudVoice ?? ""}
                onChange={(e) => onReadAloudVoiceChange(e.target.value)}
                style={selectStyle}
              >
                {readAloudVoices!.map((v) => (
                  <option key={v} value={v}>
                    {v.replace(/^en_US-/, "").replace(/-medium$/, "")}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Reasoning level. Mirrors the desktop filter exactly: a level is
              offered when the model supports it, and `auto` is always kept. */}
          {onThinkingLevelChange !== undefined && (
            <div style={rowStyle}>
              <span>
                <span style={labelStyle}>Reasoning</span>
                <span style={{ ...hintStyle, display: "block" }}>How hard the model thinks before answering</span>
              </span>
              <select
                data-mobile-settings-reasoning="true"
                aria-label="Reasoning level"
                value={thinkingLevel ?? "auto"}
                onChange={(e) => onThinkingLevelChange(e.target.value as ThinkingLevel)}
                style={selectStyle}
              >
                {THINKING_LEVELS.filter((lvl) => {
                  if (!availableThinkingLevels) return true;
                  if (lvl === "auto") return true;
                  return availableThinkingLevels.includes(lvl);
                }).map((lvl) => {
                  const mapped = lvl !== "auto" && thinkingLevelMap ? thinkingLevelMap[lvl] : undefined;
                  const label = mapped != null && mapped !== lvl ? mapped : lvl;
                  return (
                    <option key={lvl} value={lvl}>
                      {label}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          {/* Sticky follow-up */}
          <div style={rowStyle}>
            <span>
              <span style={labelStyle}>Follow-up window</span>
              <span style={{ ...hintStyle, display: "block" }}>
                After a reply, keep listening so you can carry on without repeating the wake word
              </span>
            </span>
            <button
              type="button"
              data-mobile-settings-sticky="true"
              role="switch"
              aria-checked={stickyEnabled ? "true" : "false"}
              aria-label="Follow-up window"
              onClick={() => onStickyChange(!stickyEnabled)}
              style={{
                minWidth: 64,
                minHeight: 44,
                padding: "0 12px",
                background: stickyEnabled ? "var(--accent)" : "none",
                border: `1px solid ${stickyEnabled ? "var(--accent)" : "var(--border)"}`,
                borderRadius: 22,
                color: stickyEnabled ? "#0b1220" : "var(--text-muted)",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {stickyEnabled ? "On" : "Off"}
            </button>
          </div>

          {/* Completion sound */}
          <div style={rowStyle}>
              <span>
                <span style={labelStyle}>Completion sound</span>
                <span style={{ ...hintStyle, display: "block" }}>Chime when a turn finishes</span>
              </span>
              <button
                type="button"
                data-mobile-settings-sound="true"
                role="switch"
                aria-checked={soundOn ? "true" : "false"}
                aria-label="Completion sound"
                onClick={toggleSound}
                style={{
                  minWidth: 64,
                  minHeight: 44,
                  padding: "0 12px",
                  background: soundOn ? "var(--accent)" : "none",
                  border: `1px solid ${soundOn ? "var(--accent)" : "var(--border)"}`,
                  borderRadius: 22,
                  color: soundOn ? "#0b1220" : "var(--text-muted)",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {soundOn ? "On" : "Off"}
              </button>
            </div>
        </div>
      </aside>
    </>
  );
}

/** Open/close state for the settings drawer, owned by the composer. */
export function useMobileSettings() {
  const [open, setOpen] = useState(false);
  return { open, setOpen };
}
