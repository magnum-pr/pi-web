"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { isPseudoDeviceId } from "@/lib/audio-devices";

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
  /** Device actually captured; null = the platform default. */
  resolvedMicDeviceId?: string | null;
}

/** Mic source selector for the jarvis voice input: follow-output (auto), system
 * default, or a specific device. Mirrors the DictationButton menu pattern. */
export function VoiceMicSelector({ enabled, micMode, setMicMode, devices, resolvedMicDeviceId }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Pseudo ids ("default"/"communications") are represented by the explicit
  // options below, so keep them out of the concrete device list.
  const selectable = devices.filter((d) => !isPseudoDeviceId(d.deviceId));

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const isDevice = !(micMode === "auto" || micMode === "output" || micMode === "default");
  const currentLabel = isDevice
    ? selectable.find((d) => d.deviceId === micMode)?.label || "Mic…"
    : micMode === "auto"
      ? "Automatic"
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
              <option value="auto">{t("chat.audioAutomatic")}</option>
              <option value="output">Follow output (auto)</option>
              <option value="default">System default</option>
              {selectable.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
                </option>
              ))}
            </select>
            {/* What the mode actually resolved to — "Automatic" alone hides
                whether it picked AirPods or the built-in mic. */}
            <span style={{ fontSize: 10, opacity: 0.8 }}>
              {resolvedMicDeviceId
                ? `Using: ${selectable.find((d) => d.deviceId === resolvedMicDeviceId)?.label || resolvedMicDeviceId.slice(0, 12)}`
                : "Using: system default"}
            </span>
          </label>
        </div>
      )}
    </div>
  );
}
