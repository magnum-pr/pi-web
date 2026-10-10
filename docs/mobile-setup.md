# Pi Web on your phone — setup

One canonical setup guide for running Pi Web from a phone, with the voice
surface working end to end. It covers the whole path: prepare the hub machine,
expose it privately, install the app on the phone, and configure voice.

- **Hub** — the machine that runs Pi Web and does all the work.
- **Phone** — a browser or installed app pointing at the hub.
- **Transport** — Tailscale. Private, TLS, no internet exposure.

> **Do not** use `tailscale funnel`, port-forward 30141, or point a public
> tunnel (ngrok/Cloudflare) at Pi Web. The Tailnet is the boundary; see
> [Hardening](#hardening).

---

## 1. Prepare the hub

### Prerequisites

| Requirement | Check |
|---|---|
| Node.js ≥ 22.19.0 | `node --version` |
| Python 3 + `venv` (for Piper / PocketSphinx) | `python3 --version` |
| `git`, `cmake`, a C++ compiler (macOS/Linux — builds whisper.cpp) | `xcode-select --install`, `brew install cmake` |
| A model provider configured | Pi Web → **Models** panel |

### Install the voice stack

All voice processing runs on the hub, never on the phone. Two setup scripts,
one each for input and output:

```bash
npm install
npm run setup:whisper          # speech → text: base.en model (~140 MB)
npm run setup:voice            # text → speech + wake word: Piper venv, 3 voices, PocketSphinx
```

Optional: a more accurate dictation model — `npm run setup:whisper small.en`
(~466 MB). Installed models are switchable from the selector beside the mic.

`setup:voice` creates the Python venv **outside the repo** (default
`~/.piper-venv`) and downloads voices into `piper/voices/`. That placement is
deliberate: `next build` walks the project tree, and a venv's `bin/python` is a
symlink pointing outside the root, which aborts a Turbopack production build.

**Platform notes**

- **Windows** — the `whisper-server` binaries ship with this repo, so
  `setup:whisper` only downloads the model. They need the Microsoft Visual C++
  Redistributable, already present on most machines.
- **Linux** — install the toolchain first:
  `sudo apt install cmake build-essential`.

### Verify before going further

```bash
ls whisper/bin whisper/models      # whisper.cpp server + ggml model
ls piper/voices                    # <voice>.onnx + <voice>.onnx.json
```

Both scripts are idempotent — re-run them if something is missing. The engine
resolves missing pieces as "unavailable" and hides the affected control rather
than offering a button that cannot work.

---

## 2. Run Pi Web on the hub

Build for reliability — a production build has no hot-reload surprises mid-walk.

```bash
npm run build
npm run start        # binds 127.0.0.1:30141
```

**Keep it on loopback.** `tailscale serve` proxies to a local port, so the
phone reaches Pi Web *through* `tailscaled` with the port never exposed on a
network interface. `npm run start:lan` binds `0.0.0.0`, which lets every device
on the same Wi-Fi or Tailnet hit the port directly, bypassing the proxy — and a
check that trusts a forwarded header can then be spoofed. Use `start:lan` only
if you are not using `tailscale serve`.

Do not run `next build` while a dev server is live; they contend on
`.next/dev/lock`.

On a hub managed by the bundled supervisor (`scripts/piweb-supervisor.sh`,
launchd `com.<user>.piweb`), the job keeps the server up and sources
`~/.pi-web.env` on every start — put the variables from
[Authentication](#4-authentication) there rather than exporting them by hand.
Restart with `scripts/piweb-restart.sh`; never `kill` the server process, since
an agent session runs as its child.

---

## 3. Expose it to the Tailnet

### Install Tailscale

Install and sign in with **one account** on both the hub and the phone:

- **macOS / Linux hub** — https://tailscale.com/download
- **Phone** — Tailscale from the App Store / Play Store, same account

```bash
tailscale status     # both devices should be listed
```

### Serve Pi Web to the Tailnet only

```bash
tailscale serve --bg 30141
tailscale serve status        # confirm: exactly one port, no funnel entry
```

This publishes Pi Web at a Tailnet-only URL of the form
`https://<machine>.<tailnet>.ts.net` that only your own devices can open. HTTPS
matters for more than privacy — browsers refuse microphone access outside a
secure context, so a plain `http://192.168.x.x` address gets no voice at all.

If a reverse proxy sends an external hostname, add that exact name to
`PI_WEB_ALLOWED_HOSTS` (see below). That allow-list does not change the address
Pi Web binds to.

---

## 4. Authentication

> **Set the password before the port is reachable.** Enabling reachability
> first and auth second is how a window appears.

Pi Web has **two gates, and only one of them is a login**:

| Gate | What it does | Default |
|---|---|---|
| Host / origin (`isApiRequestAllowed`) | Rejects cross-site browser requests and any Host that is not loopback, an IP literal, or in `PI_WEB_ALLOWED_HOSTS`. Applied to every route by `proxy.ts` — including `/m`. | Always on |
| Password (`PI_WEB_PASSWORD`) | HTTP Basic Auth, fixed username `pi`, constant-time compare. | **Off** |

With no password set, anyone who can reach the port is served in full —
including `/api/sessions`, which hands over raw transcripts. On loopback that is
tolerable; on a Tailnet it is not.

```bash
export PI_WEB_PASSWORD='a-long-random-password'   # username is always `pi`
export PI_WEB_ALLOWED_HOSTS='<phone-tailscale-ip>,<hub>.ts.net'
```

Find device addresses with `tailscale status`. Narrowing the allowed hosts
matters most on cellular, where the phone sits behind carrier NAT shared with
strangers — but Tailscale being *up* is what keeps the traffic on the Tailnet.
If Tailscale drops, the correct outcome is an unreachable Pi Web, never a
fallback to a public path.

Both gates are pinned by `proxy.test.mjs`: 401 without credentials, wrong
password, wrong username, every API route, and the UI root.

**What the password does and does not buy you:** it proves the caller knows it,
and over `tailscale serve` the credential is not exposed in transit. It does
*not* survive a compromised or unlocked phone — the browser caches it, and
`/api/sessions` serves transcripts with no second factor. Device lock and
Tailnet membership remain load-bearing.

---

## 5. Install on the phone

Pi Web installs as a PWA. No app store, no build on the device.

**iOS / iPadOS (Safari)**

1. Open the Tailnet URL and confirm the mobile shell loads.
2. Share → **Add to Home Screen** → Add.
3. Launch from the icon — it opens standalone at `/m`.

**Android (Chrome)**

1. Open the Tailnet URL.
2. Menu → **Add to Home screen** / **Install app**.
3. Launch from the icon.

Sign in with the Basic Auth password once; the browser remembers it for the
session.

### First-run checklist

- [ ] The icon opens `/m`, not `/`.
- [ ] The ☰ drawer lists your projects; left-edge swipe opens it from a chat.
- [ ] Tapping the mic prompts for microphone permission — **grant it**. There
      is no second prompt, and a denied permission looks the same as a broken
      mic.
- [ ] Hold-to-talk captures and releases.
- [ ] **Read replies aloud** plays through the phone.
- [ ] (Optional) Hands-free listening arms on the wake word.

> **Audio starts only after a gesture.** iOS lifts its autoplay restriction
> permanently once the page has been interacted with, so the first tap anywhere
> performs the unlock. Before that, automatic playback fails while a *manual*
> tap plays fine. That asymmetry is the signature of a missing unlock, not of a
> broken audio pipeline.

---

## What the mobile surface is

`/m` is a **separate component tree**, not a responsive restyle of the desktop
app. Both run over the same backend: same API routes, same auth, same session
files, and the same `ChatWindow` / `useAgentSession` / voice hooks.

| Concern | On `/m` |
|---|---|
| Session list | Full-screen left drawer; left-edge swipe from a chat |
| Header | Session title + ☰ only — no cost bar, sidebar, or minimap |
| Composer | Touch-sized controls, hold-to-talk voice pill, ⚙ settings drawer |
| Settings | Sectioned drawer: Model / Audio / Voice / Advanced |
| Chrome | Safe-area insets for notch and home indicator; fixed viewport height |

A phone reaches it three ways: the manifest sets `start_url: "/m"`, so a
home-screen launch lands there; `app/page.tsx` redirects phones and tablets from
`/` to `/m` by user agent; and `/m` works directly from any device.

Detection is **user-agent based, never viewport based** (`lib/mobile-ua.ts`), so
a narrowed desktop window keeps the desktop UI. iPadOS 13+ reports a `Macintosh`
desktop UA — the `Macintosh` + `Mobile` combination is the documented tell. The
two trees never switch after load; a stale tab stays on whichever route it
opened.

### Settings drawer

The ⚙ button opens a right-hand drawer. Sections are flat headings, never
collapsible panels — a collapsed section on a phone hides the control the
drawer was opened for.

| Section | Controls |
|---|---|
| **Model** | Model, reasoning level |
| **Audio** | Read replies aloud, speaking voice, output device, completion sound, last read-aloud failure |
| **Voice** | Hands-free listening, follow-up window, microphone source, input sensitivity |
| **Advanced** | Wake word and timings: wake word, stop phrase, silence timeout, max recording, follow-up patience |

Edits are written to a machine-local override at
`~/.pi/agent/voice-config.json` (follows `PI_CODING_AGENT_DIR`), merged
per-section over the tracked `voice-config.json`, and re-validated through the
same clamp-on-read path the base config uses. A phone never modifies the
checkout. Wake-word and stop-phrase changes take effect without a rebuild — the
phrases are read from config and passed to the spotter at spawn.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Phone shows the desktop UI | Stale tab opened before the redirect, or a manifest not yet installed. Open `/m` directly. |
| Mic button missing | No secure context (plain-HTTP LAN address), or whisper not set up. Connect over the Tailnet URL. |
| Automatic playback silent, manual tap works | The audio unlock has not happened yet — tap anywhere once. |
| "Read-aloud failed" in the Audio section | Piper missing or not set up; the section shows the real reason. |
| Wake word never fires | Keyword spotter missing (`npm run setup:voice`), or the threshold is too strict. |
| Wake word fires constantly | Threshold too loose; raise it in **Advanced**. |
| Drawer unresponsive on iOS | Reload the tab; verify with the current build, not a cached one. |

The run is current when the server process start time is newer than
`.next/BUILD_ID`. A stale `.next` under a running server produces failures with
no error anywhere.

---

## Hardening

Beyond the password and the two gates:

1. **Lock `PI_WEB_ALLOWED_HOSTS`** to your phone and hub only. This narrows
   "any device on the net" to "these specific devices."
2. **Keep the Tailnet minimal.** Only your devices; share it with no one.
3. **Bind to loopback**, not `0.0.0.0` — see [step 2](#2-run-pi-web-on-the-hub).
4. **Verify, don't intend:** `tailscale serve status` should show only the
   expected port. A `funnel` entry is the failure this catches. Run it whenever
   you start Pi Web.
5. **Remove a lost device from the Tailnet immediately.** Device lock is the
   only thing between a found phone and full agent access — no second factor
   exists.

---

## Reference

### Engine environment variables

Resolution order is explicit overrides first, then repo-local directories.

| Variable | Purpose | Default |
|---|---|---|
| `WHISPER_SERVER_PATH` | `whisper-server` binary | `whisper/bin/` |
| `WHISPER_MODEL_DIR` | Directory of `ggml-*.bin` / `*.gguf` models | `whisper/models/` |
| `WHISPER_HOST` / `WHISPER_PORT` | Whisper bind address / port | `127.0.0.1:8765` |
| `PIPER_PYTHON` | Python executable for the Piper server | from the venv |
| `PIPER_VENV_DIR` | Venv created by `setup:voice` | `~/.piper-venv` |
| `PIPER_VOICES_DIR` | Directory of `<voice>.onnx` files | `piper/voices/` |
| `PIPER_HOST` / `PIPER_PORT` | Piper bind address / port | `127.0.0.1:8766` |
| `PIPER_DEFAULT_VOICE` | Voice used when none is selected | `en_US-lessac-medium` |
| `PI_WEB_PASSWORD` | Enables Basic Auth; username is always `pi` | unset (auth off) |
| `PI_WEB_ALLOWED_HOSTS` | Extra exact proxy/custom hostnames, comma-separated | unset |

### Routes and files

| Item | Location |
|---|---|
| Mobile UI | `app/m/page.tsx` → `components/mobile/MobileShell.tsx` |
| Mobile-only components | `components/mobile/` — shell, session drawer, settings drawer, voice pill |
| Phone detection | `lib/mobile-ua.ts` |
| Manifest / install metadata | `app/manifest.ts` |
| Voice override store | `lib/voice-config-store.ts` |
| Voice config schema | `lib/voice-config.ts` |
| Auth gate | `lib/web-auth.ts`, `proxy.ts` |
| Voice APIs | `/api/transcribe`, `/api/whisper/status`, `/api/speak`, `/api/speak/voices`, `/api/kws` |

Run the mobile component tests with `npm test` — they assert behaviour (drawer
reachability, hold-to-talk capture, control wiring), not styling.

### Known constraints

- **Secure context is mandatory for the mic.** HTTPS or `localhost` only.
- **`/m` and `/` are separate trees.** A change to mobile-only chrome does not
  affect the desktop shell, and vice versa. Cross-check both when touching the
  shared chat layer.
- **The wake-word threshold is a config value, not a preset.** It trades false
  triggers against missed wakes; lower is stricter for PocketSphinx's
  `kws_threshold`.
