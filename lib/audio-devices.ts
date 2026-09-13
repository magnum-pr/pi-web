/**
 * Shared audio-endpoint selection policy.
 *
 * Every audio consumer in the app (wake-word mic, dictation mic, read-aloud
 * output) resolves its device through this module so the preference order is
 * identical everywhere:
 *
 *     AirPods  →  built-in (MacBook)  →  system default
 *
 * `null` means "no preference — let the platform decide". Callers turn that
 * into either "send no getUserMedia constraint" or "route to the default sink",
 * which is what makes the System default option meaningful.
 *
 * Pure module (no DOM, no React) — unit-testable under `node --test`.
 */

export interface AudioDeviceRef {
  deviceId: string;
  label: string;
}

/** Preference tiers, in priority order. */
export type PreferredTier = "airpods" | "builtin";

const PREFERENCE_ORDER: PreferredTier[] = ["airpods", "builtin"];

/**
 * `enumerateDevices()` reports pseudo-entries with these ids. They are not real
 * devices: pinning one as an `exact` constraint (getUserMedia) or as a sink id
 * yields an endpoint that silently does nothing.
 */
const PSEUDO_DEVICE_IDS = new Set(["", "default", "communications"]);

export function isPseudoDeviceId(deviceId: string | null | undefined): boolean {
  return !deviceId || PSEUDO_DEVICE_IDS.has(deviceId);
}

/** Rank a device label into the preference chain. `null` = not preferred. */
export function preferredTier(label: string): PreferredTier | null {
  const l = label.trim().toLowerCase();
  if (!l) return null;
  if (l.includes("airpods") || l.includes("air pods")) return "airpods";
  if (
    l.includes("macbook") ||
    l.includes("built-in") ||
    l.includes("builtin") ||
    l.includes("internal")
  ) {
    return "builtin";
  }
  return null;
}

/**
 * Pick the device to pin following AirPods → built-in. Returns `null` when
 * neither tier is present, which the caller reads as "use the system default".
 * Pseudo-ids are never returned.
 */
export function pickPreferredDevice<T extends AudioDeviceRef>(devices: T[]): T | null {
  const concrete = devices.filter((d) => !isPseudoDeviceId(d.deviceId));
  for (const tier of PREFERENCE_ORDER) {
    const match = concrete.find((d) => preferredTier(d.label) === tier);
    if (match) return match;
  }
  return null;
}

/**
 * Resolve a stored device choice into a concrete deviceId to pin, or `null`
 * for "no constraint / system default".
 *
 * Recognised choices: `"auto"` (and `undefined`/`null`) runs the preference
 * chain; `"default"`/`"communications"` mean the system default outright; any
 * other value is treated as a manual pin.
 */
export function resolveDeviceChoice(
  choice: string | null | undefined,
  devices: AudioDeviceRef[],
): string | null {
  // Unset or explicit "auto" → run the preference chain.
  if (choice === undefined || choice === null || choice === "auto") {
    return pickPreferredDevice(devices)?.deviceId ?? null;
  }
  // "" / "default" / "communications" all mean "let the platform decide".
  if (isPseudoDeviceId(choice)) return null;
  return choice;
}
