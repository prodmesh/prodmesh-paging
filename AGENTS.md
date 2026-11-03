# AGENTS.md — prodmesh-paging

Nursery visual paging, part of the ProdMesh family. Read
[ADR 0001](docs/decisions/0001-standalone-control-shaped.md) before changing
the shape of anything.

## Layout

- `server/index.js` — entry point; `--selftest` runs `server/selftest.js`.
- `server/app.js` — HTTP routes, the SSE stream hub, static files. Plain
  `node:http`.
- `server/paging.js` — active pages, config, PINs and sessions. No HTTP; takes
  an injectable `now()` so tests control time.
- `server/store.js` — the JSON files in the data directory (atomic writes) and
  the JSON-lines log.
- `public/` — `nursery.html` (`/`), `key.html` (`/key`), `admin.html`
  (`/admin`). Modules are served under `/static/`. No build step and no
  framework.

## Rules

- **No dependencies and no CDNs.** Booth machines may have no internet, and
  the server must run with only `node`.
- **The key page draws only pure black and pure white text.** Anything else
  shows up through the ATEM luma key. It fails to black, never to a stale code.
- **The stream contract matches ProdMesh-Control ADR 0010.** That means
  `event: msg` frames carrying `{ topic, data }`, snapshot topics, and
  conflation under backpressure. Don't add an event-shaped topic to the same
  path.
- **`npm run selftest` must print `PASS`.** Add a check for any new behaviour.
- **Comments explain why.** Decisions go in `docs/decisions/NNNN-kebab-title.md`
  using the family's ADR format.
- **Ship flow:** implement, let the owner look at it running, and commit/push
  only after they approve.
