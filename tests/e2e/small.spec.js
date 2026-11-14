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
  await expect(guest.getByText('Times are in', { exact: false })).toHaveCount(0);
  await expect(guest.getByText('Click or drag over the times you’re free.', { exact: false })).toBeVisible();
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
