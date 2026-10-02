"use client";

import { useEffect, useRef, useState } from "react";

import type { MicMeter } from "@/lib/mic-sensitivity";
import type { VoiceInputPhase } from "@/hooks/useVoiceInput";

/**
 * How long the capture loop may be silent before the UI declares it dead.
 * The analyser runs in every phase including `armed`, so this is measured from
 * the last frame — not from the last sound. 10s per the owner's decision.
 */
export const DEAD_AFTER_MS = 10_000;

/**
 * Marks the capture loop as dead when it stops delivering frames.
 *
 * This is the mitigation for the failure proven on the device: after an iOS
 * interruption (lock, app switch, call), the mic indicator can stay lit while
 * nothing is captured — a **silent** failure where the UI looks alive and the
 * user talks into a void. A label alone cannot catch that, because the hook
 * still believes it is recording. Only the absence of analyser frames proves it.
 *
 * Detection is by frame *freshness*, not level: `armed` is legitimately quiet,
 * so a low dB reading means "nobody is talking", not "the mic is dead".
 */
export function useDeadCapture(
  meterRef: React.RefObject<MicMeter>,
  phase: VoiceInputPhase,
  enabled: boolean,
): { dead: boolean; clear: () => void } {
  const [dead, setDead] = useState(false);
  const lastFrameRef = useRef<{ db: number; threshold: number; at: number } | null>(null);
  // Seeded on first use inside the effect — `Date.now()` during render is
  // impure and the linter (rightly) rejects it.
  const lastChangeAtRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled || phase === "idle" || phase === "working") {
      setDead(false);
      lastFrameRef.current = null;
      return;
    }
    if (dead) return; // already latched; only a user action clears it

    lastChangeAtRef.current = Date.now();
    const id = window.setInterval(() => {
      const m = meterRef.current;
      if (!m) return;
      const now = Date.now();

      if (m.active) {
        // `active` flips true the moment the capture loop produces a frame, so
        // it doubles as proof the analyser is alive.
        lastChangeAtRef.current = now;
        lastFrameRef.current = { db: m.db, threshold: m.threshold, at: now };
        return;
      }

      const prev = lastFrameRef.current;
      if (prev && (prev.db !== m.db || prev.threshold !== m.threshold)) {
        lastChangeAtRef.current = now;
        lastFrameRef.current = { db: m.db, threshold: m.threshold, at: now };
        return;
      }

      if (now - lastChangeAtRef.current >= DEAD_AFTER_MS) setDead(true);
    }, 1000);

    return () => window.clearInterval(id);
  }, [meterRef, phase, enabled, dead]);

  return { dead, clear: () => setDead(false) };
}
