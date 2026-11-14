// Touch behaviour, run in the "phone" project (a Pixel 7 profile with a touch screen).
import { test, expect } from '@playwright/test';
import { signUp, createEvent } from './helpers.js';

async function centre(locator) {
  const box = await locator.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Sends raw touch events, so the timing of a press-and-hold is under the test's control. */
async function touch(page) {
  const client = await page.context().newCDPSession(page);
  const send = (type, point) => client.send('Input.dispatchTouchEvent', {
    type, touchPoints: point ? [{ x: Math.round(point.x), y: Math.round(point.y) }] : [],
  });
  return { start: (p) => send('touchStart', p), move: (p) => send('touchMove', p), end: () => send('touchEnd') };
}

test.beforeEach(async ({ page }) => {
  await signUp(page);
});

test('a tap marks one time and a second tap clears it', async ({ page }) => {
  const { days, link } = await createEvent(page);
  await page.goto(link);
  const cell = page.getByRole('gridcell', { name: `${days[0].cell}, 10:00 AM`, exact: true });
  await cell.tap();
  await expect(cell).toHaveAttribute('aria-selected', 'true');
  await cell.tap();
  await expect(cell).toHaveAttribute('aria-selected', 'false');
});

test('press and hold, then drag, marks a block of times', async ({ page }) => {
  const { days, link } = await createEvent(page);
  await page.goto(link);
  const from = page.getByRole('gridcell', { name: `${days[0].cell}, 10:00 AM`, exact: true });
  const to = page.getByRole('gridcell', { name: `${days[1].cell}, 12:00 PM`, exact: true });
  await page.getByRole('gridcell', { name: `${days[0].cell}, 2:00 PM`, exact: true }).scrollIntoViewIfNeeded();
  await from.scrollIntoViewIfNeeded();
  const a = await centre(from);
  const b = await centre(to);
  const finger = await touch(page);
  await finger.start(a);
  await page.waitForTimeout(450);
  await finger.move({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  await finger.move(b);
  await finger.end();
  for (const day of [days[0], days[1]]) {
    for (const time of ['10:00 AM', '11:00 AM', '12:00 PM']) {
      await expect(page.getByRole('gridcell', { name: `${day.cell}, ${time}`, exact: true })).toHaveAttribute('aria-selected', 'true');
    }
  }
  await expect(page.getByText('6 hours marked')).toBeVisible();
});

test('a held drag that runs off the bottom of the screen keeps marking down to the last time in view', async ({ page }) => {
  const { days, link } = await createEvent(page, { from: '8:00 AM', to: '10:00 PM', slot: '30 minutes' });
  await page.goto(link);
  const from = page.getByRole('gridcell', { name: `${days[0].cell}, 8:00 AM`, exact: true });
  await from.scrollIntoViewIfNeeded();
  const a = await centre(from);
  const finger = await touch(page);
  await finger.start(a);
  await page.waitForTimeout(450);
  await finger.move({ x: a.x, y: a.y + 40 });
  await finger.move({ x: a.x, y: page.viewportSize().height + 300 });
  await finger.end();
  const marked = await page.locator('.tt-cell[aria-selected="true"]').count();
  expect(marked).toBeGreaterThan(3);
});

test('a quick swipe across the grid scrolls the page and marks nothing', async ({ page }) => {
  const { days, link } = await createEvent(page, { from: '8:00 AM', to: '10:00 PM', slot: '30 minutes' });
  await page.goto(link);
  const from = page.getByRole('gridcell', { name: `${days[0].cell}, 2:00 PM`, exact: true });
  await from.scrollIntoViewIfNeeded();
  const a = await centre(from);
  const finger = await touch(page);
  await finger.start(a);
  for (let step = 1; step <= 6; step++) await finger.move({ x: a.x, y: a.y - step * 25 });
  await finger.end();
  await expect(page.locator('.tt-cell[aria-selected="true"]')).toHaveCount(0);
  await expect(page.getByText('Nothing marked yet')).toBeVisible();
});

test('the invite page fits a phone screen without sideways scrolling', async ({ page }) => {
  const { link } = await createEvent(page);
  await page.goto(link);
  await expect(page.getByRole('button', { name: 'Save my times' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
