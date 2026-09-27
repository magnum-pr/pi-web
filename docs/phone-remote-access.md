# Running Pi Web on your phone (secure remote access)

> Personal setup doc. Goal: use Pi Web's full voice UI (Whisper dictation +
> Piper spoken replies) from your phone while walking — same experience as on
> the laptop. Security posture: solo user, private Tailnet, NO app-level auth
> on Pi Web's core routes — so the boundary is **Tailscale device isolation**
> plus `tailscale serve`, enforced not assumed.

---

## TL;DR

| Item | What | Where |
|---|---|---|
| Tailscale | install + login | laptop AND phone |
| Pi Web | run bound to network (`start:lan`) | laptop |
| `tailscale serve` | exposes Pi Web to the Tailnet only | laptop |
| Browser | open the Tailnet URL | phone |

**Do NOT** use `tailscale funnel` (that's internet-exposed). **Do NOT**
port-forward or expose Pi Web beyond the Tailnet — it has no auth of its own.

---

## 1. Install Tailscale (both devices)

- **Laptop:** https://tailscale.com/download (macOS) — sign in with one account.
- **Phone:** App Store / Play Store — Tailscale app, sign in with the SAME
  account.

Both appear as devices in one Tailnet. Verify:
```bash
tailscale status   # on the laptop — lists both devices
```

## 2. Confirm Pi Web runs on the laptop

From the pi-web project dir:
```bash
npm run dev         # or: npm run build && npm run start   (production)
```

> For walking-the-dog reliability, **production build is preferred** over `dev`
> (fewer hot-reload surprises). Use `start` after `build`.

## 3. Bind Pi Web to the network (not just localhost)

Pi Web defaults to `127.0.0.1` (localhost only). For the phone to reach it,
use the LAN binding so it listens on the Tailnet interface too:
```bash
npm run start:lan   # binds 0.0.0.0
```
(or `npm run dev:lan` for dev). Port is `30141` by default.

## 4. Expose it to the Tailnet ONLY via `tailscale serve`

On the **laptop**, run Tailscale Serve pointing at Pi Web:
```bash
tailscale serve --bg 30141
```
This makes Pi Web reachable at a **Tailnet-only URL**
(`https://<machine-name>.<tailnet>.ts.net`) that ONLY your devices can open.
Verify:
```bash
tailscale serve status
```

## 5. Open it on the phone

On your phone's browser, go to the Tailnet URL printed by `tailscale serve`.
Sign in to Pi Web with the same account. Use the voice UI: AirPods mic →
dictation (Whisper runs on the laptop), replies spoken back via Piper through
your AirPods.

---

## Hardening (cheap, recommended)

> **Updated 2026-09-27.** The four routes below **now call
> `isApiRequestAllowed`** (`app/api/transcribe`, `app/api/sessions`,
> `app/api/agent/new`, `app/api/git/{status,diff}`). They were previously
> unguarded, which made Tailnet isolation the *only* control. That mattered more
> than it looked: `/api/sessions` serves raw transcripts, and a credential sweep
> on 2026-09-27 found 232 live secrets in those files. An unguarded
> `/api/sessions` was the delivery path from a local log to an external reader.
>
> The guard rejects browser cross-site requests and any Host that is not
> loopback, an IP literal, or explicitly configured. It is **not**
> authentication — see (e).

Pi Web has no login. `isApiRequestAllowed` is an origin/host check, not a
credential check, and it now covers the sensitive routes. Protection is still
primarily **Tailnet device isolation** plus `tailscale serve`, enforced not
assumed.

### a. Lock the allowed hosts to your phone AND your hubs
Set Pi Web env so only expected hosts are accepted:
```bash
export PI_WEB_ALLOWED_HOSTS="<phone-tailscale-ip>,<hub-tailscale-name>.ts.net"
```
Find device IPs via `tailscale status`. This tightens "any IP on the net" to
"specifically these devices."

> **Mobile data matters here.** On cellular the phone gets a carrier-NAT address
> shared with strangers. The guard above is what stops that mattering; Tailscale
> being *up* is what keeps the traffic on the Tailnet. If Tailscale drops and the
> phone has no route back, the correct outcome is an unreachable Pi Web — never a
> fallback to a public path.

### b. Keep the Tailnet minimal
Only your two devices. Don't share the Tailnet with other devices/people.

### c. Never expose beyond the Tailnet
- No port-forwarding on your router to 30141.
- No `tailscale funnel`.
- No cloud tunnel (ngrok/cloudflare) pointing at Pi Web.

### d. Never expose beyond the Tailnet — and check it, don't just intend it
- No port-forwarding on your router to 30141.
- No `tailscale funnel`.
- No cloud tunnel (ngrok/cloudflare) pointing at Pi Web.

Make this verifiable rather than remembered:
```bash
tailscale serve status     # should show ONLY the expected port
```
A `funnel` entry is the failure this catches. Run it alongside the Pi Web start.

### e. Real authentication — NOT YET IMPLEMENTED

Everything else in this section is a *reachability* control. None of it proves
who is asking. Anyone holding the unlocked phone has full Pi Web, which means
agent execution and transcript access.

Until real auth exists, the controls that actually matter are:
1. **Device lock on the phone** (Face ID / passcode) — currently the only thing
   standing between a lost phone and full agent access.
2. **Tailnet membership** — remove a device the moment it is lost.

Options when implementing it, cheapest first:
- **Shared-secret header** checked by an extension, with a phone-side bookmark
  injecting it. Weak (the secret lives on the device) but stops casual LAN access.
- **Authenticated reverse proxy** (Caddy basic auth) in front of the port, still
  behind `tailscale serve`.
- **Tailscale itself** as identity — `tailscale serve` can require an identity,
  which is the least new machinery for a solo user.

Prefer the last option unless there is a reason not to: it uses the identity
layer already in the path rather than adding one.

---

## Operational notes

- **Laptop must be on** (and Tailscale running) for the phone to reach Pi Web.
  No laptop = no agent, regardless of phone.
- **First call is free; the risk surface is: whatever can reach the Tailnet.**
  If you ever join a new device to the Tailnet or the laptop hits an untrusted
  network, re-check `tailscale status` to confirm only expected devices.
- If the phone loses Pi Web: check the laptop is up, Tailscale running on
  both, `tailscale serve status` shows the port, then reload the phone browser.

## Verification checklist (first run)
1. `tailscale status` on laptop → laptop + phone listed.
2. `npm run build && npm run start:lan` on laptop → "ready".
3. `tailscale serve --bg 30141` → prints Tailnet URL.
4. Phone browser opens that URL, logs in, and voice round-trip works.
5. `PI_WEB_ALLOWED_HOSTS` set to the phone IP **and** the hub's Tailnet name;
   a request with any other Host is denied (`isApiRequestAllowed`, verified by
   `app/api/sessions/guard.test.mjs`).
6. `tailscale serve status` shows only port 30141 — no `funnel` entry.
