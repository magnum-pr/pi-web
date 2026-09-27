#!/bin/bash
# pi-web detached restart
# ---------------------------------------------------------------------------
# Ask launchd to cycle the pi-web server. Safe to run FROM INSIDE pi-web:
# it fully detaches (double-fork + new session) and waits briefly before
# kicking the job, so the restart completes even though the caller — and
# everything else in the server's process group — is killed by the cycle.
#
# This is the correct way for a pi-web agent to apply a restart. Never
# `kill <server-pid>` yourself: that takes the agent down with it.
# ---------------------------------------------------------------------------
set -u

LABEL="${PIWEB_LABEL:-com.dhavalrana.piweb}"
UID_NUM="$(id -u)"

python3 - "$LABEL" "$UID_NUM" >/dev/null 2>&1 <<'PY' &
import os, sys, time

label, uid = sys.argv[1], sys.argv[2]

# Double-fork + setsid: leave the server's process group entirely so the
# restart survives launchd tearing that group down.
if os.fork() != 0:
    os._exit(0)
os.setsid()
if os.fork() != 0:
    os._exit(0)

# Let the caller's command return (and its response stream flush) first.
time.sleep(1.5)
os.execvp("launchctl", ["launchctl", "kickstart", "-k", f"gui/{uid}/{label}"])
PY

disown 2>/dev/null || true
echo "restart requested — pi-web will cycle in ~2s. This session may drop; the server comes back on its own."
