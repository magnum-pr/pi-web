"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ChatWindow } from "@/components/ChatWindow";
import { useMobileSessions } from "@/hooks/useMobileSessions";
import type { SessionInfo } from "@/lib/types";

import { MobileSessionDrawer } from "./MobileSessionDrawer";

const LAST_SESSION_KEY = "pi-mobile-last-session";
/** Horizontal travel from the left edge that opens the drawer. */
const EDGE_SWIPE_PX = 60;
/** Where the touch must start to count as an edge swipe. */
const EDGE_ZONE_PX = 24;

function readLastSession(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(LAST_SESSION_KEY);
  } catch {
    return null;
  }
}

function writeLastSession(id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id) localStorage.setItem(LAST_SESSION_KEY, id);
    else localStorage.removeItem(LAST_SESSION_KEY);
  } catch {
    // ignore storage errors
  }
}

/**
 * Mobile-only surface (decision: separate tree, shared backend).
 *
 * Deliberately keeps its own session selection rather than borrowing
 * AppShell's: AppShell's state is chrome (panels, dialogs, worktrees, stats)
 * that has no meaning on a phone. The chat data layer is not duplicated —
 * `ChatWindow` owns `useAgentSession` itself.
 */
export function MobileShell() {
  const { sessions, loading, error, mostRecentId, refresh } = useMobileSessions();
  const [selected, setSelected] = useState<SessionInfo | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null);
  // Distinguishes consecutive fresh composers in the same cwd.
  const [newSessionDraftId] = useState(() => `m-${Date.now().toString(36)}`);
  const restoredRef = useRef(false);

  // Restore once, after the first successful list load. A deliberate "new chat"
  // (newSessionCwd set) must not be clobbered by a later refresh.
  useEffect(() => {
    if (restoredRef.current || loading || sessions.length === 0) return;
    restoredRef.current = true;
    if (selected || newSessionCwd) return;

    const lastId = readLastSession();
    const match = lastId ? sessions.find((s) => s.id === lastId) : undefined;
    const target = match ?? sessions.find((s) => s.id === mostRecentId) ?? sessions[0];
    if (target) setSelected(target);
  }, [loading, sessions, selected, newSessionCwd, mostRecentId]);

  useEffect(() => {
    writeLastSession(selected?.id ?? null);
  }, [selected?.id]);

  // Left-edge swipe opens the drawer. The right edge is deliberately unused so
  // a browser tab's back gesture can never conflict (decision 6, AC-8).
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    touchStart.current = t.clientX <= EDGE_ZONE_PX ? { x: t.clientX, y: t.clientY } : null;
  }, []);
  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const start = touchStart.current;
    if (!start) return;
    const t = e.touches[0];
    if (!t) return;
    if (Math.abs(t.clientY - start.y) > 60) {
      touchStart.current = null; // vertical scroll, not a drawer swipe
      return;
    }
    if (t.clientX - start.x > EDGE_SWIPE_PX) {
      touchStart.current = null;
      setDrawerOpen(true);
    }
  }, []);

  const effectiveNewSessionCwd = newSessionCwd;
  const newSessionDraftKey =
    selected === null && effectiveNewSessionCwd ? `new:${newSessionDraftId}:${effectiveNewSessionCwd}` : null;
  const showChat = selected !== null || effectiveNewSessionCwd !== null;
  const sessionKey = selected?.id ?? newSessionDraftKey ?? "empty";

  const handleSelect = useCallback((s: SessionInfo) => {
    setNewSessionCwd(null);
    setSelected(s);
  }, []);

  const handleNewChat = useCallback((cwd: string) => {
    setSelected(null);
    setNewSessionCwd(cwd);
  }, []);

  return (
    <div
      data-mobile-shell="true"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "var(--app-viewport-height, 100dvh)",
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
          height: "calc(44px + env(safe-area-inset-top))",
          paddingTop: "env(safe-area-inset-top)",
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-panel)",
        }}
      >
        <button
          type="button"
          data-mobile-drawer-toggle="true"
          aria-label="Open sessions"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 44,
            height: 44,
            padding: 0,
            background: "none",
            border: "none",
            color: "var(--text)",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <span
          data-mobile-title="true"
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 14,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {selected ? selected.name || selected.firstMessage || selected.id : newSessionCwd ? "New chat" : "Pi Web"}
        </span>
      </header>

      <main
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
        }}
      >
        {showChat ? (
          <ChatWindow
            key={sessionKey}
            session={selected}
            newSessionCwd={effectiveNewSessionCwd}
            newSessionDraftKey={newSessionDraftKey}
            onSessionCreated={(s) => {
              setNewSessionCwd(null);
              setSelected(s);
              refresh();
            }}
          />
        ) : (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              padding: 24,
              textAlign: "center",
            }}
          >
            {loading ? (
              <span style={{ fontSize: 13, color: "var(--text-dim)" }}>Loading sessions…</span>
            ) : (
              <>
                <span style={{ fontSize: 13, color: "var(--text-dim)" }}>
                  {error ? `Could not load sessions: ${error}` : "No sessions yet."}
                </span>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  style={{
                    minHeight: 44,
                    padding: "0 18px",
                    background: "var(--bg-panel)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    color: "var(--text)",
                    fontSize: 14,
                    cursor: "pointer",
                  }}
                >
                  Choose a project
                </button>
              </>
            )}
          </div>
        )}
      </main>

      <MobileSessionDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        sessions={sessions}
        selectedId={selected?.id ?? null}
        onSelect={handleSelect}
        onNewChat={handleNewChat}
        loading={loading}
        error={error}
      />
    </div>
  );
}
