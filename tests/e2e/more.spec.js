import { test, expect } from '@playwright/test';
import { signUp, createEvent, answerAsGuest, nextMonthDays, freshEmail, openConfirmationLink } from './helpers.js';

const NY = { locale: 'en-US', timezoneId: 'America/New_York' };

test('the sign-up form explains what is wrong instead of creating a weak account', async ({ page }) => {
  await page.goto('#/sign-up');
  await page.getByLabel('Your name').fill('Olga');
  await page.getByLabel('Email').fill('not-an-email');
  await page.getByLabel('Password', { exact: true }).fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Enter an email address, like name@example.com.')).toBeVisible();
  await expect(page.getByText('Use at least 15 characters.', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible();
});

test('a new organizer must confirm their email before they can create an event', async ({ page }) => {
  const account = await signUp(page, { confirm: false });
  await expect(page.getByRole('heading', { name: 'Confirm your email' })).toBeVisible();
  await expect(page.getByText(account.email)).toBeVisible();
  await expect(page.getByRole('link', { name: 'New event' })).toHaveCount(0);

  // Going straight to the form does not get round it.
  await page.goto('#/new');
  await expect(page.getByRole('heading', { name: 'Confirm your email' })).toBeVisible();
  await expect(page.getByLabel('Event name')).toHaveCount(0);

  // Saying "I've confirmed" without having opened the link changes nothing.
  await page.getByRole('button', { name: 'I’ve confirmed' }).click();
  await expect(page.getByText('Not confirmed yet')).toBeVisible();

  await openConfirmationLink(account.email);
  await page.getByRole('button', { name: 'I’ve confirmed' }).click();
  await expect(page.getByLabel('Event name')).toBeVisible();
  await createEvent(page);
});

test('coming back to the tab after opening the confirmation link is enough', async ({ page }) => {
  const account = await signUp(page, { confirm: false });
  await openConfirmationLink(account.email);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('link', { name: 'New event' }).first()).toBeVisible();
});

test('signing up twice with one email does not create a second account', async ({ page, browser }) => {
  const first = await signUp(page);
  const other = await browser.newContext(NY);
  const otherPage = await other.newPage();
  await otherPage.goto('#/sign-up');
  await otherPage.getByLabel('Your name').fill('Impostor');
  await otherPage.getByLabel('Email').fill(first.email);
  await otherPage.getByLabel('Password', { exact: true }).fill('another long password');
  await otherPage.getByRole('button', { name: 'Create account' }).click();
  await expect(otherPage.getByRole('alert')).toContainText('can’t be used for a new account');
  await other.close();
});

test('asking for a password reset gives the same answer for any address', async ({ page }) => {
  await page.goto('#/reset');
  const address = freshEmail();
  await page.getByLabel('Email').fill(address);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('status').filter({ hasText: `If ${address} has an account` })).toBeVisible();
});

test('the event form refuses an event with no days and says why', async ({ page }) => {
  await signUp(page);
  await page.goto('#/new');
  await page.getByLabel('Event name').fill('No days yet');
  await page.getByRole('button', { name: 'Create event' }).click();
  await expect(page.getByText('Pick at least one day.')).toBeVisible();
  await page.getByLabel('Event name').fill('');
  await page.getByRole('button', { name: 'Create event' }).click();
  await expect(page.getByText('Give the event a name.')).toBeVisible();
});

test('days can be picked by dragging across the calendar, and past days cannot be picked', async ({ page }) => {
  await signUp(page);
  await page.goto('#/new');
  await expect(page.getByRole('button', { name: 'Previous month' })).toBeDisabled();
  await page.getByRole('button', { name: 'Next month' }).click();
  const days = nextMonthDays();
  await page.getByRole('gridcell', { name: days[2].picker }).scrollIntoViewIfNeeded();
  const from = await page.getByRole('gridcell', { name: days[0].picker }).boundingBox();
  const to = await page.getByRole('gridcell', { name: days[2].picker }).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 6 });
  await page.mouse.up();
  for (const day of days) await expect(page.getByRole('gridcell', { name: day.picker })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('3 days:', { exact: false })).toBeVisible();
});

test('an event can run past midnight, and the grid says which rows are the next day', async ({ page }) => {
  await signUp(page);
  const { days } = await createEvent(page, { title: 'Late game night', from: '8:00 PM', to: '2:00 AM', slot: '1 hour' });
  await page.getByRole('link', { name: 'Add my own times' }).click();
  await expect(page.getByRole('heading', { name: 'Late game night' })).toBeVisible();
  await expect(page.getByText('next day').first()).toBeVisible();
  // 1:00 AM in the first column belongs to the day after the first day.
  await expect(page.getByRole('gridcell', { name: `${days[1].cell}, 1:00 AM`, exact: true }).first()).toBeVisible();
  await expect(page.getByRole('gridcell', { name: `${days[0].cell}, 8:00 PM`, exact: true })).toBeVisible();
  await expect(page.locator('.tt-cell')).toHaveCount(18);
});

test('an invitee in another time zone sees the times in their own zone and can switch', async ({ page, browser }) => {
  await signUp(page);
  const { days, link } = await createEvent(page);
  const tokyo = await browser.newContext({ locale: 'en-US', timezoneId: 'Asia/Tokyo' });
  const guest = await tokyo.newPage();
  await guest.goto(link);
  const zone = guest.getByLabel('Time zone to show times in');
  await expect(zone).toBeVisible();
  // 9:00 AM in New York (UTC-5 in December) is 11:00 PM the same day in Tokyo.
  await expect(guest.getByRole('gridcell', { name: `${days[0].cell}, 11:00 PM`, exact: true })).toBeVisible();
  await guest.getByRole('gridcell', { name: `${days[0].cell}, 11:00 PM`, exact: true }).click();
  await zone.selectOption({ index: 1 });
  const nine = guest.getByRole('gridcell', { name: `${days[0].cell}, 9:00 AM`, exact: true });
  await expect(nine).toHaveAttribute('aria-selected', 'true');
  await guest.getByLabel('Your name').fill('Yuki');
  await guest.getByRole('button', { name: 'Save my times' }).click();
  await expect(guest.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await tokyo.close();

  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('gridcell', { name: `${days[0].cell}, 9:00 AM, 1 of 1 free` })).toBeVisible();
});

test('the answers can be read as a table, and one person can be shown alone', async ({ page, browser }) => {
  await signUp(page);
  const { days, link } = await createEvent(page);
  await (await answerAsGuest(browser, link, 'Ana', [`${days[0].cell}, 9:00 AM`])).context.close();
  await (await answerAsGuest(browser, link, 'Ben', [`${days[0].cell}, 10:00 AM`])).context.close();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByText('2 answers')).toBeVisible();

  await page.getByRole('region', { name: '2 answers' }).getByRole('button', { name: /^Ana/ }).click();
  await expect(page.getByText('Showing only Ana’s free times.')).toBeVisible();
  await expect(page.getByRole('gridcell', { name: `${days[0].cell}, 9:00 AM, free`, exact: true })).toBeVisible();
  await expect(page.getByRole('gridcell', { name: `${days[0].cell}, 10:00 AM, not free`, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show everyone' }).click();

  await page.getByRole('button', { name: 'Show as a table' }).click();
  const table = page.getByRole('region', { name: 'Answers as a table' });
  await expect(table.getByRole('columnheader', { name: 'Ana' })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: 'Ben' })).toBeVisible();
  await expect(table.getByRole('row').nth(1)).toContainText('1 of 2');
});

test('the best times list ranks the stretch most people can make', async ({ page, browser }) => {
  await signUp(page);
  const { days, link } = await createEvent(page);
  const both = [`${days[1].cell}, 1:00 PM`, `${days[1].cell}, 2:00 PM`];
  await (await answerAsGuest(browser, link, 'Ana', [...both, `${days[0].cell}, 9:00 AM`])).context.close();
  await (await answerAsGuest(browser, link, 'Ben', both)).context.close();
  await page.getByRole('button', { name: 'Refresh' }).click();
  const best = page.getByRole('region', { name: 'Best times' });
  await expect(best.getByRole('listitem').first()).toContainText('1:00 PM–3:00 PM');
  await expect(best.getByRole('listitem').first()).toContainText('All 2 free');
  await best.getByLabel('For a meeting of').selectOption({ label: '2 hours' });
  await expect(best.getByRole('listitem')).toHaveCount(1);
  await best.getByLabel('For a meeting of').selectOption({ label: '3 hours' });
  await expect(best).toContainText('Nobody has marked a stretch that long');
});

test('a guest who answered and then creates an account keeps their answer and can organize at once', async ({ page, browser }) => {
  await signUp(page);
  const { days, link } = await createEvent(page);
  const { context, page: guest } = await answerAsGuest(browser, link, 'Gus', [`${days[0].cell}, 9:00 AM`]);
  await signUp(guest, { name: 'Gus' });
  await createEvent(guest, { title: 'Gus’s own event' });
  await guest.goto(link);
  await expect(guest.getByLabel('Your name')).toHaveValue('Gus');
  await expect(guest.getByRole('gridcell', { name: `${days[0].cell}, 9:00 AM`, exact: true })).toHaveAttribute('aria-selected', 'true');
  await context.close();
});

test('on a shared computer a second person can add a separate answer', async ({ page, browser }) => {
  await signUp(page);
  const { days, link } = await createEvent(page);
  const { context, page: shared } = await answerAsGuest(browser, link, 'Ana', [`${days[0].cell}, 9:00 AM`]);
  await shared.reload();
  await shared.getByRole('button', { name: 'Someone else? Add a separate answer' }).click();
  await expect(shared.getByLabel('Your name')).toHaveValue('');
  await shared.getByLabel('Your name').fill('Ben');
  await shared.getByRole('gridcell', { name: `${days[0].cell}, 10:00 AM`, exact: true }).click();
  await shared.getByRole('button', { name: 'Save my times' }).click();
  await expect(shared.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await context.close();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByText('2 answers')).toBeVisible();
});

test('a guest can remove their own answer', async ({ page, browser }) => {
  await signUp(page);
  const { days, link } = await createEvent(page);
  const { context, page: guest } = await answerAsGuest(browser, link, 'Ana', [`${days[0].cell}, 9:00 AM`]);
  await guest.getByRole('button', { name: 'Remove my answer' }).click();
  await guest.getByRole('dialog').getByRole('button', { name: 'Remove my answer' }).click();
  await expect(guest.getByText('Your answer has been removed.')).toBeVisible();
  await context.close();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByText('No answers yet')).toBeVisible();
});

test('an organizer can change their password and must use the new one afterwards', async ({ page }) => {
  const account = await signUp(page);
  await page.goto('#/account');
  await page.getByLabel('Current password').fill('wrong password here');
  await page.getByLabel('New password').fill('a brand new passphrase');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('The current password isn’t right.')).toBeVisible();
  await page.getByLabel('Current password').fill(account.password);
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Password changed')).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.goto('#/sign-in');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill('a brand new passphrase');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Your events' })).toBeVisible();
});

test('deleting an account removes its events, and their invite links stop working', async ({ page, browser }) => {
  const account = await signUp(page);
  const { days, link } = await createEvent(page);
  await (await answerAsGuest(browser, link, 'Ana', [`${days[0].cell}, 9:00 AM`])).context.close();
  await page.goto('#/account');
  await page.getByRole('button', { name: 'Delete my account' }).click();
  await page.getByRole('dialog').getByLabel('Your password').fill(account.password);
  await page.getByRole('dialog').getByRole('button', { name: 'Delete account' }).click();
  await expect(page.getByText('Account deleted')).toBeVisible();
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'We can’t find that event' })).toBeVisible();
});

test('the organizer can correct the name and note of an event, and invitees see the change', async ({ page, browser }) => {
  await signUp(page);
  const { link } = await createEvent(page, { title: 'Bored game weekend' });
  await page.getByRole('button', { name: 'Edit name and note' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Event name')).toHaveValue('Bored game weekend');
  await dialog.getByLabel('Event name').fill('   ');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog.getByText('Give the event a name.')).toBeVisible();
  await dialog.getByLabel('Event name').fill('Board game weekend');
  await dialog.getByLabel('Note for invitees').fill('Bring snacks.');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name: 'Board game weekend', level: 1 })).toBeVisible();
  await expect(page.getByText('Bring snacks.')).toBeVisible();

  const context = await browser.newContext(NY);
  const guest = await context.newPage();
  await guest.goto(link);
  await expect(guest.getByRole('heading', { name: 'Board game weekend', level: 1 })).toBeVisible();
  await expect(guest.getByText('Bring snacks.')).toBeVisible();
  await context.close();
});

test('deleting an event takes it off the list', async ({ page }) => {
  await signUp(page);
  await createEvent(page, { title: 'Short-lived' });
  await page.getByRole('button', { name: 'Delete event' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete event' }).click();
  await expect(page.getByRole('heading', { name: 'Your events' })).toBeVisible();
  await expect(page.getByText('No events yet')).toBeVisible();
});

test('names and titles that look like HTML are shown as plain text', async ({ page, browser }) => {
  await signUp(page);
  const title = '<img src=x onerror=alert(1)> party';
  const { days, link } = await createEvent(page, { title });
  let dialogs = 0;
  page.on('dialog', (d) => { dialogs += 1; d.dismiss(); });
  await (await answerAsGuest(browser, link, '<b>Mallory</b><script>alert(1)</script>', [`${days[0].cell}, 9:00 AM`])).context.close();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByText('<b>Mallory</b><script>alert(1)</script>')).toBeVisible();
  await expect(page.locator('main img')).toHaveCount(0);
  await expect(page.locator('main b', { hasText: 'Mallory' })).toHaveCount(0);
  expect(dialogs).toBe(0);
});
