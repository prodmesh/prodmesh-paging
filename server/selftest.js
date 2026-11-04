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
    r = await call('POST', '/api/pages', { body: { code: '   ' }, token: nursery });
    check('empty code refused', r.status === 400, r);

    r = await call('POST', '/api/pages', { body: { code: 'ab12cd' }, token: nursery });
    check('6-character code refused', r.status === 400 && /at most 5/.test(r.data.error), r);

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

    // No character rules: O and 0, I and 1, punctuation, 1 to 5 characters.
    for (const [raw, want] of [['o0i1', 'O0I1'], ['7', '7'], ['a-b#c', 'A-B#C']]) {
      r = await call('POST', '/api/pages', { body: { code: raw }, token: nursery });
      check(`code ${JSON.stringify(raw)} accepted`, r.status === 200 && r.data.page.code === want, r);
    }
    r = await call('DELETE', `/api/pages/${encodeURIComponent('a-b#c')}`, { token: nursery });
    check('clear works for punctuation codes', r.data.cleared === true, r);
    await call('DELETE', '/api/pages/o0i1', { token: nursery });
    await call('DELETE', '/api/pages/7', { token: nursery });
    check('clears leave only the original page', app.paging.list().length === 1, app.paging.list());

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
    check('config reports max code length', r.data.maxCodeLength === 5, r.data);

    r = await call('PUT', '/api/config', { body: { display: { position: 'top-both' } }, token: admin });
    check('mirrored position accepted', r.data.display.position === 'top-both', r.data);

    // ── Heartbeat ──
    check('heartbeat off by default', r.data.display.heartbeat?.enabled === false, r.data.display);
    r = await call('PUT', '/api/config', {
      body: { display: { heartbeat: { enabled: true, position: 'middle', sizeVh: 99 } } },
      token: admin,
    });
    const hb = r.data.display.heartbeat;
    check('heartbeat settings clamp', hb.enabled === true && hb.position === 'bottom-right' && hb.sizeVh === 10, hb);
    check('heartbeat leaves code position alone', r.data.display.position === 'top-both', r.data.display);

    // ── Blocked words ──
    r = await call('POST', '/api/pages', { body: { code: 'xfuck' }, token: nursery });
    check('built-in word blocked anywhere in code', r.status === 400 && /can't be shown/.test(r.data.error), r);
    r = await call('POST', '/api/pages', { body: { code: 'ass' }, token: nursery });
    check('short word blocked as whole code', r.status === 400, r);
    r = await call('POST', '/api/pages', { body: { code: 'pass1' }, token: nursery });
    check('short word not blocked inside a code', r.status === 200, r);
    r = await call('PUT', '/api/blocked-words', { body: { words: ['zz9', ' zz9 ', '', 'bad words'] }, token: nursery });
    check('nursery cannot edit blocked words', r.status === 401, r);
    r = await call('PUT', '/api/blocked-words', { body: { words: ['zz9', ' zz9 ', '', 'bad words'] }, token: admin });
    check('blocked words normalized and deduped', r.data.extra.join() === 'ZZ9,BADWORDS' && r.data.builtIn > 0, r.data);
    r = await call('POST', '/api/pages', { body: { code: 'Zz9' }, token: nursery });
    check('tech-added word blocked', r.status === 400, r);

    // ── Companion clear-all ──
    r = await call('POST', '/api/integrations/clear-all?key=anything');
    check('clear-all refused before a key exists', r.status === 401, r);
    r = await call('POST', '/api/integration-key', { token: nursery });
    check('nursery cannot make an integration key', r.status === 401, r);
    r = await call('POST', '/api/integration-key', { token: admin });
    const ikey = r.data.key;
    check('admin makes an integration key', r.status === 200 && typeof ikey === 'string' && ikey.length > 16, r);
    r = await call('GET', '/api/session');
    check('session reports key is set', r.data.integrationKeySet === true, r.data);
    r = await call('POST', '/api/integrations/clear-all?key=wrong');
    check('wrong integration key refused', r.status === 401, r);
    r = await call('POST', `/api/integrations/clear-all?key=${encodeURIComponent(ikey)}`);
    check('clear-all with key in query', r.status === 200 && r.data.cleared === 1 && app.paging.list().length === 0, r);
    await call('POST', '/api/pages', { body: { code: 'K7' }, token: nursery });
    let res2 = await fetch(`${base}/api/integrations/clear-all`, { method: 'POST', headers: { 'X-Paging-Key': ikey } });
    check('clear-all with key in header', res2.status === 200 && (await res2.json()).cleared === 1, res2.status);
    res2 = await fetch(`${base}/api/integrations/clear-all?key=${encodeURIComponent(ikey)}`);
    check('clear-all refuses GET', res2.status === 404, res2.status);
    r = await call('POST', '/api/integration-key', { token: admin });
    res2 = await fetch(`${base}/api/integrations/clear-all?key=${encodeURIComponent(ikey)}`, { method: 'POST' });
    check('new key revokes the old one', res2.status === 401, res2.status);

    r = await call('GET', '/api/log', { token: admin });
    const actions = r.data.entries.map((e) => e.action);
    for (const a of ['page', 'renew', 'clear', 'timeout', 'config', 'blocked', 'integration-key']) {
      check(`log records ${a}`, actions.includes(a), actions);
    }
    check('log records station', r.data.entries.some((e) => e.station === 'Nursery A'), r.data.entries[0]);
    check('log records Companion clears', r.data.entries.some((e) => e.action === 'clear' && e.station === 'Companion'), r.data.entries[0]);

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
