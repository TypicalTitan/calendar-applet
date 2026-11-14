import { h, icon, toast, copyText } from '../ui/dom.js';

/**
 * A plain page with a heading, a sentence or two, and optionally a way forward. `action` is the
 * main one; `secondary` is a quieter alternative. Each is { href, label } or { onclick, label }.
 */
export function messageView({ title, body, action, secondary }) {
  const control = (item, quiet) => (item.href
    ? h('a', { class: quiet ? 'btn btn-quiet' : 'btn', href: item.href }, item.label)
    : h('button', { type: 'button', class: quiet ? 'btn btn-quiet' : 'btn', onclick: item.onclick }, item.label));
  return {
    title,
    narrow: true,
    el: h('div', { class: 'stack' },
      h('h1', null, title),
      typeof body === 'string' ? h('p', { class: 'muted' }, body) : body,
      action || secondary ? h('p', { class: 'row' }, action ? control(action, false) : null, secondary ? control(secondary, true) : null) : null),
  };
}

export function notFoundView() {
  return messageView({
    title: 'There’s nothing at this address',
    body: 'The link may be mistyped or cut short. If someone sent it to you, ask them to send it again.',
    action: { href: '#/', label: 'Go to the home page' },
  });
}

/**
 * The security rules, shown ready to copy. A link to the file would only download it: GitHub
 * Pages does not know what a ".rules" file is.
 */
function rulesBox() {
  const text = h('textarea', { class: 'textarea rules-text', readonly: true, rows: 8, 'aria-label': 'The security rules to paste' });
  text.value = 'Loading the rules…';
  const copy = h('button', { type: 'button', class: 'btn btn-quiet btn-small', disabled: true }, icon('copy'), 'Copy the rules');
  copy.addEventListener('click', async () => {
    if (await copyText(text.value)) toast('Rules copied');
    else { text.focus(); text.select(); toast('Press Ctrl+C or ⌘C to copy'); }
  });
  fetch('./firestore.rules')
    .then((reply) => (reply.ok ? reply.text() : Promise.reject(new Error('not found'))))
    .then((rules) => { text.value = rules; copy.disabled = false; })
    .catch(() => { text.value = 'The rules could not be loaded here. Open firestore.rules in the repository and copy everything in it.'; });
  return h('div', { class: 'stack stack-s' }, text, h('div', null, copy));
}

/** Shown instead of the site until js/config.js has the owner's Firebase settings. */
export function setupView({ appName }) {
  const origin = window.location.hostname;
  const step = (title, ...body) => h('li', null, h('h3', null, title), ...body);
  return {
    title: 'Finish setting up',
    narrow: true,
    el: h('div', { class: 'stack stack-l' },
      h('div', { class: 'stack stack-s' },
        h('h1', null, 'Finish setting up'),
        h('p', { class: 'muted' }, `${appName} keeps accounts and answers in a free Firebase project that you own. Setting it up takes about ten minutes, once. Until then, visitors see this page.`)),
      h('ol', { class: 'setup-steps' },
        step('Create a Firebase project',
          h('p', null, 'Go to ', h('a', { href: 'https://console.firebase.google.com/', target: '_blank', rel: 'noopener noreferrer' }, 'console.firebase.google.com'),
            ' and create a project. Gemini and Google Analytics can stay off. The free Spark plan is enough.')),
        step('Turn on sign-in',
          h('p', null, 'In the console menu open Authentication (under Security), then Sign-in method. Enable:'),
          h('ul', null,
            h('li', null, h('b', null, 'Email/Password'), ', for organizers.'),
            h('li', null, h('b', null, 'Anonymous'), ', so invitees can save their times without an account.')),
          h('p', null, 'Then in Authentication, Settings:'),
          h('ul', null,
            h('li', null, 'Authorized domains: add ', h('code', null, origin || 'your-name.github.io'), '.'),
            h('li', null, 'Password policy: minimum length 15, enforcement Require, character types off.'))),
        step('Create the database',
          h('p', null, 'Open Firestore (under Databases & Storage) and create a database. Keep the Standard edition and the database ID (default). Pick a location near you; it can’t be changed later. Choose production mode.')),
        step('Paste the security rules',
          h('p', null, 'In Firestore, open Rules. Replace everything there with this, then Publish. These rules are what keep each organizer’s answers private.'),
          rulesBox()),
        step('Connect the site',
          h('p', null, 'Open Project settings (the gear icon). Under Your apps, add a Web app. It shows a snippet with several values. Copy these four into ',
            h('code', null, 'js/config.js'), ' in the repository:'),
          h('pre', null, h('code', null, 'firebase: {\n  apiKey: "…",\n  authDomain: "…",\n  projectId: "…",\n  appId: "…",\n},')),
          h('p', null, 'Commit the change to the main branch. Once the tests have run and GitHub Pages has republished (a few minutes; see the Actions tab), this page is replaced by the real site.'))),
      h('p', { class: 'muted small' }, 'These values are identifiers, not passwords, and are safe to publish. The README in the repository has the same steps with more detail.')),
  };
}
