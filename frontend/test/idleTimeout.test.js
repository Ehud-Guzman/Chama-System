// When an unattended session ends.
import test from 'node:test';
import assert from 'node:assert/strict';

import { idleStage, IDLE_LIMIT_MS, IDLE_WARNING_MS } from '../src/utils/idleTimeout.js';

const NOW = 1_800_000_000_000;

test('recent activity is active', () => {
  assert.deepEqual(idleStage({ lastActive: NOW - 5 * 60 * 1000, now: NOW }), { stage: 'active', secondsLeft: null });
  assert.equal(idleStage({ lastActive: NOW, now: NOW }).stage, 'active');
});

test('the last minute before the limit is a warning that counts down', () => {
  const start = NOW - (IDLE_LIMIT_MS - IDLE_WARNING_MS);
  assert.deepEqual(idleStage({ lastActive: start, now: NOW }), { stage: 'warning', secondsLeft: 60 });
  assert.equal(idleStage({ lastActive: NOW - (IDLE_LIMIT_MS - 10_000), now: NOW }).secondsLeft, 10);
  assert.equal(idleStage({ lastActive: NOW - (IDLE_LIMIT_MS - 500), now: NOW }).secondsLeft, 1, 'never shows zero while still signed in');
});

test('the limit itself, and anything past it, is expired', () => {
  assert.equal(idleStage({ lastActive: NOW - IDLE_LIMIT_MS, now: NOW }).stage, 'expired');
  assert.equal(idleStage({ lastActive: NOW - 3 * IDLE_LIMIT_MS, now: NOW }).stage, 'expired');
});

test('a value that cannot be read never signs anybody out', () => {
  for (const bad of [undefined, null, '', 'abc', 0, NaN, -5]) {
    assert.equal(idleStage({ lastActive: bad, now: NOW }).stage, 'active', String(bad));
  }
});
