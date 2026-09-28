#!/usr/bin/env node
/**
 * One-time setup for pi-web's offline voice output (Piper TTS).
 *
 * Creates `piper/venv`, installs `piper-tts` + `flask`, and downloads a few
 * en_US voices into `piper/voices/`. The runtime (lib/piper-tts.ts) then spawns
 * `python -m piper.http_server` from that venv.
 *
 * Usage:
 *   node scripts/setup-voice.mjs                                  # 3 default voices
 *   node scripts/setup-voice.mjs en_US-lessac-medium en_US-ryan-high
 */

import { spawnSync } from "node:child_process";
import { homedir } from "os";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PIPER_DIR = join(ROOT, "piper");
// The venv lives OUTSIDE the repo by default.
//
// Reason: `next build` walks the project tree, and a venv's bin/python is a
// symlink to a system interpreter — i.e. it points outside the tree. Turbopack
// aborts with "Symlink ... is invalid, it points out of the filesystem root",
// so a production bundle could not be produced at all while the venv sat inside
// the project. Dev was unaffected (it does not walk the same way), which is why
// it went unnoticed for so long.
//
// Nothing imports the venv — piper-tts spawns it at runtime and lib/piper-config.ts
// already reads PIPER_VENV_DIR — so keeping it out of the repo costs nothing.
const VENV_DIR = process.env.PIPER_VENV_DIR || join(homedir(), ".piper-venv");
const VOICES_DIR = join(PIPER_DIR, "voices");

const DEFAULT_VOICES = [
  "en_US-lessac-medium",
  "en_US-amy-medium",
  "en_US-ryan-medium",
];

const isWin = process.platform === "win32";
const venvPython = join(VENV_DIR, isWin ? "Scripts" : "bin", isWin ? "python.exe" : "python");

function log(...args) {
  console.log("[setup-voice]", ...args);
}

function fail(...args) {
  console.error("[setup-voice]", ...args);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  log("$", cmd, args.join(" "));
  const res = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (res.error) fail(`failed to run ${cmd}: ${res.error.message}`);
  if (res.status !== 0) fail(`${cmd} exited with status ${res.status}`);
}

function ensureVenv() {
  if (existsSync(venvPython)) {
    log("venv present:", VENV_DIR);
    return;
  }
  const systemPython = process.env.PYTHON || (isWin ? "python" : "python3");
  log("creating venv with", systemPython);
  run(systemPython, ["-m", "venv", VENV_DIR]);
}

function main() {
  const requested = process.argv.slice(2);
  const voices = requested.length > 0 ? requested : DEFAULT_VOICES;

  ensureVenv();
  run(venvPython, ["-m", "pip", "install", "piper-tts", "flask", "pocketsphinx"]);
  run(venvPython, ["-m", "piper.download_voices", ...voices, "--download-dir", VOICES_DIR]);
  log("done — voices installed under", VOICES_DIR);
}

main();
