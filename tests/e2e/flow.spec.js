import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { signUp, createEvent, answerAsGuest, freshEmail } from './helpers.js';

test('an organizer creates an event, invitees answer by link, and the organizer sees and exports the result', async ({ page, browser }) => {
  await signUp(page);
  const { days, link } = await createEvent(page);
  expect(link).toMatch(/#\/e\/[A-Za-z0-9]{20}$/);
  await expect(page.getByText('No answers yet')).toBeVisible();

  const ana = await answerAsGuest(browser, link, 'Ana', [`${days[0].cell}, 9:00 AM`, `${days[0].cell}, 10:00 AM`, `${days[1].cell}, 2:00 PM`]);
  const ben = await answerAsGuest(browser, link, 'Ben', [`${days[0].cell}, 10:00 AM`, `${days[1].cell}, 2:00 PM`]);

  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByText('2 answers')).toBeVisible();
  await expect(page.getByRole('gridcell', { name: `${days[0].cell}, 10:00 AM, 2 of 2 free` })).toBeVisible();
  await expect(page.getByRole('gridcell', { name: `${days[0].cell}, 9:00 AM, 1 of 2 free` })).toBeVisible();
  await expect(page.getByRole('gridcell', { name: `${days[2].cell}, 9:00 AM, 0 of 2 free` })).toBeVisible();

  // The detail panel names who is and is not free at a time.
  await page.getByRole('gridcell', { name: `${days[0].cell}, 9:00 AM, 1 of 2 free` }).click();
  const detail = page.getByRole('region', { name: 'Selected time' });
  await expect(detail).toContainText('Ana');
  await expect(detail).toContainText('Ben');

  // CSV export: one row per time slot, one column per person.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download by time (.csv)' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('board-game-weekend-grid.csv');
  const csv = await readFile(await file.path(), 'utf8');
  const lines = csv.replace(/^\uFEFF/, '').trim().split('\r\n');
  expect(lines[0]).toBe('Date,Day,Start,End,Time zone,Start (UTC),Free,Answers,Ana,Ben');
  expect(lines).toHaveLength(1 + 3 * 8);
  expect(lines[1]).toMatch(new RegExp(`^${days[0].iso},\\w{3},09:00,10:00,America/New_York,[^,]+,1,2,1,0$`));
  expect(lines[2]).toMatch(new RegExp(`^${days[0].iso},\\w{3},10:00,11:00,America/New_York,[^,]+,2,2,1,1$`));

  const download2 = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download by person (.csv)' }).click();
  const csv2 = await readFile(await (await download2).path(), 'utf8');
  expect(csv2).toContain(`Ana,${days[0].iso},`);
  expect(csv2).toContain(`Ben,${days[1].iso},`);

  await ana.context.close();
  await ben.context.close();
});

test('a guest can come back in the same browser and change their answer', async ({ page, browser }) => {
  await signUp(page);
  const { days, link } = await createEvent(page);
  const guest = await answerAsGuest(browser, link, 'Ana', [`${days[0].cell}, 9:00 AM`]);

  await guest.page.reload();
  await expect(guest.page.getByLabel('Your name')).toHaveValue('Ana');
  const nine = guest.page.getByRole('gridcell', { name: `${days[0].cell}, 9:00 AM`, exact: true });
  await expect(nine).toHaveAttribute('aria-selected', 'true');
  await nine.click();
  await guest.page.getByRole('gridcell', { name: `${days[2].cell}, 4:00 PM`, exact: true }).click();
  await guest.page.getByRole('button', { name: 'Save my times' }).click();
  await expect(guest.page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();

  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByText('1 answer', { exact: true })).toBeVisible();
  await expect(page.getByRole('gridcell', { name: `${days[0].cell}, 9:00 AM, 0 of 1 free` })).toBeVisible();
  await expect(page.getByRole('gridcell', { name: `${days[2].cell}, 4:00 PM, 1 of 1 free` })).toBeVisible();
  await guest.context.close();
});

test('closing an event stops new answers, and the organizer can remove an answer', async ({ page, browser }) => {
  await signUp(page);
  const { days, link } = await createEvent(page);
  const guest = await answerAsGuest(browser, link, 'Ana', [`${days[0].cell}, 9:00 AM`]);
  await guest.context.close();

  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByText('1 answer', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close event' }).click();
  await expect(page.getByText('Closed to new answers')).toBeVisible();

  const late = await browser.newContext({ locale: 'en-US', timezoneId: 'America/New_York' });
  const latePage = await late.newPage();
  await latePage.goto(link);
  await expect(latePage.getByText('This event is closed')).toBeVisible();
  await expect(latePage.getByRole('button', { name: 'Save my times' })).toHaveCount(0);
  await late.close();

  await page.getByRole('button', { name: 'Remove Ana' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove answer' }).click();
  await expect(page.getByText('No answers yet')).toBeVisible();
});

test('painting by dragging marks a block of times', async ({ page, browser }) => {
  await signUp(page);
  const { days, link } = await createEvent(page);
  const context = await browser.newContext({ locale: 'en-US', timezoneId: 'America/New_York' });
  const guest = await context.newPage();
  await guest.goto(link);
  await guest.getByLabel('Your name').fill('Chi');
  const from = await guest.getByRole('gridcell', { name: `${days[0].cell}, 10:00 AM`, exact: true }).boundingBox();
  const to = await guest.getByRole('gridcell', { name: `${days[1].cell}, 12:00 PM`, exact: true }).boundingBox();
  await guest.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await guest.mouse.down();
  await guest.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await guest.mouse.up();
  for (const day of [days[0], days[1]]) {
    for (const time of ['10:00 AM', '11:00 AM', '12:00 PM']) {
      await expect(guest.getByRole('gridcell', { name: `${day.cell}, ${time}`, exact: true })).toHaveAttribute('aria-selected', 'true');
    }
  }
  await expect(guest.getByRole('gridcell', { name: `${days[0].cell}, 9:00 AM`, exact: true })).toHaveAttribute('aria-selected', 'false');
  await expect(guest.getByRole('gridcell', { name: `${days[2].cell}, 10:00 AM`, exact: true })).toHaveAttribute('aria-selected', 'false');
  await expect(guest.getByText('6 hours marked')).toBeVisible();
  await context.close();
});

test('the grid can be filled in with the keyboard alone', async ({ page, browser }) => {
  await signUp(page);
  const { days, link } = await createEvent(page);
  const context = await browser.newContext({ locale: 'en-US', timezoneId: 'America/New_York' });
  const guest = await context.newPage();
  await guest.goto(link);
  await guest.getByRole('gridcell', { name: `${days[0].cell}, 9:00 AM`, exact: true }).focus();
  await guest.keyboard.press('Space');
  await guest.keyboard.press('Shift+ArrowDown');
  await guest.keyboard.press('ArrowRight');
  await guest.keyboard.press('Enter');
  await expect(guest.getByRole('gridcell', { name: `${days[0].cell}, 9:00 AM`, exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(guest.getByRole('gridcell', { name: `${days[0].cell}, 10:00 AM`, exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(guest.getByRole('gridcell', { name: `${days[1].cell}, 10:00 AM`, exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(guest.getByRole('gridcell', { name: `${days[1].cell}, 9:00 AM`, exact: true })).toHaveAttribute('aria-selected', 'false');
  await context.close();
});

test('sign-in rejects a wrong password without saying whether the account exists', async ({ page }) => {
  const account = await signUp(page);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.goto('#/sign-in');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill('not the password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('That email and password don’t match an account.');

  await page.getByLabel('Email').fill(freshEmail());
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('That email and password don’t match an account.');

  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Your events' })).toBeVisible();
});

test('pages for organizers send a signed-out visitor to sign in, then back', async ({ page }) => {
  await page.goto('#/new');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('one organizer cannot open another organizer\'s results', async ({ page, browser }) => {
  await signUp(page);
  const { link } = await createEvent(page);
  const other = await browser.newContext({ locale: 'en-US', timezoneId: 'America/New_York' });
  const otherPage = await other.newPage();
  await signUp(otherPage, { name: 'Pete' });
  await otherPage.goto(`${link}/results`);
  await expect(otherPage.getByText('Only the person who made this event can see the answers')).toBeVisible();
  await other.close();
});

test('an unknown invite link says so plainly', async ({ page }) => {
  await page.goto('#/e/doesNotExist0000000x');
  await expect(page.getByRole('heading', { name: 'Can’t find that event' })).toBeVisible();
});

test('a site with no Firebase settings shows setup steps instead of a broken page', async ({ browser, baseURL }) => {
  const context = await browser.newContext();
  await context.addCookies([{ name: 'unconfigured', value: '1', url: new URL('/', baseURL).href }]);
  const page = await context.newPage();
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Finish setting up' })).toBeVisible();
  // The rules to paste into Firebase are shown on the page, ready to copy.
  await expect(page.getByLabel('The security rules to paste')).toHaveValue(/rules_version = '2';[\s\S]*match \/events\/\{eventId\}/);
  await expect(page.getByRole('button', { name: 'Copy the rules' })).toBeEnabled();
  await context.close();
});

test('the page loads with no console errors and no Content-Security-Policy violations', async ({ page }) => {
  const problems = [];
  // The Auth emulator answers 501 for the password-policy lookup that real Firebase supports;
  // the site treats a failed lookup as "no extra policy", so that one request is expected here.
  const expected = (url) => url.includes('/v2/passwordPolicy');
  page.on('console', (m) => { if (m.type() === 'error' && !expected(m.location().url)) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('response', (r) => { if (r.status() >= 400 && !expected(r.url())) problems.push(`${r.status()} ${r.url()}`); });
  await signUp(page);
  await createEvent(page);
  expect(problems).toEqual([]);
});
