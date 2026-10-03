"use client";

import { useState } from "react";

import { MicSensitivityControl } from "@/components/MicSensitivityControl";
import { useAudioOutputs } from "@/hooks/useAudioOutputs";
import { isPseudoDeviceId } from "@/lib/audio-devices";
import type { MicMeter, MicSensitivity } from "@/lib/mic-sensitivity";
import type { VoiceConfig } from "@/lib/voice-config";
import type { VoiceConfigPatch } from "@/lib/voice-config-store";

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

  // Read-aloud output routing. `sinkSupported` is false where AudioContext
  // .setSinkId is missing (Safari/Firefox) — the row is then absent, not broken.
  readAloudSink?: string;
  onReadAloudSinkChange?: (deviceId: string) => void;
  readAloudSinkSupported?: boolean;
  /** Why the last read-aloud failed — shown in the Audio section, beside the control. */
  readAloudError?: string | null;
  onDismissReadAloudError?: () => void;

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

  // Wake-word listening. Previously unreachable on `/m` (finding F12): the
  // only on/off lived in the desktop composer's voice cluster.
  voiceEnabled?: boolean;
  onVoiceEnabledChange?: (enabled: boolean) => void;

  // Mic source + input sensitivity, both browser-local.
  micMode?: string;
  onMicModeChange?: (mode: string) => void;
  micDevices?: { deviceId: string; label: string }[];
  /** Device actually captured; null = the platform default. */
  resolvedMicDeviceId?: string | null;
  sensitivity?: MicSensitivity;
  onSensitivityChange?: (next: Partial<MicSensitivity>) => void;
  /** Live level meter written by the voice-input audio loop. */
  meter?: { current: MicMeter } | null;

  // The resolved voice config the pipeline is actually using. These values live
  // in the server voice config; edits go through `onVoiceConfigChange`, which
  // patches this machine's override file — never the repo's tracked one.
  voiceConfig?: VoiceConfig | null;
  onVoiceConfigChange?: (patch: VoiceConfigPatch) => void;
  /** True while a patch is in flight — the Advanced inputs go read-only. */
  voiceConfigSaving?: boolean;
  voiceConfigError?: string | null;

  // Completion sound. When the caller supplies the props they win; otherwise
  // the drawer owns the same `pi-sound-enabled` preference the desktop
  // `useAudio` hook reads, so the setting stays consistent across surfaces
  // without drilling a second copy of the hook through the mobile shell.
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
}

const SOUND_KEY = "pi-sound-enabled";

/**
 * Options for the file-backed numeric fields.
 *
 * Discrete lists rather than free-text/range inputs: every value here must
 * survive `resolveVoiceConfig`'s clamps, and on a phone a picker is two taps
 * where a numeric keyboard is five plus a typo. The chosen values sit inside the
 * schema bounds and at the ends of the useful range.
 */
const SILENCE_OPTIONS = [500, 1000, 1500, 2000, 3000, 5000, 8000, 15000];
const DURATION_OPTIONS = [15, 30, 45, 60, 120, 300];
const LAPSE_OPTIONS = [10, 30, 60, 90, 120, 300];

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
/** Editable config value in a fixed-width control. */
const textInputStyle: React.CSSProperties = {
  width: 130,
  minHeight: 44,
  padding: "0 10px",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  color: "var(--text)",
  fontSize: 13,
  textAlign: "right",
};

/**
 * One labelled group of rows.
 *
 * Flat by owner decision: sections are headings, never collapsible panels. A
 * collapsed section on a phone hides the control the drawer was opened for, and
 * the drawer is already a short scroll.
 */
function Section({ title, section, children }: { title: string; section: string; children: React.ReactNode }) {
  return (
    <section data-mobile-settings-section={section}>
      <h3
        style={{
          margin: 0,
          padding: "16px 0 2px",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--text-dim)",
        }}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

/** On/off switch. Text, never colour alone — the state must be legible. */
function Switch({
  on,
  onToggle,
  label,
  attr,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
  attr: string;
}) {
  return (
    <button
      type="button"
      {...{ [attr]: "true" }}
      role="switch"
      aria-checked={on ? "true" : "false"}
      aria-label={label}
      onClick={onToggle}
      style={{
        minWidth: 64,
        minHeight: 44,
        padding: "0 12px",
        background: on ? "var(--accent)" : "none",
        border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 22,
        color: on ? "#0b1220" : "var(--text-muted)",
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
      }}
    >
      {on ? "On" : "Off"}
    </button>
  );
}

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
 * be hit-testable, or it swallows taps (the F13/D1 dead-click defect). The body
 * is additionally not rendered while closed, so nothing that polls (the output
 * device list, the sensitivity meter) runs behind a hidden panel.
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
  readAloudSink,
  onReadAloudSinkChange,
  readAloudSinkSupported,
  readAloudError,
  onDismissReadAloudError,
  stickyEnabled,
  onStickyChange,
  thinkingLevel,
  onThinkingLevelChange,
  availableThinkingLevels,
  thinkingLevelMap,
  voiceEnabled,
  onVoiceEnabledChange,
  micMode,
  onMicModeChange,
  micDevices,
  resolvedMicDeviceId,
  sensitivity,
  onSensitivityChange,
  meter,
  voiceConfig,
  onVoiceConfigChange,
  voiceConfigSaving = false,
  voiceConfigError,
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

  // Enumerated only while open (`active`), and re-runs on devicechange so a
  // newly plugged headset appears without a reload.
  const { devices: outputDevices } = useAudioOutputs(open);
  const selectableOutputs = outputDevices.filter((d) => !isPseudoDeviceId(d.deviceId));
  const selectableInputs = (micDevices ?? []).filter((d) => !isPseudoDeviceId(d.deviceId));
  const micLabelFor = (deviceId: string) =>
    selectableInputs.find((d) => d.deviceId === deviceId)?.label || deviceId.slice(0, 12);
  // Without a handler the Advanced values are informational only; with one they
  // are editable. Disabling rather than hiding keeps the numbers on screen —
  // knowing the live wake-word window is the whole diagnostic for finding F16.
  const canEdit = onVoiceConfigChange !== undefined && voiceConfig != null;
  // Advanced is a disclosure row, collapsed by default. Local state, not
  // persisted: the drawer should open on the everyday controls every time.
  const [advancedOpen, setAdvancedOpen] = useState(false);

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

        {/* Body only while open: the output-device enumeration and the
            sensitivity meter both poll, and neither may run behind a hidden
            panel. */}
        {open && (
          <div style={{ padding: "0 12px 12px", overflowY: "auto" }}>
            {/* ---------------------------------------------------------- Model */}
            <Section title="Model" section="model">
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

              {/* Reasoning sits directly beneath Model: the two are one decision,
                  and the option list is filtered by whichever model is selected. */}
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
            </Section>

            {/* ---------------------------------------------------------- Audio */}
            <Section title="Audio" section="audio">
              {onReadAloudToggle !== undefined && (
                <div style={rowStyle}>
                  <span>
                    <span style={labelStyle}>Read replies aloud</span>
                    <span style={{ ...hintStyle, display: "block" }}>Speak the summary when a turn finishes</span>
                  </span>
                  <Switch
                    on={readAloudEnabled ?? false}
                    onToggle={onReadAloudToggle}
                    label="Read replies aloud"
                    attr="data-mobile-settings-readaloud"
                  />
                </div>
              )}

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

              {/* Output routing. Only where the platform can actually route it —
                  Safari/Firefox have no AudioContext.setSinkId. */}
              {readAloudSinkSupported && onReadAloudSinkChange !== undefined && (
                <div style={rowStyle}>
                  <span>
                    <span style={labelStyle}>Play through</span>
                    <span style={{ ...hintStyle, display: "block" }}>Which speaker reads replies aloud</span>
                  </span>
                  <select
                    data-mobile-settings-sink="true"
                    aria-label="Play read-aloud through"
                    value={readAloudSink ?? "auto"}
                    onChange={(e) => onReadAloudSinkChange(e.target.value)}
                    style={selectStyle}
                  >
                    <option value="auto">Automatic</option>
                    <option value="default">System default</option>
                    {selectableOutputs.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Output ${d.deviceId.slice(0, 8)}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div style={rowStyle}>
                <span>
                  <span style={labelStyle}>Completion sound</span>
                  <span style={{ ...hintStyle, display: "block" }}>Chime when a turn finishes</span>
                </span>
                <Switch
                  on={soundOn}
                  onToggle={toggleSound}
                  label="Completion sound"
                  attr="data-mobile-settings-sound"
                />
              </div>

              {/* The read-aloud failure, beside the control that causes it.
                  It used to be recorded and rendered nowhere, which is what
                  made "it did not play" impossible to diagnose. */}
              {readAloudError && (
                <div
                  data-mobile-settings-readaloud-error="true"
                  role="alert"
                  style={{
                    ...rowStyle,
                    alignItems: "flex-start",
                    paddingTop: 10,
                  }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span style={{ ...labelStyle, color: "#e01a4f" }}>Read-aloud failed</span>
                    <span style={{ ...hintStyle, display: "block" }}>{readAloudError}</span>
                  </span>
                  {onDismissReadAloudError && (
                    <button
                      type="button"
                      data-mobile-settings-readaloud-error-dismiss="true"
                      aria-label="Dismiss read-aloud error"
                      onClick={onDismissReadAloudError}
                      style={{
                        minWidth: 44,
                        minHeight: 44,
                        flexShrink: 0,
                        background: "none",
                        border: "1px solid var(--border)",
                        borderRadius: 10,
                        color: "var(--text-muted)",
                        fontSize: 14,
                        cursor: "pointer",
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              )}
            </Section>

            {/* ---------------------------------------------------------- Voice */}
            <Section title="Voice" section="voice">
              {onVoiceEnabledChange !== undefined && (
                <div style={rowStyle}>
                  <span>
                    <span style={labelStyle}>Hands-free listening</span>
                    <span style={{ ...hintStyle, display: "block" }}>
                      Listen for the wake word. Off means the mic is closed.
                    </span>
                  </span>
                  <Switch
                    on={voiceEnabled ?? false}
                    onToggle={() => onVoiceEnabledChange(!(voiceEnabled ?? false))}
                    label="Hands-free listening"
                    attr="data-mobile-settings-voiceenabled"
                  />
                </div>
              )}

              <div style={rowStyle}>
                <span>
                  <span style={labelStyle}>Follow-up window</span>
                  <span style={{ ...hintStyle, display: "block" }}>
                    After a reply, keep listening so you can carry on without repeating the wake word
                  </span>
                </span>
                <Switch
                  on={stickyEnabled}
                  onToggle={() => onStickyChange(!stickyEnabled)}
                  label="Follow-up window"
                  attr="data-mobile-settings-sticky"
                />
              </div>

              {onMicModeChange !== undefined && (
                <div style={rowStyle}>
                  <span>
                    <span style={labelStyle}>Microphone</span>
                    <span style={{ ...hintStyle, display: "block" }}>
                      {resolvedMicDeviceId
                        ? `Using ${micLabelFor(resolvedMicDeviceId)}`
                        : "Using the system default"}
                    </span>
                  </span>
                  <select
                    data-mobile-settings-mic="true"
                    aria-label="Microphone source"
                    value={micMode ?? "auto"}
                    onChange={(e) => onMicModeChange(e.target.value)}
                    style={selectStyle}
                  >
                    <option value="auto">Automatic</option>
                    <option value="output">Follow output</option>
                    <option value="default">System default</option>
                    {selectableInputs.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {meter && sensitivity && onSensitivityChange && (
                <div data-mobile-settings-sensitivity="true" style={{ ...rowStyle, minHeight: 44 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <MicSensitivityControl
                      meter={meter}
                      sensitivity={sensitivity}
                      setSensitivity={onSensitivityChange}
                      label={(key) =>
                        ({
                          "chat.micSensitivity": "Input sensitivity",
                          "chat.micSensitivityHint": "Speak normally — the line marks where the mic starts listening.",
                          "chat.micAutoSensitivity": "Automatic",
                          "chat.micMoreSensitive": "More sensitive",
                        })[key] ?? key
                      }
                    />
                  </div>
                </div>
              )}
            </Section>

            {/* ------------------------------------------------------- Advanced */}
            {/* Collapsed by default, opened by its own row. A disclosure row and
                not a collapsed section: one boolean, and every other section
                keeps its always-visible header. Without this, five
                file-tuning rows pushed Audio and Voice off the first screen. */}
            <Section title="Advanced" section="advanced">
              <button
                type="button"
                data-mobile-settings-advanced-toggle="true"
                aria-expanded={advancedOpen}
                aria-controls="mobile-settings-advanced-body"
                onClick={() => setAdvancedOpen((o) => !o)}
                style={{
                  ...rowStyle,
                  width: "100%",
                  minHeight: 44,
                  background: "none",
                  border: "none",
                  borderBottom: "1px solid var(--border)",
                  color: "var(--text)",
                  cursor: "pointer",
                  textAlign: "left",
                  padding: "12px 0",
                }}
              >
                <span>
                  <span style={labelStyle}>Wake word and timings</span>
                  <span style={{ ...hintStyle, display: "block" }}>
                    {advancedOpen ? "Hide" : `Show — wake word is “${voiceConfig?.wakeWord.phrase ?? "…"}”`}
                  </span>
                </span>
                <span aria-hidden="true" style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {advancedOpen ? "▾" : "▸"}
                </span>
              </button>

              {/* Not rendered while collapsed. A `hidden` attribute would leave
                  these inputs reachable by keyboard/screen reader in some
                  browsers; not mounting them is the only reliable version. */}
              {advancedOpen && (
                <div id="mobile-settings-advanced-body">
                  {/* Editable, but through the *override* file: these land in
                      the machine-local agent config, never the tracked repo file. */}
                  <div style={rowStyle}>
                <span>
                  <span style={labelStyle}>Wake word</span>
                  <span style={{ ...hintStyle, display: "block" }}>Say this to start a question</span>
                </span>
                <input
                  data-mobile-settings-advanced="wakeword"
                  aria-label="Wake word"
                  type="text"
                  defaultValue={voiceConfig?.wakeWord.phrase ?? ""}
                  disabled={!canEdit || voiceConfigSaving}
                  onBlur={(e) => {
                    const next = e.target.value.trim();
                    if (next && next !== voiceConfig?.wakeWord.phrase) {
                      onVoiceConfigChange!({ wakeWord: { phrase: next } });
                    }
                  }}
                  style={textInputStyle}
                />
              </div>

              <div style={rowStyle}>
                <span>
                  <span style={labelStyle}>Stop phrase</span>
                  <span style={{ ...hintStyle, display: "block" }}>Optional early send</span>
                </span>
                <input
                  data-mobile-settings-advanced="stopphrase"
                  aria-label="Stop phrase"
                  type="text"
                  defaultValue={voiceConfig?.stopWord.phrase ?? ""}
                  disabled={!canEdit || voiceConfigSaving}
                  onBlur={(e) => {
                    const next = e.target.value.trim();
                    if (next && next !== voiceConfig?.stopWord.phrase) {
                      onVoiceConfigChange!({ stopWord: { phrase: next } });
                    }
                  }}
                  style={textInputStyle}
                />
              </div>

              <div style={rowStyle}>
                <span>
                  <span style={labelStyle}>Silence timeout</span>
                  <span style={{ ...hintStyle, display: "block" }}>Quiet before a capture is sent</span>
                </span>
                <select
                  data-mobile-settings-advanced="silence"
                  aria-label="Silence timeout"
                  value={voiceConfig?.vad.silenceMs ?? 3000}
                  disabled={!canEdit || voiceConfigSaving}
                  onChange={(e) => onVoiceConfigChange!({ vad: { silenceMs: Number(e.target.value) } })}
                  style={selectStyle}
                >
                  {SILENCE_OPTIONS.map((ms) => (
                    <option key={ms} value={ms}>
                      {ms >= 1000 ? `${ms / 1000} s` : `${ms} ms`}
                    </option>
                  ))}
                </select>
              </div>

              <div style={rowStyle}>
                <span>
                  <span style={labelStyle}>Max recording</span>
                  <span style={{ ...hintStyle, display: "block" }}>Hard cap on one capture</span>
                </span>
                <select
                  data-mobile-settings-advanced="maxduration"
                  aria-label="Max recording length"
                  value={voiceConfig?.recording.maxDurationS ?? 45}
                  disabled={!canEdit || voiceConfigSaving}
                  onChange={(e) => onVoiceConfigChange!({ recording: { maxDurationS: Number(e.target.value) } })}
                  style={selectStyle}
                >
                  {DURATION_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s} s
                    </option>
                  ))}
                </select>
              </div>

              <div style={rowStyle}>
                <span>
                  <span style={labelStyle}>Follow-up patience</span>
                  <span style={{ ...hintStyle, display: "block" }}>How long the follow-up window stays open</span>
                </span>
                <select
                  data-mobile-settings-advanced="lapse"
                  aria-label="Follow-up patience"
                  value={voiceConfig?.sticky.lapseS ?? 30}
                  disabled={!canEdit || voiceConfigSaving}
                  onChange={(e) => onVoiceConfigChange!({ sticky: { lapseS: Number(e.target.value) } })}
                  style={selectStyle}
                >
                  {LAPSE_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s} s
                    </option>
                  ))}
                </select>
              </div>

              {voiceConfigError && (
                <p
                  data-mobile-settings-advanced-error="true"
                  style={{ margin: "10px 0 0", fontSize: 11, color: "#e01a4f", lineHeight: 1.4 }}
                >
                  Could not save: {voiceConfigError}
                </p>
              )}
                </div>
              )}
            </Section>
          </div>
        )}
      </aside>
    </>
  );
}

/** Open/close state for the settings drawer, owned by the composer. */
export function useMobileSettings() {
  const [open, setOpen] = useState(false);
  return { open, setOpen };
}
