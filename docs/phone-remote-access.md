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

Pi Web's API security layer (`isApiRequestAllowed`) only guards a subset of
routes. **`/api/agent`, `/api/sessions`, `/api/git`, `/api/transcribe` have NO
auth.** So your protection is Tailnet device isolation.

### a. Lock the allowed hosts to your phone
Set Pi Web env so only your phone's Tailscale IP is accepted:
```bash
export PI_WEB_ALLOWED_HOSTS="<phone-tailscale-ip>"
```
Find the phone IP via `tailscale status`. This tightens "any IP on the net"
to "specifically my phone."

### b. Keep the Tailnet minimal
Only your two devices. Don't share the Tailnet with other devices/people.

### c. Never expose beyond the Tailnet
- No port-forwarding on your router to 30141.
- No `tailscale funnel`.
- No cloud tunnel (ngrok/cloudflare) pointing at Pi Web.

### d. (Future / optional) real auth in front
If you ever want stronger-than-Tailnet assurance, put an authenticated proxy
(Caddy with basic auth, or a shared-secret header check) in front of Pi Web,
still served over `tailscale serve`. Not required for solo personal use.

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
5. `PI_WEB_ALLOWED_HOSTS` set to phone IP; non-phone device denied.
