# ProdMesh Paging

Nursery visual paging for church video systems. A volunteer types a child's
paging code and presses **PAGE**. The code then appears as white text on
a black frame, which the ATEM keys onto the building feed and projectors.

| Page | Who uses it | What it does |
| --- | --- | --- |
| `/` | Nursery volunteers | Enter the nursery PIN once, then page and clear codes |
| `/key` | Booth output machine | Full-screen black frame; active codes rotate in white |
| `/admin` | Tech | Auto-clear time, key look with live preview, PINs, log |

## Run it

Requires Node 20 or newer and has no dependencies.

```bash
npm start
```

It serves on port **8522**. Set `PORT`, `HOST` or `PAGING_DATA` to change the
port, bind address or data folder (the default folder is `./var`).

On first run, open `/admin` and choose a nursery PIN and an admin PIN.

For a Raspberry Pi that runs the server and drives the key output over
HDMI, see [docs/raspberry-pi.md](docs/raspberry-pi.md).

## Hooking it up

1. **Booth machine:** open `http://<server>:8522/key` in a browser, go full
   screen, and put it on the output that feeds the ATEM (a GPU→SDI converter
   or a DeckLink).
2. **ATEM:** set up a luma key on an **upstream** keyer of the program
   feeds that should show pages (not a DSK, so pages stay off the broadcast).
   Open `/key?test=2X3Y` to set clip and gain with a code on screen.
3. **Nursery:** open `http://<server>:8522/` and enter the nursery PIN. Make
   it the browser's home page.

## Behaviour

- Codes are 2–6 characters (4 by default; tech sets this at `/admin`) using
  `A–Z` and `2–9`, but never O, 0, I or 1.
- The key can sit in any corner, the center, or **both top corners (or both
  bottom corners) at once**. With both, each screen masks the side it wants
  off a single key output.
- Paging a code that is already showing restarts its timer instead of adding
  it twice.
- Pages clear themselves after the auto-clear time (10 minutes by default),
  or when a volunteer clears them (two taps).
- When several codes are active, the key shows one at a time (4 s each by
  default).
- If the key page loses the server it goes **black** and reconnects on its
  own. If the nursery page loses the server it shows a red banner and disables
  PAGE.
- Every page, renew, clear and timeout is logged with the time, the station
  and the client address. Tech can see the log at `/admin`.

## Develop

```bash
npm run selftest
```

That prints `PASS` or the first failure. See [AGENTS.md](AGENTS.md) and
[docs/decisions](docs/decisions/).
