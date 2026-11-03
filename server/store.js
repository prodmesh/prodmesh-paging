// Everything paging remembers lives in one data directory as plain files:
// config.json, state.json (active pages), sessions.json, log.jsonl. A church
// tech can read, back up or hand-edit them; there is no database to babysit.

import fs from 'node:fs';
import path from 'node:path';

export function createStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = (name) => path.join(dir, name);

  function read(name, fallback) {
    try {
      return JSON.parse(fs.readFileSync(file(name), 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return fallback;
      // A corrupt file must not take paging down on a Sunday morning. Keep the
      // evidence beside it and start from the fallback.
      fs.renameSync(file(name), file(`${name}.corrupt-${Date.now()}`));
      return fallback;
    }
  }

  // Write-then-rename so a power cut mid-write leaves the old file, never half
  // of the new one.
  function write(name, value) {
    const tmp = file(`${name}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, file(name));
  }

  function append(entry) {
    fs.appendFileSync(file('log.jsonl'), JSON.stringify(entry) + '\n');
  }

  function tail(limit) {
    let text;
    try {
      text = fs.readFileSync(file('log.jsonl'), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    return text
      .trim()
      .split('\n')
      .filter(Boolean)
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse();
  }

  return { read, write, append, tail };
}
