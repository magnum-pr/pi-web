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
- **L-006 — A test that greps source can pass by matching a COMMENT.** Three
  times in one session a new test asserted `assert.match(source, /someCall\(\)/)`
  and the string being searched for appeared in a doc comment **above** the code,
  so the assertion succeeded while verifying nothing. Two of them were only
  exposed when an unrelated refactor moved the real call; the third failed by
  luck. The failure mode is worse than a normal bug: a broken test fails loudly,
  a **vacuous** test grants confidence that was never earned, and it is invisible
  in a green run. Rules that follow: slice from the *body* (`indexOf` the
  assignment, not the identifier) rather than from the first mention; prefer
  asserting behaviour over the presence of a particular identifier; and when a
  test that should pass starts failing after a pure refactor, suspect the test's
  anchoring before the code. Also: an assertion of *ordering* built from
  successive `indexOf` calls will silently compare positions in prose.
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
- **L-008 — On this codebase, verify the RUNNING BUILD before reporting a defect,
  including one in your own new code.** A stale `.next` (server start time BEFORE
  `BUILD_ID` mtime) made a working collapsible section render as permanently
  expanded, and it was reported to the owner as a bug in the change. It was not:
  the server was serving a build that predated the change. `AGENTS.md` lists the
  build/restart ordering trap and L-003 covers the same ground from the testing
  side; this is the *diagnosis* side of it — **read a surprising result as
  "which build am I looking at?" before "what is wrong with this code?"**, and
  compare process start time to `.next/BUILD_ID` mtime first.
- **L-009 — Fixing a bug and creating one are the same act; budget for it.**
  Making the read-aloud `<audio>` element shared fixed automatic playback (the
  gesture unlock now survives) **and** introduced a stuck "Reading…" indicator
  (the unlock routine called `play()`/`pause()` on the element mid-reply, and a
  pause never fires `ended`, so nothing cleared the state). Both were real, both
  shipped, separated by one device round-trip. The pattern to expect: in shared
  mutable state, every new writer is a new way to desynchronise. When adding a
  writer to a resource, enumerate the readers that assume exclusivity.
  Also worth keeping: `AudioBufferSourceNode` has **no** `onerror` (a buffer
  source cannot fail asynchronously once started — only `play()` on a media
  element can), so an "error handler" written for one is dead code the linter
  cannot see; TypeScript caught it.
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
- **L-011 — "Detection without recovery" is half a fix, and the owner will
  notice.** Making a dead microphone visible was correct work, but the repair was
  left as a manual tap — and the tap was wired as a *toggle*, so recovering cost
  two taps for a failure the app had already detected. When a system can detect
  its own failure, it should repair itself or repair in one action; asking the
  user to perform a repair the app could perform is a usability defect even when
  the diagnosis is right. Same shape as the real fix here: an existing lever
  already forced a rebuild (`deviceTick`), so the "repair" was reusing it rather
  than toggling power.
- **L-005 — Building wipes `.next/`, which a running production server serves
  from.** The server keeps responding from memory and its log stays clean, but it
  then serves chunks that no longer match the replaced build — the mobile shell
  hung on "Loading sessions…" indefinitely with **no error anywhere**. Build and
  restart promptly; never leave a server running against a `.next/` that has been
  rebuilt underneath it. A scratch server on a second port is the safe way to
  verify a build while the live one keeps serving.
