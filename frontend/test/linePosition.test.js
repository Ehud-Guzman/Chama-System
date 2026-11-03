// Where a member stands against the group's money line: the figure the ledger screen calls "expected".
//
//   npm test        (in frontend/)
import test from 'node:test';
import assert from 'node:assert/strict';

import { linePosition } from '../src/utils/linePosition.js';

test('below the line: the distance is how far short he is', () => {
  // Week 99 on the paper ledger's own figures: 123,600 in week 98, plus 1,500.
  assert.deepEqual(linePosition({ moneyLimit: 125100, money: 93750 }), {
    line: 125100,
    held: 93750,
    distance: 31350,
    side: 'below',
  });
});

test('above the line: the distance is how far over he is, and it is never negative', () => {
  const p = linePosition({ moneyLimit: 125100, money: 195540 });
  assert.equal(p.side, 'above');
  assert.equal(p.distance, 70440);
});

test('exactly on the line counts as on it, not below', () => {
  const p = linePosition({ moneyLimit: 125100, money: 125100 });
  assert.equal(p.side, 'on');
  assert.equal(p.distance, 0);
});

test('a figure that has been through a division cannot read as a hair below the line', () => {
  const p = linePosition({ moneyLimit: 125100, money: 125099.99999999999 });
  assert.equal(p.side, 'on');
});

test('no line, nothing claimed: switched off, or no ledger at all', () => {
  assert.equal(linePosition({ moneyLimit: 0, money: 5000 }), null);
  assert.equal(linePosition({ money: 5000 }), null);
  assert.equal(linePosition(null), null);
  assert.equal(linePosition(undefined), null);
});

test('values arriving as strings are read as numbers', () => {
  const p = linePosition({ moneyLimit: '125100', money: '93750' });
  assert.equal(p.side, 'below');
  assert.equal(p.distance, 31350);
});
