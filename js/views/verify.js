// Shown to an organizer whose email address is not confirmed yet. The database refuses to let an
// unconfirmed account create events, so this is where a new organizer waits for the email.

import { h, toast } from '../ui/dom.js';
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
        note.textContent = 'Not confirmed yet. Open the link in the email first, then try again.';
      }
    } catch (error) {
      if (askedByPerson) note.textContent = error.message;
    }
  }

  check.addEventListener('click', () => look(true));
  resend.addEventListener('click', async () => {
    resend.disabled = true;
    try {
      await resendVerification();
      note.textContent = 'Sent. It can take a few minutes to arrive.';
    } catch (error) {
      note.textContent = error.message;
    }
    setTimeout(() => { resend.disabled = false; }, RESEND_WAIT_MS);
  });

  // Most people open the link in another tab and come back: notice that without being asked.
  const onReturn = () => { if (document.visibilityState === 'visible') look(false); };
  window.addEventListener('focus', onReturn);
  document.addEventListener('visibilitychange', onReturn);

  return {
    el: h('section', { class: 'sheet stack', 'aria-labelledby': 'verify-title' },
      h('h2', { id: 'verify-title' }, 'Confirm your email'),
      h('p', null, 'We sent a link to ', h('b', null, account.email), '. Open it to show the address is yours, then come back here. You can create events as soon as that’s done.'),
      h('p', { class: 'muted' }, 'The email can take a few minutes and sometimes lands in spam. Typed the wrong address? Delete this account on the ', h('a', { href: '#/account' }, 'Account page'), ' and sign up again.'),
      h('div', { class: 'row' }, check, resend),
      note),
    dispose() {
      finished = true;
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    },
  };
}
