// The organizer's list of events.

import { h, replace } from '../ui/dom.js';
import { listMyEvents, getAccount } from '../backend.js';
import { verifyPanel } from './verify.js';
import { daysSummary, hoursRange } from '../ui/format.js';

export function eventsView({ navigate }) {
  const account = getAccount();
  if (!account.verified) {
    const panel = verifyPanel(account, () => navigate('/events'));
    return {
      title: 'Your events',
      dispose: panel.dispose,
      el: h('div', { class: 'stack' }, h('div', { class: 'page-head' }, h('h1', null, 'Your events')), panel.el),
    };
  }
  const list = h('div', null, h('p', { class: 'loading', role: 'status' }, 'Loading your events…'));

  listMyEvents().then((events) => {
    if (events.length === 0) {
      replace(list, h('p', { class: 'muted' }, 'No events yet.'));
      return;
    }
    replace(list, h('ul', { class: 'event-list' }, events.map((event) => h('li', null,
      h('a', { href: `#/e/${event.id}/results` },
        h('span', { class: 'name' }, event.title),
        h('span', { class: 'when' }, `${daysSummary(event.dates)}, ${hoursRange(event.startMinute, event.endMinute)}`),
        h('span', { class: 'state' }, event.open ? null : h('span', { class: 'muted small' }, 'Closed')))))));
  }).catch((error) => {
    replace(list, h('p', { class: 'banner banner-danger', role: 'alert' }, error.message));
  });

  return {
    title: 'Your events',
    el: h('div', { class: 'stack' },
      h('div', { class: 'page-head' },
        h('h1', null, 'Your events'),
        h('a', { class: 'btn', href: '#/new' }, 'New event')),
      list),
  };
}
