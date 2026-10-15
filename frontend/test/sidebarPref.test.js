// The remembered fold of the sidebar. Only the failure modes need pinning: storage that is missing or
// throws must leave the menu open and working, never break the layout around it.
import test from 'node:test';
import assert from 'node:assert/strict';

import { readCollapsed, writeCollapsed } from '../src/utils/sidebarPref.js';

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
  };
}

test('a menu nobody has folded is open', () => {
  assert.equal(readCollapsed(fakeStorage()), false);
});

test('what was chosen is what comes back', () => {
  const storage = fakeStorage();
  writeCollapsed(true, storage);
  assert.equal(readCollapsed(storage), true);
  writeCollapsed(false, storage);
  assert.equal(readCollapsed(storage), false);
});

test('anything other than the saved value reads as open', () => {
  assert.equal(readCollapsed(fakeStorage({ 'chama.sidebarCollapsed': 'yes' })), false);
  assert.equal(readCollapsed(fakeStorage({ 'chama.sidebarCollapsed': '' })), false);
});

test('storage that is missing or throws never breaks the menu', () => {
  const broken = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };
  assert.equal(readCollapsed(broken), false);
  assert.doesNotThrow(() => writeCollapsed(true, broken));
  assert.equal(readCollapsed(null), false);
  assert.doesNotThrow(() => writeCollapsed(true, null));
});
