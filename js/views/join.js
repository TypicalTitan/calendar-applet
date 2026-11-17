// Where a link to run an event with someone lands. Opening it while signed in, and pressing the
// one button, adds you to the people who run the event; the link then stops working.

import { h, replace, setBusy, isBusy } from '../ui/dom.js';
import { getEvent, getAccount, runsEvent, joinEvent } from '../backend.js';
import { verifyPanel } from './verify.js';
import { messageView } from './misc.js';
import { buildSlots } from '../core/slots.js';
import { eventSummary } from '../ui/format.js';

export function joinView({ params, navigate, signInThenReturn, signUpThenReturn }) {
  const [eventId, inviteId] = params;
  const here = `/e/${eventId}/join/${inviteId}`;
  const account = getAccount();

  if (!account) {
    return messageView({
      title: 'Run an event with a friend',
      body: 'Someone wants you to run their event with them. Sign in to say yes. New here? Make an account first.',
      action: { onclick: signInThenReturn, label: 'Sign in' },
      secondary: { onclick: signUpThenReturn, label: 'Create account' },
    });
  }
  if (!account.verified) {
    const panel = verifyPanel(account, () => navigate(here));
    return {
      title: 'Confirm your email',
      narrow: true,
      dispose: panel.dispose,
      el: h('div', { class: 'stack' }, h('h1', null, 'Confirm your email first'), panel.el),
    };
  }

  const holder = h('div', null, h('p', { class: 'loading', role: 'status' }, 'Loading the event…'));
  let disposed = false;

  getEvent(eventId).then(async (event) => {
    if (disposed) return;
    if (!event || event === 'damaged') {
      replace(holder, messageView({
        title: 'Can’t find that event',
        body: 'It may have been deleted, or the link may be cut short.',
        action: { href: '#/events', label: 'Your events' },
      }).el);
      return;
    }
    if (await runsEvent(event)) {
      if (!disposed) navigate(`/e/${event.id}/results`, { replaceEntry: true });
      return;
    }
    if (disposed) return;
    const failure = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const yes = h('button', { type: 'button', class: 'btn' }, 'Run it with them');
    yes.addEventListener('click', async () => {
      if (isBusy(yes)) return;
      setBusy(yes, true);
      failure.hidden = true;
      try {
        await joinEvent(event.id, inviteId);
        navigate(`/e/${event.id}/results`, { replaceEntry: true });
      } catch (error) {
        failure.textContent = error.message;
        failure.hidden = false;
        setBusy(yes, false);
        yes.hidden = true; // it would only fail the same way again
      }
    });
    replace(holder, h('div', { class: 'stack' },
      h('h1', null, event.title),
      h('p', { class: 'muted' }, eventSummary(event, buildSlots(event).utc[0])),
      h('p', null, 'Someone asked you to run this with them. You’ll see every answer and can close or delete it.'),
      h('p', { class: 'row' }, yes, h('a', { class: 'btn btn-quiet', href: `#/e/${event.id}` }, 'Just add my times')),
      failure));
  }).catch((error) => {
    if (!disposed) replace(holder, h('p', { class: 'banner banner-danger', role: 'alert' }, error.message));
  });

  return {
    title: 'Run an event',
    narrow: true,
    el: holder,
    dispose: () => { disposed = true; },
  };
}
