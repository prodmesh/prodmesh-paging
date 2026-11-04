// HTTP surface. Plain node:http, no framework: there are a dozen routes and
// the booth machine that runs this should need nothing but `node`.
//
// The wire shape deliberately matches ProdMesh-Control (ADR 0010 there):
// GET /api/stream?topics=a,b emits `event: msg` frames carrying
// `{ topic, data }`, every topic is a state snapshot, and slow subscribers
// conflate instead of queueing. If Control ever absorbs paging, its
// `useTopic('paging:active')` works unchanged.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPaging } from './paging.js';
import { createStore } from './store.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const PAGES = { '/': 'nursery.html', '/key': 'key.html', '/admin': 'admin.html' };
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export const TOPICS = ['paging:active', 'paging:display'];

// The key page blanks itself if it hears nothing for a few of these. Named
// `ping` (not a `:` comment) so browser code can see it; Control's client only
// listens for `msg`, so it ignores these harmlessly.
const PING_MS = 5_000;
const SWEEP_MS = 1_000;

// Failed logins per client address: five tries, then a 30 s pause. A 4-digit
// PIN on an open LAN is only as good as this.
const MAX_FAILS = 5;
const LOCKOUT_MS = 30_000;

export function createApp({ dataDir, now = Date.now }) {
  const store = createStore(dataDir);
  const subs = new Set(); // { res, topics, pending }
  const fails = new Map(); // ip -> { count, until }

  const paging = createPaging({
    store,
    now,
    onChange: (what) => publish(what === 'pages' ? 'paging:active' : 'paging:display'),
  });

  // ── Stream hub ───────────────────────────────────────────────────────────

  function snapshot(topic) {
    if (topic === 'paging:active') return { pages: paging.list(), serverNow: now() };
    return paging.publicConfig();
  }

  const frame = (topic, data) => `event: msg\ndata: ${JSON.stringify({ topic, data })}\n\n`;

  // Conflate, never queue: a backed-up socket holds at most one pending frame
  // per topic, newest wins. Correct because every topic is a snapshot.
  function send(sub, topic, text) {
    if (sub.pending) {
      sub.pending.set(topic, text);
      return;
    }
    if (sub.res.write(text) === false) {
      sub.pending = new Map();
      sub.res.once('drain', () => drain(sub));
    }
  }
  function drain(sub) {
    const queued = sub.pending;
    sub.pending = null;
    for (const [topic, text] of queued) send(sub, topic, text);
  }

  function publish(topic) {
    let text;
    for (const sub of subs) {
      if (sub.topics.has(topic)) send(sub, topic, (text ??= frame(topic, snapshot(topic))));
    }
  }

  function openStream(req, res, url) {
    const topics = new Set(
      (url.searchParams.get('topics') ?? '').split(',').filter((t) => TOPICS.includes(t)),
    );
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const sub = { res, topics, pending: null };
    subs.add(sub);
    for (const t of topics) send(sub, t, frame(t, snapshot(t)));
    const ping = setInterval(() => send(sub, '_ping', `event: ping\ndata: ${now()}\n\n`), PING_MS);
    req.on('close', () => {
      clearInterval(ping);
      subs.delete(sub);
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  function json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > 16_384) {
          reject(Object.assign(new Error('Body too large'), { status: 413 }));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
        }
      });
      req.on('error', reject);
    });
  }

  const ipOf = (req) => req.socket.remoteAddress?.replace(/^::ffff:/, '') ?? '?';
  const tokenOf = (req) => (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '') || null;

  // Admin sessions can do anything a nursery session can.
  function auth(req, role) {
    const s = paging.session(tokenOf(req));
    if (!s) return null;
    if (role === 'admin' && s.role !== 'admin') return null;
    return { station: s.station, role: s.role, ip: ipOf(req) };
  }

  function serveFile(res, rel) {
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC + path.sep)) return json(res, 404, { error: 'Not found' });
    fs.readFile(file, (err, buf) => {
      if (err) return json(res, 404, { error: 'Not found' });
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(buf);
    });
  }

  // ── Routes ───────────────────────────────────────────────────────────────

  async function route(req, res) {
    const url = new URL(req.url, 'http://local');
    const p = url.pathname;
    const m = req.method;

    if (m === 'GET' && PAGES[p]) return serveFile(res, PAGES[p]);
    if (m === 'GET' && p.startsWith('/static/')) return serveFile(res, p.slice('/static/'.length));
    if (m === 'GET' && p === '/api/stream') return openStream(req, res, url);

    if (m === 'GET' && p === '/api/pages') return json(res, 200, snapshot('paging:active'));
    if (m === 'GET' && p === '/api/config') return json(res, 200, paging.publicConfig());

    if (m === 'GET' && p === '/api/session') {
      const s = paging.session(tokenOf(req));
      return json(res, 200, {
        role: s?.role ?? null,
        station: s?.station ?? null,
        needsSetup: paging.needsSetup(),
        nurseryPinSet: paging.hasPin('nursery'),
      });
    }

    if (m === 'POST' && p === '/api/session') {
      const ip = ipOf(req);
      const f = fails.get(ip);
      if (f && f.until > now()) {
        return json(res, 429, { error: 'Too many wrong PINs. Wait 30 seconds.' });
      }
      const { role = 'nursery', pin, station } = await readBody(req);
      if (!paging.hasPin(role)) {
        return json(res, 409, { error: 'Tech has not set this PIN yet.' });
      }
      const token = paging.login(role, pin, station);
      if (!token) {
        const next = { count: (f?.count ?? 0) + 1, until: 0 };
        if (next.count >= MAX_FAILS) Object.assign(next, { count: 0, until: now() + LOCKOUT_MS });
        fails.set(ip, next);
        return json(res, 401, { error: 'Wrong PIN.' });
      }
      fails.delete(ip);
      return json(res, 200, { token, role });
    }

    if (m === 'DELETE' && p === '/api/session') {
      const t = tokenOf(req);
      if (t) paging.logout(t);
      return json(res, 200, { ok: true });
    }

    if (m === 'POST' && p === '/api/setup') {
      if (!paging.needsSetup()) return json(res, 409, { error: 'Already set up.' });
      const { adminPin, nurseryPin } = await readBody(req);
      const who = { station: 'setup', ip: ipOf(req) };
      for (const [role, pin] of [['admin', adminPin], ['nursery', nurseryPin]]) {
        const r = paging.setPin(role, pin, who);
        if (r.error) return json(res, 400, r);
      }
      return json(res, 200, { token: paging.login('admin', adminPin, 'Tech'), role: 'admin' });
    }

    // ── Nursery actions ──

    if (m === 'POST' && p === '/api/pages') {
      const who = auth(req, 'nursery');
      if (!who) return json(res, 401, { error: 'Log in first.' });
      const { code } = await readBody(req);
      const r = paging.page(code, who);
      if (r.error) return json(res, 400, r);
      return json(res, 200, r);
    }

    // Codes can hold any character, so the path segment is URL-encoded.
    const clearMatch = p.match(/^\/api\/pages\/([^/]{1,64})$/);
    if (m === 'DELETE' && clearMatch) {
      const who = auth(req, 'nursery');
      if (!who) return json(res, 401, { error: 'Log in first.' });
      let raw;
      try {
        raw = decodeURIComponent(clearMatch[1]);
      } catch {
        return json(res, 400, { error: 'Bad code.' });
      }
      return json(res, 200, { cleared: paging.clear(raw, who) });
    }

    // ── Admin actions ──

    if (m === 'DELETE' && p === '/api/pages') {
      const who = auth(req, 'admin');
      if (!who) return json(res, 401, { error: 'Admin only.' });
      return json(res, 200, { cleared: paging.clearAll(who) });
    }

    if (m === 'PUT' && p === '/api/config') {
      const who = auth(req, 'admin');
      if (!who) return json(res, 401, { error: 'Admin only.' });
      return json(res, 200, paging.updateConfig(await readBody(req), who));
    }

    const pinMatch = p.match(/^\/api\/pins\/(nursery|admin)$/);
    if (m === 'PUT' && pinMatch) {
      const who = auth(req, 'admin');
      if (!who) return json(res, 401, { error: 'Admin only.' });
      const r = paging.setPin(pinMatch[1], (await readBody(req)).pin, who);
      return json(res, r.error ? 400 : 200, r);
    }

    if (m === 'GET' && p === '/api/log') {
      if (!auth(req, 'admin')) return json(res, 401, { error: 'Admin only.' });
      const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit')) || 200));
      return json(res, 200, { entries: paging.log(limit) });
    }

    return json(res, 404, { error: 'Not found' });
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch((err) => {
      if (!res.headersSent) json(res, err.status ?? 500, { error: err.status ? err.message : 'Server error' });
      if (!err.status) console.error(err);
    });
  });

  // Pages that expired while the server was down are swept (and logged as
  // timeouts) on the first tick.
  const sweeper = setInterval(() => paging.sweep(), SWEEP_MS);
  server.on('close', () => clearInterval(sweeper));

  return { server, paging };
}
