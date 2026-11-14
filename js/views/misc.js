import { h } from '../ui/dom.js';

/** A plain page with a heading, a sentence or two, and optionally one way forward. */
export function messageView({ title, body, action }) {
  return {
    title,
    narrow: true,
    el: h('div', { class: 'stack' },
      h('h1', null, title),
      typeof body === 'string' ? h('p', { class: 'muted' }, body) : body,
      action ? h('p', null, h('a', { class: 'btn', href: action.href }, action.label)) : null),
  };
}

export function notFoundView() {
  return messageView({
    title: 'There’s nothing at this address',
    body: 'The link may be mistyped or cut short. If someone sent it to you, ask them to send it again.',
    action: { href: '#/', label: 'Go to the home page' },
  });
}

const RULES_URL = './firestore.rules';

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
        h('p', { class: 'muted' }, `${appName} keeps accounts and answers in a free Firebase project that you own. It takes about ten minutes, once. Until then, visitors see this page.`)),
      h('ol', { class: 'setup-steps' },
        step('Create a Firebase project',
          h('p', null, 'Go to ', h('a', { href: 'https://console.firebase.google.com/', target: '_blank', rel: 'noopener noreferrer' }, 'console.firebase.google.com'),
            ', choose Add project, and give it a name. You can leave Google Analytics off. The free Spark plan is enough.')),
        step('Turn on sign-in',
          h('p', null, 'In the project, open Build, then Authentication, then Sign-in method, and enable two providers:'),
          h('ul', null,
            h('li', null, h('b', null, 'Email/Password'), ' for organizers.'),
            h('li', null, h('b', null, 'Anonymous'), ' so invitees can save their times without an account.')),
          h('p', null, 'Then open Authentication, Settings, Authorized domains and add ', h('code', null, origin || 'your-name.github.io'), '.')),
        step('Create the database',
          h('p', null, 'Open Build, then Firestore Database, and choose Create database. Pick a location near you and start in production mode.')),
        step('Paste the security rules',
          h('p', null, 'Open Firestore Database, then Rules. Replace everything there with the contents of ',
            h('a', { href: RULES_URL, target: '_blank', rel: 'noopener' }, 'firestore.rules'),
            ' from this site’s repository, and choose Publish. These rules are what keep each organizer’s answers private.')),
        step('Connect the site',
          h('p', null, 'Open Project settings (the gear icon), scroll to Your apps, and add a Web app. Copy the four values it shows into ',
            h('code', null, 'js/config.js'), ' in the repository:'),
          h('pre', null, h('code', null, 'firebase: {\n  apiKey: "…",\n  authDomain: "…",\n  projectId: "…",\n  appId: "…",\n},')),
          h('p', null, 'Commit the change to the main branch. Once the tests have run and GitHub Pages has republished (a few minutes; see the Actions tab), this page is replaced by the real site.'))),
      h('p', { class: 'muted small' }, 'These values are identifiers, not passwords, and are safe to publish. The README in the repository has the same steps with more detail.')),
  };
}
