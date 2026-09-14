# Upstream `agegr/pi-web` — changes since our fork base

Our local `main` branched from upstream at `96c643a` (2026-08-26).
This note captures what upstream shipped in the **99 commits** from there to
`upstream/main` = `8366762` (**Release v0.9.1**), across **v0.8.11 → v0.9.0 → v0.9.1**.

Scale: **210 files changed, +15,986 / −8,366** (`components/` ≈22% of the diff,
`lib/` ≈42%).

---

## ⭐ Built-in subagents (largest feature cluster)

- **Enabled built-in subagents by default** (`237d0ca`).
- **Worktree isolation** — each subagent runs in its own git worktree
  (`2661247`).
- **Persisted-session resume** — resume a subagent's prior session (`a31d5c5`).
- **Concurrent-run queue** — queue overlapping subagent runs
  (new `lib/subagent-queue.ts`, `b77a25f`).
- **Profiles** — support `tintinweb` agent profiles (`bbe2f7d`); honor
  extension tool selectors (`e3fbbf6`).
- **Profile round-trip** — save preserves frontmatter keys pi-web does not own
  (`name`, `allowed_subagents`, `exclude_extensions`, `disallowed_tools`, …).
- **Delete semantics** — deleting a parent session cascades its subagent
  descendants (`e83f4b5`).
- New API: `app/api/subagents/profiles/`, `app/api/subagents/settings/`.

## ⭐ Workspace terminal

- **Terminal tabs in the file panel** (`9290c27`, `TerminalPanel.tsx`).
- New backend: `lib/terminal-manager.ts`, `lib/terminal-client.ts`,
  `app/api/terminal/route.ts`, `app/api/terminal/[id]/route.ts`,
  `app/api/terminal/[id]/events/route.ts`, `bin/prepare-terminal.js`.
- **New docs:** `docs/terminal.md`.
- New deps: `@xterm/xterm`, `@xterm/addon-fit`, `node-pty`.
- Platform fixes: default terminal shells to a UTF-8 locale (`2e914db`); ship
  Linux terminal prebuilds and report native load failures (`ce18006`).

## Other headline features

- **Browser password login** (`e685cac`, #505) — `PI_WEB_PASSWORD` now drives a
  real login page (`app/login/page.tsx`, `app/api/web-auth/`) instead of HTTP
  Basic only; API clients may still use Basic Auth (user `pi`).
- **Provider usage quotas** (`6d53fd5`) — `lib/provider-usage.ts`,
  `app/api/provider-usage/query/`, `ProviderUsageSummary.tsx`.
- **Session search** — text search with jumps + cross-window sync
  (`1cbd96f`, `SessionSearch.tsx`, `app/api/sessions/search/`).
- **Configurable idle timeout** — `PI_WEB_IDLE_TIMEOUT_MS` (`e9f954a`, #665).
- **Extension session liveness** — versioned registry so extensions doing
  detached work prevent automatic idle eviction (`lib/session-liveness.ts`,
  `app/api/agent/[id]/lease/`).
- **Keep selected sessions alive** (`0ff1138`).
- **Branch conversations from selected text** (`c0abfc2`, #698).
- **Plugin update check + bulk update** in settings (`50b7f79`, #611).

## Improvements by area

- **Chat / input:** Alt/Option+Enter sends a follow-up while streaming (#657);
  per-session reading positions (#723); preserve unsent new-session drafts
  (#720); first-message session forks (`585d56c`); Mermaid diagram previews
  (#693); inline video preview in the file panel (#655); wide Markdown tables
  scroll horizontally (#650); @ file picker visibility (#768) + keyboard
  wrapping (#769); Ctrl/Cmd-click opens local file links (#708); escaped
  backticks in inline code; rich-text paste links (#537); warn on images sent
  to a non-vision model (#636).
- **Appearance:** readable themes + toolbar theme selector (`448e146`);
  chat content width & font size (#704); expand thinking blocks by default
  (#639); thinking-block borders/typography; settings reorganized (chat display
  grouping, appearance simplification + resets).
- **PWA / mobile / iOS:** iOS background push delivery (#728); renotify repeated
  completion notifications (#701); opaque PWA icons (#718); mobile status-bar
  wrap (#604); mobile streaming scroll-follow fix (#715);
  `?sidebar=collapsed` for embedded launches (#712).
- **Extensions:** ANSI colors in widgets via `AnsiText` + `ansi_up` (#601);
  Markdown extension prompts (#699); show top-level extensions in plugin
  settings (`ef51ffd`); extension dialog keyboard nav + countdown; status shelf
  label scrolling (#675).
- **Perf / infra:** windowed sidebar session list (#626); cached session
  metadata; gzipped large JSON responses (#731); file-panel highlight-tree
  cache (#653); text-preview pagination. Added CI (`.github/workflows/ci.yml`)
  pinned to Node 22.19.0, and an e2e harness (`e2e/run.mjs`, `themes`,
  `terminal`, `chat-appearance`, `extension-dialog`). i18n localization sweep.
  Windows PowerShell tool toggle (`081c5b1`).
- **Deps:** `@earendil-works/*` **0.84.3 → 0.85.1**; added `ansi_up`, `semver`
  (plus the xterm/node-pty noted above).

## Overlap risk with our voice commits

Upstream touched files our 23 voice/device commits also changed — expect merge
conflicts around:
- Settings reorganization vs our `MicSensitivityControl` / mic & output pickers.
- Input handling (Alt+Enter, forks, drafts) near `ChatInput` / `useVoiceInput`.
- Broad `components/` + `lib/` churn.
