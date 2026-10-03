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
 * Shown when the browser refused to start audio because no gesture had unlocked
 * the page yet.
 *
 * This is recoverable and usually self-correcting: the first tap anywhere
 * establishes the unlock and the refused reply is replayed automatically. The
 * wording therefore describes what is happening and what will happen, rather
 * than telling the user to complete a step the app handles itself.
 */
export const AUTOPLAY_BLOCKED_MESSAGE =
  "Audio was locked when this reply arrived — it will play once you tap the screen";

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
  /**
   * One long-lived <audio> element, reused for every reply.
   *
   * Previously a new element was constructed per speak. That matters on iOS:
   * the user-gesture restriction is lifted per element on several paths, so a
   * brand-new element is unproven again even after the page has been
   * interacted with. Reusing one element keeps the unlock that `unlockAudio`
   * earned on the first tap.
   */
  const elementRef = useRef<HTMLAudioElement | null>(null);
  /** True once the silent-buffer unlock has been performed. */
  const unlockedRef = useRef(false);
  /**
   * The reply that was refused because the page was not yet unlocked.
   *
   * Held so it can be replayed the moment a gesture unlocks audio. This is what
   * replaces the old "Read aloud now" button: the recovery is automatic, so the
   * UI does not have to ask the user to perform a step the app can perform
   * itself.
   */
  const blockedTextRef = useRef<string | null>(null);
  /** Set once `speak` exists, so `unlockAudio` can replay without a cycle. */
  const replayRef = useRef<(() => void) | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const speakingRef = useRef(false);
  const speakingTextRef = useRef<string | null>(null);

  /** The reusable playback element, created once. */
  const ensureAudioElement = useCallback((): HTMLAudioElement | null => {
    if (typeof window === "undefined") return null;
    if (elementRef.current) return elementRef.current;
    const el = new Audio();
    // Keep it in the graph so iOS treats it as a live media element.
    el.preload = "auto";
    el.setAttribute("playsinline", "true");
    elementRef.current = el;
    return el;
  }, []);

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

  /**
   * Establish and hold the browser's audio unlock.
   *
   * WebKit lifts the user-gesture requirement permanently once a gesture has
   * been processed (`removeBehaviorRestrictionsAfterFirstUserGesture`), so the
   * block is not permanent — it only applies until the page has been interacted
   * with. This runs on the first tap and keeps a live, unlocked context and a
   * *primed* <audio> element around afterwards, because a newly constructed
   * AudioContext or element is once again unproven.
   *
   * The silent buffer is the documented way to complete the unlock: starting a
   * source node with no audible output marks the graph as user-initiated
   * without making a sound.
   */
  const unlockAudio = useCallback(() => {
    const ctx = getCtx();
    if (ctx && ctx.state === "suspended") {
      void ctx.resume().catch(() => {});
    }
    // Silence, at zero gain: proves intent to play without being audible.
    if (ctx && !unlockedRef.current) {
      try {
        const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        src.connect(gain);
        gain.connect(ctx.destination);
        src.start(0);
        unlockedRef.current = true;
      } catch {
        // Non-fatal: playback may still succeed from a later gesture.
      }
    }
    // Prime the reusable element too — a brand-new element has to earn the
    // restriction removal again on some paths.
    const el = ensureAudioElement();
    if (el) {
      try {
        el.play().then(
          () => {
            el.pause();
            el.currentTime = 0;
          },
          () => {
            // Nothing to play yet; the gesture is still recorded by the attempt.
          },
        );
      } catch {
        // ignore
      }
    }

    // Audio is now unlocked. If a reply was previously refused for exactly that
    // reason, play it now rather than making the user find it again.
    if (blockedTextRef.current) {
      blockedTextRef.current = null;
      // Deferred a tick so the unlock is committed by the engine before
      // playback is attempted.
      setTimeout(() => replayRef.current?.(), 0);
    }
  }, [getCtx, ensureAudioElement]);

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
    const el = ensureAudioElement();
    if (!el) throw new Error("Playback failed: audio is unavailable");

    // Reuse the one element rather than constructing a fresh Audio per reply.
    // A new element would have to earn the gesture unlock again.
    const url = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
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
    let ended = false;
    const finish = () => {
      URL.revokeObjectURL(url);
      if (audioElRef.current === el) audioElRef.current = null;
      speakingRef.current = false;
      speakingTextRef.current = null;
      setSpeaking(false);
      setSpeakingText(null);
    };
    el.onended = () => {
      ended = true;
      settled = true;
      finish();
    };
    el.onerror = () => {
      elementFailed = true;
      if (settled) return; // a specific failure already won
      settled = true;
      finish();
    };
    el.src = url;
    el.load();
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
      // iOS refuses to start audio that no user gesture has unlocked. Automatic
      // read-aloud fires when a turn finishes — not a gesture — so Safari
      // rejects it here while *manual* read-aloud (a tap) succeeds.
      if (isAutoplayBlock(e)) {
        throw Object.assign(new Error(AUTOPLAY_BLOCKED_MESSAGE), { _stage: "blocked" as const });
      }
      throw e;
    }
    if (!ended) {
      // playback() resolved but the element never reported an end, which means
      // it was accepted and is playing. Nothing further to do here.
    }
  }, [ensureAudioElement]);

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
      // A gesture-refused reply is recoverable, so remember it for replay once
      // the page is unlocked. Any other stage is a real fault and is not
      // retried — replaying it would fail identically.
      blockedTextRef.current = stage === "blocked" ? trimmed : null;
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

  // Let `unlockAudio` replay a refused reply without depending on `speak`
  // (which would be a cycle: speak → unlock → speak). Assigned in an effect
  // rather than during render, since mutating a ref while rendering is not
  // safe under a double-render.
  useEffect(() => {
    replayRef.current = () => {
      const pending = blockedTextRef.current;
      if (!pending) return;
      blockedTextRef.current = null;
      void speak(pending).catch(() => {
        // If it is refused again, `fail` records it anew and the next tap retries.
      });
    };
  }, [speak]);

  /**
   * Take the audio unlock on the first interaction anywhere in the app.
   *
   * WebKit lifts the user-gesture requirement permanently once a gesture has
   * been processed, so obtaining one early is what lets *automatic* read-aloud
   * work later. Waiting for the user to tap a specific control meant the unlock
   * often did not exist when a reply finished. One passive listener, removed
   * after it fires, is enough — and because it is not a capture-phase or
   * cancelling listener, it cannot interfere with the tap it observes.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (unlockedRef.current) return;
    const onFirstGesture = () => {
      unlockAudio();
      window.removeEventListener("pointerdown", onFirstGesture);
      window.removeEventListener("keydown", onFirstGesture);
    };
    window.addEventListener("pointerdown", onFirstGesture, { passive: true });
    window.addEventListener("keydown", onFirstGesture);
    return () => {
      window.removeEventListener("pointerdown", onFirstGesture);
      window.removeEventListener("keydown", onFirstGesture);
    };
  }, [unlockAudio]);

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
