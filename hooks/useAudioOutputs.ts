"use client";

import { useCallback, useEffect, useState } from "react";

export interface AudioOutputDevice {
  deviceId: string;
  label: string;
}

/**
 * Enumerate `audiooutput` devices for the read-aloud output picker.
 *
 * Browsers hide output devices (and blank every label) until the page holds a
 * media permission, so the list can come back empty. We deliberately do NOT
 * prompt for one here: acquiring a mic stream while the voice-input pipeline
 * is already holding the device can disturb that live capture (and on macOS
 * can flip the default input). The caller shows an empty-state hint instead,
 * and the voice-input grant normally populates labels anyway.
 *
 * Only runs while `active` (menu open), and re-runs on `devicechange`, which
 * also gives output hot-swap: a newly plugged headset appears without reload.
 */
export function useAudioOutputs(active: boolean) {
  const [devices, setDevices] = useState<AudioOutputDevice[]>([]);

  const refresh = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(
        list
          .filter((d) => d.kind === "audiooutput")
          .map((d) => ({ deviceId: d.deviceId, label: d.label || "" })),
      );
    } catch {
      // Keep the previous list — a failed enumeration shouldn't blank the menu.
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void refresh();
    const onDeviceChange = () => {
      void refresh();
    };
    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
    };
  }, [active, refresh]);

  return { devices, refresh };
}
