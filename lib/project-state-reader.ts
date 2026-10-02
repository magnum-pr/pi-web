import fs from "fs";
import path from "path";
import type { MemorySource, ProjectStateInput, SourceStatus } from "@/lib/project-state";

const MAX_MEMORY_FILE_BYTES = 256 * 1024; // matches /api/files text preview bound

const MEMORY_FILES: Array<{ source: MemorySource; fileName: string }> = [
  { source: "plan", fileName: "PLAN.md" },
  { source: "tasks", fileName: "TASKS.md" },
  { source: "progress", fileName: "PROGRESS.md" },
  { source: "decisions", fileName: "DECISIONS.md" },
  { source: "vision", fileName: "VISION.md" },
];

/**
 * Read the five harness memory files from a project root and map each to
 * `present` / `absent` / `error`. Pure filesystem + status mapping — no auth,
 * no project resolution — so it is unit-testable in isolation.
 */
export function readProjectStateFromDir(
  projectRoot: string,
  options: { maxBytes?: number } = {},
): { input: ProjectStateInput; sources: Record<MemorySource, SourceStatus> } {
  const maxBytes = options.maxBytes ?? MAX_MEMORY_FILE_BYTES;
  const input: ProjectStateInput = {
    plan: null,
    tasks: null,
    progress: null,
    decisions: null,
    vision: null,
  };
  const sources: Record<MemorySource, SourceStatus> = {
    plan: "absent",
    tasks: "absent",
    progress: "absent",
    decisions: "absent",
    vision: "absent",
  };

  for (const { source, fileName } of MEMORY_FILES) {
    const filePath = path.join(projectRoot, fileName);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      sources[source] = "absent";
      continue;
    }
    if (!stat.isFile() || stat.size > maxBytes) {
      sources[source] = "error";
      continue;
    }
    try {
      input[source] = fs.readFileSync(filePath, "utf8");
      sources[source] = "present";
    } catch {
      sources[source] = "error";
    }
  }

  return { input, sources };
}
