// Active pages, configuration and PIN sessions. No HTTP in here — app.js maps
// requests onto these calls, and the selftest drives them with a fake clock.

import crypto from 'node:crypto';
import { BLOCKED_WORDS } from './blocked-words.js';

// Codes are whatever the check-in sticker says, 1 to 5 characters. The
// nursery asked for no character rules (O and 0 both allowed), so the only
// normalization is upper-casing and dropping spaces.
export const MAX_CODE_LENGTH = 5;

export const POSITIONS = [
  'top-right', 'top-left', 'top-both',
  'bottom-right', 'bottom-left', 'bottom-both',
  'center',
];

export const CORNERS = ['top-right', 'top-left', 'bottom-right', 'bottom-left'];

export const DEFAULT_CONFIG = {
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
    // A small white square that flips on every message from the server. It
    // sits outside the keyer's mask, so only the multiview sees it: blinking
    // means the key page is alive and connected.
    heartbeat: {
      enabled: false,
      position: 'bottom-right',
      sizeVh: 1.5,
      marginVh: 2,
    },
  },
  // Tech's additions to BLOCKED_WORDS, edited at /admin.
  blockedWords: [],
  pins: { nursery: null, admin: null },
  // Hash of the key Bitfocus Companion (or any HTTP client) sends to clear
  // all pages. Null until tech generates one at /admin.
  integrationKey: null,
};

export function normalizeCode(raw) {
  const code = String(raw ?? '').toUpperCase().replace(/\s+/g, '');
  // Count characters, not UTF-16 units, so an accented letter is one.
  const length = [...code].length;
  if (length < 1) return { error: 'Type a code first.' };
  if (length > MAX_CODE_LENGTH) return { error: `Codes are at most ${MAX_CODE_LENGTH} characters.` };
  return { code };
}

// ── Blocked words ────────────────────────────────────────────────────────────

export function normalizeWord(w) {
  return String(w ?? '').toUpperCase().replace(/\s+/g, '');
}

// Short words must match the whole code; longer ones match anywhere. See
// blocked-words.js for why.
export function isBlocked(code, extra = []) {
  for (const raw of [...BLOCKED_WORDS, ...extra]) {
    const w = normalizeWord(raw);
    if (!w) continue;
    if (w.length <= 3 ? code === w : code.includes(w)) return true;
  }
  return false;
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
    autoClearMinutes: Math.round(clamp(input?.autoClearMinutes, 1, 120, base.autoClearMinutes)),
    rotateSeconds: clamp(input?.rotateSeconds, 1, 30, base.rotateSeconds),
    display: {
      position: POSITIONS.includes(d.position) ? d.position : bd.position,
      codeSizeVh: clamp(d.codeSizeVh, 3, 60, bd.codeSizeVh),
      marginVh: clamp(d.marginVh, 0, 20, bd.marginVh),
      label: typeof d.label === 'string' ? d.label.slice(0, 32) : bd.label,
      showLabel: typeof d.showLabel === 'boolean' ? d.showLabel : bd.showLabel,
      heartbeat: sanitizeHeartbeat(d.heartbeat, bd.heartbeat ?? DEFAULT_CONFIG.display.heartbeat),
    },
  };
}

function sanitizeHeartbeat(h, base) {
  return {
    enabled: typeof h?.enabled === 'boolean' ? h.enabled : base.enabled,
    position: CORNERS.includes(h?.position) ? h.position : base.position,
    sizeVh: clamp(h?.sizeVh, 0.5, 10, base.sizeVh),
    marginVh: clamp(h?.marginVh, 0, 20, base.marginVh),
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
  // sanitizeConfig only knows the public settings; the private ones are
  // carried over from the file explicitly.
  let config = {
    ...sanitizeConfig(stored, DEFAULT_CONFIG),
    pins: { ...DEFAULT_CONFIG.pins, ...stored.pins },
    blockedWords: Array.isArray(stored.blockedWords) ? stored.blockedWords : [],
    integrationKey: stored.integrationKey ?? null,
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
    const { code, error } = normalizeCode(raw);
    if (error) return { error };
    if (isBlocked(code, config.blockedWords)) {
      log('blocked', { code, ...who });
      return { error: "That code can't be shown. If it's really on the sticker, call tech." };
    }
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
    const code = normalizeCode(raw).code;
    if (!code) return false;
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
    maxCodeLength: MAX_CODE_LENGTH,
    autoClearMinutes: config.autoClearMinutes,
    rotateSeconds: config.rotateSeconds,
    display: config.display,
  });

  function updateConfig(input, who) {
    config = { ...config, ...sanitizeConfig(input, config) };
    log('config', { ...who, config: publicConfig() });
    saveConfig();
    return publicConfig();
  }

  // ── Blocked words (admin) ──

  const blockedWords = () => ({ builtIn: BLOCKED_WORDS.length, extra: config.blockedWords });

  function setBlockedWords(list, who) {
    if (!Array.isArray(list)) return { error: 'Expected a list of words.' };
    config.blockedWords = [...new Set(list.map(normalizeWord).filter(Boolean))].slice(0, 500);
    log('blocked-words', { ...who, count: config.blockedWords.length });
    saveConfig();
    return blockedWords();
  }

  // ── Integration key (Companion) ──
  // One shared secret, shown once when generated and stored only as a hash.
  // It can clear all pages and nothing else.

  function newIntegrationKey(who) {
    const key = crypto.randomBytes(18).toString('base64url');
    config.integrationKey = tokenKey(key);
    log('integration-key', { ...who });
    saveConfig();
    return key;
  }

  function checkIntegrationKey(key) {
    if (!key || !config.integrationKey) return false;
    return crypto.timingSafeEqual(Buffer.from(tokenKey(key), 'hex'), Buffer.from(config.integrationKey, 'hex'));
  }

  const hasIntegrationKey = () => Boolean(config.integrationKey);

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
    blockedWords,
    setBlockedWords,
    newIntegrationKey,
    checkIntegrationKey,
    hasIntegrationKey,
    login,
    session,
    logout,
    log: (limit) => store.tail(limit),
  };
}
