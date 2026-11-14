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
