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
- **L-005 — Building wipes `.next/`, which a running production server serves
  from.** The server keeps responding from memory and its log stays clean, but it
  then serves chunks that no longer match the replaced build — the mobile shell
  hung on "Loading sessions…" indefinitely with **no error anywhere**. Build and
  restart promptly; never leave a server running against a `.next/` that has been
  rebuilt underneath it. A scratch server on a second port is the safe way to
  verify a build while the live one keeps serving.
