/**
 * Output-paired mic routing — the browser equivalent of whisper-vtt's `[audio]
 * device_name = "auto"` behavior.
 *
 * The wake-word path (`useVoiceInput`) used to hand getUserMedia no deviceId,
 * so it captured whatever the browser's default input was. When AirPods are
 * off that default can be stale (still the AirPods mic → silence → no wake
 * word). Here we resolve the mic that matches the *active output device* and
 * hot-swap when the output changes.
 *
 * Pure module (no DOM, no React) — unit-testable under `node --test`.
 */

export interface AudioDeviceRef {
  deviceId: string;
  label: string;
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/** Strip trailing role words so "MacBook Pro Speakers" and "… Microphone" share a stem. */
function deviceStem(label: string): string {
  return normalize(label).replace(/\s*(speakers?|microphone|mic|built-in|input|output)\b.*$/, "").trim();
}

/**
 * Pick the best input deviceId for the given default output label.
 * Mirrors whisper-vtt's priority: exact → stem → MacBook/built-in → first.
 */
export function resolveMicDeviceId(
  inputs: AudioDeviceRef[],
  defaultOutputLabel: string,
): string | null {
  if (inputs.length === 0) return null;
  // Ignore the "default"/"communications" pseudo-ids — pin a concrete device.
  const concrete = inputs.filter(
    (i) => i.deviceId && i.deviceId !== "default" && i.deviceId !== "communications",
  );
  const pool = concrete.length > 0 ? concrete : inputs;

  const outNorm = normalize(defaultOutputLabel);
  const outStem = deviceStem(defaultOutputLabel);

  // 1. Exact name match (e.g. "AirPods Pro" ↔ "AirPods Pro").
  if (outNorm) {
    const exact = pool.find((i) => normalize(i.label) === outNorm);
    if (exact) return exact.deviceId;
  }

  // 2. Stem match (e.g. "MacBook Pro Speakers" ↔ "MacBook Pro Microphone").
  if (outStem) {
    const stem = pool.find((i) => deviceStem(i.label) === outStem);
    if (stem) return stem.deviceId;
    const contains = pool.find((i) => normalize(i.label).includes(outStem));
    if (contains) return contains.deviceId;
  }

  // 3. MacBook / built-in fallback — the classic laptop mic.
  const builtin = pool.find((i) => /macbook|built-in/.test(normalize(i.label)));
  if (builtin) return builtin.deviceId;

  // 4. First concrete input as a last resort.
  return pool[0]?.deviceId ?? null;
}

/**
 * The deviceId `getUserMedia` should pin for a given mic mode.
 *
 * `"default"` (and `"communications"`) are PSEUDO device ids that
 * `enumerateDevices` reports; they are not real devices, and passing one to
 * `getUserMedia` as an `exact` constraint produces a stream that never
 * captures — silence in, no wake word. Returning `null` means "no
 * constraint", so the platform default applies and hot-swaps normally.
 */
export function resolveMicConstraint(
  micMode: string,
  inputs: AudioDeviceRef[],
  defaultOutputLabel: string,
): string | null {
  if (micMode === "default" || micMode === "communications") return null;
  if (micMode === "output") return resolveMicDeviceId(inputs, defaultOutputLabel);
  return micMode || null;
}

/** True for the pseudo ids that must never be pinned as an exact constraint. */
export function isPseudoDeviceId(deviceId: string | null | undefined): boolean {
  return !deviceId || deviceId === "default" || deviceId === "communications";
}
