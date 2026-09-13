"use client";

import { useEffect, useState } from "react";
import { meterPct, type MicMeter, type MicSensitivity } from "@/lib/mic-sensitivity";

interface Props {
  /** Live level/threshold written by the voice-input audio loop. */
  meter: { current: MicMeter };
  sensitivity: MicSensitivity;
  setSensitivity: (next: Partial<MicSensitivity>) => void;
  label: (key: string) => string;
}

/**
 * Input-sensitivity control, Discord-style: a live level meter with the
 * threshold drawn as a vertical line, an "auto" toggle, and a slider that
 * takes over from auto the moment you drag it.
 *
 * Mount only while its menu is open — the meter polls at ~16 fps, and the
 * polling stops as soon as this unmounts.
 */
export function MicSensitivityControl({ meter, sensitivity, setSensitivity, label }: Props) {
  const [level, setLevel] = useState<MicMeter>({ db: -60, threshold: -60, active: false });

  useEffect(() => {
    const id = setInterval(() => setLevel({ ...meter.current }), 60);
    return () => clearInterval(id);
  }, [meter]);

  const speech = level.active && level.db > level.threshold;
  // Slider is inverted so dragging right = more sensitive (lower dB gate).
  const sliderValue = -sensitivity.volumeDb;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
        {label("chat.micSensitivity")}
      </span>

      <div
        role="meter"
        aria-label={label("chat.micSensitivity")}
        aria-valuenow={Math.round(level.db)}
        aria-valuemin={-60}
        aria-valuemax={0}
        style={{
          position: "relative", height: 8, borderRadius: 4,
          background: "var(--bg)", border: "1px solid var(--border)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute", inset: 0, right: "auto",
            width: `${meterPct(level.db)}%`,
            background: speech ? "var(--accent, #4ade80)" : "var(--text-dim)",
            opacity: speech ? 1 : 0.5,
            transition: "width 0.06s linear",
          }}
        />
        <div
          title={`${Math.round(level.threshold)} dB`}
          style={{
            position: "absolute", top: -2, bottom: -2,
            left: `${meterPct(level.threshold)}%`,
            width: 2, marginLeft: -1,
            background: "var(--text)",
            opacity: 0.85,
          }}
        />
      </div>

      <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
        {label("chat.micSensitivityHint")}
      </span>

      <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: "var(--text-muted)", cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={sensitivity.auto}
          onChange={(e) => setSensitivity({ auto: e.target.checked })}
        />
        {label("chat.micAutoSensitivity")}
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--text-muted)" }}>
        <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span>{sensitivity.auto ? "Auto" : `${Math.round(sensitivity.volumeDb)} dB`}</span>
          <span style={{ opacity: 0.7 }}>{label("chat.micMoreSensitive")}</span>
        </span>
        <input
          type="range"
          min={20}
          max={70}
          step={1}
          value={sliderValue}
          disabled={sensitivity.auto}
          // Dragging takes over from auto — same as Discord.
          onChange={(e) => setSensitivity({ auto: false, volumeDb: -Number(e.target.value) })}
          style={{ width: "100%", opacity: sensitivity.auto ? 0.5 : 1 }}
        />
      </label>
    </div>
  );
}
