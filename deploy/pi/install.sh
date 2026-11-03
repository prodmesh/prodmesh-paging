#!/usr/bin/env bash
# One-shot Raspberry Pi setup. Run from the clone, as the desktop user, with sudo:
#
#   sudo ./deploy/pi/install.sh              server + key output on this Pi's HDMI
#   sudo ./deploy/pi/install.sh --no-kiosk   server only
#
# Safe to run again: it rewrites the service and skips steps already done.

set -euo pipefail

KIOSK=1
for arg in "$@"; do
  case "$arg" in
    --no-kiosk) KIOSK=0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [ "$(id -u)" -ne 0 ] || [ -z "${SUDO_USER:-}" ] || [ "$SUDO_USER" = root ]; then
  echo "Run this as your normal user via sudo:  sudo $0" >&2
  exit 1
fi

DIR="$(cd "$(dirname "$0")/../.." && pwd)"
USER_NAME="$SUDO_USER"
USER_HOME="$(getent passwd "$USER_NAME" | cut -d: -f6)"
as_user() { sudo -u "$USER_NAME" -H "$@"; }

step() { printf '\n==> %s\n' "$*"; }

# ── Node ────────────────────────────────────────────────────────────────────
step "Checking Node"
NODE="$(as_user bash -lc 'command -v node' || true)"
if [ -z "$NODE" ]; then
  echo "Node is not installed. See docs/raspberry-pi.md, step 2." >&2
  exit 1
fi
MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
if [ "$MAJOR" -lt 20 ]; then
  echo "Node $("$NODE" --version) is too old; 20 or newer is needed. See docs/raspberry-pi.md, step 2." >&2
  exit 1
fi
echo "Using $NODE ($("$NODE" --version))"

step "Running selftest"
as_user bash -c "cd '$DIR' && '$NODE' server/index.js --selftest"

# ── Server ──────────────────────────────────────────────────────────────────
step "Installing prodmesh-paging.service"
sed -e "s#@USER@#$USER_NAME#g" -e "s#@DIR@#$DIR#g" -e "s#@NODE@#$NODE#g" \
  "$DIR/deploy/pi/prodmesh-paging.service" > /etc/systemd/system/prodmesh-paging.service
systemctl daemon-reload
systemctl enable prodmesh-paging.service
systemctl restart prodmesh-paging.service

for _ in $(seq 1 20); do
  curl -fsS -o /dev/null http://localhost:8522/api/config && break
  sleep 0.5
done
if curl -fsS -o /dev/null http://localhost:8522/api/config; then
  echo "Server is up."
else
  echo "Server did not come up. Check: journalctl -u prodmesh-paging -n 50" >&2
  exit 1
fi

# ── Kiosk ───────────────────────────────────────────────────────────────────
if [ "$KIOSK" = 1 ]; then
  step "Setting up the key output"

  ENV_DIR="$USER_HOME/.config/prodmesh-paging"
  if [ ! -f "$ENV_DIR/kiosk.env" ]; then
    as_user mkdir -p "$ENV_DIR"
    as_user tee "$ENV_DIR/kiosk.env" >/dev/null <<'EOF'
# Read by deploy/pi/kiosk.sh at login. Edit, then reboot (or log out and in).
KEY_URL=http://localhost:8522/key
HDMI_OUTPUT=HDMI-A-1
# Must match the ATEM's video standard exactly. Leave empty to let the Pi
# choose. Run `wlr-randr` on the Pi's desktop to list the modes it offers.
HDMI_MODE=1920x1080@59.940Hz
EOF
    echo "Wrote $ENV_DIR/kiosk.env"
  else
    echo "Keeping existing $ENV_DIR/kiosk.env"
  fi

  chmod +x "$DIR/deploy/pi/kiosk.sh"
  LINE="$DIR/deploy/pi/kiosk.sh &"
  if command -v labwc >/dev/null; then
    AUTOSTART="$USER_HOME/.config/labwc/autostart"
    as_user mkdir -p "$(dirname "$AUTOSTART")"
    as_user touch "$AUTOSTART"
    if grep -qF "deploy/pi/kiosk.sh" "$AUTOSTART"; then
      echo "Kiosk already in $AUTOSTART"
    else
      echo "$LINE" | as_user tee -a "$AUTOSTART" >/dev/null
      echo "Added kiosk to $AUTOSTART"
    fi
  else
    echo "labwc not found. This needs Raspberry Pi OS with desktop (Bookworm or" >&2
    echo "newer, labwc). Add this to your session's autostart by hand:" >&2
    echo "  $LINE" >&2
  fi

  if command -v raspi-config >/dev/null; then
    raspi-config nonint do_blanking 1 && echo "Screen blanking disabled."
    # Log the desktop user in without a password so the key comes back on
    # its own after a power cut.
    raspi-config nonint do_boot_behaviour B4 && echo "Desktop autologin enabled."
  else
    echo "raspi-config not found: disable screen blanking and enable desktop autologin by hand." >&2
  fi

  if ! command -v wlr-randr >/dev/null; then
    apt-get install -y wlr-randr >/dev/null && echo "Installed wlr-randr."
  fi
fi

# ── Done ────────────────────────────────────────────────────────────────────
HOST="$(hostname).local"
IP="$(hostname -I | awk '{print $1}')"
cat <<EOF

Done.
  Nursery:  http://$HOST:8522/        (or http://$IP:8522/)
  Admin:    http://$HOST:8522/admin   first visit sets the PINs
  Key:      http://$HOST:8522/key

Next: reboot to start the key output, then line the key up on the ATEM
with /key?test=2X3Y. See docs/raspberry-pi.md, step 5.
EOF
