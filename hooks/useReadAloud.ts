"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { isPseudoDeviceId, pickPreferredDevice } from "@/lib/audio-devices";

const ENABLED_KEY = "pi-read-aloud-enabled";
const VOICE_KEY = "pi-read-aloud-voice";
const SINK_KEY = "pi-read-aloud-sink";

/**
 * How read-aloud audio can be routed to a chosen output device.
 *
 * - `audio-context` — `AudioContext.setSinkId()` (Chrome/Edge 110+)
 * - `media-element` — `HTMLMediaElement.setSinkId()` (Firefox 116+); we fall
 *   back to an <audio> element for playback since the context API is absent
 * - `none` — no routing API (Safari); the picker is hidden
 */
type SinkMode = "audio-context" | "media-element" | "none";

/**
 * Shown when the browser refused to start audio without a user gesture.
 *
 * This is a *recoverable* condition, not a fault: the same reply plays the
 * moment the user taps. Saying so turns a dead feature into one extra tap.
 */
export const AUTOPLAY_BLOCKED_MESSAGE =
  "Not allowed to play automatically — tap Read aloud to hear this reply";

/**
 * Is this failure the browser's autoplay policy rather than a real fault?
 *
 * Safari/Firefox reject `play()` with a `NotAllowedError`; some builds use a
 * different name, so match on the name *and* the message rather than the
 * constructor, which differs across engines.
 */
function isAutoplayBlock(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const name = (e as { name?: string }).name ?? "";
  return (
    name === "NotAllowedError" ||
    name === "AbortError" ||
    /not allowed|user gesture|user activation|autoplay/i.test(e.message)
  );
}

/**
 * A read-aloud failure, decomposed.
 *
 * The owner-reported defect is that read-aloud "sometimes does not play at all".
 * A bare message cannot resolve that, because "it did not play" is consistent
 * with at least four different causes. Recording the *stage* is what makes the
 * failure diagnosable instead of merely visible.
 */
export interface ReadAloudFailure {
  /** Human-readable reason, for display. */
  message: string;
  /** When it happened, so a stale notice can be aged out. */
  at: number;
  /** Which stage failed — the fact that distinguishes the causes. */
  stage: "request" | "decode" | "blocked" | "start" | "playback";
  /** AudioContext state at the moment of failure, when known. */
  contextState?: string;
}

type SinkCapableContext = AudioContext & { setSinkId?: (id: string) => Promise<void> };

/**
 * Recover the failure stage from a thrown message.
 *
 * The playback helpers prefix their messages with the stage they failed at, so
 * the stage survives the round trip through `throw`/`catch` without needing a
 * custom error class at every call site.
 */
function stageFromMessage(message: string): ReadAloudFailure["stage"] {
  if (/not allowed to play automatically/i.test(message)) return "blocked";
  if (/blocked/i.test(message)) return "blocked";
  if (/could not be loaded/i.test(message)) return "decode";
  if (/decoded/i.test(message)) return "decode";
  if (/start playback/i.test(message)) return "start";
  if (/mid-playback/i.test(message)) return "playback";
  return "request";
}

function detectSinkMode(): SinkMode {
  if (typeof window === "undefined") return "none";
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (Ctor && typeof (Ctor.prototype as { setSinkId?: unknown }).setSinkId === "function") {
    return "audio-context";
  }
  if (
    typeof HTMLMediaElement !== "undefined" &&
    typeof (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId === "function"
  ) {
    return "media-element";
  }
  return "none";
}

/**
 * Apply a sink target, tolerating the two spellings browsers accept for the
 * default output: the spec's empty string, and the historical literal
 * "default". Without this, choosing "System default" could silently leave
 * playback pinned to whatever device was selected before.
 */
async function applySink(
  target: string,
  setter: ((id: string) => Promise<void>) | undefined,
): Promise<void> {
  if (!setter) return;
  try {
    await setter(target);
  } catch {
    if (target === "") {
      try {
        await setter("default");
      } catch {
        // Unsupported sink — leave playback on the default output.
      }
    }
  }
}

/** Fetch + speak + voice selection for the "read aloud" voice-output layer. */
export function useReadAloud() {
  const [enabled, setEnabledState] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem(ENABLED_KEY);
    return stored === null ? true : stored === "true";
  });
  const [speaking, setSpeaking] = useState(false);
  const [speakingText, setSpeakingText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * The last structured failure — stage plus context state. `error` stays for
   * rendering; this exists so the *reason* is inspectable rather than only the
   * sentence, which is the whole point of F18.
   */
  const [lastFailure, setLastFailure] = useState<ReadAloudFailure | null>(null);
  const [voice, setVoiceState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(VOICE_KEY);
  });
  const [voices, setVoices] = useState<string[]>([]);
  const [defaultVoice, setDefaultVoice] = useState("en_US-lessac-medium");

  // Audio output routing for read-aloud (headphone menu). "auto" applies the
  // shared preference chain (AirPods → built-in → system default), "default"
  // follows the system output, or a concrete id pins that device.
  const [sinkId, setSinkIdState] = useState<string>(() => {
    if (typeof window === "undefined") return "auto";
    return localStorage.getItem(SINK_KEY) || "auto";
  });
  /** Concrete sink id handed to setSinkId ("" = the default output). */
  const sinkTargetRef = useRef<string>("");
  const sinkModeRef = useRef(detectSinkMode());

  /** Resolve a stored choice into a concrete sink id. */
  const resolveSinkTarget = useCallback(async (choice: string): Promise<string> => {
    if (choice !== "auto") return isPseudoDeviceId(choice) ? "" : choice;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const outputs = list
        .filter((d) => d.kind === "audiooutput")
        .map((d) => ({ deviceId: d.deviceId, label: d.label || "" }));
      return pickPreferredDevice(outputs)?.deviceId ?? "";
    } catch {
      return "";
    }
  }, []);

  const setSinkId = useCallback((next: string) => {
    setSinkIdState(next);
    try {
      localStorage.setItem(SINK_KEY, next);
    } catch {
      // ignore storage errors
    }
  }, []);

  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const speakingRef = useRef(false);
  const speakingTextRef = useRef<string | null>(null);

  const getCtx = useCallback((): AudioContext | null => {
    if (ctxRef.current && ctxRef.current.state !== "closed") return ctxRef.current;
    try {
      ctxRef.current = new AudioContext();
    } catch {
      return null;
    }
    // Apply the pinned output before the first sound is routed. An empty
    // target means the default output, which needs no call at all.
    const ctx = ctxRef.current as SinkCapableContext;
    if (ctx.setSinkId && sinkTargetRef.current !== "") {
      void applySink(sinkTargetRef.current, ctx.setSinkId.bind(ctx));
    }
    return ctxRef.current;
  }, []);

  // Resolve the choice and (re-)apply it to the live context.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const target = await resolveSinkTarget(sinkId);
      if (cancelled) return;
      sinkTargetRef.current = target;
      const ctx = ctxRef.current as SinkCapableContext | null;
      if (ctx) await applySink(target, ctx.setSinkId?.bind(ctx));
    })();
    return () => {
      cancelled = true;
    };
  }, [sinkId, resolveSinkTarget]);

  const unlockAudio = useCallback(() => {
    const ctx = getCtx();
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
  }, [getCtx]);

  const loadVoices = useCallback(async () => {
    try {
      const res = await fetch("/api/speak/voices");
      if (!res.ok) return;
      const data = (await res.json()) as { voices?: unknown; defaultVoice?: unknown };
      if (Array.isArray(data.voices)) setVoices(data.voices.filter((v): v is string => typeof v === "string"));
      if (typeof data.defaultVoice === "string") setDefaultVoice(data.defaultVoice);
    } catch {
      // voices are optional — speak still works with the server default
    }
  }, []);

  useEffect(() => {
    void loadVoices();
  }, [loadVoices]);

  const setVoice = useCallback((next: string) => {
    setVoiceState(next);
    try {
      localStorage.setItem(VOICE_KEY, next);
    } catch {
      // ignore storage errors
    }
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    try {
      localStorage.setItem(ENABLED_KEY, String(next));
    } catch {
      // ignore storage errors
    }
    if (next) unlockAudio();
  }, [unlockAudio]);

  const stop = useCallback(() => {
    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch {
        // already stopped
      }
      sourceRef.current = null;
    }
    const el = audioElRef.current;
    if (el) {
      try {
        el.pause();
      } catch {
        // ignore
      }
      audioElRef.current = null;
    }
    speakingRef.current = false;
    speakingTextRef.current = null;
    setSpeaking(false);
    setSpeakingText(null);
  }, []);

  /**
   * Play decoded audio through the AudioContext, pinned to the chosen sink.
   *
   * This is the path iOS Safari takes, and it is the one the owner reported as
   * "sometimes does not play at all". It used to attach only `src.onended`, so
   * every failure inside it rejected into nothing. Each step now reports which
   * step failed, because "playback failed" alone cannot separate the possible
   * causes: an audio context iOS never unlocked, a payload the decoder
   * rejected, or a start that threw.
   */
  const playViaContext = useCallback(async (buf: ArrayBuffer) => {
    const ctx = getCtx();
    if (!ctx) throw new Error("Playback failed: Web Audio is unavailable");

    // iOS only lets audio start from a user gesture. A context left `suspended`
    // plays nothing at all, and this used to be swallowed by a bare `.catch`.
    // Resume, then *re-read the state* rather than assuming it worked.
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        // fall through to the state check — it is the authoritative answer
      }
    }
    if (ctx.state !== "running") {
      throw new Error(
        `Playback failed: audio is blocked (context is "${ctx.state}") — tap the screen once, then try again`,
      );
    }

    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await ctx.decodeAudioData(buf);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new Error(`Playback failed: the audio could not be decoded (${detail})`);
    }

    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(ctx.destination);
    src.onended = () => {
      if (sourceRef.current === src) sourceRef.current = null;
      speakingRef.current = false;
      speakingTextRef.current = null;
      setSpeaking(false);
      setSpeakingText(null);
    };
    // NOTE: AudioBufferSourceNode has no `onerror` — unlike <audio>, a buffer
    // source cannot fail asynchronously once started. Start-time failures are
    // synchronous and caught below, which is the only error surface this node
    // actually has.
    sourceRef.current = src;
    try {
      src.start();
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      sourceRef.current = null;
      throw new Error(`Playback failed: could not start playback (${detail})`);
    }
  }, [getCtx]);

  /**
   * Playback via an <audio> element — used when only
   * `HTMLMediaElement.setSinkId` exists (Firefox), so routing still works.
   */
  const playViaElement = useCallback(async (buf: ArrayBuffer) => {
    const url = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
    const el = new Audio(url);
    audioElRef.current = el;
    // The element's own error event fires asynchronously and can land AFTER
    // `play()` has already rejected. Writing `error` from both places made the
    // message and the recorded stage disagree: the autoplay block set
    // stage="blocked" (so the retry button appeared, correctly) and the element
    // event then overwrote the message with the old generic "Audio playback
    // failed". Observed on device: right button, wrong words.
    //
    // So the element event never writes state directly — it records *why*, and
    // the failure is decided once, in the catch below.
    let elementFailed = false;
    let settled = false;
    const finish = () => {
      URL.revokeObjectURL(url);
      if (audioElRef.current === el) audioElRef.current = null;
      speakingRef.current = false;
      speakingTextRef.current = null;
      setSpeaking(false);
      setSpeakingText(null);
    };
    el.onended = finish;
    el.onerror = () => {
      elementFailed = true;
      if (settled) return; // a specific failure already won
      settled = true;
      finish();
    };
    // This path is only taken when HTMLMediaElement.setSinkId exists.
    await applySink(sinkTargetRef.current, el.setSinkId.bind(el));
    try {
      await el.play();
      settled = true;
    } catch (e) {
      finish();
      settled = true;
      // A load/decode failure is the more specific explanation, so it wins over
      // the play() rejection it also causes (which would otherwise be misread
      // as an autoplay block and offer a retry that cannot work).
      if (elementFailed) {
        throw Object.assign(new Error("Playback failed: the audio could not be loaded"), {
          _stage: "decode" as const,
        });
      }
      // iOS refuses to start audio that no user gesture asked for. Automatic
      // read-aloud fires when a turn finishes — not a gesture — so Safari
      // rejects it here while *manual* read-aloud (a tap) succeeds. That
      // asymmetry is the observed defect.
      if (isAutoplayBlock(e)) {
        throw Object.assign(new Error(AUTOPLAY_BLOCKED_MESSAGE), { _stage: "blocked" as const });
      }
      throw e;
    }
  }, []);

  const speak = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setError(null);
    stop();
    speakingRef.current = true;
    speakingTextRef.current = trimmed;
    setSpeaking(true);
    setSpeakingText(trimmed);

    const fail = (message: string, stage: ReadAloudFailure["stage"]) => {
      speakingRef.current = false;
      speakingTextRef.current = null;
      setSpeaking(false);
      setSpeakingText(null);
      setError(message);
      setLastFailure({
        message,
        at: Date.now(),
        stage,
        contextState: (ctxRef.current as AudioContext | null)?.state,
      });
    };

    try {
      const res = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(voice ? { text: trimmed, voice } : { text: trimmed }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw Object.assign(new Error(err.error ?? `HTTP ${res.status}`), { _stage: "request" as const });
      }
      const buf = await res.arrayBuffer();
      if (sinkModeRef.current === "media-element") {
        await playViaElement(buf);
      } else {
        await playViaContext(buf);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const stage = (e as { _stage?: ReadAloudFailure["stage"] })._stage ?? stageFromMessage(message);
      fail(message, stage);
      // Re-throw so callers can react. The state is already updated above for
      // the UI; this exists for the auto-read path, which needs to know the
      // read failed so it can still re-arm the voice follow-up window.
      throw e instanceof Error ? e : new Error(message);
    }
  }, [voice, stop, playViaContext, playViaElement]);

  const toggle = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (speakingRef.current && speakingTextRef.current === trimmed) {
      stop();
    } else {
      void speak(trimmed);
    }
  }, [speak, stop]);

  return {
    enabled,
    setEnabled,
    speaking,
    speakingText,
    error,
    lastFailure,
    /** Clear a surfaced failure once the user has seen it. */
    clearError: useCallback(() => {
      setError(null);
      setLastFailure(null);
    }, []),
    speak,
    stop,
    toggle,
    voice: voice ?? defaultVoice,
    setVoice,
    voices,
    defaultVoice,
    sinkId,
    setSinkId,
    sinkSupported: sinkModeRef.current !== "none",
    loadVoices,
    unlockAudio,
  };
}
