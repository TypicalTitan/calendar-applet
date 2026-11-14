// The site is meant to stay small: each page has one job, and nothing on it that the job does
// not need. These tests hold that line.
import { test, expect } from '@playwright/test';
import { signUp, createEvent, answerAsGuest } from './helpers.js';

test('the home page says what the site is, shows the example, and has one button', async ({ page }) => {
  await page.goto('#/');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1 })).toHaveText('Schedule things with your friends.');
  await expect(main.getByRole('link', { name: 'Create an event' })).toHaveCount(1);
  await expect(main.getByRole('link', { name: 'Sign in' })).toHaveCount(0);
  await expect(main.getByText('You need an account. Your friends don’t.')).toBeVisible();
  await expect(main.getByText('How it works')).toHaveCount(0);
  await expect(main.getByRole('grid')).toHaveCount(2);
});

test('someone opening an invite link is not offered an account, or told things they don’t need', async ({ page, browser }) => {
  await signUp(page);
  const { link } = await createEvent(page);
  const context = await browser.newContext({ locale: 'en-US', timezoneId: 'America/New_York' });
  const guest = await context.newPage();
  await guest.goto(link);
  await expect(guest.getByLabel('Your name')).toBeVisible();
  await expect(guest.getByRole('link', { name: 'Sign in' })).toHaveCount(0);
  await expect(guest.getByRole('link', { name: 'Create account' })).toHaveCount(0);
  // Their clock shows the same times as the event's, so there is nothing to say about time zones.
  await expect(guest.locator('.zone-line')).toHaveCount(0);
  await expect(guest.getByText('Click or drag over the times you’re free. Do it again to clear.')).toBeVisible();
  // The name box is no wider than the timetable under it.
  const nameWidth = (await guest.getByLabel('Your name').boundingBox()).width;
  const gridWidth = (await guest.getByRole('grid').boundingBox()).width;
  expect(nameWidth).toBeLessThan(gridWidth + 60);
  // The way home is still there.
  await guest.getByRole('link', { name: 'Overlap' }).click();
  await expect(guest.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await context.close();
});

test('a new event’s page is the link and an empty timetable until someone answers', async ({ page, browser }) => {
  await signUp(page);
  const { days, link } = await createEvent(page);
  await expect(page.getByText('No answers yet')).toBeVisible();
  await expect(page.getByText('Send the link. Names show up here as people answer.')).toBeVisible();
  await expect(page.getByText('Anyone with this link can add their times. No account needed.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Best times' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Download by time (.csv)' })).toBeHidden();

  const guest = await answerAsGuest(browser, link, 'Ana', [`${days[0].cell}, 9:00 AM`]);
  await guest.context.close();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByText('1 answer', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Best times' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download by time (.csv)' })).toBeVisible();
});

test('a closed event’s page stops saying that anyone can add their times', async ({ page }) => {
  await signUp(page);
  await createEvent(page);
  await page.getByRole('button', { name: 'Close event' }).click();
  await expect(page.getByText('Closed to new answers. The link still opens, but nobody can add or change times.')).toBeVisible();
  await expect(page.getByText('Anyone with this link can add their times', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reopen event' }).click();
  await expect(page.getByText('Anyone with this link can add their times. No account needed.')).toBeVisible();
});

test('the new-event form talks about clicking on a computer with a mouse', async ({ page }) => {
  await signUp(page);
  await page.goto('#/new');
  await expect(page.getByText('Click the days you want. Drag to add several.')).toBeVisible();
  await expect(page.getByText('No days picked yet.')).toBeVisible();
});

const height = async (locator) => (await locator.boundingBox())?.height ?? 0;

test('the keyboard keys are shown when a grid is used from the keyboard, and not before', async ({ page, browser }) => {
  await signUp(page);
  await page.goto('#/new');
  const dayKeys = page.getByText('Keyboard: arrows move, Space picks a day', { exact: false });
  expect(await height(dayKeys)).toBeLessThan(3);
  await expect(page.getByRole('grid', { name: 'Days' })).toHaveAttribute('aria-describedby', await dayKeys.getAttribute('id'));
  await page.getByRole('button', { name: 'Next month' }).focus();
  await page.keyboard.press('Tab');
  expect(await height(dayKeys)).toBeGreaterThan(10);

  const { link } = await createEvent(page);
  const context = await browser.newContext({ locale: 'en-US', timezoneId: 'America/New_York' });
  const guest = await context.newPage();
  await guest.goto(link);
  const keys = guest.getByText('Keyboard: arrows move, Space marks or clears', { exact: false });
  await expect(guest.getByLabel('Your name')).toBeVisible();
  expect(await height(keys)).toBeLessThan(3);
  await guest.getByLabel('Your name').focus();
  await guest.keyboard.press('Tab');
  await expect(guest.locator('.tt-cell').first()).toBeFocused();
  expect(await height(keys)).toBeGreaterThan(10);
  await context.close();
});

test('where clocks run to 24 the hours are written out in full', async ({ page, browser }) => {
  await signUp(page);
  const { link } = await createEvent(page);
  const context = await browser.newContext({ locale: 'en-GB', timezoneId: 'America/New_York' });
  const guest = await context.newPage();
  await guest.goto(link);
  await expect(guest.getByText(/0?9:00 to 17:00/)).toBeVisible(); // not a bare "09 to 17"
  await context.close();
  await expect(page.getByText('9 AM to 5 PM', { exact: false })).toBeVisible();
});

test('signing out on the home page puts the signed-out page back', async ({ page }) => {
  await signUp(page);
  await page.goto('#/');
  const main = page.getByRole('main');
  await expect(main.getByRole('link', { name: 'Your events' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(main.getByRole('link', { name: 'Create an event' })).toBeVisible();
  await expect(main.getByText('You need an account. Your friends don’t.')).toBeVisible();
  await expect(main.getByRole('link', { name: 'Your events' })).toHaveCount(0);
});

test('an empty timetable does not pretend a time can be picked', async ({ page }) => {
  await signUp(page);
  const { days } = await createEvent(page);
  const cell = page.getByRole('gridcell', { name: `${days[0].cell}, 9:00 AM, no answers yet` });
  await cell.click();
  await expect(cell).toHaveAttribute('aria-selected', 'false');
  await cell.focus();
  await page.keyboard.press('Space');
  await expect(cell).toHaveAttribute('aria-selected', 'false');
});

test('the table view and one person’s times do not get tangled', async ({ page, browser }) => {
  await signUp(page);
  const { days, link } = await createEvent(page);
  await (await answerAsGuest(browser, link, 'Ana', [`${days[0].cell}, 9:00 AM`])).context.close();
  await (await answerAsGuest(browser, link, 'Ben', [`${days[0].cell}, 10:00 AM`])).context.close();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByText('Pick a time on the grid to see who’s free then.')).toBeVisible();

  // Showing the table moves the keyboard to it, because it appears above the button.
  await page.getByRole('button', { name: 'Show as a table' }).focus();
  await page.keyboard.press('Enter');
  const table = page.getByRole('region', { name: 'Answers as a table' });
  await expect(table).toBeFocused();
  await expect(page.getByText('Pick a time on the grid', { exact: false })).toHaveCount(0);

  // Choosing one person goes back to the grid, where that choice shows.
  await page.getByRole('region', { name: '2 answers' }).getByRole('button', { name: /^Ana/ }).click();
  await expect(page.getByText('Showing only Ana’s free times.')).toBeVisible();
  await expect(table).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show as a table' })).toBeVisible();

  // And showing the table again shows everyone.
  await page.getByRole('button', { name: 'Show as a table' }).click();
  await expect(table).toBeVisible();
  await expect(page.getByRole('region', { name: '2 answers' }).getByRole('button', { name: /^Ana/ })).toHaveAttribute('aria-pressed', 'false');
});

test('the table keeps the keyboard when new answers arrive by themselves', async ({ page, browser }) => {
  await signUp(page);
  const { days, link } = await createEvent(page);
  await (await answerAsGuest(browser, link, 'Ana', [`${days[0].cell}, 9:00 AM`])).context.close();
  await page.clock.install();
  await page.reload();
  await expect(page.getByText('1 answer', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show as a table' }).click();
  const table = page.getByRole('region', { name: 'Answers as a table' });
  await table.focus();
  await (await answerAsGuest(browser, link, 'Ben', [`${days[0].cell}, 10:00 AM`])).context.close();
  await page.clock.fastForward(61_000);
  await expect(page.getByText('2 answers')).toBeVisible();
  await expect(table).toBeFocused();
});

test('a closed event does not invite its owner to add times, or keep showing a removed answer', async ({ page, browser }) => {
  await signUp(page);
  const { days, link } = await createEvent(page);
  const { context, page: guest } = await answerAsGuest(browser, link, 'Ana', [`${days[0].cell}, 9:00 AM`]);
  await page.getByRole('button', { name: 'Close event' }).click();
  await expect(page.getByText('Closed to new answers', { exact: false })).toBeVisible();

  await page.getByRole('link', { name: 'Add my own times' }).click();
  await expect(page.getByText('You made this event. This is what your friends see.')).toBeVisible();
  await expect(page.getByText('You can add your own times here too', { exact: false })).toHaveCount(0);

  await guest.reload();
  await expect(guest.getByText('Here’s what you saved', { exact: false })).toBeVisible();
  await guest.getByRole('button', { name: 'Remove my answer' }).click();
  await guest.getByRole('dialog').getByRole('button', { name: 'Remove my answer' }).click();
  const done = guest.getByRole('status').filter({ hasText: 'Answer removed.' });
  await expect(done).toBeVisible({ timeout: 15_000 });
  await expect(done).toBeFocused();
  await expect(guest.getByText('This event is closed. No more answers.')).toBeVisible();
  await expect(guest.getByText('Here’s what you saved', { exact: false })).toHaveCount(0);
  await expect(guest.getByRole('grid')).toHaveCount(0);
  await context.close();
});

test('the line about whose answer this is follows a change of name', async ({ page, browser }) => {
  await signUp(page);
  const { days, link } = await createEvent(page);
  const { context, page: guest } = await answerAsGuest(browser, link, 'Ana', [`${days[0].cell}, 9:00 AM`]);
  await guest.reload();
  await expect(guest.getByText('Saved from this browser as Ana.')).toBeVisible();
  await guest.getByLabel('Your name').fill('Anastasia');
  await guest.getByRole('button', { name: 'Save my times' }).click();
  await expect(guest.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible({ timeout: 15_000 });
  await expect(guest.getByText('Saved from this browser as Anastasia.')).toBeVisible();
  await context.close();
});

test('the new-event form says out loud when a day runs past midnight, and its errors all look like errors', async ({ page }) => {
  await signUp(page);
  await page.goto('#/new');
  await page.getByLabel('From').selectOption({ label: '8:00 PM' });
  await page.getByLabel('To', { exact: true }).selectOption({ label: '2:00 AM' });
  await expect(page.getByRole('status').filter({ hasText: 'runs past midnight' })).toBeVisible();
  await page.getByLabel('To', { exact: true }).selectOption({ label: '11:00 PM' });
  await expect(page.getByText('runs past midnight', { exact: false })).toHaveCount(0);

  await page.getByRole('button', { name: 'Create event' }).click();
  const colour = (text) => page.getByText(text).evaluate((el) => getComputedStyle(el).color);
  expect(await colour('Pick at least one day.')).toBe(await colour('Give the event a name.'));
});

test('a button that is busy keeps the keyboard', async ({ page, browser }) => {
  const account = await signUp(page);
  // Month arrows: at the first month "Previous month" is off but still there.
  await page.goto('#/new');
  const previous = page.getByRole('button', { name: 'Previous month' });
  await expect(previous).toHaveAttribute('aria-disabled', 'true');
  await page.getByRole('button', { name: 'Next month' }).click();
  await previous.focus();
  await page.keyboard.press('Enter');
  await expect(previous).toHaveAttribute('aria-disabled', 'true');
  await expect(previous).toBeFocused();

  // Saving a name on the account page.
  await page.goto('#/account');
  const saveName = page.getByRole('button', { name: 'Save name' });
  await saveName.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Name saved')).toBeVisible();
  await expect(saveName).toBeFocused();

  // Saving times on the invite page.
  const { days, link } = await createEvent(page);
  const context = await browser.newContext({ locale: 'en-US', timezoneId: 'America/New_York' });
  const guest = await context.newPage();
  await guest.goto(link);
  await guest.getByLabel('Your name').fill('Ana');
  await guest.getByRole('gridcell', { name: `${days[0].cell}, 9:00 AM`, exact: true }).click();
  const save = guest.getByRole('button', { name: 'Save my times' });
  await save.focus();
  await guest.keyboard.press('Enter');
  await expect(guest.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await expect(save).toBeFocused();

  // A wrong password on the sign-in form.
  await guest.goto('#/sign-in');
  await guest.getByLabel('Email').fill(account.email);
  await guest.getByLabel('Password', { exact: true }).fill('not the password at all');
  const signIn = guest.getByRole('button', { name: 'Sign in' });
  await signIn.focus();
  await guest.keyboard.press('Enter');
  await expect(guest.getByRole('alert')).toContainText('don’t match an account');
  await expect(signIn).toBeFocused();
  await context.close();
});

test('a shaded cell still shows where the keyboard is', async ({ page, browser }) => {
  await signUp(page);
  const { days, link } = await createEvent(page);
  await (await answerAsGuest(browser, link, 'Ana', [`${days[0].cell}, 9:00 AM`])).context.close();
  await page.getByRole('button', { name: 'Refresh' }).click();
  const cell = page.getByRole('gridcell', { name: `${days[0].cell}, 9:00 AM, 1 of 1 free` });
  const rings = () => cell.evaluate((el) => (getComputedStyle(el).boxShadow.match(/inset/g) || []).length);
  await cell.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await expect(cell).toBeFocused();
  expect(await rings()).toBe(2); // a paper band, then the focus colour
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  expect(await rings()).toBe(1); // picked, not focused: the paper band alone, five pixels wide
  expect(await cell.evaluate((el) => getComputedStyle(el).boxShadow)).toContain('5px');
});
