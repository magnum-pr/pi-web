import type { VoiceConfig } from "./voice-config";

/**
 * Mic input-sensitivity model for the Discord-style mic menu.
 *
 * The voice config owns the *shared* VAD defaults; this module owns the
 * *per-browser* override a user sets from the UI. Keeping the maths here
 * (rather than inside the hook) makes it testable and keeps `useVoiceInput`
 * focused on audio plumbing.
 */
export interface MicSensitivity {
  /** true = adaptive (ambient floor + calibration margin); false = pinned. */
  auto: boolean;
  /** Pinned silence threshold in dBFS, used when `auto` is false. */
  volumeDb: number;
}

/** Live meter snapshot: written from the audio loop, read by the mic menu. */
export interface MicMeter {
  db: number;
  threshold: number;
  active: boolean;
}

export const DEFAULT_MIC_SENSITIVITY: MicSensitivity = { auto: true, volumeDb: -40 };

/** Manual threshold bounds — mirrors the volumeDb clamp in voice-config. */
export const SENSITIVITY_MIN_DB = -70;
export const SENSITIVITY_MAX_DB = -20;

export function clampSensitivityDb(db: number): number {
  return Math.max(SENSITIVITY_MIN_DB, Math.min(SENSITIVITY_MAX_DB, db));
}

/**
 * Effective silence threshold in dBFS.
 *
 * Auto keeps the pre-existing adaptive behaviour: the ambient floor plus the
 * configured margin, clamped to [-60, -28] so a noisy room can't push the
 * gate so high that quiet speech never registers. Manual returns the pinned
 * value instead — that is the slider's whole purpose.
 */
export function silenceThreshold(
  cfg: VoiceConfig,
  floorDb: number | null,
  sens: MicSensitivity,
): number {
  if (!sens.auto) return clampSensitivityDb(sens.volumeDb);
  if (floorDb === null) return cfg.vad.volumeDb;
  return Math.max(-60, Math.min(-28, floorDb + cfg.vad.calibrationMarginDb));
}

/**
 * Parse a stored override. Anything malformed falls back to the default
 * (auto) so a corrupt localStorage entry can never break the mic.
 */
export function parseMicSensitivity(raw: string | null): MicSensitivity {
  if (!raw) return DEFAULT_MIC_SENSITIVITY;
  try {
    const parsed = JSON.parse(raw) as Partial<MicSensitivity>;
    return {
      auto: typeof parsed.auto === "boolean" ? parsed.auto : DEFAULT_MIC_SENSITIVITY.auto,
      volumeDb:
        typeof parsed.volumeDb === "number" && Number.isFinite(parsed.volumeDb)
          ? clampSensitivityDb(parsed.volumeDb)
          : DEFAULT_MIC_SENSITIVITY.volumeDb,
    };
  } catch {
    return DEFAULT_MIC_SENSITIVITY;
  }
}

/** Map a dBFS reading onto a 0–100 meter band (-60 dB … 0 dB). */
export function meterPct(db: number): number {
  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
}
