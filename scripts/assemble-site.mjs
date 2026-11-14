// Builds the folder that gets published to GitHub Pages:  node scripts/assemble-site.mjs <out> <stamp>
//
// Two things differ from the repository itself:
//   - only the site's own files are copied (no tests, tooling or settings for them);
//   - the js and css folders are renamed to include a stamp (the commit id). GitHub Pages lets
//     browsers reuse files for ten minutes, so without this a returning visitor could run a mix
//     of old and new scripts just after an update. A new folder name means a clean set.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function scriptsUnder(dir, base = dir) {
  const found = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...scriptsUnder(path, base));
    else if (name.endsWith('.js')) found.push(path.slice(base.length + 1).split('\\').join('/'));
  }
  return found;
}

export function assembleSite({ root, out, stamp }) {
  if (!/^[A-Za-z0-9]{1,40}$/.test(stamp)) throw new Error(`The stamp must be letters and digits, got "${stamp}"`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const file of ['index.html', '404.html', 'firestore.rules']) cpSync(join(root, file), join(out, file));
  cpSync(join(root, 'assets'), join(out, 'assets'), { recursive: true });
  cpSync(join(root, 'css'), join(out, `css-${stamp}`), { recursive: true });
  cpSync(join(root, 'js'), join(out, `js-${stamp}`), { recursive: true });

  // Tell the browser about every script at once, so it does not discover them one import at a time.
  const preloads = scriptsUnder(join(root, 'js'))
    .filter((path) => path !== 'main.js' && path !== 'legacy.js')
    .map((path) => `  <link rel="modulepreload" href="./js-${stamp}/${path}">`)
    .join('\n');

  let index = readFileSync(join(out, 'index.html'), 'utf8')
    .replace(/^\s*<link rel="modulepreload"[^>]*>\n/gm, '')
    .replaceAll('./css/', `./css-${stamp}/`)
    .replaceAll('./js/', `./js-${stamp}/`);
  const entry = index.indexOf('  <script type="module"');
  if (entry < 0) throw new Error('index.html has no module script to put the preloads before');
  index = `${index.slice(0, entry)}${preloads}\n${index.slice(entry)}`;
  writeFileSync(join(out, 'index.html'), index);

  const missing = readFileSync(join(out, '404.html'), 'utf8')
    .replaceAll('/calendar-applet/css/', `/calendar-applet/css-${stamp}/`)
    .replaceAll('/calendar-applet/js/', `/calendar-applet/js-${stamp}/`);
  writeFileSync(join(out, '404.html'), missing);

  for (const [name, text] of [['index.html', index], ['404.html', missing]]) {
    if (/(\.|calendar-applet)\/(js|css)\//.test(text)) throw new Error(`${name} still points at an unstamped folder`);
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const out = resolve(process.argv[2] || '_site');
  const stamp = (process.argv[3] || 'dev').slice(0, 12);
  assembleSite({ root, out, stamp });
  console.log(`Site assembled in ${out} (stamp ${stamp})`);
}
