// `node server/index.js --selftest` — drives the real HTTP surface against a
// throwaway data directory with a fake clock. Prints PASS or the first FAIL.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './app.js';

export async function selftest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paging-selftest-'));
  let clock = Date.UTC(2026, 10, 1, 17, 0, 0);
  const now = () => clock;
  let app = createApp({ dataDir: dir, now });
  let base = await listen(app.server);
  const results = [];

  const call = async (method, p, { body, token } = {}) => {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(base + p, { method, headers, body: body && JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  };
  const check = (name, ok, detail) => {
    results.push({ name, ok });
    if (!ok) console.log(`FAIL ${name}${detail === undefined ? '' : `: ${JSON.stringify(detail)}`}`);
  };

  try {
    // ── Setup and auth ──
    let r = await call('GET', '/api/session');
    check('fresh install needs setup', r.data.needsSetup === true, r.data);

    r = await call('POST', '/api/pages', { body: { code: '2X3Y' } });
    check('paging without login is refused', r.status === 401, r);

    r = await call('POST', '/api/setup', { body: { adminPin: '12', nurseryPin: '4321' } });
    check('setup rejects short PIN', r.status === 400, r);

    r = await call('POST', '/api/setup', { body: { adminPin: '9876', nurseryPin: '4321' } });
    const admin = r.data.token;
    check('setup returns admin session', r.status === 200 && admin, r);

    r = await call('POST', '/api/setup', { body: { adminPin: '0000', nurseryPin: '0000' } });
    check('setup closes after first use', r.status === 409, r);

    r = await call('POST', '/api/session', { body: { role: 'nursery', pin: '0000' } });
    check('wrong nursery PIN refused', r.status === 401, r);

    r = await call('POST', '/api/session', { body: { role: 'nursery', pin: '4321', station: 'Nursery A' } });
    const nursery = r.data.token;
    check('nursery login', r.status === 200 && nursery, r);

    // ── Paging ──
    r = await call('POST', '/api/pages', { body: { code: '2O3Y' }, token: nursery });
    check('ambiguous characters refused', r.status === 400 && /never use/.test(r.data.error), r);

    r = await call('POST', '/api/pages', { body: { code: '2x3' }, token: nursery });
    check('short code refused', r.status === 400, r);

    r = await call('POST', '/api/pages', { body: { code: ' 2x3y ' }, token: nursery });
    check('page normalizes code', r.status === 200 && r.data.page.code === '2X3Y' && !r.data.renewed, r);

    const frames = await readStream(base, 'paging:active,paging:display,bogus:topic');
    const active = frames.find((f) => f.topic === 'paging:active');
    check('stream snapshot carries the page', active?.data.pages[0]?.code === '2X3Y', frames);
    check('stream drops unknown topics', frames.every((f) => f.topic !== 'bogus:topic'), frames);
    check('stream carries display config', frames.some((f) => f.topic === 'paging:display' && f.data.display), frames);

    clock += 5 * 60_000;
    r = await call('POST', '/api/pages', { body: { code: '2X3Y' }, token: nursery });
    check('re-paging renews instead of duplicating', r.data.renewed === true && app.paging.list().length === 1, r);
    check('renew restarts the timer', r.data.page.expiresAt === clock + 10 * 60_000, r.data.page);

    await call('POST', '/api/pages', { body: { code: 'AB7K' }, token: nursery });
    r = await call('GET', '/api/pages');
    check('pages listed oldest first', r.data.pages.map((p) => p.code).join() === '2X3Y,AB7K', r.data);

    // ── Persistence ──
    app.server.closeAllConnections();
    await new Promise((res) => app.server.close(res));
    app = createApp({ dataDir: dir, now });
    base = await listen(app.server);
    check('active pages survive restart', app.paging.list().length === 2, app.paging.list());

    r = await call('GET', '/api/session', { token: nursery });
    check('nursery session survives restart', r.data.role === 'nursery', r.data);

    // ── Clearing ──
    r = await call('DELETE', '/api/pages/ab7k', { token: nursery });
    check('manual clear', r.data.cleared === true && app.paging.list().length === 1, r);

    clock += 10 * 60_000 + 1;
    app.paging.sweep();
    check('auto-clear after timeout', app.paging.list().length === 0, app.paging.list());

    // ── Admin ──
    r = await call('PUT', '/api/config', { body: { autoClearMinutes: 3 }, token: nursery });
    check('nursery cannot change config', r.status === 401, r);

    r = await call('PUT', '/api/config', {
      body: { autoClearMinutes: 0, rotateSeconds: 6, display: { position: 'nowhere', codeSizeVh: 500 } },
      token: admin,
    });
    check('config clamps bad values', r.data.autoClearMinutes === 1 && r.data.display.codeSizeVh === 60 && r.data.display.position === 'top-right', r.data);
    check('config keeps good values', r.data.rotateSeconds === 6, r.data);

    r = await call('GET', '/api/log', { token: admin });
    const actions = r.data.entries.map((e) => e.action);
    for (const a of ['page', 'renew', 'clear', 'timeout', 'config']) {
      check(`log records ${a}`, actions.includes(a), actions);
    }
    check('log records station', r.data.entries.some((e) => e.station === 'Nursery A'), r.data.entries[0]);

    r = await call('PUT', '/api/pins/nursery', { body: { pin: '5555' }, token: admin });
    check('admin changes nursery PIN', r.status === 200, r);
    r = await call('POST', '/api/pages', { body: { code: '2X3Y' }, token: nursery });
    check('PIN change revokes old nursery sessions', r.status === 401, r);

    // ── Lockout ──
    for (let i = 0; i < 5; i++) await call('POST', '/api/session', { body: { role: 'admin', pin: '1111' } });
    r = await call('POST', '/api/session', { body: { role: 'admin', pin: '9876' } });
    check('repeated wrong PINs lock out', r.status === 429, r);
    clock += 31_000;
    r = await call('POST', '/api/session', { body: { role: 'admin', pin: '9876' } });
    check('lockout expires', r.status === 200, r);

    // ── Static ──
    for (const p of ['/', '/key', '/admin', '/static/lib.js', '/static/key-render.js']) {
      const res = await fetch(base + p);
      check(`serves ${p}`, res.status === 200);
    }
    const res = await fetch(base + '/static/..%2f..%2fpackage.json');
    check('no path traversal', res.status === 404);
  } catch (err) {
    console.log(`FAIL threw: ${err.stack}`);
    results.push({ ok: false });
  } finally {
    app.server.closeAllConnections();
    app.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `FAIL (${failed} of ${results.length})` : `PASS (${results.length} checks)`);
  return failed === 0;
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

// Read the initial snapshot frames off a stream, then hang up.
async function readStream(base, topics) {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/stream?topics=${topics}`, { signal: ctrl.signal });
  const reader = res.body.getReader();
  let text = '';
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && (text.match(/event: msg/g) ?? []).length < 2) {
    const { value, done } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
  }
  ctrl.abort();
  return text
    .split('\n\n')
    .filter((block) => block.startsWith('event: msg'))
    .map((block) => JSON.parse(block.split('\ndata: ')[1]));
}
