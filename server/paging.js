// Active pages, configuration and PIN sessions. No HTTP in here — app.js maps
// requests onto these calls, and the selftest drives them with a fake clock.

import crypto from 'node:crypto';

// Codes are four characters from an alphabet without O/0 and I/1. A parent
// squinting at a projector from row 30 cannot tell those apart, and neither
// can a volunteer reading a smudged sticker.
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// Length is set by tech to match whatever the check-in labels print.
export const MIN_CODE_LENGTH = 2;
export const MAX_CODE_LENGTH = 6;

export const POSITIONS = [
  'top-right', 'top-left', 'top-both',
  'bottom-right', 'bottom-left', 'bottom-both',
  'center',
];

export const DEFAULT_CONFIG = {
  codeLength: 4,
  autoClearMinutes: 10,
  rotateSeconds: 4,
  display: {
    position: 'top-right',
    // Sizes are % of the output's height so the same settings look the same
    // at 720p and 1080p.
    codeSizeVh: 12,
    marginVh: 4,
    label: 'CHILD PAGE',
    showLabel: true,
  },
  pins: { nursery: null, admin: null },
};

export function normalizeCode(raw, length) {
  const code = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (code.length !== length) {
    return { error: `Codes are ${length} characters.` };
  }
  const bad = [...code].filter((c) => !CODE_ALPHABET.includes(c));
  if (bad.length) {
    if (bad.some((c) => 'O0I1'.includes(c))) {
      return { error: 'Codes never use O, 0, I or 1. Check the label again.' };
    }
    return { error: 'Codes use only letters and numbers.' };
  }
  return { code };
}

// ── Config validation ────────────────────────────────────────────────────────
// Every field is clamped rather than rejected, so an admin typing 0 minutes
// gets 1 instead of an error dialog.

const clamp = (n, lo, hi, fallback) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
};

export function sanitizeConfig(input, base) {
  const d = input?.display ?? {};
  const bd = base.display;
  return {
    ...base,
    codeLength: Math.round(clamp(input?.codeLength, MIN_CODE_LENGTH, MAX_CODE_LENGTH, base.codeLength)),
    autoClearMinutes: Math.round(clamp(input?.autoClearMinutes, 1, 120, base.autoClearMinutes)),
    rotateSeconds: clamp(input?.rotateSeconds, 1, 30, base.rotateSeconds),
    display: {
      position: POSITIONS.includes(d.position) ? d.position : bd.position,
      codeSizeVh: clamp(d.codeSizeVh, 3, 60, bd.codeSizeVh),
      marginVh: clamp(d.marginVh, 0, 20, bd.marginVh),
      label: typeof d.label === 'string' ? d.label.slice(0, 32) : bd.label,
      showLabel: typeof d.showLabel === 'boolean' ? d.showLabel : bd.showLabel,
    },
  };
}

// ── PINs ─────────────────────────────────────────────────────────────────────

export function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function checkPin(pin, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const got = crypto.scryptSync(String(pin), salt, 32);
  return crypto.timingSafeEqual(got, Buffer.from(hash, 'hex'));
}

export function validPin(pin) {
  return typeof pin === 'string' && /^\d{4,8}$/.test(pin);
}

const tokenKey = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

// ── The paging core ──────────────────────────────────────────────────────────

export function createPaging({ store, now = Date.now, onChange = () => {} }) {
  const stored = store.read('config.json', {});
  let config = {
    ...sanitizeConfig(stored, DEFAULT_CONFIG),
    pins: { ...DEFAULT_CONFIG.pins, ...stored.pins },
  };
  let pages = store.read('state.json', { pages: [] }).pages ?? [];
  // Sessions are stored by token hash, so a copied data folder can't be used
  // to impersonate a browser.
  let sessions = store.read('sessions.json', {});

  const log = (action, fields) => store.append({ at: new Date(now()).toISOString(), action, ...fields });

  function savePages() {
    store.write('state.json', { pages });
    onChange('pages');
  }
  function saveConfig() {
    store.write('config.json', config);
    onChange('config');
  }

  function list() {
    return [...pages].sort((a, b) => a.pagedAt - b.pagedAt);
  }

  function page(raw, who) {
    const { code, error } = normalizeCode(raw, config.codeLength);
    if (error) return { error };
    const t = now();
    const expiresAt = t + config.autoClearMinutes * 60_000;
    const existing = pages.find((p) => p.code === code);
    if (existing) {
      // Paging a code that's already up restarts its timer rather than showing
      // it twice. The original pagedAt is kept so rotation order is stable.
      existing.expiresAt = expiresAt;
      log('renew', { code, ...who });
      savePages();
      return { page: existing, renewed: true };
    }
    const p = { code, pagedAt: t, expiresAt, station: who.station };
    pages.push(p);
    log('page', { code, ...who });
    savePages();
    return { page: p, renewed: false };
  }

  function clear(raw, who, reason = 'clear') {
    const code = String(raw ?? '').toUpperCase();
    const before = pages.length;
    pages = pages.filter((p) => p.code !== code);
    if (pages.length === before) return false;
    log(reason, { code, ...who });
    savePages();
    return true;
  }

  function clearAll(who) {
    if (!pages.length) return 0;
    const n = pages.length;
    for (const p of pages) log('clear', { code: p.code, ...who });
    pages = [];
    savePages();
    return n;
  }

  function sweep() {
    const t = now();
    const expired = pages.filter((p) => p.expiresAt <= t);
    if (!expired.length) return 0;
    for (const p of expired) log('timeout', { code: p.code, station: 'auto' });
    pages = pages.filter((p) => p.expiresAt > t);
    savePages();
    return expired.length;
  }

  // ── Config ──

  const publicConfig = () => ({
    codeLength: config.codeLength,
    autoClearMinutes: config.autoClearMinutes,
    rotateSeconds: config.rotateSeconds,
    display: config.display,
  });

  function updateConfig(input, who) {
    config = { ...sanitizeConfig(input, config), pins: config.pins };
    log('config', { ...who, config: publicConfig() });
    saveConfig();
    return publicConfig();
  }

  // ── Auth ──

  // Until an admin PIN exists, /admin offers first-run setup. That is the one
  // unauthenticated write, and it closes itself the moment it succeeds.
  const needsSetup = () => !config.pins.admin;
  const hasPin = (role) => Boolean(config.pins[role]);

  function setPin(role, pin, who) {
    if (!validPin(pin)) return { error: 'PINs are 4–8 digits.' };
    config.pins[role] = hashPin(pin);
    // A new PIN revokes every browser that logged in with the old one; that is
    // the point of changing it.
    for (const [k, s] of Object.entries(sessions)) if (s.role === role) delete sessions[k];
    store.write('sessions.json', sessions);
    log('pin', { role, ...who });
    saveConfig();
    return { ok: true };
  }

  function login(role, pin, station) {
    if (!['nursery', 'admin'].includes(role)) return null;
    if (!checkPin(pin, config.pins[role])) return null;
    const token = crypto.randomBytes(24).toString('base64url');
    sessions[tokenKey(token)] = {
      role,
      station: String(station || (role === 'admin' ? 'Tech' : 'Nursery')).slice(0, 40),
      createdAt: now(),
    };
    store.write('sessions.json', sessions);
    return token;
  }

  function session(token) {
    return token ? sessions[tokenKey(token)] ?? null : null;
  }

  function logout(token) {
    delete sessions[tokenKey(token)];
    store.write('sessions.json', sessions);
  }

  return {
    list,
    page,
    clear,
    clearAll,
    sweep,
    publicConfig,
    updateConfig,
    needsSetup,
    hasPin,
    setPin,
    login,
    session,
    logout,
    log: (limit) => store.tail(limit),
  };
}
