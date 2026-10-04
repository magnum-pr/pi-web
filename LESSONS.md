# LESSONS — PiWeb

> PiWeb-app-specific lessons. Loaded when working in `~/projects/pi-web`.
> Cross-project rules live in `~/.pi/agent/LESSONS.md`; harness/tooling
> lessons live in `~/.pi/LESSONS.md`. Keep this file generic — no client
> or personal data (this repo is public).

## Anti-patterns

- **L-001 (moved from global) — Don't run a production build while a dev server
  is live.** `next build` contends with `next dev` on `.next/dev/lock` and
  pollutes the dev artifact. If the dev port is already up, **reuse the
  running instance** instead of rebuilding.
- **L-002 — The route generator scaffolds a route file it reads as empty.**
  Non-atomic file writes race tsr generation and clobber files
  (`__root.tsx` became the "Hello __root" scaffold). Write files
  atomically; clear `.tanstack` cache if a route file unexpectedly
  regresses.
- **L-003 — Never ask the owner to test a change the running system cannot see
  yet.** Twice in one session the owner picked up their phone for a build that
  did not exist yet: once because the fix was still uncommitted and uncompiled,
  once because `.next/` had been replaced under a server that was still serving
  the previous bundle from memory. Both tests were guaranteed to fail regardless
  of whether the fix was correct — so the likely outcome was a **false negative**,
  sending the next attempt after a bug that was already fixed. **Order is: fix →
  gates → commit → build → restart → *then* device test.** Verify the run is
  current with the process start time vs `.next/BUILD_ID` mtime before involving
  anyone. The check takes two seconds; guessing wrong costs a build-and-retest
  cycle of the owner's time. (Related: `AGENTS.md` already listed this as a trap;
  knowing it was not enough.)
- **L-004 — Tailwind v4's PostCSS pipeline can silently drop a hand-written CSS
  rule, and the source will look perfect.** A `max-width: 640px` rule for
  `.project-state-stats` never reached the built stylesheet while its neighbours
  in the **same media block** (`.chat-stats-center`, `.message-usage`,
  `.directory-picker-*`) all did. Renaming the class and removing the adjacent
  comment changed nothing. **Check the built CSS, not the source** — grep
  `.next/static/css/*.css` for the selector. If it is absent, gate in React with
  `useIsMobile` instead of fighting the pipeline, and leave a note so the rule is
  not re-added. Generalise: any "I wrote the CSS and it did nothing" bug should
  start by proving the rule was emitted at all.
- **L-006 — A test that greps source can pass by matching a COMMENT.** See
  **GL-021** (global): the reasoning failure and the rules are recorded there.
  Project-specific outcome: three test assertions in this repo were found
  vacuous for exactly this reason, in `hooks/useReadAloud.test.mjs` and
  `hooks/useDeadCapture.test.mjs`.
- **L-007 — A grep-based orphan/dead-code scan over a TS+Next repo is mostly
  false positives; do not delete on its output.** A file-orphan heuristic flagged
  `MessageView`, `atomic-file`, `path-security`, `startup-preferences` and ~50
  others as unreferenced — **all demonstrably live** — because imports appear as
  `@/x`, `./x`, `../x` and extensionless forms, and no single pattern sees all of
  them. The reliable method is to extract every import specifier
  (`from "..."`, `import("...")`, `require("...")`) from the tree and compare
  basenames; that found the one genuine candidate. Corollary: an exported symbol
  with "no references in other files" is usually just used within its own file —
  count occurrences *in the defining file* before calling it dead. Two removals
  were safe only because they had exactly one occurrence (the definition).
- **L-008 — Verify the RUNNING BUILD before reporting a defect, including in your
  own new code.** See **GL-023** (global) for the general form. Project detail:
  check process start time against `.next/BUILD_ID` mtime; a stale `.next` made a
  working collapsible section render as permanently expanded and it was reported
  as a bug in the change. `AGENTS.md` lists the build/restart ordering trap and
  L-003 covers the testing side; this is the *diagnosis* side.
- **L-010 — iOS audio: the gesture requirement is lifted PERMANENTLY after the
  first gesture, and losing the unlock is an application bug.** WebKit's
  `HTMLMediaElement::removeBehaviorRestrictionsAfterFirstUserGesture()` runs once
  and the restriction does not return. "Autoplay is blocked on iOS" is therefore
  the wrong mental model — the correct one is "autoplay is blocked until the page
  has been interacted with". Concretely: take the unlock deliberately on the first
  tap anywhere (a one-sample buffer at zero gain completes it silently), and
  **reuse one media element** — a freshly constructed `Audio`/`AudioContext` is
  unproven again, so building one per playback throws the unlock away. Symptom of
  getting this wrong is distinctive and worth recognising: **automatic playback
  fails while the same content plays fine when tapped manually.**
- **L-012 — `AudioBufferSourceNode` has no `onerror`.** A buffer source cannot
  fail asynchronously once started, unlike a media element — only `play()` on an
  `HTMLMediaElement` rejects. An "error handler" written for a buffer source is
  dead code no linter will flag; TypeScript catches it as a missing property,
  which is how it was found. Attach error handling to `play()`/`decodeAudioData`
  instead.
- **L-005 — Building wipes `.next/`, which a running production server serves
  from.** The server keeps responding from memory and its log stays clean, but it
  then serves chunks that no longer match the replaced build — the mobile shell
  hung on "Loading sessions…" indefinitely with **no error anywhere**. Build and
  restart promptly; never leave a server running against a `.next/` that has been
  rebuilt underneath it. A scratch server on a second port is the safe way to
  verify a build while the live one keeps serving.

## Promoted out of this file

These were written here first and then generalised, because the underlying
reasoning failure was not PiWeb-specific. The project-specific detail is gone
from this file deliberately — keep new entries here only if they would be
*wrong* somewhere else.

| Was | Now |
|---|---|
| L-009 — fixing and breaking are the same act in shared state | **GL-024** |
| L-011 — detection without recovery is half a fix | **GL-025** |

The numbering gap (no L-009 / L-011) is intentional and not a deleted lesson.

Also promoted, originally written here before being generalised:
L-006 → **GL-021** (a test can pass by matching a comment),
L-008 → **GL-023** (ask which build you are looking at).
L-007 (orphan-scan false positives) and L-010 / L-012 (iOS audio internals)
stay local — they are only correct in this stack.
