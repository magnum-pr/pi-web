import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { writePrivateFileAtomicSync } from "./atomic-file";
import { resolveVoiceConfig, type VoiceConfig } from "./voice-config";

/**
 * A partial, hand-editable patch over the base voice config.
 *
 * Deliberately loose typing: this is what came off disk or off the wire, before
 * `resolveVoiceConfig` has clamped it. Nothing may read these numbers directly.
 */
export type VoiceConfigPatch = Record<string, Record<string, unknown>>;

/**
 * Where a machine stores its own voice-config overrides.
 *
 * Deliberately **not** the repo's `voice-config.json`. That file is tracked by
 * git and is also read by the PocketSphinx bridge and the whisper pipeline, so
 * letting a phone write it would produce uncommitted diffs in a tracked file and
 * make local configuration indistinguishable from authored work. This mirrors
 * `models-config-store`, which writes `~/.pi/agent/models.json` for the same
 * reason: machine-local state belongs outside the checkout.
 */
export function getVoiceOverridePath(): string {
  return join(getAgentDir(), "voice-config.json");
}

/** Section keys the schema defines. An unknown key is dropped, never merged. */
const SECTIONS = ["wakeWord", "stopWord", "vad", "recording", "sticky"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Strip a patch down to known sections and their scalar leaves.
 *
 * Read and write both pass through this, so a file edited by hand and a body
 * posted to the API are held to the same shape. Unknown keys are dropped rather
 * than stored and ignored — a config file that accumulates keys nothing reads
 * is how "I changed the setting and nothing happened" bugs start.
 */
export function sanitizeVoicePatch(raw: unknown): VoiceConfigPatch {
  if (!isRecord(raw)) return {};
  const out: VoiceConfigPatch = {};
  for (const section of SECTIONS) {
    const value = raw[section];
    if (!isRecord(value)) continue;
    const fields: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(value)) {
      // Scalars only. The schema has no nested objects or arrays, so anything
      // deeper is either a mistake or an attempt to smuggle structure in.
      if (typeof field === "string" || typeof field === "number" || typeof field === "boolean") {
        fields[key] = field;
      }
    }
    if (Object.keys(fields).length > 0) out[section] = fields;
  }
  return out;
}

/**
 * Read the machine-local override.
 *
 * Missing or unparseable yields `{}` — the same "bad config warns, never
 * crashes" contract as `resolveVoiceConfig`. A corrupt override must degrade to
 * the base config, not break voice.
 */
export function readVoiceOverride(path: string = getVoiceOverridePath()): VoiceConfigPatch {
  if (!existsSync(path)) return {};
  try {
    return sanitizeVoicePatch(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return {};
  }
}

/**
 * Merge an override patch over a resolved base config.
 *
 * Per-section, so patching `vad.silenceMs` cannot silently drop the other two
 * VAD fields. The result is re-resolved through `resolveVoiceConfig`, which is
 * what applies the clamps and guarantees an unknown or malformed value can never
 * reach the audio pipeline.
 */
export function mergeVoiceConfigs(base: VoiceConfig, patch: VoiceConfigPatch): VoiceConfig {
  const merged: Record<string, unknown> = { ...base };
  for (const section of SECTIONS) {
    const fields = patch[section];
    if (!fields) continue;
    merged[section] = { ...(base[section] as Record<string, unknown>), ...fields };
  }
  return resolveVoiceConfig(merged);
}

/**
 * Patch the override file. `patch` is merged over whatever is already on disk,
 * and only the patched keys are persisted.
 *
 * Writing the *resolved* config instead would be a trap: every value would then
 * live in the override, so a later change to the tracked base would be shadowed
 * forever and the two would silently diverge.
 */
export function writeVoiceOverride(
  patch: VoiceConfigPatch,
  path: string = getVoiceOverridePath(),
): void {
  const clean = sanitizeVoicePatch(patch);
  const existing = readVoiceOverride(path);
  const merged: VoiceConfigPatch = { ...existing };
  for (const [section, fields] of Object.entries(clean)) {
    merged[section] = { ...(merged[section] ?? {}), ...fields };
  }

  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writePrivateFileAtomicSync(path, `${JSON.stringify(merged, null, 2)}\n`);
}
