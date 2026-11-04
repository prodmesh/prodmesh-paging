# ADR 0001 — A standalone paging server, shaped like ProdMesh-Control

Status: accepted · 2026-11-03

## Context

Nursery paging at Canyon Hills runs through ProPresenter on a nursery-wing
computer. A volunteer types a 4-character code into an announcement. That
machine's single output goes over SDI to the main ATEM as an **upstream** key,
so pages reach the building feed and auditorium projectors but never YouTube.

It fails in three ways:

1. Volunteers have to drive ProPresenter correctly.
2. If the machine drops to the desktop, the key shows a box of desktop
   wallpaper on the projectors.
3. It breaks often enough that tech has to walk to the nursery mid-service.

What actually needs to happen is small: a volunteer submits a code, a black
frame shows white text, and the code goes away later.

## Decision

**prodmesh-paging is its own small Node server** (port 8522, no dependencies)
with three pages:

- `/` — the nursery page. Enter the PIN once per browser, then type a code and
  press PAGE. Active pages are listed with a two-tap Clear.
- `/key` — the key output, run full-screen on a **booth machine** that feeds the
  ATEM. Only pure black and white text are ever drawn. When several codes are
  active they rotate one at a time.
- `/admin` — for tech: the auto-clear time, rotation speed, key position, size
  and label (with a live preview), the PINs, and the log.

**Its wire contract copies ProdMesh-Control's (Control ADR 0010).**
`GET /api/stream?topics=paging:active,paging:display` emits `event: msg` frames
carrying `{ topic, data }`. Both topics are state snapshots, and slow sockets
conflate rather than queue. If Control later wants paging on a dashboard or in
its audit log, it can subscribe to these topics or absorb the module without a
new protocol.

Why not build it inside Control from the start: Control has a lot more surface
area than paging needs. Paging must keep working when the dashboard is down for
an upgrade, and it should be deployable at a church that doesn't run Control
at all.

**Two shared PINs, not named users.** The nursery PIN unlocks the volunteer
page for that browser (the token is saved). The admin PIN unlocks settings. PINs
are stored as salted scrypt hashes; tokens are stored hashed. Changing a PIN
revokes every session created with it. Five wrong PINs from one address
trigger a 30-second lockout. Every page, renew, clear and timeout is logged
with the time, the station name and the client address, so mistakes can be
traced without adding any friction for volunteers.

**Codes:** originally four characters from `A–Z 2–9` without O, 0, I or 1,
so they couldn't be misread from the back row. Superseded; see the second
addendum.

**State is plain files** in `var/`: config, active pages, sessions, and a
JSON-lines log. Writes go to a temp file and are renamed into place. Active
pages survive a restart; any that expired while the server was down are logged
as timeouts on the next sweep.

**The key page fails to black.** The server pings every 5 s. Twelve seconds without
hearing from it counts as a dead link, and then
draws nothing rather than freezing on a code that may already have been
cleared.

## Consequences

- The nursery machine needs only a browser. ProPresenter and its SDI output can
  be retired from the nursery wing.
- The booth machine needs a full-screen browser on an output that reaches the
  ATEM: a GPU output through an SDI converter, or a DeckLink.
- PIN security matches the closed-LAN threat model the family assumes. It
  stops a curious congregant on guest Wi-Fi; it is not meant to stop a
  determined attacker on the production network.

## Not decided here

- A ProPresenter announcement/message output driven through its API, as a
  second output alongside `/key`.
- Publishing pages into ProdMesh-Control's feed or audit log.
- Checking codes against Planning Center Check-Ins.

## Addendum — configurable length and mirrored corners (2026-11-03)

- ~~**Code length is a setting from 2 to 6, defaulting to 4.**~~ Replaced by
  the second addendum. Paging has to
  accept whatever the check-in labels print, so tech sets the length to match.
  The nursery page reads it from `paging:display` and resizes the input. Pages
  already on screen are unaffected when the length changes.
- **New positions `top-both` and `bottom-both`** draw the same code in both
  corners of the key output. Different screens fed from the one keyed feed can
  each mask to the side that suits them, so there's no need for a second
  output or keyer.

## Addendum — no character rules on codes (2026-11-03)

Nursery volunteers asked to type whatever the sticker says. The excluded
characters (O/0/I/1) and the fixed length kept getting in their way. Codes are
now **any 1 to 5 characters**: upper-cased, with spaces removed, and no other
rules. The admin code-length setting is gone.

The cost is the reason the rule existed: O and 0 can look alike on screen.
Parents read their own sticker against the screen, so a lookalike is
unlikely to send the wrong parent, and the volunteers preferred fewer refusals.
The clear endpoint now URL-decodes its path segment, since a code may contain
characters such as `#` or `/`.

## Addendum — Companion, blocked codes, heartbeat (2026-11-04)

- **`POST /api/integrations/clear-all`** for a Bitfocus Companion button.
  Companion's Generic HTTP module can't do our PIN login, so this uses one
  shared **integration key**. It's generated at `/admin`, shown once, and
  stored only as a hash. It can clear all pages and nothing else. Wrong keys
  count toward the same per-address lockout as wrong PINs. The endpoint is
  POST only, so a link preview or prefetch can never clear the screens.
- **Blocked codes.** A short built-in list (`server/blocked-words.js`) plus
  tech's additions in the data folder, so they survive `git pull`. There are
  deliberately no spelling variants. Words of 3 letters or fewer match only
  the whole code, because short words hide inside random sticker codes and a
  real child's code must never be refused. Longer words match anywhere.
- **Heartbeat.** An optional white square on the key output that flips on
  every frame from the server. The ping interval drops from 5 s to 2 s so it
  visibly blinks. It's drawn only while connected: a square frozen *on* would
  look healthy on the multiview, so offline draws nothing, as before.
