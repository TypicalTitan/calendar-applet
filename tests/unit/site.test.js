// Checks on the site as a whole that need no browser: things that would only show up as a
// broken page on GitHub Pages, or as a security regression nobody notices.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, rmSync, cpSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { assembleSite } from '../../scripts/assemble-site.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');

function filesUnder(dir, extension) {
  const found = [];
  for (const name of readdirSync(join(root, dir))) {
    const path = join(dir, name);
    if (statSync(join(root, path)).isDirectory()) found.push(...filesUnder(path, extension));
    else if (path.endsWith(extension)) found.push(path);
  }
  return found;
}

const ownScripts = filesUnder('js', '.js').filter((path) => !path.startsWith(join('js', 'vendor')));

test('index.html uses only relative addresses, so it works under /calendar-applet/', () => {
  const html = read('index.html');
  assert.equal(/(href|src)="\//.test(html), false);
  assert.equal(/<base\b/i.test(html), false);
});

test('the Content-Security-Policy comes before anything the page loads', () => {
  const html = read('index.html');
  const policy = html.indexOf('http-equiv="Content-Security-Policy"');
  assert.ok(policy > 0);
  for (const tag of ['<script', '<link']) assert.ok(policy < html.indexOf(tag), `${tag} appears before the policy`);
  for (const part of ["default-src 'none'", "script-src 'self'", "style-src 'self'", "form-action 'none'", "base-uri 'none'", "require-trusted-types-for 'script'"]) {
    assert.ok(html.includes(part), part);
  }
});

test('no script turns a string into markup or code', () => {
  const forbidden = /\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write|\beval\s*\(|new Function\s*\(|setTimeout\s*\(\s*['"`]|\.srcdoc\b/;
  for (const path of ownScripts) {
    const line = read(path).split('\n').findIndex((text) => forbidden.test(text) && !text.trim().startsWith('//'));
    assert.equal(line, -1, `${path}:${line + 1}`);
  }
});

test('every import between the site\'s scripts is relative and points at a file that exists', () => {
  for (const path of ownScripts) {
    for (const match of read(path).matchAll(/from\s+'([^']+)'/g)) {
      const target = match[1];
      assert.ok(target.startsWith('./') || target.startsWith('../'), `${path} imports ${target}`);
      assert.ok(existsSync(join(root, dirname(path), target)), `${path} imports missing ${target}`);
    }
  }
});

test('the committed settings never point the public site at local test servers', () => {
  assert.equal(/emulators\s*:/.test(read('js/config.js').replace(/\/\/.*$/gm, '')), false);
});

test('the published folder holds only the site, with stamped script and style folders', () => {
  const out = mkdtempSync(join(tmpdir(), 'site-'));
  try {
    assembleSite({ root, out, stamp: 'abc12345' });
    assert.deepEqual(readdirSync(out).sort(), ['404.html', 'assets', 'css-abc12345', 'firestore.rules', 'index.html', 'js-abc12345']);

    const html = readFileSync(join(out, 'index.html'), 'utf8');
    assert.ok(html.includes('./css-abc12345/app.css'));
    assert.ok(html.includes('src="./js-abc12345/main.js"'));
    assert.equal(/\.\/(js|css)\//.test(html), false, 'an unstamped address is left in index.html');
    const missing = readFileSync(join(out, '404.html'), 'utf8');
    assert.equal(/\/(js|css)\//.test(missing), false, 'an unstamped address is left in 404.html');
    assert.ok(missing.includes('/css-abc12345/app.css'));

    // Every script is announced up front so the browser fetches them together.
    const preloaded = [...html.matchAll(/rel="modulepreload" href="\.\/js-abc12345\/([^"]+)"/g)].map((m) => m[1]).sort();
    const present = filesUnder('js', '.js').map((path) => relative('js', path).split('\\').join('/')).filter((path) => path !== 'main.js' && path !== 'legacy.js').sort();
    assert.deepEqual(preloaded, present);

    // The stylesheet still finds its fonts from its new folder.
    const css = readFileSync(join(out, 'css-abc12345', 'app.css'), 'utf8');
    for (const match of css.matchAll(/url\("([^"]+)"\)/g)) assert.ok(existsSync(join(out, 'css-abc12345', match[1])), match[1]);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('a browser too old for the site is told so', () => {
  assert.ok(/<script nomodule src="\.\/js\/legacy\.js">/.test(read('index.html')));
  assert.ok(existsSync(join(root, 'js/legacy.js')));
});

test('the 404 page is stamped whatever the repository is called, including a site on its own domain', () => {
  // Whatever prefix the committed page has now (the owner may have renamed the repository).
  const current = read('404.html').match(/href="([^"]*)\/css\/app\.css"/)[1];
  for (const [prefix, expected] of [['/my-renamed-repo', '/my-renamed-repo/css-abc12345/app.css'], ['', '/css-abc12345/app.css']]) {
    const copy = mkdtempSync(join(tmpdir(), 'site-src-'));
    const out = mkdtempSync(join(tmpdir(), 'site-'));
    try {
      // Only the site's own files, so the test does not depend on where the checkout lives.
      for (const entry of ['index.html', '404.html', 'firestore.rules', 'assets', 'css', 'js']) {
        cpSync(join(root, entry), join(copy, entry), { recursive: true });
      }
      const page = readFileSync(join(copy, '404.html'), 'utf8').replaceAll(`${current}/`, `${prefix}/`);
      writeFileSync(join(copy, '404.html'), page);
      assembleSite({ root: copy, out, stamp: 'abc12345' });
      assert.ok(readFileSync(join(out, '404.html'), 'utf8').includes(`href="${expected}"`), prefix || '(own domain)');
    } finally {
      rmSync(copy, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  }
});
