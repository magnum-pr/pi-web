/**
 * Keyword-spotting bridge — spawns the PocketSphinx helper
 * (`scripts/kws-helper.py`) and reports wake/stop phrase detection from
 * base64 PCM chunks. Mirrors the whisper/piper singletons: one long-lived
 * child in `globalThis`, with a pending-request map keyed by id.
 *
 * The wake + stop phrases come from the (hot-reloaded) voice config and are
 * passed to the helper at spawn, so renaming them needs no rebuild. The
 * helper reports stable labels: "wake" | "stop" | null.
 *
 * Server-only module. Only imported by the API route handler.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { resolveKwsConfig, type KwsConfig } from "./kws-config";
import { DEFAULT_VOICE_CONFIG, resolveVoiceConfig } from "./voice-config";

/** Read + validate the repo voice-config.json (hot-reloaded). Never throws. */
function loadVoiceConfigFile(): unknown {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), "voice-config.json"), "utf8"));
  } catch {
    return {};
  }
}

interface Pending {
  resolve: (detected: string | null) => void;
  reject: (error: Error) => void;
}

interface KwsSingleton {
  config: KwsConfig;
  child: ChildProcess | null;
  error: string | null;
  pending: Map<string, Pending>;
  nextId: number;
}

const globalForKws = globalThis as unknown as { __kws?: KwsSingleton };

export class KwsError extends Error {}

function ensureState(): KwsSingleton {
  if (!globalForKws.__kws) {
    globalForKws.__kws = {
      config: resolveKwsConfig(),
      child: null,
      error: null,
      pending: new Map(),
      nextId: 0,
    };
    process.once("exit", stopKwsHelper);
  }
  return globalForKws.__kws;
}

function rejectAll(state: KwsSingleton, error: string): void {
  for (const [, pending] of state.pending) pending.reject(new KwsError(error));
  state.pending.clear();
}

function spawnHelper(state: KwsSingleton): void {
  if (state.child) return;
  state.error = null;
  if (!existsSync(state.config.python) || !existsSync(state.config.helper)) {
    state.error = "Keyword spotter not set up — run `npm run setup:voice`";
    rejectAll(state, state.error);
    return;
  }

  // Wake + stop phrases from the hot-reloaded voice config.
  const vc = resolveVoiceConfig(loadVoiceConfigFile());
  const child = spawn(
    state.config.python,
    [state.config.helper, "--wake", vc.wakeWord.phrase, "--stop", vc.stopWord.phrase],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  state.child = child;

  const rl = createInterface({ input: child.stdout! });
  rl.on("line", (line) => {
    try {
      const res = JSON.parse(line) as { id?: string; detected?: string | null };
      const id = res.id;
      if (id && state.pending.has(id)) {
        const pending = state.pending.get(id)!;
        state.pending.delete(id);
        pending.resolve(res.detected ?? null);
      }
    } catch {
      // ignore malformed helper output
    }
  });

  // Drain stderr so the child never blocks on a full pipe.
  child.stderr?.on("data", () => {});
  child.on("error", (err) => {
    state.error = `KWS helper failed to start: ${err.message}`;
    rejectAll(state, state.error);
  });
  child.on("exit", () => {
    state.child = null;
    rejectAll(state, "KWS helper exited unexpectedly");
  });
}

/** Detect wake/stop phrases in a base64 16 kHz int16 mono PCM chunk. */
export function detectKeyword(pcmBase64: string): Promise<string | null> {
  const state = ensureState();
  if (!state.child) spawnHelper(state);
  if (!state.child || !state.child.stdin?.writable) {
    return Promise.reject(new KwsError(state.error ?? "KWS helper not ready"));
  }

  const id = String(state.nextId++);
  const child = state.child;
  return new Promise((resolve, reject) => {
    state.pending.set(id, { resolve, reject });
    // Wake-word sensitivity comes from the (hot-reloaded) voice config.
    const threshold = resolveVoiceConfig(loadVoiceConfigFile()).wakeWord.threshold;
    const msg = threshold !== DEFAULT_VOICE_CONFIG.wakeWord.threshold
      ? JSON.stringify({ id, audio: pcmBase64, threshold })
      : JSON.stringify({ id, audio: pcmBase64 });
    child.stdin!.write(msg + "\n", (err) => {
      if (err) {
        state.pending.delete(id);
        reject(new KwsError(`KWS write failed: ${err.message}`));
      }
    });
  });
}

/** Kill the helper child (used on shutdown). */
export function stopKwsHelper(): void {
  const state = globalForKws.__kws;
  if (!state) return;
  if (state.child) {
    try {
      state.child.kill();
    } catch {
      // already gone
    }
    state.child = null;
  }
  rejectAll(state, "KWS helper stopped");
}
