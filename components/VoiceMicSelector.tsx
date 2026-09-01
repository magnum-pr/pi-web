"use client";

import { useEffect, useRef, useState } from "react";

function ChevronIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

interface Props {
  enabled: boolean;
  micMode: string;
  setMicMode: (mode: string) => void;
  devices: { deviceId: string; label: string }[];
}

/** Mic source selector for the jarvis voice input: follow-output (auto), system
 * default, or a specific device. Mirrors the DictationButton menu pattern. */
export function VoiceMicSelector({ enabled, micMode, setMicMode, devices }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const isDevice = !(micMode === "output" || micMode === "default");
  const currentLabel = isDevice
    ? devices.find((d) => d.deviceId === micMode)?.label || "Mic…"
    : micMode === "output"
      ? "Follow output"
      : "System default";

  return (
    <div ref={ref} style={{ position: "relative", display: "flex", alignItems: "center", flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={`Mic: ${currentLabel}`}
        aria-label={`Mic: ${currentLabel}`}
        aria-expanded={open}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 18, height: 32, padding: 0,
          background: "none", border: "none", borderRadius: 9,
          color: enabled ? "var(--text-dim)" : "var(--text-dim)",
          cursor: "pointer",
          opacity: enabled ? 1 : 0.55,
        }}
      >
        <ChevronIcon />
      </button>

      {open && (
        <div
          style={{
            position: "absolute", bottom: 38, right: 0, zIndex: 40,
            minWidth: 220, padding: 10,
            background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            display: "flex", flexDirection: "column", gap: 8,
          }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--text-muted)" }}>
            Mic source
            <select
              value={micMode}
              onChange={(e) => setMicMode(e.target.value)}
              style={{
                background: "var(--bg)", color: "var(--text)",
                border: "1px solid var(--border)", borderRadius: 7,
                padding: "5px 6px", fontSize: 12, maxWidth: 220,
              }}
            >
              <option value="output">Follow output (auto)</option>
              <option value="default">System default</option>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
