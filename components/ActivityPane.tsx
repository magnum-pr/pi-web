"use client";

import { useMemo } from "react";
import type { AgentMessage } from "@/lib/types";

interface ActivityRow {
  id: string;
  icon: "tool" | "bash";
  title: string;
  detail: string;
  exitCode?: number;
  running?: boolean;
}

/** Collapse a toolCall block's input to a single line for the activity feed. */
function inputSummary(rawInput: string | undefined, input: unknown): string {
  if (rawInput) {
    const oneLine = rawInput.replace(/\s+/g, " ").trim();
    return oneLine.length > 100 ? oneLine.slice(0, 100) + "…" : oneLine;
  }
  try {
    return JSON.stringify(input ?? {});
  } catch {
    return "";
  }
}

/** Truncate a command/output blob to a single short line. */
function oneLine(s: string | undefined, max = 100): string {
  if (!s) return "";
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max) + "…" : flat;
}

function toolRowsFrom(msg: AgentMessage, prefix: string, running: boolean): ActivityRow[] {
  if (msg.role !== "assistant") return [];
  const blocks = Array.isArray(msg.content) ? (msg.content as unknown as Array<Record<string, unknown>>) : [];
  const rows: ActivityRow[] = [];
  for (let j = 0; j < blocks.length; j++) {
    const b = blocks[j];
    if (b?.type !== "toolCall") continue;
    const toolName = String(b.toolName ?? "tool");
    const input = b.input as { command?: string } | undefined;
    const isBash = toolName === "bash" || toolName === "exec" || toolName === "shell" || !!input?.command;
    if (isBash) {
      // Extract the actual command, not the raw JSON wrapper.
      rows.push({
        id: `${prefix}-${j}`,
        icon: "bash",
        title: (input?.command ?? (b.rawInput as string | undefined) ?? "").trim().split("\n")[0] || toolName,
        detail: "",
        running,
      });
    } else {
      rows.push({
        id: `${prefix}-${j}`,
        icon: "tool",
        title: toolName,
        detail: inputSummary(b.rawInput as string | undefined, b.input),
        running,
      });
    }
  }
  return rows;
}

/**
 * Right-hand "activity" pane: a live, chronological feed of the tool calls and
 * commands the agent is running. Settled messages plus the streaming message
 * (so in-progress calls appear immediately, marked running).
 */
export function ActivityPane({ messages, streamingMessage, isStreaming }: {
  messages: AgentMessage[];
  streamingMessage?: AgentMessage | null;
  isStreaming?: boolean;
}) {
  const rows = useMemo<ActivityRow[]>(() => {
    const out: ActivityRow[] = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role === "bashExecution") {
        out.push({
          id: `${i}-bash`,
          icon: "bash",
          title: m.command.split("\n")[0],
          detail: oneLine(m.output, 100),
          exitCode: m.exitCode,
        });
        continue;
      }
      out.push(...toolRowsFrom(m, `${i}-m`, false));
    }
    // Live tail: tool calls in the not-yet-settled streaming message.
    if (isStreaming && streamingMessage) {
      out.push(...toolRowsFrom(streamingMessage, `live`, true));
    }
    return out;
  }, [messages, streamingMessage, isStreaming]);

  if (rows.length === 0) {
    return (
      <div style={{ padding: 16, fontSize: 12, color: "var(--text-dim)" }}>
        No commands or file activity yet.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "10px 8px" }}>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-dim)", padding: "0 6px 6px" }}>
        Activity
      </div>
      {rows.map((r) => (
        <div
          key={r.id}
          style={{
            display: "flex", alignItems: "flex-start", gap: 8,
            padding: "6px 8px", borderRadius: 7, fontSize: 12,
            borderLeft: r.running ? "2px solid var(--accent)" : "2px solid transparent",
            background: r.icon === "bash" ? "rgba(156,163,175,0.08)" : "rgba(59,130,246,0.06)",
            color: "var(--text)",
            overflow: "hidden",
          }}
        >
          <span style={{ flexShrink: 0, fontFamily: "var(--font-mono)", fontSize: 11, width: 18, color: r.running ? "var(--accent)" : r.icon === "bash" ? "var(--text-muted)" : "var(--accent)" }}>
            {r.running ? (
              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", animation: "pulse 1.2s ease-in-out infinite", verticalAlign: "middle" }} />
            ) : r.icon === "bash" ? "$" : "⚙"}
          </span>
          <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {r.title}
            </span>
            {r.detail && (
              <span style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.detail}
              </span>
            )}
            {r.running ? (
              <span style={{ fontSize: 10, color: "var(--text-dim)" }}>running…</span>
            ) : r.exitCode !== undefined && (
              <span style={{ fontSize: 10, color: r.exitCode === 0 ? "var(--text-dim)" : "#ef4444" }}>
                {r.exitCode === 0 ? "exit 0" : `exit ${r.exitCode}`}
              </span>
            )}
          </span>
        </div>
      ))}
      <style>{`@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }`}</style>
    </div>
  );
}
