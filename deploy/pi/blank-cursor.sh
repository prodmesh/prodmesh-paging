#!/usr/bin/env bash
# Installs the "prodmesh-blank" cursor theme: every cursor is one transparent
# pixel. kiosk-session.sh selects it, so no arrow ever reaches the key output.
#
# CSS `cursor: none` on /key is not enough by itself: it only applies once the
# pointer moves over the page. Until then (and with no mouse attached, that
# is forever) labwc draws its own cursor from the theme.
#
# Usage (install.sh calls this):  sudo ./deploy/pi/blank-cursor.sh

set -euo pipefail

THEME=/usr/share/icons/prodmesh-blank
mkdir -p "$THEME/cursors"

cat > "$THEME/index.theme" <<'EOF'
[Icon Theme]
Name=prodmesh-blank
Comment=Transparent cursors for the paging key output
EOF

# A 68-byte Xcursor file, little-endian:
#   file header  "Xcur", header size 16, version 1.0, 1 TOC entry
#   TOC entry    type image (0xfffd0002), nominal size 24, at offset 28
#   image chunk  header 36, type image, size 24, version 1,
#                1x1 pixels, hotspot 0,0, delay 0, one ARGB pixel = 0 (clear)
printf '\x58\x63\x75\x72\x10\x00\x00\x00\x00\x00\x01\x00\x01\x00\x00\x00\x02\x00\xfd\xff\x18\x00\x00\x00\x1c\x00\x00\x00\x24\x00\x00\x00\x02\x00\xfd\xff\x18\x00\x00\x00\x01\x00\x00\x00\x01\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00' \
  > "$THEME/cursors/left_ptr"

# Every name a compositor or app might ask for points at the same blank.
# A missing name would fall back to a visible built-in cursor.
for name in default arrow top_left_arrow pointer hand1 hand2 text xterm \
  wait watch progress left_ptr_watch crosshair cross move fleur grab grabbing \
  not-allowed all-scroll help question_arrow context-menu cell copy alias \
  n-resize s-resize e-resize w-resize ne-resize nw-resize se-resize sw-resize \
  ns-resize ew-resize nesw-resize nwse-resize col-resize row-resize \
  top_side bottom_side left_side right_side top_left_corner top_right_corner \
  bottom_left_corner bottom_right_corner sb_h_double_arrow sb_v_double_arrow; do
  ln -sf left_ptr "$THEME/cursors/$name"
done

echo "Installed blank cursor theme at $THEME"
