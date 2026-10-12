import { test, before, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, addDoc, collection, getDocs, deleteDoc } from 'firebase/firestore';

let env;
const ADMIN = { email: 'chendoc100@gmail.com', email_verified: true };
const IMG = 'data:image/jpeg;base64,' + 'A'.repeat(100);

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-pd', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore();
    await setDoc(doc(db, 'content/slides'), { list: [{ id: 'PA0001' }] });
    await setDoc(doc(db, 'progress/bob'), { seen: ['PA0001'] });
    await setDoc(doc(db, 'users/bob'), { notes: { PA0001: 'secret' } });
    await setDoc(doc(db, 'users/bob/images/i1'), { slide: 'PA0001', data: IMG, w: 1, h: 1, at: 1 });
    await setDoc(doc(db, 'reports/r1'), { slide: 'PA0001', text: 'x', uid: 'bob', name: 'Bob', at: 1, done: false });
  });
});
after(async () => { await env.cleanup(); });

const anon = () => env.unauthenticatedContext().firestore();
const alice = () => env.authenticatedContext('alice', { email: 'alice@gmail.com', email_verified: true }).firestore();
const bob = () => env.authenticatedContext('bob', { email: 'bob@gmail.com', email_verified: true }).firestore();
const admin = () => env.authenticatedContext('kevin', ADMIN).firestore();
const fakeAdmin = () => env.authenticatedContext('mallory', { email: 'chendoc100@gmail.com', email_verified: false }).firestore();

test('signed-out visitors cannot read anything', async () => {
  await assertFails(getDoc(doc(anon(), 'content/slides')));
  await assertFails(getDoc(doc(anon(), 'progress/bob')));
  await assertFails(getDoc(doc(anon(), 'users/bob')));
  await assertFails(getDocs(collection(anon(), 'reports')));
});

test('signed-in users read the slide list but cannot change it', async () => {
  await assertSucceeds(getDoc(doc(alice(), 'content/slides')));
  await assertFails(setDoc(doc(alice(), 'content/slides'), { list: [] }));
  await assertFails(setDoc(doc(fakeAdmin(), 'content/slides'), { list: [] }));
});

test('admin can edit the slide list', async () => {
  await assertSucceeds(setDoc(doc(admin(), 'content/slides'), { list: [{ id: 'PA0001' }, { id: 'PA0002' }] }));
  await assertSucceeds(getDoc(doc(admin(), 'admin/flag')));
  await assertFails(getDoc(doc(alice(), 'admin/flag')));
});

test('users cannot see or touch other users’ data', async () => {
  await assertFails(getDoc(doc(alice(), 'progress/bob')));
  await assertFails(setDoc(doc(alice(), 'progress/bob'), { seen: [] }));
  await assertFails(getDoc(doc(alice(), 'users/bob')));
  await assertFails(updateDoc(doc(alice(), 'users/bob'), { notes: {} }));
  await assertFails(getDoc(doc(alice(), 'users/bob/images/i1')));
  await assertFails(getDocs(collection(alice(), 'users/bob/images')));
  await assertFails(deleteDoc(doc(alice(), 'users/bob/images/i1')));
  await assertFails(getDocs(collection(alice(), 'progress')));
  await assertFails(getDocs(collection(alice(), 'users')));
  // even the admin cannot read classmates' personal data
  await assertFails(getDoc(doc(admin(), 'users/bob')));
  await assertFails(getDoc(doc(admin(), 'progress/bob')));
});

test('users manage their own data', async () => {
  await assertSucceeds(setDoc(doc(alice(), 'progress/alice'), { seen: ['PA0001'] }));
  await assertSucceeds(setDoc(doc(alice(), 'users/alice'), { notes: { PA0001: 'hi' } }));
  await assertSucceeds(addDoc(collection(alice(), 'users/alice/images'), { slide: 'PA0001', data: IMG, w: 1, h: 1, at: 1 }));
  await assertFails(addDoc(collection(alice(), 'users/alice/images'), { slide: 'PA0001', data: 'javascript:alert(1)', w: 1, h: 1, at: 1 }));
  await assertFails(addDoc(collection(alice(), 'users/alice/images'), { slide: 'PA0001', data: IMG, w: 1, h: 1, at: 1, extra: 1 }));
});

test('reports: create as yourself only; only admin reads', async () => {
  const ok = { slide: 'PA0001', text: 'typo', uid: 'alice', name: 'Alice', at: 1, done: false };
  await assertSucceeds(addDoc(collection(alice(), 'reports'), ok));
  await assertFails(addDoc(collection(alice(), 'reports'), { ...ok, uid: 'bob' }));
  await assertFails(addDoc(collection(alice(), 'reports'), { ...ok, done: true }));
  await assertFails(addDoc(collection(alice(), 'reports'), { ...ok, text: 'x'.repeat(1501) }));
  await assertFails(getDoc(doc(alice(), 'reports/r1')));
  await assertFails(getDocs(collection(bob(), 'reports')));
  await assertSucceeds(getDocs(collection(admin(), 'reports')));
  await assertSucceeds(updateDoc(doc(admin(), 'reports/r1'), { done: true }));
});
