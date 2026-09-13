"use client";

import { useEffect, useRef, useState } from "react";
import { useAudioOutputs } from "@/hooks/useAudioOutputs";

interface Props {
  /** Read-aloud on/off (the existing headphone toggle). */
  enabled: boolean;
  onToggle: () => void;
  /** Stored output device id; "default" follows the system output. */
  sinkId: string;
  onSinkChange: (deviceId: string) => void;
  /** False in browsers without AudioContext.setSinkId (Firefox/Safari). */
  sinkSupported: boolean;
  label: (key: string) => string;
}

function HeadphoneIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 14v-1a9 9 0 0 1 18 0v1" />
      <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z" />
      <path d="M21 14h-3a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-5z" />
    </svg>
  );
}

function optionLabel(label: string, deviceId: string, index: number): string {
  if (label) return label;
  return deviceId === "default" ? "System default" : `Output ${index + 1}`;
}

/**
 * Headphone button + menu: read-aloud on/off and where the voice plays.
 *
 * Routing uses `AudioContext.setSinkId`, which is Chromium-only. On Firefox
 * and Safari the device list is replaced by a short explanation and the menu
 * still works as the read-aloud toggle.
 */
export function VoiceOutputSelector({
  enabled,
  onToggle,
  sinkId,
  onSinkChange,
  sinkSupported,
  label,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { devices } = useAudioOutputs(open);
  const selectable = devices.filter(
    (d) => d.deviceId !== "default" && d.deviceId !== "communications",
  );

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", display: "flex", alignItems: "center", flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={enabled ? label("chat.disableReadAloud") : label("chat.enableReadAloud")}
        aria-label={enabled ? label("chat.disableReadAloud") : label("chat.enableReadAloud")}
        aria-expanded={open}
        aria-haspopup="menu"
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 32, height: 32, padding: 0,
          background: "none", border: "none", borderRadius: 9,
          color: enabled ? "var(--text-muted)" : "var(--text-dim)",
          cursor: "pointer",
          opacity: enabled ? 1 : 0.55,
          transition: "background 0.12s, color 0.12s, opacity 0.12s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; e.currentTarget.style.opacity = "1"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = enabled ? "var(--text-muted)" : "var(--text-dim)"; e.currentTarget.style.opacity = enabled ? "1" : "0.55"; }}
      >
        <HeadphoneIcon />
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute", bottom: 38, right: 0, zIndex: 40,
            minWidth: 240, padding: 10,
            background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            display: "flex", flexDirection: "column", gap: 10,
          }}
        >
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={enabled}
            onClick={onToggle}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              background: "none", border: "none", padding: 0,
              color: "var(--text)", fontSize: 12, cursor: "pointer", textAlign: "left",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 14, height: 14, borderRadius: 4, flexShrink: 0,
                border: "1px solid var(--border)",
                background: enabled ? "var(--accent, var(--text))" : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "var(--bg)",
              }}
            >
              {enabled && (
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </span>
            {label("chat.readAloudToggle")}
          </button>

          {sinkSupported ? (
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--text-muted)" }}>
              {label("chat.outputDevice")}
              <select
                value={sinkId}
                onChange={(e) => onSinkChange(e.target.value)}
                style={{
                  background: "var(--bg)", color: "var(--text)",
                  border: "1px solid var(--border)", borderRadius: 7,
                  padding: "5px 6px", fontSize: 12, maxWidth: 240,
                }}
              >
                <option value="default">{label("chat.outputDeviceDefault")}</option>
                {selectable.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {optionLabel(d.label, d.deviceId, i)}
                  </option>
                ))}
              </select>
              {selectable.length === 0 && (
                <span style={{ fontSize: 10, opacity: 0.8 }}>
                  {label("chat.outputNoDevices")}
                </span>
              )}
            </label>
          ) : (
            <span style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>
              {label("chat.outputUnsupported")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
