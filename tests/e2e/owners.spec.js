import { test, expect } from '@playwright/test';
import { signUp, createEvent, answerAsGuest } from './helpers.js';

const NY = { locale: 'en-US', timezoneId: 'America/New_York' };

async function newPerson(browser, name) {
  const context = await browser.newContext(NY);
  const page = await context.newPage();
  await signUp(page, { name });
  return { context, page };
}

async function makeRunLink(page) {
  await page.getByRole('button', { name: 'Add someone to run it' }).click();
  const link = await page.getByLabel('Link to run this event').inputValue();
  await page.getByRole('button', { name: 'Close' }).click();
  return link;
}

test('a friend sent a one-time link runs the event too, until they are taken off', async ({ page, browser }) => {
  await signUp(page);
  const { title, days, link } = await createEvent(page);
  const ana = await answerAsGuest(browser, link, 'Ana', [`${days[0].cell}, 9:00 AM`]);
  const runLink = await makeRunLink(page);
  expect(runLink).toMatch(/#\/e\/[A-Za-z0-9]{20}\/join\/[A-Za-z0-9]{20}$/);

  // Henry opens it, says yes, and lands on the answers.
  const henry = await newPerson(browser, 'Henry');
  await henry.page.goto(runLink);
  await expect(henry.page.getByRole('heading', { name: title })).toBeVisible();
  await henry.page.getByRole('button', { name: 'Run it with them' }).click();
  await expect(henry.page.getByLabel('Invite link')).toHaveValue(link);
  await expect(henry.page.getByRole('heading', { name: '1 answer' })).toBeVisible();
  await expect(henry.page.getByText('You run this with whoever made it.')).toBeVisible();

  // It is on his list of events, and the maker sees him.
  await henry.page.goto('#/events');
  await expect(henry.page.getByRole('link', { name: new RegExp(title) })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Also run by')).toContainText('Henry');

  // He can close it, like the maker.
  await henry.page.goto(`${link}/results`);
  await henry.page.getByRole('button', { name: 'Close event' }).click();
  await expect(henry.page.getByRole('button', { name: 'Reopen event' })).toBeVisible();
  await henry.page.getByRole('button', { name: 'Reopen event' }).click();
  await expect(henry.page.getByRole('button', { name: 'Close event' })).toBeVisible();

  // The link worked once.
  const pete = await newPerson(browser, 'Pete');
  await pete.page.goto(runLink);
  await pete.page.getByRole('button', { name: 'Run it with them' }).click();
  await expect(pete.page.getByText('This link has been used, or is more than a week old.')).toBeVisible();
  await pete.page.goto(`${link}/results`);
  await expect(pete.page.getByText('Only whoever runs this event can see the answers')).toBeVisible();

  // The maker takes him off; the answers are closed to him again.
  await page.getByRole('button', { name: 'Take off Henry' }).click();
  await page.getByRole('button', { name: 'Take them off' }).click();
  await expect(page.getByText('Also run by')).toHaveCount(0);
  await henry.page.reload();
  await expect(henry.page.getByText('Only whoever runs this event can see the answers')).toBeVisible();

  await Promise.all([ana.context.close(), henry.context.close(), pete.context.close()]);
});

test('a friend who runs an event can delete it, and its links stop working', async ({ page, browser }) => {
  await signUp(page);
  const { title, link } = await createEvent(page);
  const runLink = await makeRunLink(page);
  const spare = await makeRunLink(page);
  const henry = await newPerson(browser, 'Henry');
  await henry.page.goto(runLink);
  await henry.page.getByRole('button', { name: 'Run it with them' }).click();
  await henry.page.getByRole('button', { name: 'Delete event' }).click();
  await henry.page.getByRole('dialog').getByRole('button', { name: 'Delete event' }).click();
  await expect(henry.page.getByRole('heading', { name: 'Your events' })).toBeVisible();
  await expect(henry.page.getByRole('link', { name: new RegExp(title) })).toHaveCount(0);
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Can’t find that event' })).toBeVisible();
  await page.goto(spare);
  await expect(page.getByRole('heading', { name: 'Can’t find that event' })).toBeVisible();
  await henry.context.close();
});

test('a signed-out visitor with a link to run an event is asked to sign in, then brought back', async ({ page, browser }) => {
  await signUp(page);
  const { title } = await createEvent(page);
  const runLink = await makeRunLink(page);
  const context = await browser.newContext(NY);
  const visitor = await context.newPage();
  await visitor.goto(runLink);
  await expect(visitor.getByRole('heading', { name: 'Run an event with a friend' })).toBeVisible();
  await visitor.getByRole('button', { name: 'Create account' }).click();
  await visitor.getByLabel('Your name').fill('Henry');
  await visitor.getByLabel('Email').fill(`henry-${Date.now()}@example.com`);
  await visitor.getByLabel('Password', { exact: true }).fill('correct horse battery');
  await visitor.getByRole('button', { name: 'Create account' }).click();
  // Back on the link, which asks them to confirm their email before they can say yes.
  await expect(visitor.getByRole('heading', { name: 'Confirm your email first' })).toBeVisible();
  await context.close();
  expect(title).toBeTruthy();
});
