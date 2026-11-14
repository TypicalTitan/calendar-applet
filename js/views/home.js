// The home page: one line saying what the site is, and a working example to try.

import { h, replace } from '../ui/dom.js';
import { createPaintGrid, createHeatGrid, heatLegend } from '../ui/grid.js';
import { getAccount } from '../backend.js';
import { buildSlots, slotWall } from '../core/slots.js';
import { countAvailable, toAnswer, bestWindows } from '../core/availability.js';
import { localTimeZone } from '../core/tz.js';
import { todayIn, addDays, weekdayOf } from '../core/dates.js';
import { longDate, timeRange, listNames } from '../ui/format.js';

// Three friends who have already answered the demo event (Friday to Sunday evening, hourly).
const FRIENDS = [
  { name: 'Ana', slots: '011100111100110' },
  { name: 'Ben', slots: '001110011110000' },
  { name: 'Chi', slots: '111000011100111' },
];

function demo() {
  const zone = localTimeZone();
  const today = todayIn(zone);
  const friday = addDays(today, ((5 - weekdayOf(today) + 7) % 7) || 7);
  const event = {
    timezone: zone,
    dates: [friday, addDays(friday, 1), addDays(friday, 2)],
    startMinute: 17 * 60,
    endMinute: 22 * 60,
    slotMinutes: 60,
  };
  const slots = buildSlots(event);
  let mine = Uint8Array.from('000000011000000', Number);

  const readout = h('div', { class: 'readout', 'aria-live': 'polite' });
  const legend = h('div');
  const heat = createHeatGrid({ event, slots, zone, label: 'Everyone’s free times in the example' });

  function update() {
    const everyone = [...FRIENDS, { name: 'You', slots: toAnswer(mine) }];
    const answers = everyone.map((p) => p.slots);
    const counts = countAvailable(answers, slots.count);
    heat.setData({ counts, total: everyone.length });
    replace(legend, heatLegend(counts, everyone.length));
    const [best] = bestWindows(slots, answers, 2, 1);
    if (!best) { replace(readout, h('p', { class: 'muted' }, 'Mark a couple of evenings to see where everyone overlaps.')); return; }
    const first = slotWall(event, slots, best.day * slots.perDay + best.startK, zone);
    const last = slotWall(event, slots, best.day * slots.perDay + best.lastStartK + best.length - 1, zone);
    const cells = [];
    for (let k = best.startK; k < best.lastStartK + best.length; k++) cells.push(best.day * slots.perDay + k);
    heat.setHighlight(cells);
    const names = best.who.map((p) => everyone[p].name);
    replace(readout,
      h('p', null, h('b', null, `${longDate(first.date)}, ${timeRange(first.startMinute, last.endMinute)}`)),
      h('p', { class: 'friends' }, best.count === everyone.length ? 'All four of you are free.' : `${best.count} of ${everyone.length} free: ${listNames(names)}.`));
  }

  const paint = createPaintGrid({
    event, slots, zone, value: mine,
    label: 'Your free times in the example. Mark the evenings you could make.',
    onChange: (next) => { mine = next; update(); },
  });
  update();

  return {
    el: h('div', { class: 'sheet demo' },
      h('div', { class: 'pairgrid' },
        h('div', null,
          h('h2', null, 'You: mark when you’re free'),
          paint.el),
        h('div', null,
          h('h2', null, 'Everyone: stronger shading, more people'),
          heat.el)),
      legend,
      readout),
    dispose: () => paint.destroy(),
  };
}

export function homeView() {
  const account = getAccount();
  const example = demo();
  return {
    title: '',
    dispose: example.dispose,
    el: h('section', { class: 'hero' },
      h('div', null,
        h('h1', null, 'Schedule things with your friends.'),
        h('p', { class: 'lede' }, 'Pick some days and hours, like November 21st to 23rd, 9am to 5pm. Send the link. Your friends put in a name and mark when they’re free. You see where it overlaps.'),
        h('p', { class: 'cta' }, account
          ? h('a', { class: 'btn', href: '#/events' }, 'Your events')
          : h('a', { class: 'btn', href: '#/sign-up' }, 'Create an event')),
        account ? null : h('p', { class: 'muted small aside' }, 'You need an account. Your friends don’t.')),
      h('div', null,
        example.el,
        h('p', { class: 'muted small aside' }, 'Try it. The three friends are made up and nothing is saved.'))),
  };
}
