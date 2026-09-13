"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { encodeWav, resampleTo16k } from "@/lib/audio";
import { isPseudoDeviceId } from "@/lib/audio-devices";
import { resolveMicConstraint } from "@/lib/mic-routing";
import {
  DEFAULT_MIC_SENSITIVITY,
  clampSensitivityDb,
  healLegacyMicSensitivity,
  parseMicSensitivity,
  silenceThreshold,
  type MicMeter,
  type MicSensitivity,
} from "@/lib/mic-sensitivity";
import { DEFAULT_VOICE_CONFIG, resolveVoiceConfig, type VoiceConfig } from "@/lib/voice-config";

const TARGET_RATE = 16000;
const ROLLING_SECONDS = 2;
const KWS_POLL_MS = 400;
const CONFIG_POLL_MS = 10_000; // hot-reload cadence for /api/voice-config
// Best-effort trailing trim; the silence-stop already avoids dead air, this is a safety net.
const TRAILING_TRIM_SAMPLES = Math.round(TARGET_RATE * 1.5);
const AMBIENT_MAX_CHUNKS = 600; // ~51s of rolling noise-floor samples
const AMBIENT_PERCENTILE = 0.2; // floor = 20th percentile (like whisper-vtt)
const ONSET_HOLD_CHUNKS = 2; // consecutive speech chunks to debounce onset
const STORAGE_KEY = "pi-voice-input-enabled";
const SENSITIVITY_KEY = "pi-voice-sensitivity";
const SENSITIVITY_MIGRATED_KEY = "pi-voice-sensitivity-migrated";

export type VoiceInputPhase =
  | "idle" // not listening (mic off)
  | "armed" // listening for the wake word
  | "sticky" // post-response follow-up window — speech onset triggers
  | "recording" // capturing speech
  | "transcribing" // POSTing to /api/transcribe
  | "working"; // turn sent; mic quiet until sticky re-arms after read-aloud

/** Why a capture ended — surfaced in the UI so the end trigger is visible. */
export type VoiceEndReason = "silence" | "stop-word" | "max-duration" | "off";

function concat(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function toBase64Pcm16k(chunks: Float32Array[], fromRate: number): string {
  const all = concat(chunks);
  if (all.length === 0) return "";
  const at16k = fromRate === TARGET_RATE ? all : resampleTo16k(all, fromRate);
  const int16 = new Int16Array(at16k.length);
  for (let i = 0; i < at16k.length; i++) {
    const v = Math.max(-1, Math.min(1, at16k[i]));
    int16[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

/** Escape a phrase for use in a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strip the wake + stop phrases from a transcription (safety net for leaks).
 * The wake phrase may lead the text (optionally after "hey"); the stop
 * phrase may trail it. Falls back to stripping nothing if a phrase is empty.
 */
function stripKeyword(text: string, config: VoiceConfig): string {
  const wake = config.wakeWord.phrase.trim();
  const stop = config.stopWord.phrase.trim();
  let out = text;
  if (wake) {
    out = out.replace(new RegExp(`^(?:hey\\s+)?${escapeRegExp(wake)}[,!.\\s]*`, "i"), "");
  }
  if (stop) {
    out = out.replace(
      new RegExp(`\\s*\\b${escapeRegExp(stop)}\\b\\s*[.!?]*$`, "i"),
      "",
    );
  }
  return out.trim();
}


/** RMS of a mono chunk in dB, floored at -60. */
function rmsDb(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    sum += v * v;
  }
  const rms = Math.sqrt(sum / samples.length);
  return rms > 1e-6 ? 20 * Math.log10(rms) : -60;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return -60;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[idx];
}

/**
 * Continuous voice input: the wake word (from voice-config) arms recording;
 * silence auto-stops and auto-sends (no stop phrase required); the stop
 * phrase provides an optional early stop. After the agent's spoken reply
 * finishes, a sticky onset window re-arms for follow-ups.
 */
export function useVoiceInput(onSend: (text: string) => void, armSignal = 0, micMuted = false) {
  const [enabled, setEnabledState] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(STORAGE_KEY) === "true";
  });
  const [phase, setPhase] = useState<VoiceInputPhase>("idle");
  const [lastDetected, setLastDetected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [endReason, setEndReason] = useState<VoiceEndReason | null>(null);

  // Mic routing: "auto" = shared preference chain (AirPods → built-in →
  // system default), "output" = match the active output device, "default" =
  // system default, or a concrete deviceId = manual pin. Persisted.
  const [micMode, setMicModeState] = useState<string>(() => {
    if (typeof window === "undefined") return "auto";
    return localStorage.getItem("pi-voice-mic") || "auto";
  });
  const [devices, setDevices] = useState<{ deviceId: string; label: string }[]>([]);
  const [micDeviceId, setMicDeviceId] = useState<string | null>(null);
  const [deviceTick, setDeviceTick] = useState(0);

  // Mic sensitivity override (Discord-style). Defaults to the adaptive
  // behaviour, so an untouched install behaves exactly as before.
  const [sensitivity, setSensitivityState] = useState<MicSensitivity>(() => {
    if (typeof window === "undefined") return DEFAULT_MIC_SENSITIVITY;
    try {
      const parsed = parseMicSensitivity(localStorage.getItem(SENSITIVITY_KEY));
      // One-time heal of the legacy "unticked automatic" artefact. Gated on a
      // marker rather than the value, so choosing -40 on purpose sticks.
      let migrated = true;
      try {
        migrated = localStorage.getItem(SENSITIVITY_MIGRATED_KEY) === "1";
        if (!migrated) localStorage.setItem(SENSITIVITY_MIGRATED_KEY, "1");
      } catch {
        // storage unavailable — skip the heal rather than risk clobbering
      }
      return healLegacyMicSensitivity(parsed, migrated);
    } catch {
      return DEFAULT_MIC_SENSITIVITY;
    }
  });
  const sensitivityRef = useRef(sensitivity);
  useEffect(() => {
    sensitivityRef.current = sensitivity;
  }, [sensitivity]);

  /** Live level/threshold for the mic menu's meter (no React churn per chunk). */
  const meterRef = useRef<MicMeter>({ db: -60, threshold: -60, active: false });

  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const phaseRef = useRef<VoiceInputPhase>("idle");
  const sampleRateRef = useRef<number>(TARGET_RATE);
  const rollingRef = useRef<Float32Array[]>([]);
  const recordingRef = useRef<Float32Array[]>([]);
  const kwsInFlightRef = useRef(false);
  const configRef = useRef<VoiceConfig>(DEFAULT_VOICE_CONFIG);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mutedRef = useRef(false);
  useEffect(() => {
    mutedRef.current = micMuted;
    // Disable the mic track while the assistant is speaking so it can't hear
    // its own synthesized voice (no false wake word / no floor pollution).
    const s = streamRef.current;
    s?.getAudioTracks().forEach((t) => {
      t.enabled = !micMuted;
    });
  }, [micMuted]);

  // Amplitude / VAD / sticky state.
  const ambientRef = useRef<number[]>([]);
  const floorDbRef = useRef<number | null>(null);
  const lastSpeechAtRef = useRef<number | null>(null);
  const recordingStartAtRef = useRef<number | null>(null);
  const onsetCountRef = useRef(0);
  const ackPlayingRef = useRef(false);
  const stickyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const gotoPhase = useCallback((next: VoiceInputPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const clearStickyTimer = useCallback(() => {
    if (stickyTimerRef.current) {
      clearTimeout(stickyTimerRef.current);
      stickyTimerRef.current = null;
    }
  }, []);

  const setMicMode = useCallback((mode: string) => {
    setMicModeState(mode);
    try {
      localStorage.setItem("pi-voice-mic", mode);
    } catch {
      // ignore storage errors
    }
  }, []);

  const setSensitivity = useCallback((next: Partial<MicSensitivity>) => {
    setSensitivityState((prev) => {
      const merged: MicSensitivity = {
        auto: next.auto ?? prev.auto,
        volumeDb: clampSensitivityDb(next.volumeDb ?? prev.volumeDb),
      };
      sensitivityRef.current = merged;
      try {
        localStorage.setItem(SENSITIVITY_KEY, JSON.stringify(merged));
      } catch {
        // ignore storage errors
      }
      return merged;
    });
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // ignore storage errors
    }
    if (!next) {
      clearStickyTimer();
      // Only worth reporting if we were mid-capture.
      if (phaseRef.current === "recording") setEndReason("off");
      recordingRef.current = [];
      gotoPhase("idle");
    }
  }, [clearStickyTimer, gotoPhase]);

  // Output-paired mic routing + hot-swap on device change.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const run = async () => {
      let perm: MediaStream | null = null;
      try {
        // Grant permission first so device labels are populated.
        perm = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) return;
        const list = await navigator.mediaDevices.enumerateDevices();
        const inputs = list
          .filter((d) => d.kind === "audioinput")
          .map((d) => ({ deviceId: d.deviceId, label: d.label || "" }));
        setDevices(inputs);
        const outLabel =
          list.find((d) => d.kind === "audiooutput" && (d.deviceId === "default" || d.deviceId === "communications"))?.label || "";
        const target = resolveMicConstraint(micMode, inputs, outLabel);
        setMicDeviceId((prev) => (prev === target ? prev : target));
      } catch {
        // leave the previous routing in place
      } finally {
        perm?.getTracks().forEach((t) => t.stop());
      }
    };
    void run();
    const onDev = () => {
      // Auto modes hot-swap on device change; a manual pin does not.
      if (micMode === "default" || micMode === "output") setDeviceTick((t) => t + 1);
      void run();
    };
    navigator.mediaDevices?.addEventListener?.("devicechange", onDev);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener?.("devicechange", onDev);
    };
  }, [enabled, micMode]);


  // Play the short wake acknowledgment (proves the mic heard the wake word).
  const playAck = useCallback(async () => {
    const cfg = configRef.current;
    if (!cfg.wakeWord.ackEnabled) return;
    const ctx = ctxRef.current;
    if (!ctx) return;
    try {
      ackPlayingRef.current = true;
      const res = await fetch(`/api/speak/ack?text=${encodeURIComponent(cfg.wakeWord.ack)}`);
      if (!res.ok) return;
      const buf = await res.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(buf);
      const src = ctx.createBufferSource();
      src.buffer = audioBuffer;
      src.connect(ctx.destination);
      src.onended = () => {
        ackPlayingRef.current = false;
      };
      await ctx.resume().catch(() => {});
      src.start();
    } catch {
      ackPlayingRef.current = false;
    }
  }, []);

  const startRecording = useCallback(() => {
    rollingRef.current = [];
    recordingRef.current = [];
    onsetCountRef.current = 0;
    lastSpeechAtRef.current = performance.now();
    recordingStartAtRef.current = performance.now();
    gotoPhase("recording");
  }, [gotoPhase]);

  // After a turn is sent (or aborted), sit quiet in `working` if sticky is on
  // (awaiting the read-aloud-complete re-arm), else return to wake-word-only.
  const finishTurn = useCallback(() => {
    gotoPhase(configRef.current.sticky.enabled ? "working" : "armed");
  }, [gotoPhase]);

  const stopAndTranscribe = useCallback((reason: VoiceEndReason) => {
    setEndReason(reason);
    const chunks = recordingRef.current;
    recordingRef.current = [];
    if (chunks.length === 0) {
      finishTurn();
      return;
    }
    gotoPhase("transcribing");
    setError(null);
    const rate = sampleRateRef.current;
    const all = concat(chunks);
    const at16k = rate === TARGET_RATE ? all : resampleTo16k(all, rate);
    const trimmed = at16k.length > TRAILING_TRIM_SAMPLES
      ? at16k.subarray(0, at16k.length - TRAILING_TRIM_SAMPLES)
      : at16k;
    const wav = encodeWav(trimmed, TARGET_RATE);
    fetch("/api/transcribe", { method: "POST", body: wav })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || `Transcription failed (${res.status})`);
        }
        return res.json() as Promise<{ text?: string }>;
      })
      .then((data) => {
        const text = stripKeyword(data.text ?? "", configRef.current);
        if (text) onSend(text);
        finishTurn();
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Transcription failed");
        finishTurn();
      });
  }, [onSend, gotoPhase, finishTurn]);

  // Re-arm the sticky follow-up window. Called when the agent's spoken reply
  // finishes (or the message completes if read-aloud is off).
  const armSticky = useCallback(() => {
    const cfg = configRef.current;
    if (!enabledRef.current || !cfg.sticky.enabled) return;
    const cur = phaseRef.current;
    if (cur === "recording" || cur === "transcribing") return;
    clearStickyTimer();
    onsetCountRef.current = 0;
    gotoPhase("sticky");
    // Lapse gate: expire back to wake-word-only after lapseS of no speech.
    stickyTimerRef.current = setTimeout(() => {
      if (phaseRef.current === "sticky") gotoPhase("armed");
    }, cfg.sticky.lapseS * 1000);
  }, [clearStickyTimer, gotoPhase]);

  useEffect(() => {
    if (armSignal > 0) armSticky();
  }, [armSignal, armSticky]);

  // Config fetch + hot reload.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const loadConfig = async () => {
      try {
        const res = await fetch("/api/voice-config");
        if (!res.ok) return;
        const data = (await res.json()) as unknown;
        if (!cancelled) configRef.current = resolveVoiceConfig(data);
      } catch {
        // keep current config on transient failure
      }
    };
    void loadConfig();
    const timer = setInterval(() => void loadConfig(), CONFIG_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled]);

  const pollKws = useCallback(async () => {
    if (mutedRef.current) {
      // Mic muted during read-aloud — never run the wake-word spotter on the
      // assistant's own voice, and drop anything captured while muted.
      rollingRef.current = [];
      return;
    }
    if (kwsInFlightRef.current) return; // don't pile up if a poll is still running
    const rolling = rollingRef.current;
    if (rolling.length === 0) return;
    const b64 = toBase64Pcm16k(rolling, sampleRateRef.current);
    if (!b64) return;
    kwsInFlightRef.current = true;
    try {
      const res = await fetch("/api/kws", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: b64 }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { detected?: string | null };
      const detected = data.detected ?? null;
      if (detected) setLastDetected(detected);
      const current = phaseRef.current;
      // Wake word: from armed (idle), working (safety valve), or sticky (fallback).
      if (detected === "wake" && (current === "armed" || current === "working" || current === "sticky")) {
        void playAck();
        startRecording();
      } else if (detected === "stop" && current === "recording") {
        // Optional early stop — never required. Silence is the default end.
        stopAndTranscribe("stop-word");
      }
    } catch {
      // ignore transient KWS errors
    } finally {
      kwsInFlightRef.current = false;
    }
  }, [playAck, startRecording, stopAndTranscribe]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let node: ScriptProcessorNode | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;

    (async () => {
      try {
        // Never pin a pseudo id ("default"/"communications") — an exact
        // constraint on one yields a stream that silently captures nothing.
        const pinned = isPseudoDeviceId(micDeviceId) ? null : micDeviceId;
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: pinned ? { exact: pinned } : undefined,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 1,
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) throw new Error("Web Audio not available");
        ctx = new Ctor();
        ctxRef.current = ctx;
        sampleRateRef.current = ctx.sampleRate;
        node = ctx.createScriptProcessor(4096, 1, 1);
        node.onaudioprocess = (e) => {
          if (mutedRef.current) return; // mic muted during read-aloud — drop audio
          const data = new Float32Array(e.inputBuffer.getChannelData(0));
          const cfg = configRef.current;
          const cur = phaseRef.current;

          // KWS rolling window is always fed.
          const maxChunks = Math.max(1, Math.ceil((ctx!.sampleRate * ROLLING_SECONDS) / data.length));
          rollingRef.current.push(data);
          if (rollingRef.current.length > maxChunks) {
            rollingRef.current.splice(0, rollingRef.current.length - maxChunks);
          }

          const db = rmsDb(data);
          const silenceDb = silenceThreshold(cfg, floorDbRef.current, sensitivityRef.current);
          meterRef.current = {
            db,
            threshold: silenceDb,
            active: cur === "recording" || cur === "armed" || cur === "sticky",
          };

          if (cur === "recording") {
            // Don't capture the ack ("Yes?") playing through the mic.
            if (!ackPlayingRef.current) recordingRef.current.push(data);
            const now = performance.now();
            if (db > silenceDb) lastSpeechAtRef.current = now;
            // Hard cap — a stuck recording can't run forever.
            if (recordingStartAtRef.current !== null && now - recordingStartAtRef.current > cfg.recording.maxDurationS * 1000) {
              stopAndTranscribe("max-duration");
              return;
            }
            // Silence auto-stop (the primary end trigger).
            if (lastSpeechAtRef.current !== null && now - lastSpeechAtRef.current > cfg.vad.silenceMs) {
              stopAndTranscribe("silence");
              return;
            }
            return;
          }

          // Non-recording: feed the ambient noise floor (armed / sticky / working).
          if (!mutedRef.current) {
            const amb = ambientRef.current;
            amb.push(db);
            if (amb.length > AMBIENT_MAX_CHUNKS) amb.shift();
            floorDbRef.current = percentile([...amb].sort((a, b) => a - b), AMBIENT_PERCENTILE);
          }

          if (cur === "sticky") {
            // Recomputed after the ambient floor update so onset uses the
            // freshest floor (preserves the pre-existing behaviour).
            //
            // Adaptive mode keeps the documented "floor + onsetDb" separation
            // so ambient drift can't trigger a false follow-up. Manual mode uses
            // the gate itself: the user has already declared where speech
            // begins, and stacking onsetDb on top made the follow-up strictly
            // harder than the wake word — ~1.5 dB of margin for a typical
            // correctly-set gate, which fails on inter-word dips.
            const gate = silenceThreshold(cfg, floorDbRef.current, sensitivityRef.current);
            const onsetDb = sensitivityRef.current.auto ? gate + cfg.sticky.onsetDb : gate;
            if (db > onsetDb) {
              onsetCountRef.current += 1;
              if (onsetCountRef.current >= ONSET_HOLD_CHUNKS) startRecording();
            } else {
              onsetCountRef.current = 0;
            }
          }
        };
        const source = ctx.createMediaStreamSource(stream);
        const sink = ctx.createGain();
        sink.gain.value = 0; // muted sink so the graph is pulled without echoing
        source.connect(node);
        node.connect(sink);
        sink.connect(ctx.destination);

        timer = setInterval(() => {
          void pollKws();
        }, KWS_POLL_MS);
        gotoPhase("armed");
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Microphone unavailable");
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      if (node) node.disconnect();
      if (stream) stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      ctxRef.current = null;
      void ctx?.close();
      clearStickyTimer();
      rollingRef.current = [];
      recordingRef.current = [];
      ambientRef.current = [];
      floorDbRef.current = null;
      if (phaseRef.current !== "transcribing") {
        gotoPhase("idle");
      }
    };
  }, [enabled, micDeviceId, deviceTick, pollKws, gotoPhase, clearStickyTimer, startRecording, stopAndTranscribe]);

  return {
    enabled,
    setEnabled,
    phase,
    lastDetected,
    error,
    /** How the last capture ended, or null before the first one. */
    endReason,
    micMode,
    setMicMode,
    devices,
    /** The device actually being captured — null means "system default". */
    resolvedMicDeviceId: micDeviceId,
    meterRef,
    sensitivity,
    setSensitivity,
  };
}
