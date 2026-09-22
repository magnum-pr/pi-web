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
