#!/bin/bash
# pi-web supervisor
# ---------------------------------------------------------------------------
# Keeps the pi-web dev server alive across crashes, OOM kills, and *external*
# kills — including the case where a pi-web agent kills the server it is
# itself running inside. Managed by launchd:
#
#   ~/Library/LaunchAgents/com.dhavalrana.piweb.plist
#
# launchd (KeepAlive) guarantees this script is always running; this loop
# guarantees `npm run dev` is always running beneath it. Two layers, so a
# kill of either one is recovered.
#
# Do NOT reimplement this by killing the server from inside pi-web — use
# scripts/piweb-restart.sh, which detaches before kicking the job.
# ---------------------------------------------------------------------------
set -u

# Stable, non-interactive PATH. Node comes from the fnm "default" alias, which
# is a symlink that follows the default version (unlike the transient
# fnm_multishells path a login shell exports).
export PATH="$HOME/.local/share/fnm/aliases/default/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

APP_DIR="${PIWEB_APP_DIR:-$HOME/projects/pi-web}"
ENV_FILE="${PIWEB_ENV_FILE:-$HOME/.pi-web.env}"
LOG_FILE="${PIWEB_LOG:-/tmp/piweb-dev.log}"
PORT="${PIWEB_PORT:-30141}"
RESTART_DELAY="${PIWEB_RESTART_DELAY:-3}"
LOG_MAX_BYTES="${PIWEB_LOG_MAX_BYTES:-20000000}"  # rotate at ~20 MB

log() { printf '%s [supervisor] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$LOG_FILE"; }

cd "$APP_DIR" || { echo "piweb-supervisor: cannot cd to $APP_DIR" >&2; exit 1; }

# Load secrets (PI_WEB_PASSWORD, PI_WEB_ALLOWED_HOSTS). Mode 600; never logged.
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  log "env loaded from $ENV_FILE (PI_WEB_PASSWORD present: $([ -n "${PI_WEB_PASSWORD:-}" ] && echo yes || echo no))"
else
  log "WARNING: $ENV_FILE not found — server will start WITHOUT auth"
fi

log "supervisor up (pid $$, node $(node -v 2>/dev/null || echo '?'), port $PORT)"

while true; do
  # Rotate the log so a long-lived server can't fill the disk.
  if [ -f "$LOG_FILE" ] && [ "$(stat -f %z "$LOG_FILE" 2>/dev/null || echo 0)" -gt "$LOG_MAX_BYTES" ]; then
    mv -f "$LOG_FILE" "$LOG_FILE.1" 2>/dev/null || true
    log "log rotated (kept previous as $LOG_FILE.1)"
  fi

  # Clear any orphaned listener left on the port by an external kill, so the
  # next `npm run dev` can bind instead of dying with EADDRINUSE forever.
  stale="$(lsof -tnP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$stale" ]; then
    log "clearing stale listener(s) on :$PORT -> $stale"
    # shellcheck disable=SC2086
    kill $stale 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      lsof -tnP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 || break
      sleep 1
    done
    stale="$(lsof -tnP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
    [ -n "$stale" ] && { # shellcheck disable=SC2086
      kill -9 $stale 2>/dev/null || true; }
  fi

  log "starting: npm run dev"
  npm run dev >>"$LOG_FILE" 2>&1
  log "server exited (rc=$?); restarting in ${RESTART_DELAY}s"
  sleep "$RESTART_DELAY"
done
