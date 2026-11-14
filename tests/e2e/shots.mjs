// Takes screenshots of every main page for visual review: node tests/e2e/shots.mjs <outDir>
// Run under the emulators with the test server already listening (see `npm run shots`).
import { chromium, devices } from '@playwright/test';

const out = process.argv[2] || 'test-results/shots';
const base = 'http://127.0.0.1:4173/calendar-applet/';
const browser = await chromium.launch();
const failed = [];

async function context(options = {}) {
  const ctx = await browser.newContext({ locale: 'en-US', timezoneId: 'America/New_York', viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, ...options });
  ctx.on('page', (page) => {
    page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
    page.on('console', (m) => { if (m.type() === 'error') failed.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => failed.push(`pageerror: ${e}`));
  });
  return ctx;
}
const shot = (page, name, fullPage = true) => page.screenshot({ path: `${out}/${name}.png`, fullPage });

const desk = await context();
const page = await desk.newPage();
await page.goto(base);
await page.waitForSelector('.hero');
await shot(page, '01-home');

await page.goto(`${base}#/sign-up`);
await page.getByLabel('Your name').fill('Olga');
await page.getByLabel('Email').fill(`shots-${Date.now()}@example.com`);
await page.getByLabel('Password', { exact: true }).fill('correct horse battery');
await shot(page, '02-sign-up');
await page.getByRole('button', { name: 'Create account' }).click();
await page.getByRole('heading', { name: 'Your events' }).waitFor();
await shot(page, '03-events-empty');

await page.goto(`${base}#/new`);
await page.getByLabel('Event name').fill('Board game weekend');
await page.getByLabel('Note for invitees').fill('Bring snacks. We will pick whichever slot most people can make.');
await page.getByRole('button', { name: 'Next month' }).click();
const cells = page.locator('.cal-day:not([aria-disabled])');
for (const n of [9, 10, 11]) await cells.nth(n).click();
await shot(page, '04-new-event');
await page.getByRole('button', { name: 'Create event' }).click();
await page.getByLabel('Invite link').waitFor();
const link = await page.getByLabel('Invite link').inputValue();
await shot(page, '05-results-empty');

const people = {
  Ana: [[0, 0, 0, 5], [1, 1, 2, 6], [2, 2, 8, 12]],
  Ben: [[0, 0, 2, 9], [1, 1, 4, 10]],
  Chi: [[0, 1, 4, 7], [2, 2, 6, 13]],
  Dev: [[0, 2, 3, 6], [1, 1, 10, 15]],
  'Eli-Rose Montgomery': [[1, 2, 4, 9]],
};
let n = 0;
for (const [name, blocks] of Object.entries(people)) {
  const phone = n === 0;
  const ctx = await context(phone ? { ...devices['iPhone 14'], locale: 'en-US', timezoneId: 'America/New_York' } : {});
  const p = await ctx.newPage();
  await p.goto(link);
  await p.getByLabel('Your name').fill(name);
  for (const [d0, d1, k0, k1] of blocks) {
    if (phone) {
      for (let d = d0; d <= d1; d++) for (let k = k0; k <= k1; k++) await p.locator(`.tt-cell[data-i="${d * 16 + k}"]`).tap();
    } else {
      const a = await p.locator(`.tt-cell[data-i="${d0 * 16 + k0}"]`).boundingBox();
      const b = await p.locator(`.tt-cell[data-i="${d1 * 16 + k1}"]`).boundingBox();
      await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await p.mouse.down();
      await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
      await p.mouse.up();
    }
  }
  if (n === 0) await shot(p, '06-respond-phone');
  if (n === 1) await shot(p, '07-respond-desktop');
  await p.getByRole('button', { name: 'Save my times' }).click();
  await p.getByRole('status').filter({ hasText: 'Saved' }).waitFor();
  if (n === 1) await shot(p, '08-respond-saved');
  await ctx.close();
  n += 1;
}

await page.getByRole('button', { name: 'Refresh' }).click();
await page.getByText('5 answers').waitFor();
await page.locator('.tt-heat .tt-cell[data-i="20"]').click();
await page.mouse.move(5, 5);
await shot(page, '09-results');
await page.getByRole('button', { name: 'Show as a table' }).click();
await shot(page, '10-results-table');
await page.goto(`${base}#/events`);
await page.locator('.event-list').waitFor();
await shot(page, '11-events');
await page.goto(`${base}#/account`);
await shot(page, '12-account');

// The same results on a phone and in dark mode share the organizer's sign-in.
const state = await desk.storageState({ indexedDB: true });
const dark = await context({ colorScheme: 'dark', storageState: state });
const dp = await dark.newPage();
await dp.goto(`${link}/results`);
await dp.getByText('5 answers').waitFor();
await shot(dp, '13-results-dark');
await dp.goto(base);
await dp.waitForSelector('.hero');
await shot(dp, '14-home-dark');
const mob = await context({ ...devices['iPhone 14'], locale: 'en-US', timezoneId: 'America/New_York', storageState: state });
const mp = await mob.newPage();
await mp.goto(`${link}/results`);
await mp.getByText('5 answers').waitFor();
await shot(mp, '15-results-phone');
await mp.goto(base);
await mp.waitForSelector('.hero');
await shot(mp, '16-home-phone');

const unset = await context();
await unset.addCookies([{ name: 'unconfigured', value: '1', url: 'http://127.0.0.1:4173/' }]);
const up = await unset.newPage();
await up.goto(base);
await up.getByRole('heading', { name: 'Finish setting up' }).waitFor();
await shot(up, '17-setup');

await browser.close();
console.log('PROBLEMS', JSON.stringify([...new Set(failed)], null, 1));
