// Everything that talks to Firebase lives here. Pages call these functions and never import the
// Firebase SDK themselves, so the rest of the site is plain DOM code that is easy to follow.
//
// Accounts:  Firebase Authentication (email and password). Invitees are signed in "anonymously":
//            no name, email or password, just an identity tied to their browser so that they,
//            and only they, can come back and change their own answer.
// Data:      Cloud Firestore, protected by firestore.rules.

import {
  initializeApp, initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, connectAuthEmulator,
  onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInAnonymously,
  signOut as fbSignOut, sendEmailVerification, sendPasswordResetEmail, updateProfile, updatePassword,
  reauthenticateWithCredential, linkWithCredential, EmailAuthProvider, deleteUser, validatePassword, reload,
  getFirestore, connectFirestoreEmulator, doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, where, limit, serverTimestamp, writeBatch,
} from './vendor/firebase.js';
import { parseEvent } from './core/validate.js';
import { computeDayStarts } from './core/slots.js';
import { cleanName, isAnswer, emptyAnswer } from './core/availability.js';

let auth = null;
let db = null;
let currentUser; // undefined until Firebase has reported the sign-in state once
const listeners = new Set();
let ready;

export function isConfigured(config) {
  const f = config?.firebase;
  return Boolean(f && f.apiKey && f.projectId && f.appId);
}

/** Starts Firebase. Resolves once we know whether somebody is signed in. */
export function startBackend(config) {
  const app = initializeApp(config.firebase);
  // No pop-up or redirect sign-in is used, so none of that code (or its third-party scripts and
  // frames) is loaded: sign-in state is simply kept in this browser's storage.
  auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  db = getFirestore(app);
  if (config.emulators) {
    connectAuthEmulator(auth, config.emulators.auth, { disableWarnings: true });
    connectFirestoreEmulator(db, ...config.emulators.firestore);
  }
  ready = new Promise((resolve) => {
    onAuthStateChanged(auth, (user) => {
      currentUser = toUser(user);
      resolve();
      for (const listener of listeners) listener(currentUser);
    });
  });
  return ready;
}

function toUser(user) {
  if (!user) return null;
  return {
    uid: user.uid,
    email: user.email || '',
    name: user.displayName || '',
    verified: user.emailVerified,
    guest: user.isAnonymous,
  };
}

/** The signed-in person ({ uid, email, name, verified, guest }) or null. */
export function getUser() {
  return currentUser ?? null;
}

/** The signed-in account holder, or null for nobody and for guests. */
export function getAccount() {
  return currentUser && !currentUser.guest ? currentUser : null;
}

export function onUserChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function refreshUser() {
  currentUser = toUser(auth.currentUser);
  for (const listener of listeners) listener(currentUser);
}

// ------------------------------------------------------------------ errors

/** An error with a message that is safe and useful to show to the person. */
export class FriendlyError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

const OFFLINE = 'We couldn’t reach the server. Check your connection and try again.';

function friendly(error, fallback) {
  const code = error?.code || '';
  // Wrong password, unknown email and malformed email all get the same answer, so the form never
  // reveals whether an address has an account.
  if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email',
    'auth/user-disabled', 'auth/invalid-login-credentials', 'auth/missing-password'].includes(code)) {
    return new FriendlyError('That email and password don’t match an account.', code);
  }
  if (code === 'auth/too-many-requests') {
    return new FriendlyError('Too many attempts. Wait a few minutes and try again, or reset your password.', code);
  }
  if (code === 'auth/network-request-failed' || code === 'unavailable') return new FriendlyError(OFFLINE, code);
  if (code === 'auth/email-already-in-use' || code === 'auth/credential-already-in-use') {
    return new FriendlyError('That email can’t be used for a new account. If it’s yours, sign in or reset your password.', code);
  }
  if (code === 'auth/weak-password' || code === 'auth/password-does-not-meet-requirements') {
    return new FriendlyError(`Choose a longer password: at least ${PASSWORD_MIN} characters.`, code);
  }
  if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation') {
    return new FriendlyError('This site isn’t fully set up yet: this kind of sign-in is switched off in its Firebase project.', code);
  }
  if (code === 'auth/requires-recent-login') {
    return new FriendlyError('For your security, sign out, sign in again, and then retry.', code);
  }
  if (code === 'permission-denied') {
    return new FriendlyError(fallback?.denied || 'You don’t have permission to do that.', code);
  }
  if (code === 'resource-exhausted') {
    return new FriendlyError('The site has hit its free daily limit. Try again tomorrow.', code);
  }
  return new FriendlyError(fallback?.other || 'Something went wrong. Try again.', code);
}

async function attempt(work, fallback) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof FriendlyError) throw error;
    console.error(error);
    throw friendly(error, fallback);
  }
}

// ------------------------------------------------------------------ accounts

export const PASSWORD_MIN = 10;

/**
 * Checks a new password against this site's minimum and the Firebase project's own password
 * policy (if the owner set one). Returns a message, or '' when the password is acceptable.
 */
export async function passwordProblem(password) {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters. A few unrelated words work well.`;
  if (password.length > 128) return 'Use 128 characters or fewer.';
  try {
    const status = await validatePassword(auth, password);
    if (!status.isValid) {
      const need = [];
      if (status.meetsMinPasswordLength === false) need.push(`at least ${status.passwordPolicy.customStrengthOptions.minPasswordLength} characters`);
      if (status.containsUppercaseLetter === false) need.push('a capital letter');
      if (status.containsLowercaseLetter === false) need.push('a lower-case letter');
      if (status.containsNumericCharacter === false) need.push('a number');
      if (status.containsNonAlphanumericCharacter === false) need.push('a symbol');
      return need.length ? `This password needs ${need.join(', ')}.` : 'This password doesn’t meet the site’s rules.';
    }
  } catch {
    // The policy could not be fetched; the server still enforces it on sign-up.
  }
  return '';
}

function verificationSettings() {
  // Bring people back to the site after they click the link in the email.
  return { url: window.location.href.split('#')[0], handleCodeInApp: false };
}

async function sendVerification(user) {
  try {
    await sendEmailVerification(user, verificationSettings());
  } catch (error) {
    // The return address is refused unless the site's domain is on the project's list of
    // authorized domains. The email still works without it.
    if (error?.code === 'auth/unauthorized-continue-uri' || error?.code === 'auth/invalid-continue-uri') {
      await sendEmailVerification(user);
    } else {
      throw error;
    }
  }
}

export function signUp({ name, email, password }) {
  return attempt(async () => {
    let user;
    if (auth.currentUser?.isAnonymous) {
      // This browser already answered an invite as a guest. Turn that guest into the new account
      // so the answers stay theirs.
      ({ user } = await linkWithCredential(auth.currentUser, EmailAuthProvider.credential(email, password)));
    } else {
      ({ user } = await createUserWithEmailAndPassword(auth, email, password));
    }
    if (name) await updateProfile(user, { displayName: name });
    await user.getIdToken(true); // so the database sees an account, not a guest, straight away
    refreshUser();
    try { await sendVerification(user); } catch (error) { console.warn('Verification email not sent', error); }
  });
}

export function signIn({ email, password }) {
  return attempt(async () => {
    await signInWithEmailAndPassword(auth, email, password);
    refreshUser();
  });
}

export function signOut() {
  return attempt(async () => {
    await fbSignOut(auth);
  });
}

/** Always succeeds from the person's point of view, whether or not the address has an account. */
export async function requestPasswordReset(email) {
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (error) {
    const code = error?.code || '';
    if (code === 'auth/too-many-requests' || code === 'auth/network-request-failed') throw friendly(error);
    console.warn('Password reset not sent', code);
  }
}

export function resendVerification() {
  return attempt(async () => {
    if (auth.currentUser) await sendVerification(auth.currentUser);
  });
}

/** Asks Firebase again whether the email has been confirmed. */
export function recheckVerification() {
  return attempt(async () => {
    if (!auth.currentUser) return false;
    await reload(auth.currentUser);
    if (auth.currentUser.emailVerified) await auth.currentUser.getIdToken(true);
    refreshUser();
    return auth.currentUser.emailVerified;
  });
}

async function confirmPassword(password) {
  const user = auth.currentUser;
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
  return user;
}

export function changePassword({ current, next }) {
  return attempt(async () => {
    const user = await confirmPassword(current);
    await updatePassword(user, next);
  });
}

export function changeName(name) {
  return attempt(async () => {
    await updateProfile(auth.currentUser, { displayName: name });
    refreshUser();
  });
}

/** Deletes the account and every event it owns, with their answers. Needs the password again. */
export function deleteAccount(password) {
  return attempt(async () => {
    const user = await confirmPassword(password);
    for (const event of await listMyEvents()) await deleteEvent(event.id);
    await deleteUser(user);
  });
}

// ------------------------------------------------------------------ events

const ID = /^[A-Za-z0-9]{20}$/; // the shape of the ids Firestore generates, and the only one the rules accept
const millis = (stamp) => (stamp && typeof stamp.toMillis === 'function' ? stamp.toMillis() : null);

function readEvent(snapshot) {
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  return parseEvent(snapshot.id, { ...data, createdAt: millis(data.createdAt), updatedAt: millis(data.updatedAt) });
}

/** Saves a new event (already checked by validateEvent) and returns its id. */
export function createEvent(value) {
  return attempt(async () => {
    const ref = doc(collection(db, 'events'));
    await setDoc(ref, {
      ownerUid: auth.currentUser.uid,
      title: value.title,
      description: value.description,
      timezone: value.timezone,
      dates: value.dates,
      startMinute: value.startMinute,
      endMinute: value.endMinute,
      slotMinutes: value.slotMinutes,
      dayStarts: computeDayStarts(value),
      slotCount: value.slotCount,
      open: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  }, { denied: 'The event couldn’t be saved. Sign in again and retry.' });
}

/** The event, null if there is none with that id, or 'damaged' if it is not well formed. */
export function getEvent(id) {
  return attempt(async () => {
    if (!ID.test(id)) return null;
    const snapshot = await getDoc(doc(db, 'events', id));
    if (!snapshot.exists()) return null;
    return readEvent(snapshot) || 'damaged';
  });
}

export function listMyEvents() {
  return attempt(async () => {
    const mine = query(collection(db, 'events'), where('ownerUid', '==', auth.currentUser.uid), limit(100));
    const snapshot = await getDocs(mine);
    return snapshot.docs.map(readEvent).filter(Boolean).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  });
}

/** Changes the name, note or open/closed state. The days and times of an event never change. */
export function updateEvent(id, changes) {
  return attempt(async () => {
    const allowed = {};
    for (const key of ['title', 'description', 'open']) if (key in changes) allowed[key] = changes[key];
    await updateDoc(doc(db, 'events', id), { ...allowed, updatedAt: serverTimestamp() });
  });
}

/** Deletes an event and every answer to it. */
export function deleteEvent(id) {
  return attempt(async () => {
    const answers = await getDocs(collection(db, 'events', id, 'responses'));
    for (let i = 0; i < answers.docs.length; i += 400) {
      const batch = writeBatch(db);
      for (const answer of answers.docs.slice(i, i + 400)) batch.delete(answer.ref);
      await batch.commit();
    }
    await deleteDoc(doc(db, 'events', id));
  });
}

// ------------------------------------------------------------------ answers

function readAnswer(snapshot, slotCount) {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    name: cleanName(data.name) || 'Unnamed',
    slots: isAnswer(data.slots, slotCount) ? data.slots : emptyAnswer(slotCount),
    createdAt: millis(data.createdAt),
    updatedAt: millis(data.updatedAt),
  };
}

/** Every answer to an event, oldest first. Only the organizer is allowed to ask. */
export function listAnswers(event) {
  return attempt(async () => {
    const snapshot = await getDocs(collection(db, 'events', event.id, 'responses'));
    return snapshot.docs.map((d) => readAnswer(d, event.slotCount)).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }, { denied: 'Only the organizer can see the answers.' });
}

/** The answer saved from this browser, or null. */
export function getMyAnswer(event) {
  return attempt(async () => {
    if (!auth.currentUser) return null;
    const snapshot = await getDoc(doc(db, 'events', event.id, 'responses', auth.currentUser.uid));
    return snapshot.exists() ? readAnswer(snapshot, event.slotCount) : null;
  });
}

/** Saves this person's answer, signing them in as a guest first if they are nobody yet. */
export function saveMyAnswer(event, { name, slots }) {
  return attempt(async () => {
    if (!auth.currentUser) await signInAnonymously(auth);
    const ref = doc(db, 'events', event.id, 'responses', auth.currentUser.uid);
    const existing = await getDoc(ref);
    if (existing.exists()) {
      await updateDoc(ref, { name, slots, updatedAt: serverTimestamp() });
    } else {
      await setDoc(ref, { name, slots, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    }
  }, { denied: 'Your times couldn’t be saved. The organizer may have just closed this event.' });
}

export function deleteMyAnswer(event) {
  return attempt(async () => {
    if (auth.currentUser) await deleteDoc(doc(db, 'events', event.id, 'responses', auth.currentUser.uid));
  });
}

/** Removes one person's answer. Only the organizer is allowed to. */
export function deleteAnswer(event, answerId) {
  return attempt(async () => {
    await deleteDoc(doc(db, 'events', event.id, 'responses', answerId));
  });
}
