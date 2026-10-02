"use client";

import { MobileShell } from "@/components/mobile/MobileShell";
import { I18nProvider } from "@/hooks/useI18n";

/**
 * Mobile-only surface. Reached by tapping the home-screen icon (`start_url` is
 * `/m`) or by the user-agent redirect at `/`.
 *
 * Shares everything except the UI tree: same API routes, same auth, same
 * sessions, same `useVoiceInput`/`useReadAloud`/`useAgentSession` hooks.
 */
export default function MobileHome() {
  return (
    <I18nProvider>
      <MobileShell />
    </I18nProvider>
  );
}
