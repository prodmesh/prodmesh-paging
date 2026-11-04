// Shared browser helpers: API calls, the saved login, and the live stream.

// localStorage can throw (private windows, blocked storage); a missing token
// just means "log in again", never a broken page.
export function loadToken(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function saveToken(key, token) {
  try {
    if (token) localStorage.setItem(key, token);
    else localStorage.removeItem(key);
  } catch {}
}

export async function api(method, path, { body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: 'Cannot reach the paging server.' } };
  }
}

// One EventSource carrying named topics, same frame shape as ProdMesh-Control.
// The server pings every 5 s; hearing nothing for WATCHDOG_MS means the link is
// dead even if the socket hasn't noticed (a pulled cable can take minutes to
// error), so we report "down" and reconnect ourselves.
const WATCHDOG_MS = 12_000;

export function connect(topics, { onTopic, onStatus }) {
  let es = null;
  let watchdog = null;
  let up = null;

  const setUp = (v) => {
    if (v !== up) onStatus?.((up = v));
  };

  function alive() {
    setUp(true);
    clearTimeout(watchdog);
    watchdog = setTimeout(restart, WATCHDOG_MS);
  }

  function restart() {
    setUp(false);
    es?.close();
    setTimeout(open, 1000);
  }

  function open() {
    es = new EventSource(`/api/stream?topics=${topics.join(',')}`);
    es.addEventListener('msg', (e) => {
      alive();
      const { topic, data } = JSON.parse(e.data);
      onTopic(topic, data);
    });
    es.addEventListener('ping', alive);
    es.onerror = () => {
      setUp(false);
      // EventSource retries on its own unless the server refused outright.
      if (es.readyState === EventSource.CLOSED) {
        clearTimeout(watchdog);
        setTimeout(open, 2000);
      }
    };
  }

  open();
}

export function minutesAgo(ms) {
  const m = Math.floor(ms / 60_000);
  return m < 1 ? 'just now' : `${m} min ago`;
}

export function minutesLeft(ms) {
  const m = Math.ceil(ms / 60_000);
  return m <= 1 ? 'under a minute' : `${m} min`;
}
