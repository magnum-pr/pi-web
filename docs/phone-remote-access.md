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

> **Corrected 2026-09-27 (second time).** This section previously claimed
> `/api/agent`, `/api/sessions`, `/api/git`, `/api/transcribe` were "unguarded"
> and that the origin check "only guards a subset of routes". **That was wrong.**
> `proxy.ts` runs on `matcher: ["/", "/api/:path*"]`, so every API route and the
> UI root already went through `isApiRequestAllowed`. Acting on the false claim,
> redundant per-route checks were added to four route groups; they are harmless
> defence in depth but were never the gap.
>
> `/api/sessions` does serve raw transcripts, and a credential sweep on
> 2026-09-27 found 232 live secrets in those files — so the concern was real. The
> actual gap was the one described below: **no password was ever configured.**

### Pi Web has TWO gates, and only one of them is a login

| Layer | What it is | Default |
|---|---|---|
| **Host / origin** (`isApiRequestAllowed`) | Rejects cross-site browser requests and any Host that is not loopback, an IP literal, or in `PI_WEB_ALLOWED_HOSTS`. Applied to every route by `proxy.ts`. | **always on** |
| **Password** (`PI_WEB_PASSWORD`) | HTTP Basic Auth, fixed username `pi`, constant-time compare. Real authentication. | **off** |

With no password set, **anyone who can reach the port is served in full** —
including `/api/sessions`, which hands out session transcripts. On loopback that
is tolerable. On a Tailnet, or bound to `0.0.0.0`, it is not.

Enable the second gate:

```bash
export PI_WEB_PASSWORD='a-long-random-password'   # username is always `pi`
```

Both layers are pinned by `proxy.test.mjs` — nine tests covering 401 without
credentials, wrong password, wrong username, every API route, and the UI root.
Before that file existed, `web-auth.ts` had tests but the gate that uses it had
none, and a gate that stops being applied looks identical to one that works.

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

### c. Bind to LOOPBACK, not to the LAN

`package.json` offers both. **Prefer the loopback one:**

```bash
npm run build && npm run start     # binds 127.0.0.1 — use this
# npm run start:lan                # binds 0.0.0.0  — avoid
```

`tailscale serve` proxies to a local port, so the phone reaches Pi Web *through
tailscaled* with the port never exposed on a network interface. That is strictly
safer than `start:lan`: with `0.0.0.0`, every device on the same Wi-Fi or Tailnet
can hit the port directly, bypassing the proxy — and any check that trusts a
forwarded header can then be spoofed.

### d. Never expose beyond the Tailnet — and check it, don't just intend it
- No port-forwarding on your router to 30141.
- No `tailscale funnel`.
- No cloud tunnel (ngrok/cloudflare) pointing at Pi Web.

Make this verifiable rather than remembered:
```bash
tailscale serve status     # should show ONLY the expected port
```
A `funnel` entry is the failure this catches. Run it alongside the Pi Web start.

### e. Real authentication — IMPLEMENTED, NOT ENABLED

An earlier version of this section said real auth did not exist. **It does.** It
is HTTP Basic Auth in `lib/web-auth.ts`, wired globally through `proxy.ts`, and
covered by nine tests in `proxy.test.mjs`. It is **off** until you set a password.

```bash
export PI_WEB_PASSWORD='a-long-random-password'   # username is always `pi`
```

Then restart Pi Web. You will get a browser prompt on the phone, and the
credential is cached for the session.

**What it does and does not give you:**

- It proves the caller knows the password. Over `tailscale serve` the traffic is
  already TLS, so the credential is not exposed in transit.
- It does **not** survive a compromised or unlocked phone: the browser remembers
  it. Device lock is still load-bearing.
- It does **not** replace Tailnet isolation. It is the layer that holds when
  Tailnet isolation fails — a device you forgot to remove, or a future
  misconfiguration.

**Order that matters:** set the password *before* exposing the port. Enabling
reachability first and auth second is how a window appears.

### f. What still rests on the phone's device lock

Even with the gate on, an unlocked phone in someone's hand has full Pi Web:
agent execution, `/api/git`, and `/api/sessions` — which serves session
transcripts. There is no second factor.

The controls that carry that weight:
1. **Device lock** (Face ID / passcode) — the only thing between a lost phone and
   full agent access.
2. **Tailnet membership** — remove a device the moment it is lost.
3. **`PI_WEB_ALLOWED_HOSTS`** — narrows which hosts are accepted at all.
