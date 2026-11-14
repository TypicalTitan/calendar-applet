// Static server for end-to-end tests. It serves the site exactly as GitHub Pages would, with two
// differences so the pages talk to the local Firebase emulators instead of a real project:
//   - /js/config.js is replaced by a test configuration;
//   - the emulator addresses are added to the page's Content-Security-Policy.
// Everything else in the policy stays enforced, so a policy that breaks the site breaks the tests.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// SITE_ROOT serves a different folder, for testing the assembled site exactly as it is published.
const root = resolve(process.env.SITE_ROOT || fileURLToPath(new URL('../..', import.meta.url)));
const port = Number(process.env.PORT || 4173);
const BASE = '/calendar-applet'; // served under a sub-path, like a GitHub Pages project site

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

// `firebase emulators:exec` tells its child processes where the emulators are listening.
const [authHost, authPort] = (process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099').split(':');
const [storeHost, storePort] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const EMULATOR_ORIGINS = `http://${authHost}:${authPort} http://${storeHost}:${storePort}`;

const TEST_CONFIG = `export const config = {
  appName: 'Overlap',
  firebase: { apiKey: 'demo-key', authDomain: 'demo-calendar-applet.firebaseapp.com', projectId: 'demo-calendar-applet', appId: 'demo-app' },
  emulators: { auth: 'http://${authHost}:${authPort}', firestore: ['${storeHost}', ${Number(storePort)}] },
};
`;
const UNCONFIGURED = `export const config = { appName: 'Overlap', firebase: { apiKey: '', authDomain: '', projectId: '', appId: '' } };\n`;

createServer(async (req, res) => {
  // Answer only when addressed as this machine, so another site cannot reach the files through a
  // DNS name it controls.
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '')) {
    res.writeHead(421, { 'Content-Type': 'text/plain' }).end('Misdirected request');
    return;
  }
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/' || url.pathname === BASE) {
    res.writeHead(302, { Location: `${BASE}/` }).end();
    return;
  }
  if (!url.pathname.startsWith(`${BASE}/`)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    return;
  }
  let path = decodeURIComponent(url.pathname.slice(BASE.length));
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(root, path));
  const inside = relative(root, file);
  // Only files inside the site, and nothing hidden (.git, .claude, .github ...).
  if (inside.startsWith('..') || isAbsolute(inside) || inside.split(/[\\/]/).some((part) => part.startsWith('.') && part !== '.nojekyll')) {
    res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Forbidden');
    return;
  }
  try {
    let body = await readFile(file);
    if (/^\/js(-[A-Za-z0-9]+)?\/config\.js$/.test(path)) {
      body = Buffer.from(req.headers.cookie?.includes('unconfigured=1') ? UNCONFIGURED : TEST_CONFIG);
    } else if (path === '/index.html') {
      body = Buffer.from(body.toString('utf8').replace('connect-src', `connect-src ${EMULATOR_ORIGINS}`));
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
  } catch {
    try {
      res.writeHead(404, { 'Content-Type': TYPES['.html'] }).end(await readFile(join(root, '404.html')));
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    }
  }
}).listen(port, '127.0.0.1', () => console.log(`Serving ${root} at http://127.0.0.1:${port}${BASE}/`));
