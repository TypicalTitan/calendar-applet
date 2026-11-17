// Security-rule tests. Run with `npm run test:rules`, which starts the Firestore emulator.
import { test, before, beforeEach, after } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc, collection, collectionGroup, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where, limit, writeBatch,
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

// Start instants (whole minutes since 1970) for `n` consecutive days from 21 Nov 2026, 9:00 in
// New York, stored the way the site stores them: eight-digit numbers joined with commas.
const starts = (n) => Array.from({ length: n }, (_, i) => 29921160 + i * 1440).join(',');

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
// A stored answer. By default it was saved a minute ago, so its owner may change it again.
const aMinuteAgo = () => Timestamp.fromMillis(Date.now() - 60_000);
const seedAnswer = (uid, eventId = 'ev1', changes = {}) =>
  seed(`events/${pad(eventId)}/responses/${uid}`, answer({ createdAt: aMinuteAgo(), updatedAt: aMinuteAgo(), ...changes }));

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
  await assertSucceeds(getDocs(query(collection(db, 'events/ev100000000000000000/responses'), limit(500))));
  await assertSucceeds(updateDoc(doc(db, 'events/ev100000000000000000'), { open: false, updatedAt: serverTimestamp() }));
  const batch = writeBatch(db);
  batch.set(doc(db, 'tombstones/ev100000000000000000'), { at: serverTimestamp() });
  batch.delete(doc(db, 'events/ev100000000000000000'));
  await assertSucceeds(batch.commit());
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

test('an event must store one start instant per day, as eight-digit numbers in one string', async () => {
  const db = account('olga');
  const bad = (id, dayStarts) => assertFails(setDoc(doc(db, `events/${pad(id)}`), eventData('olga', { dayStarts })));
  await bad('a', starts(2));
  await bad('b', starts(4));
  await bad('c', '');
  await bad('d', [29921160, 29922600, 29924040]);
  await bad('e', ['29921160', '29922600', '29924040']);
  await bad('f', '29921160.5,29922600,29924040');
  await bad('g', '-29921160,29922600,29924040');
  await bad('h', '1,2,3');
  await bad('i', 'soon,later,never');
  await bad('j', '29921160,29922600,29924040,');
  await bad('k', '29921160 29922600 29924040');
  await bad('l', '299211600000,29922600,29924040');
  await bad('m', '\u0662\u0669\u0669\u0662\u0661\u0661\u0666\u0660,29922600,29924040'); // Arabic-Indic digits
  await bad('n', 29921160);
  await bad('o', null);
});

test('an event cannot list the same day twice or hide days inside one entry', async () => {
  const db = account('olga');
  await assertFails(setDoc(doc(db, `events/${pad('a')}`), eventData('olga', { dates: ['2026-11-21', '2026-11-21', '2026-11-22'] })));
  await assertFails(setDoc(doc(db, `events/${pad('b')}`), eventData('olga', { dates: ['2026-11-21,2026-11-22', '2026-11-23'], dayStarts: starts(3) })));
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
  await assertFails(updateDoc(ref, { dayStarts: '29921220,29922660,29924100', ...stamp }));
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

// Deleting an event leaves a marker ("tombstone") under the same id, written in the same batch,
// so the id of a deleted event can never be used again.
const tombstone = (db, id = 'ev1') => doc(db, `tombstones/${pad(id)}`);
const stamp = () => ({ at: serverTimestamp() });

test('the organizer can delete their event by leaving a tombstone in the same batch', async () => {
  await seedEvent();
  const db = account('olga');
  const batch = writeBatch(db);
  batch.set(tombstone(db), stamp());
  batch.delete(doc(db, `events/${pad('ev1')}`));
  await assertSucceeds(batch.commit());
});

test('an event cannot be deleted without its tombstone', async () => {
  await seedEvent();
  await assertFails(deleteDoc(doc(account('olga'), `events/${pad('ev1')}`)));
});

test('once an event is deleted, nobody can create an event with the same id again', async () => {
  await seed(`tombstones/${pad('ev1')}`, { at: Timestamp.now() });
  await assertFails(setDoc(doc(account('mallory'), `events/${pad('ev1')}`), eventData('mallory')));
  await assertFails(setDoc(doc(account('olga'), `events/${pad('ev1')}`), eventData('olga')));
  await assertSucceeds(setDoc(doc(account('olga'), `events/${pad('ev2')}`), eventData('olga')));
});

test('only the organizer can leave a tombstone, only for their own event, and only in the exact form', async () => {
  await seedEvent();
  await assertFails(setDoc(tombstone(account('pete')), stamp()));
  await assertFails(setDoc(tombstone(guest('gus')), stamp()));
  await assertFails(setDoc(tombstone(stranger()), stamp()));
  await assertFails(setDoc(tombstone(account('olga'), 'nope'), stamp()), 'no such event');
  await assertFails(setDoc(tombstone(account('olga')), { at: Timestamp.fromDate(new Date('2020-01-01T00:00:00Z')) }));
  await assertFails(setDoc(tombstone(account('olga')), { at: serverTimestamp(), note: 'x' }));
  await assertFails(setDoc(tombstone(account('olga')), {}));
});

test('a tombstone can never be read, changed or removed', async () => {
  await seedEvent();
  await seed(`tombstones/${pad('gone')}`, { at: Timestamp.now() });
  for (const db of [account('olga'), guest('gus'), stranger()]) {
    await assertFails(getDoc(tombstone(db, 'gone')));
    await assertFails(getDocs(collection(db, 'tombstones')));
    await assertFails(updateDoc(tombstone(db, 'gone'), { at: serverTimestamp() }));
    await assertFails(setDoc(tombstone(db, 'gone'), { at: serverTimestamp() }));
    await assertFails(deleteDoc(tombstone(db, 'gone')));
  }
});

test('a tombstone left without deleting the event does not stop the event working, or being deleted the usual way', async () => {
  // An organizer could write only the tombstone. It harms nobody: the event carries on, and
  // the site's ordinary delete (tombstone and event in one batch) still goes through.
  await seedEvent();
  const db = account('olga');
  await assertSucceeds(setDoc(tombstone(db), stamp()));
  await assertSucceeds(setDoc(doc(guest('gus'), `events/${pad('ev1')}/responses/gus`), answer()));
  await assertFails(setDoc(tombstone(account('pete')), stamp()), 'somebody else rewriting it');
  await assertFails(setDoc(tombstone(db), { at: Timestamp.fromDate(new Date('2020-01-01T00:00:00Z')) }), 'a made-up time');
  const batch = writeBatch(db);
  batch.set(tombstone(db), stamp());
  batch.delete(doc(db, `events/${pad('ev1')}`));
  await assertSucceeds(batch.commit());
  await assertFails(setDoc(tombstone(db), stamp()), 'once the event is gone the tombstone is final');
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

test('an answer cannot be saved again within five seconds of the last save', async () => {
  await seedEvent();
  await seedAnswer('gus', 'ev1', { updatedAt: Timestamp.now() });
  const ref = doc(guest('gus'), 'events/ev100000000000000000/responses/gus');
  await assertFails(updateDoc(ref, { name: 'Gus', updatedAt: serverTimestamp() }), 'saved a moment ago');
  await assertFails(deleteDoc(ref), 'deleting and re-creating would get round the wait');
  await seedAnswer('hal', 'ev1', { updatedAt: Timestamp.fromMillis(Date.now() - 6000) });
  const older = doc(guest('hal'), 'events/ev100000000000000000/responses/hal');
  await assertSucceeds(updateDoc(older, { name: 'Hal', updatedAt: serverTimestamp() }));
});

test('the organizer can remove an answer straight away, however recent it is', async () => {
  await seedEvent();
  await seedAnswer('gus', 'ev1', { updatedAt: Timestamp.now() });
  await assertSucceeds(deleteDoc(doc(account('olga'), 'events/ev100000000000000000/responses/gus')));
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
  await assertSucceeds(getDocs(query(collection(account('olga'), 'events/ev100000000000000000/responses'), limit(500))));
  await assertSucceeds(getDocs(query(collection(account('olga'), 'events/ev100000000000000000/responses'), where('updatedAt', '>', Timestamp.fromMillis(0)), limit(500))));
  await assertFails(getDocs(collection(account('olga'), 'events/ev100000000000000000/responses')), 'no limit');
  await assertFails(getDocs(query(collection(account('olga'), 'events/ev100000000000000000/responses'), limit(501))), 'limit too large');
  await assertFails(getDocs(query(collectionGroup(account('olga'), 'responses'), limit(10))), 'answers across all events');
  await assertSucceeds(getDoc(doc(account('olga'), 'events/ev100000000000000000/responses/gus')));
  await assertFails(getDocs(query(collection(guest('gus'), 'events/ev100000000000000000/responses'), limit(500))));
  await assertFails(getDocs(query(collection(account('pete'), 'events/ev100000000000000000/responses'), limit(500))));
  await assertFails(getDocs(query(collection(stranger(), 'events/ev100000000000000000/responses'), limit(500))));
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
  await assertFails(getDocs(query(collection(account('olga'), 'events/gone0000000000000000/responses'), limit(500))));
  await assertFails(getDoc(doc(account('olga'), 'events/gone0000000000000000/responses/gus')));
  await assertSucceeds(getDoc(doc(guest('gus'), 'events/gone0000000000000000/responses/gus')));
  await assertSucceeds(deleteDoc(doc(guest('gus'), 'events/gone0000000000000000/responses/gus')));
});

// ---------------------------------------------------------------- running an event together

// Whoever made an event can hand a friend a one-time link to run it with them. The link carries
// the id of an invite stored under the event. Opening it while signed in writes the friend into
// events/{id}/owners/{their uid} and uses the invite up, both in one batch.
const E = pad('ev1');
const inviteId = (n = 1) => pad(`inv${n}`);
const invitePath = (n = 1, eventId = 'ev1') => `events/${pad(eventId)}/invites/${inviteId(n)}`;
const ownerPath = (uid, eventId = 'ev1') => `events/${pad(eventId)}/owners/${uid}`;
const seedInvite = (n = 1, eventId = 'ev1', changes = {}) => seed(invitePath(n, eventId), { createdAt: Timestamp.now(), ...changes });
const seedOwner = (uid, eventId = 'ev1', n = 9) =>
  seed(ownerPath(uid, eventId), { uid, name: uid, invite: inviteId(n), at: Timestamp.now() });
const joining = (uid, changes = {}) => ({ uid, name: 'Henry', invite: inviteId(1), at: serverTimestamp(), ...changes });

// What the site does when someone opens the link: join and use up the invite in one go.
function join(db, uid, { n = 1, eventId = 'ev1', data = {}, useUp = true } = {}) {
  const batch = writeBatch(db);
  batch.set(doc(db, ownerPath(uid, eventId)), joining(uid, { invite: inviteId(n), ...data }));
  if (useUp) batch.delete(doc(db, invitePath(n, eventId)));
  return batch.commit();
}

test('whoever made an event can make one-time links for friends to run it with them', async () => {
  await seedEvent();
  const db = account('olga');
  await assertSucceeds(setDoc(doc(db, invitePath(1)), { createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(db, `events/${E}/invites/short`), { createdAt: serverTimestamp() }), 'id too short to be secret');
  await assertFails(setDoc(doc(db, invitePath(2)), { createdAt: Timestamp.fromDate(new Date('2020-01-01T00:00:00Z')) }), 'a made-up time');
  await assertFails(setDoc(doc(db, invitePath(3)), { createdAt: serverTimestamp(), extra: 1 }));
  await assertFails(updateDoc(doc(db, invitePath(1)), { createdAt: serverTimestamp() }), 'invites never change');
  await assertFails(setDoc(doc(db, `events/${pad('nope')}/invites/${inviteId(1)}`), { createdAt: serverTimestamp() }), 'no such event');
});

test('nobody else can make, read or remove those links', async () => {
  await seedEvent();
  await seedInvite(1);
  for (const db of [account('pete'), guest('gus'), stranger()]) {
    await assertFails(setDoc(doc(db, invitePath(2)), { createdAt: serverTimestamp() }));
    await assertFails(getDoc(doc(db, invitePath(1))));
    await assertFails(getDocs(query(collection(db, `events/${E}/invites`), limit(100))));
    await assertFails(deleteDoc(doc(db, invitePath(1))));
  }
  await assertFails(getDocs(query(collectionGroup(account('olga'), 'invites'), limit(10))), 'invites across all events');
});

test('a friend with an account can join with an invite, which is used up as they join', async () => {
  await seedEvent();
  await seedInvite(1);
  await assertSucceeds(join(account('henry'), 'henry'));
  await assertFails(join(account('pete'), 'pete'), 'the same invite a second time');
});

test('joining needs a real invite, used up in the same batch, before it is a week old', async () => {
  await seedEvent();
  await seedInvite(1);
  await seedInvite(2, 'ev1', { createdAt: Timestamp.fromMillis(Date.now() - 8 * 24 * 3600 * 1000) });
  await assertFails(join(account('henry'), 'henry', { n: 5, useUp: false }), 'made-up invite');
  await assertFails(join(account('henry'), 'henry', { useUp: false }), 'invite left in place');
  await assertFails(join(account('henry'), 'henry', { n: 2 }), 'expired');
  await assertFails(setDoc(doc(account('henry'), invitePath(1)), { createdAt: serverTimestamp() }), 'cannot remake an invite to reuse it');
  await assertFails(deleteDoc(doc(account('henry'), invitePath(1))), 'cannot just throw an invite away');
});

test('only a confirmed account can join, only as itself, and in the exact form', async () => {
  await seedEvent();
  await seedInvite(1);
  await assertFails(join(guest('gus'), 'gus'), 'a guest');
  await assertFails(join(unconfirmed('una'), 'una'), 'email not confirmed');
  await assertFails(join(stranger(), 'nobody'));
  await assertFails(join(account('henry'), 'pete'), 'in someone else\'s name');
  await assertFails(join(account('henry'), 'henry', { data: { uid: 'pete' } }));
  await assertFails(join(account('henry'), 'henry', { data: { name: 'x'.repeat(61) } }));
  await assertFails(join(account('henry'), 'henry', { data: { name: 7 } }));
  await assertFails(join(account('henry'), 'henry', { data: { at: Timestamp.fromDate(new Date('2020-01-01T00:00:00Z')) } }));
  await assertFails(join(account('henry'), 'henry', { data: { extra: true } }));
  await assertFails(join(account('olga'), 'olga'), 'whoever made it already runs it');
  await assertSucceeds(join(account('henry'), 'henry', { data: { name: '' } }));
});

test('someone who already runs an event cannot rewrite how they joined', async () => {
  await seedEvent();
  await seedOwner('henry');
  await seedInvite(1);
  await assertFails(join(account('henry'), 'henry'));
  await assertFails(updateDoc(doc(account('henry'), ownerPath('henry')), { name: 'Hal' }));
});

test('a friend who runs an event can see and remove answers, rename, close, reopen and delete it', async () => {
  await seedEvent();
  await seedOwner('henry');
  await seedAnswer('gus');
  const db = account('henry');
  await assertSucceeds(getDocs(query(collection(db, `events/${E}/responses`), limit(500))));
  await assertSucceeds(getDoc(doc(db, `events/${E}/responses/gus`)));
  const ref = doc(db, `events/${E}`);
  await assertSucceeds(updateDoc(ref, { title: 'Renamed', description: '', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref, { open: false, updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref, { open: true, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { ownerUid: 'henry', updatedAt: serverTimestamp() }), 'cannot take over as maker');
  await assertSucceeds(deleteDoc(doc(db, `events/${E}/responses/gus`)));
  const batch = writeBatch(db);
  batch.set(tombstone(db), stamp());
  batch.delete(ref);
  batch.delete(doc(db, ownerPath('henry')));
  await assertSucceeds(batch.commit());
});

test('a friend who runs an event can make links too, and see and remove who runs it', async () => {
  await seedEvent();
  await seedOwner('henry');
  await seedOwner('ivy');
  const db = account('henry');
  await assertSucceeds(setDoc(doc(db, invitePath(4)), { createdAt: serverTimestamp() }));
  await assertSucceeds(getDocs(query(collection(db, `events/${E}/owners`), limit(50))));
  await assertSucceeds(getDocs(query(collection(db, `events/${E}/invites`), limit(100))));
  await assertSucceeds(deleteDoc(doc(db, invitePath(4))));
  await assertSucceeds(deleteDoc(doc(account('olga'), ownerPath('ivy'))));
  await assertSucceeds(deleteDoc(doc(db, ownerPath('henry'))), 'leaving');
  await assertFails(getDocs(query(collection(db, `events/${E}/responses`), limit(500))), 'gone once they leave');
});

test('who runs an event stays private from everyone else', async () => {
  await seedEvent();
  await seedOwner('henry');
  for (const db of [account('pete'), guest('gus'), stranger()]) {
    await assertFails(getDoc(doc(db, ownerPath('henry'))));
    await assertFails(getDocs(query(collection(db, `events/${E}/owners`), limit(50))));
    await assertFails(deleteDoc(doc(db, ownerPath('henry'))));
  }
  await assertFails(getDocs(query(collection(account('olga'), `events/${E}/owners`), limit(500))), 'limit too large');
  await assertSucceeds(getDoc(doc(account('henry'), ownerPath('henry'))));
  await assertSucceeds(getDoc(doc(account('pete'), ownerPath('pete'))), 'anyone may check whether they run it');
});

test('someone can find the events they run with others, and nobody else\'s', async () => {
  await seedEvent('ev1');
  await seedEvent('ev2');
  await seedOwner('henry', 'ev1');
  await seedOwner('pete', 'ev2');
  const mine = query(collectionGroup(account('henry'), 'owners'), where('uid', '==', 'henry'), limit(100));
  await assertSucceeds(getDocs(mine));
  await assertFails(getDocs(query(collectionGroup(account('henry'), 'owners'), where('uid', '==', 'pete'), limit(100))));
  await assertFails(getDocs(query(collectionGroup(account('henry'), 'owners'), limit(100))));
  await assertFails(getDocs(query(collectionGroup(account('henry'), 'owners'), where('uid', '==', 'henry'), limit(1000))));
  await assertFails(getDocs(query(collectionGroup(stranger(), 'owners'), where('uid', '==', 'henry'), limit(100))));
});

test('events made before sharing existed keep working as they are', async () => {
  // The event document itself is unchanged by sharing, so old events need no migration.
  await seedEvent();
  await seedAnswer('gus');
  const db = account('olga');
  await assertSucceeds(getDocs(query(collection(db, `events/${E}/responses`), limit(500))));
  await assertSucceeds(updateDoc(doc(db, `events/${E}`), { open: false, updatedAt: serverTimestamp() }));
  await assertFails(getDocs(query(collection(account('henry'), `events/${E}/responses`), limit(500))));
});

test('after an event is deleted, its old links and the list of who ran it are dead', async () => {
  await seedOwner('henry', 'gone');
  await seedInvite(1, 'gone');
  await assertFails(join(account('pete'), 'pete', { eventId: 'gone' }));
  await assertFails(getDocs(query(collection(account('henry'), 'events/gone0000000000000000/responses'), limit(500))));
  await assertSucceeds(deleteDoc(doc(account('henry'), ownerPath('henry', 'gone'))), 'can still tidy up their own entry');
});

// ---------------------------------------------------------------- everything else

test('no other part of the database can be read or written', async () => {
  await assertFails(getDoc(doc(account('olga'), 'users/olga')));
  await assertFails(setDoc(doc(account('olga'), 'users/olga'), { admin: true }));
  await assertFails(setDoc(doc(account('olga'), 'events/ev100000000000000000/secrets/x'), { a: 1 }));
  await assertFails(getDocs(collection(account('olga'), 'anything')));
});
