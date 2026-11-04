#!/usr/bin/env bash
# Optional: free RAM on a small Pi (Zero 2 W, 512 MB) that only does paging.
# Run after install.sh:  sudo ./deploy/pi/slim.sh
#
# The desktop itself is trimmed by install.sh (kiosk-only autologin session).
#
# This script turns off system services a paging box doesn't need. It keeps
# avahi, because paging.local depends on it. To undo one later:
#   sudo systemctl enable --now <name>

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo: sudo $0" >&2
  exit 1
fi

# bluetooth  – no Bluetooth devices
# cups*      – printing
# rpcbind / nfs-* – NFS client plumbing
# udisks2    – desktop auto-mounting of USB drives
# ModemManager – cellular modems
SERVICES=(
  bluetooth.service
  cups.service cups-browsed.service
  rpcbind.service rpcbind.socket nfs-blkmap.service
  udisks2.service
  ModemManager.service
)

for s in "${SERVICES[@]}"; do
  if systemctl list-unit-files "$s" --no-legend 2>/dev/null | grep -q .; then
    systemctl disable --now "$s" >/dev/null 2>&1 && echo "disabled $s" || echo "could not disable $s"
  fi
done

# Wi-Fi power save lets the radio doze between packets. That adds latency
# to the live stream and can make the nursery page flap between connected and
# "Not connected". A Zero 2 W has no Ethernet, so this matters there.
if command -v nmcli >/dev/null; then
  nmcli -t -f NAME,TYPE connection show | while IFS=: read -r name type; do
    if [ "$type" = 802-11-wireless ]; then
      nmcli connection modify "$name" 802-11-wireless.powersave 2 \
        && echo "Wi-Fi power save off for '$name' (applies on reconnect or reboot)"
    fi
  done
fi

echo
free -m | head -2
