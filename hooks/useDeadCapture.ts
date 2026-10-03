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
  /**
   * Last observed frame count, and when it last advanced.
   *
   * The previous implementation compared `db`/`threshold`/`active` against
   * their previous values. That cannot work: when the capture loop dies it
   * stops *writing* the meter, so the values do not change — they freeze,
   * still carrying `active: true` from the last live frame. Every check
   * therefore read "unchanged, but the values look alive" and never latched.
   *
   * The frame counter only ever increases, so a counter that has not moved for
   * DEAD_AFTER_MS is unambiguous proof the loop stopped.
   */
  const lastFramesRef = useRef<number>(-1);
  const lastAdvanceAtRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled || phase === "idle" || phase === "working") {
      setDead(false);
      lastFramesRef.current = -1;
      return;
    }
    if (dead) return; // already latched; only a user action clears it

    lastAdvanceAtRef.current = Date.now();
    lastFramesRef.current = meterRef.current?.frames ?? -1;

    const id = window.setInterval(() => {
      const m = meterRef.current;
      if (!m) return;
      const now = Date.now();

      if (m.frames !== lastFramesRef.current) {
        // The audio loop is delivering. This is the only proof of life.
        lastFramesRef.current = m.frames;
        lastAdvanceAtRef.current = now;
        return;
      }

      if (now - lastAdvanceAtRef.current >= DEAD_AFTER_MS) setDead(true);
    }, 1000);

    return () => window.clearInterval(id);
  }, [meterRef, phase, enabled, dead]);

  return { dead, clear: () => setDead(false) };
}
