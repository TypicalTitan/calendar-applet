import { expect } from '@playwright/test';

const longDate = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const cellDate = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });

/** Three consecutive days in the middle of next month, so they are always in the future. */
export function nextMonthDays() {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 10));
  return [0, 1, 2].map((n) => {
    const d = new Date(first.getTime() + n * 86400000);
    return { iso: d.toISOString().slice(0, 10), picker: longDate.format(d), cell: cellDate.format(d) };
  });
}

let counter = 0;
export function freshEmail() {
  counter += 1;
  return `organizer-${Date.now()}-${counter}@example.com`;
}

/**
 * Does what clicking the link in the confirmation email does. The Auth emulator does not send
 * mail; it keeps the links and hands them out on request.
 */
export async function openConfirmationLink(email) {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
  const listed = await (await fetch(`http://${host}/emulator/v1/projects/demo-calendar-applet/oobCodes`)).json();
  const mail = listed.oobCodes.filter((code) => code.email === email && code.requestType === 'VERIFY_EMAIL').pop();
  if (!mail) throw new Error(`No confirmation email was sent to ${email}`);
  // The emulator confirms the address and then redirects to the site; the redirect is not followed.
  const opened = await fetch(mail.oobLink, { redirect: 'manual' });
  if (opened.status >= 400) throw new Error(`The confirmation link failed: ${opened.status}`);
}

/** Creates an account and, unless told otherwise, confirms its email as the person would. */
export async function signUp(page, { name = 'Olga', email = freshEmail(), password = 'correct horse battery', confirm = true } = {}) {
  await page.goto('#/sign-up');
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your events' })).toBeVisible();
  if (confirm) {
    await expect(page.getByRole('heading', { name: 'Confirm your email' })).toBeVisible();
    await openConfirmationLink(email);
    await page.getByRole('button', { name: 'I’ve confirmed' }).click();
    await expect(page.getByRole('link', { name: 'New event' }).first()).toBeVisible();
  }
  return { name, email, password };
}

export async function createEvent(page, { title = 'Board game weekend', from = '9:00 AM', to = '5:00 PM', slot = '1 hour' } = {}) {
  const days = nextMonthDays();
  await page.goto('#/new');
  await page.getByLabel('Event name').fill(title);
  await page.getByRole('button', { name: 'Next month' }).click();
  for (const day of days) await page.getByRole('gridcell', { name: day.picker }).click();
  await page.getByLabel('From').selectOption({ label: from });
  await page.getByLabel('To', { exact: true }).selectOption({ label: to });
  await page.getByRole('radio', { name: slot }).check();
  await page.getByRole('button', { name: 'Create event' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  const link = await page.getByLabel('Invite link').inputValue();
  return { title, days, link };
}

/** Opens the invite link as a brand-new visitor and saves an answer. `times` are cell labels. */
export async function answerAsGuest(browser, link, name, times) {
  const context = await browser.newContext({ locale: 'en-US', timezoneId: 'America/New_York' });
  const page = await context.newPage();
  await page.goto(link);
  await page.getByLabel('Your name').fill(name);
  for (const time of times) await page.getByRole('gridcell', { name: time, exact: true }).click();
  await page.getByRole('button', { name: 'Save my times' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  return { context, page };
}
