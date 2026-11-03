#!/usr/bin/env node
// Entry point. `node server/index.js` serves; `--selftest` exercises the whole
// HTTP surface against a throwaway data directory and prints PASS.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

export const VERSION = '0.1.0';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

if (process.argv.includes('--selftest')) {
  const { selftest } = await import('./selftest.js');
  process.exit((await selftest()) ? 0 : 1);
}

const port = Number(process.env.PORT) || 8522;
const host = process.env.HOST || '0.0.0.0';
const dataDir = process.env.PAGING_DATA || path.join(ROOT, 'var');

const { server, paging } = createApp({ dataDir });
server.listen(port, host, () => {
  console.log(`prodmesh-paging ${VERSION} on http://${host}:${port}`);
  console.log(`  nursery  /        key  /key        admin  /admin`);
  console.log(`  data     ${dataDir}`);
  if (paging.needsSetup()) console.log('  first run: open /admin to set the PINs');
});
