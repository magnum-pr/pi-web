"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { SessionInfo } from "@/lib/types";

/** Session list response shape from GET /api/sessions. */
interface SessionsResponse {
  sessions?: SessionInfo[];
}

export interface UseMobileSessionsResult {
  sessions: SessionInfo[];
  loading: boolean;
  error: string | null;
  /** Most recent session id, or null when there are none. */
  mostRecentId: string | null;
  refresh: () => void;
}

/**
 * Flat, recent-first session list for the mobile surface.
 *
 * Deliberately does NOT reuse SessionSidebar's data layer: that component also
 * owns project selection, worktree state, the file explorer and running/unread
 * badges. Mobile needs a plain list (decision 7 — flat, no branch/worktree, no
 * search), and coupling to the sidebar's state machine would drag all of it in.
 */
export function useMobileSessions(): UseMobileSessionsResult {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void fetch("/api/sessions?force=1", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as SessionsResponse;
      })
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data.sessions) ? data.sessions : [];
        // Recent-first. `modified` is an ISO string, so a lexical descending
        // sort is correct and avoids Date parsing per item.
        setSessions([...list].sort((a, b) => (a.modified < b.modified ? 1 : a.modified > b.modified ? -1 : 0)));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const mostRecentId = useMemo(() => sessions[0]?.id ?? null, [sessions]);

  return { sessions, loading, error, mostRecentId, refresh };
}
