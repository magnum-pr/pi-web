"use client";

import { useMemo, useState } from "react";

import type { SessionInfo } from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  sessions: SessionInfo[];
  selectedId: string | null;
  onSelect: (session: SessionInfo) => void;
  onNewChat: (cwd: string) => void;
  /** Session ids currently running, for the spinner. */
  runningIds?: ReadonlySet<string>;
  /** Session ids with unread completions, for the badge. */
  unreadIds?: ReadonlySet<string>;
  loading?: boolean;
  error?: string | null;
}

/** Distinct project directories, most-recently-seen first. */
function projectList(sessions: SessionInfo[]): { cwd: string; label: string }[] {
  const seen = new Set<string>();
  const out: { cwd: string; label: string }[] = [];
  for (const s of sessions) {
    if (!s.cwd || seen.has(s.cwd)) continue;
    seen.add(s.cwd);
    const parts = s.cwd.replace(/\/+$/, "").split("/");
    out.push({ cwd: s.cwd, label: parts[parts.length - 1] || s.cwd });
  }
  return out;
}

/**
 * Mobile session drawer.
 *
 * IMPORTANT — built *inert* when closed. The desktop drawer toggles `opacity`
 * (transitioned) and `pointerEvents` (not transitioned) while the panel slides
 * for 250ms; taps landing in that window are swallowed or hit the wrong layer,
 * which is the "dead click" defect the owner reports on the phone (findings F13,
 * grill D1). Here the closed drawer is `visibility: hidden` + `pointer-events:
 * none`, so it can never intercept a tap regardless of animation timing.
 */
export function MobileSessionDrawer({
  open,
  onClose,
  sessions,
  selectedId,
  onSelect,
  onNewChat,
  runningIds,
  unreadIds,
  loading = false,
  error = null,
}: Props) {
  const [newChatOpen, setNewChatOpen] = useState(false);
  const projects = useMemo(() => projectList(sessions), [sessions]);

  return (
    <>
      {/* Backdrop. Always mounted but inert unless open. */}
      <div
        data-mobile-drawer-backdrop={open ? "open" : "closed"}
        onClick={onClose}
        aria-hidden={!open}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 199,
          background: "rgba(0,0,0,0.45)",
          opacity: open ? 1 : 0,
          // Both are set together and neither is animated, so the backdrop can
          // never be interactive while invisible, nor invisible while blocking.
          pointerEvents: open ? "auto" : "none",
          visibility: open ? "visible" : "hidden",
          transition: "opacity 0.2s ease, visibility 0.2s ease",
        }}
      />

      {/*
        The drawer is parked at `left: 0` and hidden by a clip window that
        collapses to zero width — never by a negative horizontal offset.

        Why this matters (F15): the previous form used
        `transform: translateX(-101%)`, which put a `position: fixed` element
        ~323px to the LEFT of the viewport on a 393px screen. Measured on the
        live build: `matrix(1,0,0,1,-323.2,0)`. That was the only element on
        the page extending left of the viewport, and iOS Safari — which is
        aggressive about revealing offscreen content when a field takes focus —
        scrolled toward it when the composer was tapped. Chrome clips it silently
        (`documentElement.scrollWidth` stays 393), so this never reproduced in
        emulation.

        The clip window keeps the drawer visually identical while leaving no
        element offscreen-left. It must stay at least as wide as the drawer when
        open so the panel is never reshaped.
      */}
      <div
        data-mobile-drawer-clip={open ? "open" : "closed"}
        aria-hidden={!open}
        style={{
          position: "fixed",
          top: 0,
          bottom: 0,
          left: 0,
          zIndex: 200,
          width: open ? "min(85vw, 320px)" : 0,
          overflow: "hidden",
          pointerEvents: "none",
        }}
      >
        <aside
          data-mobile-drawer={open ? "open" : "closed"}
          aria-hidden={!open}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            width: "min(85vw, 320px)",
            display: "flex",
            flexDirection: "column",
            background: "var(--bg-panel)",
            borderRight: "1px solid var(--border)",
            paddingTop: "env(safe-area-inset-top)",
            paddingBottom: "env(safe-area-inset-bottom)",
            paddingLeft: "env(safe-area-inset-left)",
            // No horizontal translation, so nothing sits left of the viewport.
            // The clip window above performs the reveal instead.
            transition: "none",
            // The load-bearing line: a closed drawer is not hit-testable and is
            // removed from the a11y tree, so it cannot swallow taps.
            visibility: open ? "visible" : "hidden",
            pointerEvents: "none",
          }}
        >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "12px 12px 8px",
          }}
        >
          <strong style={{ fontSize: 15, letterSpacing: "-0.01em" }}>Pi Web</strong>
          <button
            type="button"
            onClick={() => setNewChatOpen((v) => !v)}
            aria-expanded={newChatOpen}
            data-mobile-new-chat="true"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              minHeight: 44,
              padding: "0 14px",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              color: "var(--text)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            + New
          </button>
        </div>

        {newChatOpen && (
          <div
            data-mobile-project-list="true"
            style={{ padding: "0 12px 10px", display: "flex", flexDirection: "column", gap: 6 }}
          >
            {projects.length === 0 && (
              <span style={{ fontSize: 12, color: "var(--text-dim)" }}>No projects yet</span>
            )}
            {projects.map((p) => (
              <button
                key={p.cwd}
                type="button"
                onClick={() => {
                  setNewChatOpen(false);
                  onClose();
                  onNewChat(p.cwd);
                }}
                style={{
                  minHeight: 44,
                  textAlign: "left",
                  padding: "0 12px",
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  color: "var(--text)",
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
          {loading && (
            <div style={{ padding: 12, fontSize: 12, color: "var(--text-dim)" }}>Loading…</div>
          )}
          {error && (
            <div style={{ padding: 12, fontSize: 12, color: "#ef4444" }}>
              Could not load sessions: {error}
            </div>
          )}
          {!loading && !error && sessions.length === 0 && (
            <div style={{ padding: 12, fontSize: 12, color: "var(--text-dim)" }}>No sessions</div>
          )}
          {sessions.map((s) => {
            const selected = s.id === selectedId;
            const running = runningIds?.has(s.id) ?? false;
            const unread = unreadIds?.has(s.id) ?? false;
            return (
              <button
                key={s.id}
                type="button"
                data-mobile-session-row={s.id}
                aria-current={selected ? "true" : undefined}
                onClick={() => {
                  onSelect(s);
                  onClose();
                }}
                style={{
                  display: "block",
                  width: "100%",
                  minHeight: 56,
                  textAlign: "left",
                  padding: "10px 12px",
                  background: selected ? "var(--bg-selected, rgba(255,255,255,0.06))" : "none",
                  border: "none",
                  borderBottom: "1px solid var(--border)",
                  color: "var(--text)",
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    display: "block",
                    fontSize: 14,
                    lineHeight: 1.3,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {s.name || s.firstMessage || s.id}
                </span>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginTop: 4,
                    fontSize: 11,
                    color: "var(--text-dim)",
                  }}
                >
                  {running && (
                    <span
                      data-mobile-session-running="true"
                      aria-label="Running"
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        border: "2px solid var(--accent)",
                        borderTopColor: "transparent",
                        display: "inline-block",
                      }}
                    />
                  )}
                  {unread && (
                    <span
                      data-mobile-session-unread="true"
                      aria-label="Unread"
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: "var(--accent)",
                        display: "inline-block",
                      }}
                    />
                  )}
                  <span>{s.messageCount} msgs</span>
                  <span>·</span>
                  <span>{new Date(s.modified).toLocaleDateString()}</span>
                </span>
              </button>
            );
          })}
        </div>
      </aside>
      </div>
    </>
  );
}
