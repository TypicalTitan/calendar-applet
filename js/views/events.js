// The organizer's list of events.

import { h, replace, icon, toast } from '../ui/dom.js';
import { listMyEvents, getAccount, resendVerification, recheckVerification } from '../backend.js';
import { daysSummary, timeRange } from '../ui/format.js';

function verifyBanner(account) {
  const banner = h('div', { class: 'banner', role: 'region', 'aria-label': 'Confirm your email' });
  const resend = h('button', { type: 'button', class: 'btn btn-quiet btn-small' }, 'Send it again');
  const check = h('button', { type: 'button', class: 'btn btn-quiet btn-small' }, 'I’ve confirmed');
  resend.addEventListener('click', async () => {
    resend.disabled = true;
    try { await resendVerification(); toast('Confirmation email sent'); } catch (error) { toast(error.message); }
    setTimeout(() => { resend.disabled = false; }, 30_000);
  });
  check.addEventListener('click', async () => {
    try {
      if (await recheckVerification()) { banner.remove(); toast('Email confirmed'); } else toast('Not confirmed yet. Open the link in the email first.');
    } catch (error) { toast(error.message); }
  });
  replace(banner,
    h('p', null, `Confirm your email: we sent a link to ${account.email}. It proves the address is yours, so you can reset your password if you ever need to.`),
    resend, check);
  return banner;
}

export function eventsView() {
  const account = getAccount();
  const list = h('div', null, h('p', { class: 'loading', role: 'status' }, 'Loading your events…'));

  listMyEvents().then((events) => {
    if (events.length === 0) {
      replace(list, h('div', { class: 'sheet empty' },
        h('h2', null, 'No events yet'),
        h('p', null, 'Pick some days and a time window, then send the link to your friends. They mark when they’re free; you see where it overlaps.'),
        h('a', { class: 'btn', href: '#/new' }, icon('plus'), 'New event')));
      return;
    }
    replace(list, h('ul', { class: 'event-list' }, events.map((event) => h('li', null,
      h('a', { href: `#/e/${event.id}/results` },
        h('span', { class: 'name' }, event.title),
        h('span', { class: 'when' }, `${daysSummary(event.dates)}, ${timeRange(event.startMinute, event.endMinute)}`),
        h('span', { class: 'state' }, event.open ? null : h('span', { class: 'tag' }, icon('lock'), 'Closed')))))));
  }).catch((error) => {
    replace(list, h('p', { class: 'banner banner-danger', role: 'alert' }, error.message));
  });

  return {
    title: 'Your events',
    el: h('div', { class: 'stack' },
      h('div', { class: 'page-head' },
        h('h1', null, 'Your events'),
        h('a', { class: 'btn', href: '#/new' }, icon('plus'), 'New event')),
      account && !account.verified ? verifyBanner(account) : null,
      list),
  };
}
