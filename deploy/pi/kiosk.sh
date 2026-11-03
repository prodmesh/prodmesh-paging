#!/usr/bin/env bash
# Shows /key full screen on the Pi's HDMI output. Started at desktop login
# from labwc's autostart (install.sh wires it up).
#
# Settings come from ~/.config/prodmesh-paging/kiosk.env (written by
# install.sh, safe to hand-edit):
#   KEY_URL      page to show (default http://localhost:8522/key)
#   HDMI_OUTPUT  wlr-randr output name (default HDMI-A-1)
#   HDMI_MODE    e.g. 1920x1080@59.940Hz — must match the ATEM's video standard
#                exactly. Leave empty to keep whatever the Pi picked.

set -u

ENV_FILE="${HOME}/.config/prodmesh-paging/kiosk.env"
# shellcheck source=/dev/null
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

KEY_URL="${KEY_URL:-http://localhost:8522/key}"
HDMI_OUTPUT="${HDMI_OUTPUT:-HDMI-A-1}"
HDMI_MODE="${HDMI_MODE:-}"

log() { logger -t prodmesh-kiosk "$*"; echo "$*"; }

# Force the output format before anything is drawn. A Pi left to choose
# usually picks 60 Hz, and an ATEM running 59.94 may refuse or stutter.
if [ -n "$HDMI_MODE" ] && command -v wlr-randr >/dev/null; then
  if wlr-randr --output "$HDMI_OUTPUT" --mode "$HDMI_MODE"; then
    log "HDMI $HDMI_OUTPUT set to $HDMI_MODE"
  else
    log "could not set $HDMI_OUTPUT to $HDMI_MODE; see: wlr-randr"
  fi
fi

# Wait for the server so the first thing on the output is black, not
# Chromium's "site can't be reached" page.
for _ in $(seq 1 60); do
  curl -fsS -o /dev/null "${KEY_URL%%/key*}/api/config" && break
  sleep 1
done

BROWSER="$(command -v chromium || command -v chromium-browser)"
if [ -z "$BROWSER" ]; then
  log "Chromium not found; install it with: sudo apt install chromium"
  exit 1
fi

# --incognito: no "restore pages?" bar after a power cut. The key page keeps
# nothing in browser storage, so nothing is lost.
# The loop relaunches Chromium if it ever exits or crashes.
while true; do
  "$BROWSER" \
    --kiosk \
    --incognito \
    --noerrdialogs \
    --disable-infobars \
    --no-first-run \
    --disable-session-crashed-bubble \
    --disable-translate \
    --disable-features=Translate,MediaRouter \
    --check-for-update-interval=31536000 \
    --password-store=basic \
    "$KEY_URL"
  log "Chromium exited ($?); relaunching"
  sleep 2
done
