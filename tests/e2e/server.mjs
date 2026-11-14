// Static server for end-to-end tests. It serves the site exactly as GitHub Pages would, with two
// differences so the pages talk to the local Firebase emulators instead of a real project:
//   - /js/config.js is replaced by a test configuration;
//   - the emulator addresses are added to the page's Content-Security-Policy.
// Everything else in the policy stays enforced, so a policy that breaks the site breaks the tests.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const port = Number(process.env.PORT || 4173);
const BASE = '/calendar-applet'; // served under a sub-path, like a GitHub Pages project site

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

const TEST_CONFIG = `export const config = {
  appName: 'Overlap',
  firebase: { apiKey: 'demo-key', authDomain: 'demo-calendar-applet.firebaseapp.com', projectId: 'demo-calendar-applet', appId: 'demo-app' },
  emulators: { auth: 'http://127.0.0.1:9099', firestore: ['127.0.0.1', 8080] },
};
`;
const UNCONFIGURED = `export const config = { appName: 'Overlap', firebase: { apiKey: '', authDomain: '', projectId: '', appId: '' } };\n`;

createServer(async (req, res) => {
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
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    let body = await readFile(file);
    if (path === '/js/config.js') {
      body = Buffer.from(req.headers.cookie?.includes('unconfigured=1') ? UNCONFIGURED : TEST_CONFIG);
    } else if (path === '/index.html') {
      body = Buffer.from(body.toString('utf8').replace('connect-src', 'connect-src http://127.0.0.1:9099 http://127.0.0.1:8080'));
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
