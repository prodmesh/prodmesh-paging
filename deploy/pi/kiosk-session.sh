#!/bin/sh
# The login session for the key output, chosen by lightdm's autologin.
#
# It is /usr/bin/labwc-pi (the Raspberry Pi desktop session) minus its `-m`.
# With -m, labwc merges the autostart from every config dir, so the system
# one also starts the wallpaper, taskbar and desktop apps behind the kiosk.
# They cost RAM a Zero 2 W doesn't have, and anything they pop up shows
# through the key. Without -m, only ~/.config/labwc/autostart runs: the kiosk.
#
# A person logging in at the Pi's own login screen still gets the normal
# desktop (lightdm's user-session is unchanged).

[ -f /usr/bin/setup_env ] && . /usr/bin/setup_env

# Same renderer choices labwc-pi makes. Boards whose GPU has no MMU (Zero 2 W,
# Pi 3) must use the pixman software renderer.
if command -v raspi-config >/dev/null && raspi-config nonint is_pi; then
  export WLR_DRM_FORCE_LIBLIFTOFF=1
  if ! raspi-config nonint gpu_has_mmu; then
    export WLR_RENDERER=pixman
  fi
fi

# Transparent cursors (deploy/pi/blank-cursor.sh). Without -m, labwc reads only
# the first environment file it finds (~/.config/labwc/environment), which
# doesn't set a cursor theme, so this one stands.
if [ -d /usr/share/icons/prodmesh-blank ]; then
  export XCURSOR_THEME=prodmesh-blank XCURSOR_SIZE=24
fi

exec /usr/bin/labwc
