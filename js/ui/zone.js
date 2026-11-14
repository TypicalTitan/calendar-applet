// Choosing which time zone a grid is shown in.

import { h } from './dom.js';
import { zoneName } from './format.js';
import { localTimeZone } from '../core/tz.js';
import { sameClock } from '../core/slots.js';

/**
 * Which zone a grid's times are in. When the reader's own clock shows the same times as the
 * event's there is nothing to say (the page heading already names the zone), so `el` is null.
 * When it shows different times, `el` is a choice between the two, starting on the reader's own.
 * Returns { el, zone } and calls onChange(zone) when the choice changes.
 */
export function zoneChooser({ event, slots, onChange }) {
  const local = localTimeZone();
  const at = slots.utc[0] ?? Date.now();
  if (event.zoneKnown === false) {
    // The event's zone is newer than this browser's list. Its stored instants still convert.
    return {
      zone: local,
      el: h('p', { class: 'zone-line' }, `Times are shown in your time zone, ${zoneName(local, at)}.`),
    };
  }
  if (sameClock(slots, local, event.timezone)) {
    return { zone: event.timezone, el: null };
  }
  const select = h('select', { class: 'select', 'aria-label': 'Time zone to show times in' },
    h('option', { value: local }, `Your time zone: ${zoneName(local, at)}`),
    h('option', { value: event.timezone }, `The event’s time zone: ${zoneName(event.timezone, at)}`));
  select.addEventListener('change', () => onChange(select.value));
  return {
    zone: local,
    el: h('p', { class: 'zone-line' }, h('span', null, 'Times shown in'), select),
  };
}
