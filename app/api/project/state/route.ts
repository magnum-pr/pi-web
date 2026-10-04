import { NextRequest, NextResponse } from "next/server";
import {
  getAllowedFileRoots,
  isExistingFilePathAllowed,
  isFilePathAllowed,
  isWindowsAbsolutePath,
} from "@/lib/file-access";
import { buildProjectState, type ProjectState } from "@/lib/project-state";
import { resolveProject } from "@/lib/worktree";
import { readProjectStateFromDir } from "@/lib/project-state-reader";

export const dynamic = "force-dynamic";

// GET /api/project/state?cwd=<absolute path> - project-at-a-glance state.
//
// The cwd must already be an allowed root (a session cwd or resolved project
// root) — this route deliberately does NOT call allowFileRoot, so it can never
// be used to browse arbitrary directories.
export async function GET(request: NextRequest) {
  try {
    const cwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
    if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
      return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
    }

    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Resolve the project root (collapses linked worktrees to the main repo)
    // and confirm it exists and is authorized before reading.
    const project = await resolveProject(cwd);
    const projectRoot = project.projectRoot;
    if (!isExistingFilePathAllowed(projectRoot, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const { input, sources } = readProjectStateFromDir(projectRoot);
    const state = buildProjectState(input);

    const result: ProjectState & { projectRoot: string } = {
      ...state,
      sources,
      projectRoot,
    };

    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
