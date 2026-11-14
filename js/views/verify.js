// Shown to an organizer whose email address is not confirmed yet. The database refuses to let an
// unconfirmed account create events, so this is where a new organizer waits for the email.

import { h, toast, setBusy, isBusy } from '../ui/dom.js';
import { resendVerification, recheckVerification } from '../backend.js';

const RESEND_WAIT_MS = 60_000;

/** Returns { el, dispose }. Calls onConfirmed() once the address is confirmed. */
export function verifyPanel(account, onConfirmed) {
  let finished = false;
  const note = h('p', { class: 'status-line', role: 'status' });
  const check = h('button', { type: 'button', class: 'btn' }, 'I’ve confirmed');
  const resend = h('button', { type: 'button', class: 'btn btn-quiet' }, 'Send it again');

  async function look(askedByPerson) {
    if (finished) return;
    try {
      if (await recheckVerification()) {
        finished = true;
        toast('Email confirmed');
        onConfirmed();
      } else if (askedByPerson) {
        note.textContent = 'Not confirmed yet. Open the link in the email first.';
      }
    } catch (error) {
      if (askedByPerson) note.textContent = error.message;
    }
  }

  check.addEventListener('click', () => look(true));
  resend.addEventListener('click', async () => {
    if (isBusy(resend)) return;
    setBusy(resend, true);
    try {
      await resendVerification();
      note.textContent = 'Sent. Can take a few minutes.';
    } catch (error) {
      note.textContent = error.message;
    }
    setTimeout(() => setBusy(resend, false), RESEND_WAIT_MS);
  });

  // Most people open the link in another tab and come back: notice that without being asked.
  const onReturn = () => { if (document.visibilityState === 'visible') look(false); };
  window.addEventListener('focus', onReturn);
  document.addEventListener('visibilitychange', onReturn);

  return {
    el: h('section', { class: 'stack', 'aria-labelledby': 'verify-title' },
      h('h2', { id: 'verify-title' }, 'Confirm your email'),
      h('p', null, 'Open the link sent to ', h('b', null, account.email), ', then come back here. You can make events after that.'),
      h('p', { class: 'muted' }, 'Not there? Give it a few minutes and check spam. Wrong address? Delete this account on the ', h('a', { href: '#/account' }, 'Account page'), ' and sign up again.'),
      h('div', { class: 'row' }, check, resend),
      note),
    dispose() {
      finished = true;
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    },
  };
}
