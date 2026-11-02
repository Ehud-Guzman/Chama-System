// When the "waking the system up" notice appears: only for a request that has waited, and never for a fast one.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createSlowTracker, SLOW_AFTER_MS } from '../src/services/slowRequests.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('the notice waits several seconds before it can appear', () => {
  assert.ok(SLOW_AFTER_MS >= 5000, 'a normal load must never flash it');
});

test('a request that settles quickly never shows the notice', async () => {
  const tracker = createSlowTracker(40);
  const seen = [];
  tracker.subscribe(() => seen.push(tracker.isSlow()));
  const end = tracker.begin();
  await sleep(10);
  end();
  await sleep(60);
  assert.equal(tracker.isSlow(), false);
  assert.deepEqual(seen, [], 'nobody was told anything');
});

test('a request that waits shows it, and it goes when that request settles', async () => {
  const tracker = createSlowTracker(30);
  const seen = [];
  tracker.subscribe(() => seen.push(tracker.isSlow()));
  const end = tracker.begin();
  await sleep(60);
  assert.equal(tracker.isSlow(), true);
  end();
  assert.equal(tracker.isSlow(), false);
  assert.deepEqual(seen, [true, false]);
});

test('with several waiting, it stays until the last one is done, and listeners hear each change only once', async () => {
  const tracker = createSlowTracker(30);
  const seen = [];
  tracker.subscribe(() => seen.push(tracker.isSlow()));
  const first = tracker.begin();
  const second = tracker.begin();
  await sleep(60);
  first();
  assert.equal(tracker.isSlow(), true, 'one is still waiting');
  second();
  assert.equal(tracker.isSlow(), false);
  assert.deepEqual(seen, [true, false]);
});

test('ending a request twice, or after unsubscribing, is harmless', async () => {
  const tracker = createSlowTracker(20);
  let calls = 0;
  const off = tracker.subscribe(() => (calls += 1));
  const end = tracker.begin();
  off();
  await sleep(50);
  end();
  end();
  assert.equal(calls, 0);
  assert.equal(tracker.isSlow(), false);
});
