// Sign in, create an account, and ask for a password reset.

import { h, field, setBusy, isBusy } from '../ui/dom.js';
import { signIn, signUp, requestPasswordReset, passwordProblem, PASSWORD_MIN } from '../backend.js';
import { tidyLine } from '../core/text.js';

const input = (props) => h('input', { class: 'input', ...props });

/** Runs an async submit handler with the button marked busy, showing any error in `errorEl`. */
function submitter(form, button, errorEl, work) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isBusy(button)) return;
    errorEl.hidden = true;
    setBusy(button, true);
    try {
      await work();
    } catch (error) {
      errorEl.textContent = error.message || 'Something went wrong. Try again.';
      errorEl.hidden = false;
    } finally {
      setBusy(button, false);
    }
  });
}

export function signInView() {
  const email = field({ label: 'Email', control: input({ type: 'email', name: 'email', autocomplete: 'username', required: true, inputMode: 'email', autocapitalize: 'none' }) });
  const password = field({ label: 'Password', control: input({ type: 'password', name: 'password', autocomplete: 'current-password', required: true }) });
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const button = h('button', { type: 'submit', class: 'btn btn-block' }, 'Sign in');
  const form = h('form', { class: 'stack', method: 'post', novalidate: true }, email.el, password.el, error, button);

  submitter(form, button, error, async () => {
    await signIn({ email: email.input.value.trim(), password: password.input.value });
  });

  return {
    title: 'Sign in',
    narrow: true,
    el: h('div', { class: 'stack' },
      h('h1', null, 'Sign in'),
      h('p', { class: 'muted' }, 'Only for making events. Got an invite link? Just open it.'),
      form,
      h('p', null, h('a', { href: '#/reset' }, 'Forgot your password?')),
      h('p', null, 'New here? ', h('a', { href: '#/sign-up' }, 'Create an account'))),
  };
}

export function signUpView() {
  const name = field({ label: 'Your name', control: input({ type: 'text', name: 'name', autocomplete: 'name', maxlength: 60, required: true }), hint: 'Fills in your name when you add your own times.' });
  const email = field({ label: 'Email', control: input({ type: 'email', name: 'email', autocomplete: 'username', required: true, inputMode: 'email', autocapitalize: 'none' }), hint: 'Only used to confirm it’s you and to reset your password.' });
  const password = field({ label: 'Password', control: input({ type: 'password', name: 'new-password', autocomplete: 'new-password', required: true, minlength: PASSWORD_MIN, maxlength: 128 }), hint: `At least ${PASSWORD_MIN} characters. A few random words will do.` });
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const button = h('button', { type: 'submit', class: 'btn btn-block' }, 'Create account');
  const form = h('form', { class: 'stack', method: 'post', novalidate: true }, name.el, email.el, password.el, error, button);

  submitter(form, button, error, async () => {
    const cleanName = tidyLine(name.input.value).slice(0, 60);
    const address = email.input.value.trim();
    name.setError(cleanName ? '' : 'Enter your name.');
    email.setError(/^\S+@\S+\.\S+$/.test(address) ? '' : 'Enter an email address, like name@example.com.');
    const problem = await passwordProblem(password.input.value);
    password.setError(problem);
    const firstBad = [name, email, password].find((f) => f.input.getAttribute('aria-invalid') === 'true');
    if (firstBad) { firstBad.input.focus(); return; }
    await signUp({ name: cleanName, email: address, password: password.input.value });
  });

  return {
    title: 'Create an account',
    narrow: true,
    el: h('div', { class: 'stack' },
      h('h1', null, 'Create an account'),
      h('p', { class: 'muted' }, 'You need one to make events. Your friends don’t.'),
      form,
      h('p', null, 'Already have an account? ', h('a', { href: '#/sign-in' }, 'Sign in'))),
  };
}

export function resetView() {
  const email = field({ label: 'Email', control: input({ type: 'email', name: 'email', autocomplete: 'username', required: true, inputMode: 'email', autocapitalize: 'none' }) });
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const done = h('p', { class: 'banner banner-plain', role: 'status', hidden: true });
  const button = h('button', { type: 'submit', class: 'btn btn-block' }, 'Send reset link');
  const form = h('form', { class: 'stack', method: 'post', novalidate: true }, email.el, error, button);

  submitter(form, button, error, async () => {
    const address = email.input.value.trim();
    email.setError(/^\S+@\S+\.\S+$/.test(address) ? '' : 'Enter an email address, like name@example.com.');
    if (email.input.getAttribute('aria-invalid') === 'true') { email.input.focus(); return; }
    await requestPasswordReset(address);
    // The same message whether or not the address has an account.
    done.textContent = `If ${address} has an account, a reset link is on its way. Check spam if it doesn’t show up.`;
    done.hidden = false;
    form.hidden = true;
  });

  return {
    title: 'Reset your password',
    narrow: true,
    el: h('div', { class: 'stack' },
      h('h1', null, 'Reset your password'),
      h('p', { class: 'muted' }, 'Put in your email to get a reset link.'),
      form, done,
      h('p', null, h('a', { href: '#/sign-in' }, 'Back to sign in'))),
  };
}
