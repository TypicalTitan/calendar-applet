// Automated accessibility checks (axe-core, WCAG 2.1 A and AA) on every main page, in the light
// and the dark colour scheme. These catch contrast, labelling and structure mistakes; they do
// not replace trying the site with a keyboard and a screen reader.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signUp, createEvent, answerAsGuest } from './helpers.js';

async function check(page, label) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const summary = results.violations.map((v) => `${label}: ${v.id} (${v.nodes.length}) ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  expect(summary).toEqual([]);
}

for (const scheme of ['light', 'dark']) {
  test(`pages pass automated accessibility checks in the ${scheme} scheme`, async ({ page, browser }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('./');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await check(page, 'home');

    await page.goto('#/sign-in');
    await check(page, 'sign in');
    await page.goto('#/reset');
    await check(page, 'reset');
    await page.goto('#/sign-up');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Enter your name.')).toBeVisible();
    await check(page, 'sign up with errors');

    await signUp(page);
    await check(page, 'events (empty)');
    await page.goto('#/new');
    await page.getByRole('button', { name: 'Create event' }).click();
    await expect(page.getByText('Pick at least one day.')).toBeVisible();
    await check(page, 'new event with errors');

    const { days, link } = await createEvent(page);
    await check(page, 'results (empty)');
    const ana = await answerAsGuest(browser, link, 'Ana', [`${days[0].cell}, 9:00 AM`, `${days[0].cell}, 10:00 AM`]);
    await ana.page.emulateMedia({ colorScheme: scheme });
    await check(ana.page, 'invite page (saved)');
    await ana.context.close();
    await (await answerAsGuest(browser, link, 'Ben', [`${days[0].cell}, 10:00 AM`, `${days[1].cell}, 1:00 PM`])).context.close();
    await (await answerAsGuest(browser, link, 'Chi', [`${days[0].cell}, 10:00 AM`])).context.close();

    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect(page.getByText('3 answers')).toBeVisible();
    await page.getByRole('gridcell', { name: `${days[0].cell}, 10:00 AM, 3 of 3 free` }).click();
    await check(page, 'results');
    await page.getByRole('button', { name: 'Show as a table' }).click();
    await check(page, 'results as a table');
    await page.getByRole('button', { name: 'Delete event' }).click();
    await check(page, 'confirm dialog');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

    await page.goto('#/events');
    await expect(page.getByRole('link', { name: /Board game weekend/ })).toBeVisible();
    await check(page, 'events');
    await page.goto('#/account');
    await check(page, 'account');
  });
}

test('the setup page passes automated accessibility checks', async ({ browser, baseURL }) => {
  const context = await browser.newContext();
  await context.addCookies([{ name: 'unconfigured', value: '1', url: new URL('/', baseURL).href }]);
  const page = await context.newPage();
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Finish setting up' })).toBeVisible();
  await check(page, 'setup');
  await context.close();
});

test('the timetable’s lines can be seen against the paper in both colour schemes', async ({ page }) => {
  await signUp(page);
  const { link } = await createEvent(page, { slot: '30 minutes' });
  await page.goto(link);
  await expect(page.getByRole('button', { name: 'Save my times' })).toBeVisible();
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    const ratios = await page.evaluate(() => {
      // A canvas turns whatever form the browser reports a colour in into plain red, green, blue.
      const rgb = (colour) => {
        const canvas = document.createElement('canvas');
        canvas.width = 1; canvas.height = 1;
        const ink = canvas.getContext('2d', { willReadFrequently: true });
        ink.fillStyle = colour;
        ink.fillRect(0, 0, 1, 1);
        return [...ink.getImageData(0, 0, 1, 1).data].slice(0, 3);
      };
      const light = (colour) => {
        const [r, g, b] = rgb(colour).map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const contrast = (a, b) => {
        const [hi, lo] = [light(a), light(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };
      const rows = [...document.querySelectorAll('.tt-row')];
      const cell = rows.find((row, n) => n > 0 && !row.classList.contains('is-hour')).querySelector('.tt-cell');
      const style = getComputedStyle(cell);
      return { blocks: contrast(style.borderTopColor, style.backgroundColor), days: contrast(style.borderLeftColor, style.backgroundColor) };
    });
    expect(ratios.blocks, `${scheme}: the line between two blocks`).toBeGreaterThanOrEqual(3);
    expect(ratios.days, `${scheme}: the line between two days`).toBeGreaterThanOrEqual(3);
  }
});

test('in forced colours, both lines of a pressed name can be read', async ({ page, browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'forced colours can only be emulated in Chromium');
  await signUp(page);
  const { days, link } = await createEvent(page);
  await (await answerAsGuest(browser, link, 'Ana', [`${days[0].cell}, 9:00 AM`])).context.close();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await page.emulateMedia({ forcedColors: 'active' });
  const ana = page.getByRole('region', { name: '1 answer' }).getByRole('button', { name: /^Ana/ });
  await ana.click();
  await expect(ana).toHaveAttribute('aria-pressed', 'true');
  const [name, detail] = await ana.evaluate((el) => [getComputedStyle(el.querySelector('.n')).color, getComputedStyle(el.querySelector('.m')).color]);
  expect(detail).toBe(name);
});
