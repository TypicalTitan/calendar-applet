// Account settings: name, email confirmation, password, and deleting the account.

import { h, field, toast, confirmDialog } from '../ui/dom.js';
import {
  getAccount, changeName, changePassword, deleteAccount, resendVerification, recheckVerification, passwordProblem, PASSWORD_MIN,
} from '../backend.js';
import { tidyLine } from '../core/text.js';

export function accountView({ navigate }) {
  const account = getAccount();

  // ---- name
  const name = field({ label: 'Your name', control: h('input', { class: 'input', type: 'text', autocomplete: 'name', maxlength: 60, value: account.name }) });
  const saveName = h('button', { type: 'submit', class: 'btn btn-quiet' }, 'Save name');
  const nameForm = h('form', { class: 'sheet stack', method: 'post', novalidate: true }, h('h2', null, 'Profile'), name.el, h('div', null, saveName));
  nameForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cleaned = tidyLine(name.input.value).slice(0, 60);
    name.setError(cleaned ? '' : 'Enter your name.');
    if (!cleaned) return;
    saveName.disabled = true;
    try { await changeName(cleaned); toast('Name saved'); } catch (error) { toast(error.message); }
    saveName.disabled = false;
  });

  // ---- email
  const verifyState = h('p', null);
  const verifyActions = h('div', { class: 'row' });
  function drawEmail(verified) {
    verifyState.textContent = verified
      ? `${account.email} is confirmed.`
      : `${account.email} is not confirmed yet. Open the link we emailed you; it proves the address is yours.`;
    verifyActions.hidden = verified;
  }
  const resend = h('button', { type: 'button', class: 'btn btn-quiet btn-small' }, 'Send the email again');
  resend.addEventListener('click', async () => {
    resend.disabled = true;
    try { await resendVerification(); toast('Confirmation email sent'); } catch (error) { toast(error.message); }
    setTimeout(() => { resend.disabled = false; }, 60_000);
  });
  const recheck = h('button', { type: 'button', class: 'btn btn-quiet btn-small' }, 'I’ve confirmed');
  recheck.addEventListener('click', async () => {
    try {
      const verified = await recheckVerification();
      drawEmail(verified);
      toast(verified ? 'Email confirmed' : 'Not confirmed yet. Open the link in the email first.');
    } catch (error) { toast(error.message); }
  });
  verifyActions.append(resend, recheck);
  drawEmail(account.verified);

  // ---- password
  const current = field({ label: 'Current password', control: h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true }) });
  const next = field({ label: 'New password', control: h('input', { class: 'input', type: 'password', autocomplete: 'new-password', required: true, minlength: PASSWORD_MIN, maxlength: 128 }), hint: `At least ${PASSWORD_MIN} characters.` });
  const passwordError = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const savePassword = h('button', { type: 'submit', class: 'btn btn-quiet' }, 'Change password');
  const passwordForm = h('form', { class: 'sheet stack', method: 'post', novalidate: true },
    h('h2', null, 'Password'),
    // A hidden user-name field lets password managers file the new password under the right account.
    h('input', { type: 'email', autocomplete: 'username', value: account.email, hidden: true, readonly: true, tabindex: '-1', 'aria-hidden': 'true' }),
    current.el, next.el, passwordError, h('div', null, savePassword));
  passwordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    passwordError.hidden = true;
    current.setError(current.input.value ? '' : 'Enter your current password.');
    next.setError(await passwordProblem(next.input.value));
    if (!current.input.value || next.input.getAttribute('aria-invalid') === 'true') return;
    savePassword.disabled = true;
    try {
      await changePassword({ current: current.input.value, next: next.input.value });
      passwordForm.reset();
      toast('Password changed');
    } catch (error) {
      passwordError.textContent = error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password'
        ? 'The current password isn’t right.' : error.message;
      passwordError.hidden = false;
    }
    savePassword.disabled = false;
  });

  // ---- delete
  const remove = h('button', { type: 'button', class: 'btn btn-danger' }, 'Delete my account');
  const removeError = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const removeStatus = h('p', { class: 'status-line', role: 'status' });
  remove.addEventListener('click', async () => {
    const confirmField = field({ label: 'Your password', control: h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true }) });
    const ok = await confirmDialog({
      title: 'Delete your account?',
      body: h('div', { class: 'stack' },
        h('p', { class: 'muted' }, 'This deletes your account, every event you created, and all the answers to them, for good. Invite links you have sent stop working.'),
        confirmField.el),
      confirmLabel: 'Delete account',
      danger: true,
    });
    if (!ok) return;
    remove.disabled = true;
    removeError.hidden = true;
    removeStatus.textContent = 'Deleting your events and account…';
    try {
      await deleteAccount(confirmField.input.value);
      toast('Account deleted');
      navigate('/');
    } catch (error) {
      // Stays on the page until the next attempt: with many events this can take a while, and
      // the person must not miss that it stopped.
      removeError.textContent = error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password' || error.code === 'auth/missing-password'
        ? 'That password isn’t right. Nothing was deleted.'
        : `Your account was not deleted. ${error.message} Events already removed stay removed; try again to finish.`;
      removeError.hidden = false;
      removeStatus.textContent = '';
      remove.disabled = false;
    }
  });

  return {
    title: 'Account',
    narrow: true,
    el: h('div', { class: 'stack' },
      h('div', { class: 'page-head' }, h('h1', null, 'Account')),
      nameForm,
      h('section', { class: 'sheet stack' }, h('h2', null, 'Email'), verifyState, verifyActions),
      passwordForm,
      h('section', { class: 'sheet stack' },
        h('h2', null, 'Delete account'),
        h('p', { class: 'muted' }, 'Removes your account and everything you created with it. This can’t be undone.'),
        h('div', null, remove),
        removeError, removeStatus)),
  };
}
