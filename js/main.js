// Start-up, the page frame (header, footer) and the router.
//
// Pages are addressed after the "#": #/ (home), #/sign-in, #/sign-up, #/reset, #/events, #/new,
// #/account, #/e/<event id> (the invite page) and #/e/<event id>/results (the organizer's view).
// Hash addresses need no server set-up, so they work on GitHub Pages as they are.

import { config } from './config.js';
import { isConfigured, startBackend, getAccount, getUser, onUserChange, signOut } from './backend.js';
import { h, replace, logoMark, toast } from './ui/dom.js';
import { homeView } from './views/home.js';
import { signInView, signUpView, resetView } from './views/auth.js';
import { eventsView } from './views/events.js';
import { newEventView } from './views/event-form.js';
import { respondView } from './views/respond.js';
import { resultsView } from './views/results.js';
import { accountView } from './views/account.js';
import { setupView, notFoundView, messageView } from './views/misc.js';

const appName = config.appName || 'Overlap';
const root = document.getElementById('app');

const routes = [
  { pattern: /^\/$/, view: homeView },
  { pattern: /^\/sign-in$/, view: signInView, signedOutOnly: true },
  { pattern: /^\/sign-up$/, view: signUpView, signedOutOnly: true },
  { pattern: /^\/reset$/, view: resetView },
  { pattern: /^\/events$/, view: eventsView, needsAccount: true },
  { pattern: /^\/new$/, view: newEventView, needsAccount: true },
  { pattern: /^\/account$/, view: accountView, needsAccount: true },
  { pattern: /^\/e\/([^/]+)\/results$/, view: resultsView, needsAccount: true },
  { pattern: /^\/e\/([^/]+)$/, view: respondView },
];

let main;
let nav;
let current = null;   // { route, dispose }
let afterSignIn = null;
let firstRender = true;

export function navigate(path, { replaceEntry = false } = {}) {
  const target = `#${path}`;
  if (window.location.hash === target) render();
  else if (replaceEntry) window.location.replace(target);
  else window.location.hash = target;
}

function currentPath() {
  const hash = window.location.hash;
  return hash.startsWith('#/') ? hash.slice(1) : '/';
}

function drawNav() {
  const account = getAccount();
  const path = currentPath();
  const link = (href, text) => h('a', { href: `#${href}`, 'aria-current': path === href ? 'page' : null }, text);
  if (account) {
    replace(nav, link('/events', 'Your events'), link('/account', 'Account'),
      h('button', { type: 'button', onclick: handleSignOut }, 'Sign out'));
  } else {
    replace(nav, link('/sign-in', 'Sign in'), link('/sign-up', 'Create account'));
  }
}

async function handleSignOut() {
  navigate('/');
  try {
    await signOut();
    toast('Signed out');
  } catch (error) {
    toast(error.message);
  }
}

function show(view, route, params) {
  if (current?.dispose) current.dispose();
  const page = view({ params, navigate, appName, config });
  current = { route, dispose: page.dispose };
  main.className = `main${page.narrow ? ' main-narrow' : ''}`;
  replace(main, page.el);
  document.title = page.title ? `${page.title} · ${appName}` : appName;
  drawNav();
  if (!firstRender) {
    window.scrollTo(0, 0);
    main.focus({ preventScroll: true });
  }
  firstRender = false;
}

function render() {
  const path = currentPath();
  for (const route of routes) {
    const match = route.pattern.exec(path);
    if (!match) continue;
    if (route.needsAccount && !getAccount()) {
      afterSignIn = path;
      navigate('/sign-in', { replaceEntry: true });
      return;
    }
    if (route.signedOutOnly && getAccount()) {
      const next = afterSignIn || '/events';
      afterSignIn = null;
      navigate(next, { replaceEntry: true });
      return;
    }
    show(route.view, route, match.slice(1).map(decodeURIComponent));
    return;
  }
  show(notFoundView, null, []);
}

function frame() {
  main = h('main', { id: 'main', class: 'main', tabindex: '-1' });
  nav = h('nav', { class: 'nav', 'aria-label': 'Account' });
  replace(root,
    h('a', { class: 'skip', href: '#main', onclick: (e) => { e.preventDefault(); main.focus(); } }, 'Skip to content'),
    h('div', { class: 'shell' },
      h('header', { class: 'masthead' },
        h('a', { class: 'wordmark', href: '#/' }, logoMark(), appName),
        nav),
      main,
      h('footer', { class: 'colophon' },
        h('p', null, `${appName} finds a time everyone is free. Names and times you save are shared with the event’s organizer and nobody else.`))));
}

async function start() {
  // A page inside someone else's frame could be used to trick a signed-in organizer into
  // clicking things. GitHub Pages cannot send the header that forbids framing, so refuse here.
  if (window.top !== window.self) {
    replace(root, h('p', { class: 'noscript' }, 'This page can’t be shown inside another site. ',
      h('a', { href: window.location.href, target: '_blank', rel: 'noopener' }, 'Open it in its own tab'), '.'));
    return;
  }

  frame();
  if (!isConfigured(config)) {
    replace(nav);
    const page = setupView({ appName });
    replace(main, page.el);
    document.title = `${page.title} · ${appName}`;
    return;
  }

  replace(main, h('p', { class: 'loading', role: 'status' }, 'Loading…'));
  try {
    await startBackend(config);
  } catch (error) {
    console.error(error);
    const page = messageView({
      title: 'The site couldn’t start',
      body: 'Its Firebase settings look wrong. If this is your site, check the values in js/config.js against the Firebase console.',
    });
    replace(main, page.el);
    return;
  }

  onUserChange(() => {
    drawNav();
    const route = current?.route;
    if (!route) return;
    // Re-route only when the change locks this page or makes it pointless. Other pages stay
    // put: an invitee being signed in as a guest mid-save must not lose what they typed.
    if ((route.needsAccount && !getAccount()) || (route.signedOutOnly && getAccount())) render();
  });
  window.addEventListener('hashchange', render);
  render();
}

export { getUser };

start();
