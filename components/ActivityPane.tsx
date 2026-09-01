"use client";

import { useMemo } from "react";
import type { AgentMessage } from "@/lib/types";

interface ActivityRow {
  id: string;
  icon: "tool" | "bash" | "file";
  title: string;
  detail: string;
  exitCode?: number;
}

/** Collapse a toolCall block's input to a single line for the activity feed. */
function inputSummary(rawInput: string | undefined, input: unknown): string {
  if (rawInput) {
    const oneLine = rawInput.replace(/\s+/g, " ").trim();
    return oneLine.length > 90 ? oneLine.slice(0, 90) + "…" : oneLine;
  }
  try {
    return JSON.stringify(input ?? {});
  } catch {
    return "";
  }
}

/**
 * Right-hand "activity" pane: a flat, chronological feed of the tool calls and
 * commands the agent ran — separate from the conversation prose.
 */
export function ActivityPane({ messages }: { messages: AgentMessage[] }) {
  const rows = useMemo<ActivityRow[]>(() => {
    const out: ActivityRow[] = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role === "bashExecution") {
        out.push({
          id: `${i}-bash`,
          icon: "bash",
          title: m.command.split("\n")[0].replace(/\s+/g, " ").trim(),
          detail: "",
          exitCode: m.exitCode,
        });
        continue;
      }
      if (m.role !== "assistant") continue;
      const blocks = Array.isArray(m.content) ? (m.content as unknown as Array<Record<string, unknown>>) : [];
      for (let j = 0; j < blocks.length; j++) {
        const b = blocks[j];
        if (b?.type === "toolCall") {
          out.push({
            id: `${i}-${j}-tool`,
            icon: "tool",
            title: String(b.toolName ?? "tool"),
            detail: inputSummary(b.rawInput as string | undefined, b.input),
          });
        }
      }
    }
    return out;
  }, [messages]);

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
            background: r.icon === "tool" ? "rgba(59,130,246,0.06)" : r.icon === "bash" ? "rgba(156,163,175,0.08)" : "rgba(16,185,129,0.06)",
            color: "var(--text)",
            overflow: "hidden",
          }}
        >
          <span style={{ flexShrink: 0, fontFamily: "var(--font-mono)", fontSize: 11, color: r.icon === "bash" ? "var(--text-muted)" : "var(--accent)", width: 34 }}>
            {r.icon === "bash" ? "$" : r.icon === "file" ? "✎" : "⚙"}
          </span>
          <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {r.title}
            </span>
            {r.detail && (
              <span style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.detail}
              </span>
            )}
            {r.exitCode !== undefined && (
              <span style={{ fontSize: 10, color: r.exitCode === 0 ? "var(--text-dim)" : "#ef4444" }}>
                {r.exitCode === 0 ? "exit 0" : `exit ${r.exitCode}`}
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
