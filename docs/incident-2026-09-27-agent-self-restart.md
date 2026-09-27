# Incident report: an agent killed the server it was running inside

**Date:** 2026-09-27
**Host:** macOS, `~/projects/pi-web`, dev server on `127.0.0.1:30141`
**Scope:** pi-web dev-server lifecycle; agent self-restart; credential handling

---

## 1. Summary

A pi-web agent session was asked to apply a new environment variable
(`PI_WEB_PASSWORD`), which required a server restart. The agent restarted the
server **from inside pi-web's own bash tool**:

```bash
kill 54185                 # 54185 = the next-server hosting the agent itself
nohup npm run dev > /tmp/piweb-dev.log 2>&1 &
```

The `kill` destroyed the agent's own process tree, so the in-flight
`nohup npm run dev` never executed. Result: the server went down, the agent died
with it, and the user's in-progress work was stranded. Nothing brought the server
back because nothing was watching it.

This is the "restart that survives the session asking for it" class of bug, and
it is a **class**, not a one-off: any in-process agent that restarts its own host
hits it.

---

## 2. Impact

- pi-web was unavailable; the user's session and its unfinished task were lost.
- The server had been running **unauthenticated** immediately before the crash
  (the pending restart *was* the change that would enable auth), so the outage
  also left the auth task half-applied.
- No data loss: the agent's artifacts (`~/.pi-web.env`, `~/.zshrc` + backup, the
  session `.jsonl`) were all on disk.

---

## 3. Root cause (evidence)

| Evidence | Finding |
|---|---|
| `/tmp/piweb-dev.log` | Zero errors. One `✓ Ready` line (17:16), then requests, then a trailing `^[[?25h` cursor-restore — i.e. a *signal*, not a crash. No restart ever occurred. |
| macOS unified log | `pid 54170 … termination reported by proc_exit` at **17:59:13** — a clean termination, **not** memory/jetsam. |
| Agent session `.jsonl` | Last write at **17:59:13** (exact same second); final entry is a `bash` toolCall containing `kill 54185` followed by `nohup npm run dev …`. |
| Process identity | `54185` was the running `next-server (v16.3.1)`, ~42 min elapsed — the server hosting the agent. |
| Supervisors | None. No launchd job, no `KeepAlive`, nothing to restart the server. |

**Mechanism:** the agent's shell is a descendant of the dev server, so
`kill <server-pid>` is a self-kill. The command dies mid-execution at the `kill`
line; the restart half never runs. There is no recovery because no supervisor
exists.

---

## 4. The fix

Two independent layers, so a kill of *either* layer is recovered:

### 4.1 `scripts/piweb-supervisor.sh` (repo)
An infinite loop that owns `npm run dev`:
- sources `~/.pi-web.env` on every start → `PI_WEB_PASSWORD` /
  `PI_WEB_ALLOWED_HOSTS` are applied automatically, no manual env dance;
- clears any stale listener on `:30141` before starting, so an externally killed
  server cannot permanently orphan the port with `EADDRINUSE`;
- rotates `/tmp/piweb-dev.log` at ~20 MB so a long-lived server can't fill disk;
- sets a non-interactive `PATH` pinned to the fnm **default alias**
  (`~/.local/share/fnm/aliases/default/bin`), not the transient
  `fnm_multishells/…` path a login shell exports.

### 4.2 `~/Library/LaunchAgents/com.dhavalrana.piweb.plist` (host)
launchd job: `RunAtLoad` + `KeepAlive` + `ThrottleInterval 10`. Keeps the
supervisor alive across crashes, OOM kills, and external kills; restarts at
login/reboot. Logs to `/tmp/piweb-supervisor.log`.

### 4.3 `scripts/piweb-restart.sh` (repo) — the agent-safe restart
The correct way for an agent to request a restart. It **double-forks and calls
`setsid()`** to leave the server's process group, waits 1.5 s (so the caller's
command can return), then runs `launchctl kickstart -k gui/<uid>/<label>`. Because
it is detached, the restart completes even when the cycle kills the caller.

**Rule for agents: never `kill <server-pid>`. Run `scripts/piweb-restart.sh`.**
Documented in `AGENTS.md` under "Server lifecycle".

---

## 5. Verification (all fresh, post-fix)

| Test | Result |
|---|---|
| Kill the `next-dev` child | supervisor restarted it (`65875 → 65927`); still serving |
| Kill the supervisor itself | launchd restored it (`runs = 2`) |
| `scripts/piweb-restart.sh` | job cycled cleanly (`runs = 3`) |
| **SIGKILL the caller 0.4 s into a restart** | restart still completed (`runs = 4`) — proves detachment |
| Final state | `launchctl print … state = running`; unauthenticated `/` → `401` |

---

## 6. What upstream (pi-web) should change

The local fix is a supervisor, i.e. a bandage over an architectural footgun.
Worth fixing in the product:

1. **Ship a supervisor.** A dev server that agents routinely restart should be
   managed by launchd/systemd with `KeepAlive`, or the app should self-supervise
   via a detached parent that outlives the server.
2. **Never let an in-process agent perform its own restart.** Provide a restart
   path that is out-of-process by construction (detached helper, supervisor
   signal file, `launchctl kickstart`), and make it the *only* documented
   restart. `restart-pi-web.ps1` on the upstream line already gestures at this.
3. **Surface "needs restart to apply" as a capability**, not something the agent
   hand-rolls with `kill`. A request-and-hand-off op removes the temptation.
4. **Don't gate server boot on an unguarded parse.** `next.config.ts` parses
   `package.json` with no `try/catch`; an unresolved merge conflict there stops
   boot with an error that never mentions git. Guard it.

---

## 7. Appendix: credential exposure and rotation

**What happened.** While diagnosing the outage, the generated
`PI_WEB_PASSWORD` was read out of `~/.pi-web.env` and printed into the agent
transcript at the user's explicit request. The file's own header said "never via
an agent" — that convention was authored by a previous agent session, not by the
user, and it did not survive first contact with a user who needed their own
credential.

**Remedy (done).**

- Generated a new 40-char random password and wrote it straight into
  `~/.pi-web.env` **without printing it** (atomic `mktemp` + `mv`, mode `600`).
- Cycled the server through the supervisor so the new value took effect.
- Verified: rotated credential → `200`; **leaked credential → `401` (revoked)**;
  no auth → `401`. Rotation invalidates the exposure.
- The old value still exists in older transcripts/session logs, but it is now
  dead.

**Recommendation.** A secret the user must know should never live only in a file
behind an instruction telling agents not to read it. Either:
- let the user **set** the password (they then own it and it's never generated
  into a transcript), or
- **display it once** to the user at generation time (UI / stderr) and tell them
  where it was stored — so no agent ever has to read it back.

---

## 8. Artifacts

| Path | State |
|---|---|
| `~/.pi-web.env` | password rotated; mode `600` |
| `~/Library/LaunchAgents/com.dhavalrana.piweb.plist` | installed, job running |
| `~/projects/pi-web/scripts/piweb-supervisor.sh` | new (uncommitted) |
| `~/projects/pi-web/scripts/piweb-restart.sh` | new (uncommitted) |
| `~/projects/pi-web/AGENTS.md` | "Server lifecycle" section added (uncommitted) |

Uninstall:
```bash
launchctl bootout gui/$(id -u)/com.dhavalrana.piweb
rm ~/Library/LaunchAgents/com.dhavalrana.piweb.plist
```
