// Security-rule tests. Run with `npm run test:rules`, which starts the Firestore emulator.
import { test, before, beforeEach, after } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where, limit,
  serverTimestamp, Timestamp, deleteField, setLogLevel,
} from 'firebase/firestore';

setLogLevel('silent'); // refused writes are the point of these tests; keep the output readable

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-calendar-applet',
    firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') },
  });
});
beforeEach(async () => { await env.clearFirestore(); });
after(async () => { await env.cleanup(); });

// People.
const account = (uid) => env.authenticatedContext(uid, {
  email: `${uid}@example.com`, email_verified: true, firebase: { sign_in_provider: 'password', identities: {} },
}).firestore();
const unconfirmed = (uid) => env.authenticatedContext(uid, {
  email: `${uid}@example.com`, email_verified: false, firebase: { sign_in_provider: 'password', identities: {} },
}).firestore();
const guest = (uid) => env.authenticatedContext(uid, {
  firebase: { sign_in_provider: 'anonymous', identities: {} },
}).firestore();
const stranger = () => env.unauthenticatedContext().firestore();

// Start instants (whole minutes since 1970) for `n` consecutive days from 21 Nov 2026, 9:00 New York.
const starts = (n) => Array.from({ length: Array.isArray(n) ? n.length : n }, (_, i) => 29722440 + i * 1440);

// A valid event owned by `ownerUid`: three days, 9:00-17:00, half-hour slots => 48 slots.
const eventData = (ownerUid, changes = {}) => ({
  ownerUid,
  title: 'Board game weekend',
  description: 'Bring snacks.',
  timezone: 'America/New_York',
  dates: ['2026-11-21', '2026-11-22', '2026-11-23'],
  startMinute: 540,
  endMinute: 1020,
  slotMinutes: 30,
  dayStarts: starts(changes.dates ? changes.dates.length : 3),
  slotCount: 48,
  open: true,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...changes,
});
const without = (data, key) => { const copy = { ...data }; delete copy[key]; return copy; };
const answer = (changes = {}) => ({
  name: 'Ana',
  slots: '1'.repeat(48),
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...changes,
});

// Puts documents in place without going through the rules.
async function seed(path, data) {
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), path), data); });
}
const pad = (id) => (id + '0'.repeat(20)).slice(0, 20);
const seedEvent = (id = 'ev1', owner = 'olga', changes = {}) =>
  seed(`events/${pad(id)}`, eventData(owner, { createdAt: Timestamp.now(), updatedAt: Timestamp.now(), ...changes }));
const seedAnswer = (uid, eventId = 'ev1', changes = {}) =>
  seed(`events/${pad(eventId)}/responses/${uid}`, answer({ createdAt: Timestamp.now(), updatedAt: Timestamp.now(), ...changes }));

// ---------------------------------------------------------------- events: reading

test('anyone, signed in or not, can open one event by its id', async () => {
  await seedEvent();
  await assertSucceeds(getDoc(doc(stranger(), 'events/ev100000000000000000')));
  await assertSucceeds(getDoc(doc(guest('gus'), 'events/ev100000000000000000')));
});

test('nobody can browse the list of all events', async () => {
  await seedEvent();
  await assertFails(getDocs(collection(stranger(), 'events')));
  await assertFails(getDocs(collection(account('olga'), 'events')));
  await assertFails(getDocs(collection(guest('gus'), 'events')));
});

test('an organizer can list their own events but not someone else\'s', async () => {
  await seedEvent('ev1', 'olga');
  await seedEvent('ev2', 'pete');
  const mine = query(collection(account('olga'), 'events'), where('ownerUid', '==', 'olga'), limit(100));
  await assertSucceeds(getDocs(mine));
  const theirs = query(collection(account('olga'), 'events'), where('ownerUid', '==', 'pete'), limit(100));
  await assertFails(getDocs(theirs));
  await assertFails(getDocs(query(collection(stranger(), 'events'), where('ownerUid', '==', 'olga'), limit(100))));
  await assertFails(getDocs(query(collection(guest('gus'), 'events'), where('ownerUid', '==', 'olga'), limit(100))));
});

test('listing events must ask for a bounded number, so one query cannot pull everything', async () => {
  const events = collection(account('olga'), 'events');
  await assertFails(getDocs(query(events, where('ownerUid', '==', 'olga'), limit(5000))));
  await assertFails(getDocs(query(events, where('ownerUid', '==', 'olga'))));
});

// ---------------------------------------------------------------- events: creating

test('a signed-in organizer can create a valid event they own', async () => {
  await assertSucceeds(setDoc(doc(account('olga'), 'events/ev100000000000000000'), eventData('olga')));
});

test('an event may have an empty description, one day, and a window past midnight', async () => {
  await assertSucceeds(setDoc(doc(account('olga'), 'events/a0000000000000000000'), eventData('olga', { description: '' })));
  await assertSucceeds(setDoc(doc(account('olga'), 'events/b0000000000000000000'), eventData('olga', { dates: ['2026-11-21'], slotCount: 16 })));
  await assertSucceeds(setDoc(doc(account('olga'), 'events/c0000000000000000000'), eventData('olga', { startMinute: 1200, endMinute: 1560, slotMinutes: 60, slotCount: 18 })));
  await assertSucceeds(setDoc(doc(account('olga'), 'events/d0000000000000000000'), eventData('olga', { startMinute: 0, endMinute: 1440, slotMinutes: 15, slotCount: 288 })));
});

test('an event may cover the maximum of 31 days', async () => {
  const dates = Array.from({ length: 31 }, (_, i) => `2027-01-${String(i + 1).padStart(2, '0')}`);
  await assertSucceeds(setDoc(doc(account('olga'), 'events/ev100000000000000000'), eventData('olga', { dates, slotCount: 31 * 16 })));
});

test('an event id must be 20 letters and digits, like the ones the site generates', async () => {
  const db = account('olga');
  await assertFails(setDoc(doc(db, 'events/short'), eventData('olga')));
  await assertFails(setDoc(doc(db, 'events/party'), eventData('olga')));
  await assertFails(setDoc(doc(db, 'events/with-dash-and_under00'), eventData('olga')));
  await assertFails(setDoc(doc(db, `events/${'x'.repeat(21)}`), eventData('olga')));
  await assertSucceeds(setDoc(doc(db, 'events/AbCdEfGhIj0123456789'), eventData('olga')));
});

test('someone who is not signed in cannot create an event', async () => {
  await assertFails(setDoc(doc(stranger(), 'events/ev100000000000000000'), eventData('olga')));
});

test('a guest without an account cannot create an event', async () => {
  await assertFails(setDoc(doc(guest('gus'), 'events/ev100000000000000000'), eventData('gus')));
});

test('an account whose email is not confirmed yet cannot create an event', async () => {
  await assertFails(setDoc(doc(unconfirmed('nina'), 'events/ev100000000000000000'), eventData('nina')));
});

test('an organizer who created events keeps control of them whatever their sign-in token says', async () => {
  await seedEvent('ev1', 'nina');
  await seedAnswer('gus');
  const db = unconfirmed('nina');
  await assertSucceeds(getDocs(collection(db, 'events/ev100000000000000000/responses')));
  await assertSucceeds(updateDoc(doc(db, 'events/ev100000000000000000'), { open: false, updatedAt: serverTimestamp() }));
  await assertSucceeds(deleteDoc(doc(db, 'events/ev100000000000000000')));
});

test('an organizer cannot create an event in someone else\'s name', async () => {
  await assertFails(setDoc(doc(account('olga'), 'events/ev100000000000000000'), eventData('pete')));
});

test('an event with a missing field is refused', async () => {
  for (const key of ['ownerUid', 'title', 'description', 'timezone', 'dates', 'startMinute', 'endMinute', 'slotMinutes', 'dayStarts', 'slotCount', 'open', 'createdAt', 'updatedAt']) {
    await assertFails(setDoc(doc(account('olga'), `events/${pad(`missing${key}`)}`), without(eventData('olga'), key)));
  }
});

test('an event with an unexpected extra field is refused', async () => {
  await assertFails(setDoc(doc(account('olga'), 'events/ev100000000000000000'), eventData('olga', { admin: true })));
});

test('an event with a bad title or description is refused', async () => {
  const db = account('olga');
  await assertFails(setDoc(doc(db, 'events/a0000000000000000000'), eventData('olga', { title: '' })));
  await assertFails(setDoc(doc(db, 'events/b0000000000000000000'), eventData('olga', { title: 'x'.repeat(101) })));
  await assertFails(setDoc(doc(db, 'events/c0000000000000000000'), eventData('olga', { title: 42 })));
  await assertFails(setDoc(doc(db, 'events/d0000000000000000000'), eventData('olga', { description: 'x'.repeat(501) })));
  await assertFails(setDoc(doc(db, 'events/e0000000000000000000'), eventData('olga', { description: null })));
  await assertSucceeds(setDoc(doc(db, 'events/f0000000000000000000'), eventData('olga', { title: 'x'.repeat(100), description: 'x'.repeat(500) })));
});

test('an event with a bad time zone is refused', async () => {
  const db = account('olga');
  await assertFails(setDoc(doc(db, 'events/a0000000000000000000'), eventData('olga', { timezone: '' })));
  await assertFails(setDoc(doc(db, 'events/b0000000000000000000'), eventData('olga', { timezone: 'x'.repeat(65) })));
  await assertFails(setDoc(doc(db, 'events/c0000000000000000000'), eventData('olga', { timezone: '<script>' })));
  await assertFails(setDoc(doc(db, 'events/d0000000000000000000'), eventData('olga', { timezone: 5 })));
  await assertSucceeds(setDoc(doc(db, 'events/e0000000000000000000'), eventData('olga', { timezone: 'America/Argentina/Buenos_Aires' })));
  await assertSucceeds(setDoc(doc(db, 'events/f0000000000000000000'), eventData('olga', { timezone: 'Etc/GMT+5' })));
});

test('an event with bad days is refused', async () => {
  const db = account('olga');
  const tooMany = Array.from({ length: 32 }, (_, i) => `2027-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`);
  await assertFails(setDoc(doc(db, 'events/a0000000000000000000'), eventData('olga', { dates: [], slotCount: 0 })));
  await assertFails(setDoc(doc(db, 'events/b0000000000000000000'), eventData('olga', { dates: tooMany, slotCount: 32 * 16 })));
  await assertFails(setDoc(doc(db, 'events/c0000000000000000000'), eventData('olga', { dates: ['21 Nov 2026'], slotCount: 16 })));
  await assertFails(setDoc(doc(db, 'events/d0000000000000000000'), eventData('olga', { dates: ['2026-13-01'], slotCount: 16 })));
  await assertFails(setDoc(doc(db, 'events/e0000000000000000000'), eventData('olga', { dates: ['2026-11-32'], slotCount: 16 })));
  await assertFails(setDoc(doc(db, 'events/f0000000000000000000'), eventData('olga', { dates: '2026-11-21', slotCount: 16 })));
  await assertFails(setDoc(doc(db, 'events/g0000000000000000000'), eventData('olga', { dates: [20261121], slotCount: 16 })));
  // Two days smuggled into one list entry, so the list looks shorter than it is.
  await assertFails(setDoc(doc(db, 'events/h0000000000000000000'), eventData('olga', { dates: ['2026-11-21,2026-11-22'], slotCount: 16 })));
  await assertFails(setDoc(doc(db, 'events/i0000000000000000000'), eventData('olga', { dates: ['2026-11-21,2026-11-22'], slotCount: 32 })));
  await assertFails(setDoc(doc(db, 'events/j0000000000000000000'), eventData('olga', { dates: ['2026-11-2', '1,2026-11-22'], slotCount: 32 })));
  await assertFails(setDoc(doc(db, 'events/k0000000000000000000'), eventData('olga', { dates: [{ day: '2026-11-21' }], slotCount: 16 })));
  await assertFails(setDoc(doc(db, 'events/l0000000000000000000'), eventData('olga', { dates: { 0: '2026-11-21' }, slotCount: 16 })));
});

test('an event must store one start instant per day, as whole numbers', async () => {
  const db = account('olga');
  await assertFails(setDoc(doc(db, 'events/a0000000000000000000'), eventData('olga', { dayStarts: starts(2) })));
  await assertFails(setDoc(doc(db, 'events/b0000000000000000000'), eventData('olga', { dayStarts: starts(4) })));
  await assertFails(setDoc(doc(db, 'events/c0000000000000000000'), eventData('olga', { dayStarts: [] })));
  await assertFails(setDoc(doc(db, 'events/d0000000000000000000'), eventData('olga', { dayStarts: '29722440,29723880,29725320' })));
  await assertFails(setDoc(doc(db, 'events/e0000000000000000000'), eventData('olga', { dayStarts: [29722440.5, 29723880, 29725320] })));
  await assertFails(setDoc(doc(db, 'events/f0000000000000000000'), eventData('olga', { dayStarts: [-29722440, 29723880, 29725320] })));
  await assertFails(setDoc(doc(db, 'events/g0000000000000000000'), eventData('olga', { dayStarts: [1, 2, 3] })));
  await assertFails(setDoc(doc(db, 'events/h0000000000000000000'), eventData('olga', { dayStarts: ['soon', 'later', 'never'] })));
  await assertFails(setDoc(doc(db, 'events/i0000000000000000000'), eventData('olga', { dayStarts: [29722440, 29723880, null] })));
  await assertFails(setDoc(doc(db, 'events/j0000000000000000000'), eventData('olga', { dayStarts: ['29722440,29723880', 29725320] })));
  await assertFails(setDoc(doc(db, 'events/k0000000000000000000'), eventData('olga', { dayStarts: [297224400000, 29723880, 29725320] })));
});

test('an event with a bad daily window is refused', async () => {
  const db = account('olga');
  await assertFails(setDoc(doc(db, 'events/a0000000000000000000'), eventData('olga', { endMinute: 540, slotCount: 0 })));
  await assertFails(setDoc(doc(db, 'events/b0000000000000000000'), eventData('olga', { endMinute: 480, slotCount: -6 })));
  await assertFails(setDoc(doc(db, 'events/c0000000000000000000'), eventData('olga', { startMinute: 545, endMinute: 1025 })));
  await assertFails(setDoc(doc(db, 'events/d0000000000000000000'), eventData('olga', { startMinute: -60, endMinute: 420 })));
  await assertFails(setDoc(doc(db, 'events/e0000000000000000000'), eventData('olga', { startMinute: 1440, endMinute: 1920 })));
  await assertFails(setDoc(doc(db, 'events/f0000000000000000000'), eventData('olga', { startMinute: 540, endMinute: 540 + 1470, slotCount: 3 * 49 })));
  await assertFails(setDoc(doc(db, 'events/g0000000000000000000'), eventData('olga', { slotMinutes: 20, slotCount: 72 })));
  await assertFails(setDoc(doc(db, 'events/h0000000000000000000'), eventData('olga', { slotMinutes: 60, endMinute: 1050, slotCount: 24 })));
  await assertFails(setDoc(doc(db, 'events/i0000000000000000000'), eventData('olga', { startMinute: 540.5 })));
  await assertFails(setDoc(doc(db, 'events/j0000000000000000000'), eventData('olga', { startMinute: '540' })));
  await assertFails(setDoc(doc(db, 'events/k0000000000000000000'), eventData('olga', { slotMinutes: 0 })));
});

test('an event whose slot count does not match its days and window is refused', async () => {
  const db = account('olga');
  await assertFails(setDoc(doc(db, 'events/a0000000000000000000'), eventData('olga', { slotCount: 47 })));
  await assertFails(setDoc(doc(db, 'events/b0000000000000000000'), eventData('olga', { slotCount: 100000 })));
  await assertFails(setDoc(doc(db, 'events/c0000000000000000000'), eventData('olga', { slotCount: '48' })));
});

test('an event must carry the server\'s clock and a true/false open flag', async () => {
  const db = account('olga');
  const past = Timestamp.fromDate(new Date('2020-01-01T00:00:00Z'));
  await assertFails(setDoc(doc(db, 'events/a0000000000000000000'), eventData('olga', { createdAt: past })));
  await assertFails(setDoc(doc(db, 'events/b0000000000000000000'), eventData('olga', { updatedAt: past })));
  await assertFails(setDoc(doc(db, 'events/c0000000000000000000'), eventData('olga', { open: 'yes' })));
  await assertSucceeds(setDoc(doc(db, 'events/d0000000000000000000'), eventData('olga', { open: false })));
});

// ---------------------------------------------------------------- events: changing and deleting

test('the organizer can rename, re-describe, close and reopen their event', async () => {
  await seedEvent();
  const ref = doc(account('olga'), 'events/ev100000000000000000');
  await assertSucceeds(updateDoc(ref, { title: 'Renamed', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref, { description: '', open: false, updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref, { open: true, updatedAt: serverTimestamp() }));
});

test('an update must still be valid and must refresh the updated time', async () => {
  await seedEvent();
  const ref = doc(account('olga'), 'events/ev100000000000000000');
  await assertFails(updateDoc(ref, { title: '', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { title: 'x'.repeat(101), updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { open: 'no', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { title: 'No timestamp' }));
  await assertFails(updateDoc(ref, { title: 'Extra', extra: 1, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { description: deleteField(), updatedAt: serverTimestamp() }));
});

test('the days, times, zone, owner and creation time of an event can never change', async () => {
  await seedEvent();
  const ref = doc(account('olga'), 'events/ev100000000000000000');
  const stamp = { updatedAt: serverTimestamp() };
  await assertFails(updateDoc(ref, { dates: ['2026-11-21', '2026-11-22', '2026-11-24'], ...stamp }));
  await assertFails(updateDoc(ref, { dates: ['2026-11-21'], slotCount: 16, ...stamp }));
  await assertFails(updateDoc(ref, { startMinute: 600, endMinute: 1080, ...stamp }));
  await assertFails(updateDoc(ref, { slotMinutes: 60, slotCount: 24, ...stamp }));
  await assertFails(updateDoc(ref, { timezone: 'Europe/Berlin', ...stamp }));
  await assertFails(updateDoc(ref, { dayStarts: [29722500, 29723940, 29725380], ...stamp }));
  await assertFails(updateDoc(ref, { ownerUid: 'pete', ...stamp }));
  await assertFails(updateDoc(ref, { createdAt: serverTimestamp(), ...stamp }));
});

test('nobody but the organizer can change or delete an event', async () => {
  await seedEvent();
  for (const db of [account('pete'), guest('gus'), stranger()]) {
    await assertFails(updateDoc(doc(db, 'events/ev100000000000000000'), { title: 'Hijacked', updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db, 'events/ev100000000000000000'), eventData('pete')));
    await assertFails(deleteDoc(doc(db, 'events/ev100000000000000000')));
  }
});

test('the organizer can delete their event', async () => {
  await seedEvent();
  await assertSucceeds(deleteDoc(doc(account('olga'), 'events/ev100000000000000000')));
});

// ---------------------------------------------------------------- answers: writing

test('a guest can save their own answer to an open event', async () => {
  await seedEvent();
  await assertSucceeds(setDoc(doc(guest('gus'), 'events/ev100000000000000000/responses/gus'), answer()));
});

test('someone with an account can answer too, including the organizer', async () => {
  await seedEvent();
  await assertSucceeds(setDoc(doc(account('pete'), 'events/ev100000000000000000/responses/pete'), answer({ name: 'Pete' })));
  await assertSucceeds(setDoc(doc(account('olga'), 'events/ev100000000000000000/responses/olga'), answer({ name: 'Olga' })));
});

test('nobody can save an answer under another person\'s id', async () => {
  await seedEvent();
  await assertFails(setDoc(doc(guest('gus'), 'events/ev100000000000000000/responses/hal'), answer()));
  await assertFails(setDoc(doc(account('olga'), 'events/ev100000000000000000/responses/gus'), answer()));
});

test('someone who is not signed in at all cannot save an answer', async () => {
  await seedEvent();
  await assertFails(setDoc(doc(stranger(), 'events/ev100000000000000000/responses/anyone'), answer()));
});

test('an answer with a bad name is refused', async () => {
  await seedEvent();
  const ref = doc(guest('gus'), 'events/ev100000000000000000/responses/gus');
  await assertFails(setDoc(ref, answer({ name: '' })));
  await assertFails(setDoc(ref, answer({ name: 'x'.repeat(61) })));
  await assertFails(setDoc(ref, answer({ name: 7 })));
  await assertSucceeds(setDoc(ref, answer({ name: 'x'.repeat(60) })));
});

test('an answer must have exactly one 0 or 1 for every slot of the event', async () => {
  await seedEvent();
  const ref = doc(guest('gus'), 'events/ev100000000000000000/responses/gus');
  await assertFails(setDoc(ref, answer({ slots: '1'.repeat(47) })));
  await assertFails(setDoc(ref, answer({ slots: '1'.repeat(49) })));
  await assertFails(setDoc(ref, answer({ slots: '2'.repeat(48) })));
  await assertFails(setDoc(ref, answer({ slots: '1'.repeat(47) + '\n' })));
  await assertFails(setDoc(ref, answer({ slots: Array(48).fill(1) })));
  await assertFails(setDoc(ref, answer({ slots: '1'.repeat(1000000) })));
  await assertSucceeds(setDoc(ref, answer({ slots: '01'.repeat(24) })));
  await assertSucceeds(setDoc(doc(guest('hal'), 'events/ev100000000000000000/responses/hal'), answer({ slots: '0'.repeat(48) })));
});

test('an answer with missing or extra fields, or a made-up time, is refused', async () => {
  await seedEvent();
  const ref = doc(guest('gus'), 'events/ev100000000000000000/responses/gus');
  for (const key of ['name', 'slots', 'createdAt', 'updatedAt']) {
    await assertFails(setDoc(ref, without(answer(), key)));
  }
  await assertFails(setDoc(ref, answer({ role: 'owner' })));
  await assertFails(setDoc(ref, answer({ createdAt: Timestamp.fromDate(new Date('2020-01-01T00:00:00Z')) })));
  await assertFails(setDoc(ref, answer({ updatedAt: Timestamp.fromDate(new Date('2020-01-01T00:00:00Z')) })));
});

test('answers are refused once the organizer closes the event', async () => {
  await seedEvent('ev1', 'olga', { open: false });
  await seedAnswer('hal');
  await assertFails(setDoc(doc(guest('gus'), 'events/ev100000000000000000/responses/gus'), answer()));
  await assertFails(updateDoc(doc(guest('hal'), 'events/ev100000000000000000/responses/hal'), { name: 'Hal 2', updatedAt: serverTimestamp() }));
});

test('answers are refused for an event that does not exist', async () => {
  await assertFails(setDoc(doc(guest('gus'), 'events/nope0000000000000000/responses/gus'), answer()));
});

test('a guest can change their own answer but not when it was first made', async () => {
  await seedEvent();
  await seedAnswer('gus');
  const ref = doc(guest('gus'), 'events/ev100000000000000000/responses/gus');
  await assertSucceeds(updateDoc(ref, { name: 'Gus', slots: '0'.repeat(48), updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { slots: '1'.repeat(10), updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { name: 'No timestamp' }));
  await assertFails(updateDoc(doc(guest('hal'), 'events/ev100000000000000000/responses/gus'), { name: 'Hal', updatedAt: serverTimestamp() }));
});

// ---------------------------------------------------------------- answers: reading and deleting

test('a guest can read their own answer, even before it exists, but nobody else\'s', async () => {
  await seedEvent();
  await seedAnswer('gus');
  await assertSucceeds(getDoc(doc(guest('gus'), 'events/ev100000000000000000/responses/gus')));
  await assertSucceeds(getDoc(doc(guest('new'), 'events/ev100000000000000000/responses/new')));
  await assertFails(getDoc(doc(guest('hal'), 'events/ev100000000000000000/responses/gus')));
  await assertFails(getDoc(doc(account('pete'), 'events/ev100000000000000000/responses/gus')));
  await assertFails(getDoc(doc(stranger(), 'events/ev100000000000000000/responses/gus')));
});

test('only the organizer can list the answers to an event', async () => {
  await seedEvent();
  await seedAnswer('gus');
  await assertSucceeds(getDocs(collection(account('olga'), 'events/ev100000000000000000/responses')));
  await assertSucceeds(getDoc(doc(account('olga'), 'events/ev100000000000000000/responses/gus')));
  await assertFails(getDocs(collection(guest('gus'), 'events/ev100000000000000000/responses')));
  await assertFails(getDocs(collection(account('pete'), 'events/ev100000000000000000/responses')));
  await assertFails(getDocs(collection(stranger(), 'events/ev100000000000000000/responses')));
});

test('the organizer can remove any answer, and a guest can remove their own', async () => {
  await seedEvent();
  await seedAnswer('gus');
  await seedAnswer('hal');
  await assertFails(deleteDoc(doc(guest('hal'), 'events/ev100000000000000000/responses/gus')));
  await assertFails(deleteDoc(doc(account('pete'), 'events/ev100000000000000000/responses/gus')));
  await assertFails(deleteDoc(doc(stranger(), 'events/ev100000000000000000/responses/gus')));
  await assertSucceeds(deleteDoc(doc(guest('hal'), 'events/ev100000000000000000/responses/hal')));
  await assertSucceeds(deleteDoc(doc(account('olga'), 'events/ev100000000000000000/responses/gus')));
});

test('the organizer cannot edit what a guest answered', async () => {
  await seedEvent();
  await seedAnswer('gus');
  await assertFails(updateDoc(doc(account('olga'), 'events/ev100000000000000000/responses/gus'), { slots: '0'.repeat(48), updatedAt: serverTimestamp() }));
});

test('answers left behind by a deleted event stay private', async () => {
  await seedAnswer('gus', 'gone');
  await assertFails(getDocs(collection(account('olga'), 'events/gone0000000000000000/responses')));
  await assertFails(getDoc(doc(account('olga'), 'events/gone0000000000000000/responses/gus')));
  await assertSucceeds(getDoc(doc(guest('gus'), 'events/gone0000000000000000/responses/gus')));
  await assertSucceeds(deleteDoc(doc(guest('gus'), 'events/gone0000000000000000/responses/gus')));
});

// ---------------------------------------------------------------- everything else

test('no other part of the database can be read or written', async () => {
  await assertFails(getDoc(doc(account('olga'), 'users/olga')));
  await assertFails(setDoc(doc(account('olga'), 'users/olga'), { admin: true }));
  await assertFails(setDoc(doc(account('olga'), 'events/ev100000000000000000/secrets/x'), { a: 1 }));
  await assertFails(getDocs(collection(account('olga'), 'anything')));
});
