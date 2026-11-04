# Raspberry Pi setup

One Pi runs the paging server **and** shows `/key` on its HDMI output. An
HDMI→SDI converter feeds that output to the ATEM.

```
Nursery browser ──LAN──▶ Pi (server + Chromium on /key) ──HDMI──▶ converter ──SDI──▶ ATEM upstream key
```

Target: a Pi 4 or Pi 5 running **Raspberry Pi OS with desktop**,
Bookworm or newer (the labwc desktop). Lite images have no desktop to show
`/key` on. You can still use one with `--no-kiosk` and render `/key`
somewhere else.

## 1. Flash the card

In Raspberry Pi Imager, choose *Raspberry Pi OS (64-bit)* (the desktop one).
Under the customisation settings:

- **Hostname:** `paging`. The nursery URL becomes `http://paging.local:8522/`.
- **Username/password:** your choice. The scripts use whichever user runs them.
- **Wi-Fi:** skip it if you can. Wired Ethernet on the production network is
  the dependable option.
- **SSH:** turn it on, so you can fix things from the booth without a keyboard.

On the network side, give the Pi a **DHCP reservation**. The `.local` name
works from Macs, iPads and most Windows 10+ machines, but an IP that never
changes is the fallback that always works.

## 2. Install Node 20+ and git

Raspberry Pi OS's own `nodejs` package may be older than 20, so use
NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
```

```bash
sudo apt install -y nodejs git
```

```bash
node --version
```

## 3. Clone and install

```bash
git clone https://github.com/prodmesh/prodmesh-paging.git ~/prodmesh-paging
```

```bash
cd ~/prodmesh-paging && sudo ./deploy/pi/install.sh
```

The installer:

1. checks Node and runs the selftest,
2. installs and starts `prodmesh-paging.service` (port 8522; it restarts
   itself if it crashes and starts on boot; data lives in
   `/var/lib/prodmesh-paging`, outside the clone),
3. writes `~/.config/prodmesh-paging/kiosk.env` and adds the kiosk to the
   desktop's autostart,
4. turns off screen blanking and turns on desktop autologin, so the key
   output comes back by itself after a power cut,
5. installs `wlr-randr` to set the HDMI output format.

Run it with `--no-kiosk` if this Pi should only run the server. It's safe to
run again.

## 4. Set the PINs

From any computer on the network, open `http://paging.local:8522/admin` and
choose the nursery and admin PINs. Set the code length to match your check-in
stickers.

## 5. Match the video format to the ATEM

This step is most likely to go wrong, so do it with the ATEM's multiview in
front of you.

**Frame rate.** The Pi has to output **exactly** the ATEM's video standard.
Left alone, a Pi usually picks 1080p60, but most ATEMs in North America run
1080p59.94 or 1080i59.94. Unless your converter does frame-rate conversion, a
mismatch gives you no picture, a flashing input, or a stutter.

`kiosk.env` defaults to `HDMI_MODE=1920x1080@59.940Hz`. To check what the Pi
is actually sending, open a terminal on the Pi's desktop and run:

```bash
wlr-randr
```

The current mode is marked. If the converter doesn't offer the exact rate you
need, pick the closest one listed and check it on the ATEM. To change the
mode, edit `~/.config/prodmesh-paging/kiosk.env` and reboot.

If the ATEM runs **1080i**, use a converter that outputs interlaced SDI from a
progressive HDMI input. Pis don't output interlaced HDMI reliably.

**Black level.** The key is a luma key, so the background has to be true
black. If the Pi sends full-range color and the converter treats it as
limited (or the other way round), black arrives as dark grey and a faint wash
shows through the key.

1. Open `http://paging.local:8522/key?test=2X3Y` on the Pi. A quick way is
   `KEY_URL=http://localhost:8522/key?test=2X3Y` in `kiosk.env`, then reboot.
2. On the ATEM, put the Pi on an **upstream** keyer (not a DSK, so pages stay
   off the stream), set it to luma, and raise **Clip** until the background
   disappears completely with no grey wash. Then adjust **Gain** until the
   letter edges are clean.
3. If you can't get a clean background, look for an RGB/range setting on the
   converter.
4. Put `KEY_URL` back to plain `/key` and reboot.

**Masking.** With the position set to *Top left + top right*, use each
feed's key mask to keep only its own side.

## 6. Point the nursery at it

On the nursery computer, open `http://paging.local:8522/`, enter the nursery
PIN, and make that page the browser's home page. If the computer is a
dedicated kiosk, put that browser in full-screen or kiosk mode too.

## Small Pis (Zero 2 W)

A Zero 2 W has 512 MB of RAM and no Ethernet port. It works, but:

- **The desktop is already trimmed.** `install.sh` creates
  `~/.config/labwc/autostart`, and labwc runs that file *instead of* the
  system one. So after the reboot the wallpaper/file manager, the taskbar and
  the desktop autostart apps never start; only the kiosk does.
- **Turn off services you don't need:**

  ```bash
  sudo ./deploy/pi/slim.sh
  ```

  This turns off Bluetooth, printing, NFS, USB auto-mounting and ModemManager,
  plus Wi-Fi power save (which otherwise adds lag to the live stream). It
  keeps avahi, which `paging.local` needs. It's slow on a Zero: allow several
  minutes.
- **Wi-Fi with a static IP.** Add the production network as an *extra*
  NetworkManager profile with a higher priority instead of editing the one
  you set up with. If the new settings are wrong, the Pi falls back to the old
  network rather than vanishing:

  ```bash
  read -rs -p "Wi-Fi password: " PSK; echo; sudo nmcli connection add type wifi con-name CHCC-Internal ifname wlan0 ssid CHCC-Internal wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$PSK" ipv4.method manual ipv4.addresses 192.168.132.95/23 ipv4.gateway 192.168.132.1 ipv4.dns 192.168.132.1 802-11-wireless.powersave 2 connection.autoconnect-priority 10; unset PSK
  ```

  The password is read without being shown and never lands in your shell
  history. Use an address outside the router's DHCP pool. Reboot to switch.

## Updating

```bash
cd ~/prodmesh-paging && ./deploy/pi/update.sh
```

That pulls the latest code, runs the selftest, and restarts the server. The
key output reconnects by itself within a few seconds. PINs, settings and the
log are kept.

## When something's wrong

| Symptom | Check |
| --- | --- |
| Nursery shows a red "Not connected" banner | `systemctl status prodmesh-paging` on the Pi; `journalctl -u prodmesh-paging -n 50` |
| Key output is black but codes are active | Is Chromium running? `journalctl -t prodmesh-kiosk`. Reboot the Pi. |
| ATEM shows no signal or a flashing input | Frame rate mismatch (step 5). `wlr-randr` shows what the Pi is sending. |
| Faint grey box around the code on screen | Black level or clip (step 5). |
| `paging.local` doesn't resolve | Use the Pi's IP instead and set up the DHCP reservation. |
| Forgot the admin PIN | On the Pi: `sudo systemctl stop prodmesh-paging`, delete `"admin"` from `pins` in `/var/lib/prodmesh-paging/config.json`, start the service, then open `/admin` to set it again. |
