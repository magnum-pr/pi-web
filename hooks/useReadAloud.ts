"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

type SinkCapableContext = AudioContext & { setSinkId?: (id: string) => Promise<void> };

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

/** Map our stored sentinel onto the spec's "default" (empty string). */
function sinkTarget(id: string): string {
  return id === "default" ? "" : id;
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
  const [voice, setVoiceState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(VOICE_KEY);
  });
  const [voices, setVoices] = useState<string[]>([]);
  const [defaultVoice, setDefaultVoice] = useState("en_US-lessac-medium");

  // Audio output routing for read-aloud (headphone menu). "default" follows
  // the system output; a concrete id pins the chosen device.
  const [sinkId, setSinkIdState] = useState<string>(() => {
    if (typeof window === "undefined") return "default";
    return localStorage.getItem(SINK_KEY) || "default";
  });
  const sinkIdRef = useRef(sinkId);
  const sinkModeRef = useRef(detectSinkMode());

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
    // Apply the pinned output before the first sound is routed.
    const ctx = ctxRef.current as SinkCapableContext;
    if (ctx.setSinkId && sinkIdRef.current !== "default") {
      void ctx.setSinkId(sinkTarget(sinkIdRef.current)).catch(() => {});
    }
    return ctxRef.current;
  }, []);

  // Re-route the live context when the selection changes.
  useEffect(() => {
    sinkIdRef.current = sinkId;
    const ctx = ctxRef.current as SinkCapableContext | null;
    if (ctx && ctx.setSinkId) {
      void ctx.setSinkId(sinkTarget(sinkId)).catch(() => {});
    }
  }, [sinkId]);

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

  /** Play decoded audio through the AudioContext, pinned to the chosen sink. */
  const playViaContext = useCallback(async (buf: ArrayBuffer) => {
    const ctx = getCtx();
    if (!ctx) throw new Error("Audio playback is not available");
    if (ctx.state === "suspended") await ctx.resume().catch(() => {});
    const audioBuffer = await ctx.decodeAudioData(buf);
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
    sourceRef.current = src;
    src.start();
  }, [getCtx]);

  /**
   * Playback via an <audio> element — used when only
   * `HTMLMediaElement.setSinkId` exists (Firefox), so routing still works.
   */
  const playViaElement = useCallback(async (buf: ArrayBuffer) => {
    const url = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
    const el = new Audio(url);
    audioElRef.current = el;
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
      finish();
      setError("Audio playback failed");
    };
    try {
      // This path is only taken when HTMLMediaElement.setSinkId exists.
      await el.setSinkId(sinkTarget(sinkIdRef.current));
    } catch {
      // Routing rejected — fall back to the default output rather than fail.
    }
    try {
      await el.play();
    } catch (e) {
      finish();
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
    try {
      const res = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(voice ? { text: trimmed, voice } : { text: trimmed }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const buf = await res.arrayBuffer();
      if (sinkModeRef.current === "media-element") {
        await playViaElement(buf);
      } else {
        await playViaContext(buf);
      }
    } catch (e) {
      speakingRef.current = false;
      speakingTextRef.current = null;
      setSpeaking(false);
      setSpeakingText(null);
      setError(e instanceof Error ? e.message : String(e));
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
