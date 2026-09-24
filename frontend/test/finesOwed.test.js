// The logic behind the "who owes what" list.
//
// This is where a false statement would live: a member missing from the list because the
// search was too literal, or a heading that says twelve members owe when nineteen do.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  matchesOwedTerm,
  owedSummary,
  owingOnly,
  searchOwed,
  sortOwed,
} from '../src/utils/finesOwed.js';

const rows = [
  {
    memberId: 'a',
    name: 'Alice Wanjiru',
    regNumber: 'WM-0001',
    phone: '0712345678',
    outstanding: 500,
    fines: 1,
    oldestUnpaid: '2026-03-12T00:00:00.000Z',
  },
  {
    memberId: 'b',
    name: 'Brian Otieno',
    regNumber: 'WM-0002',
    phone: '0722000111',
    outstanding: 2500,
    fines: 3,
    oldestUnpaid: '2026-01-05T00:00:00.000Z',
  },
  {
    memberId: 'c',
    name: 'Cleared Member',
    regNumber: 'WM-0003',
    phone: '0733000222',
    outstanding: 0,
    fines: 2,
    oldestUnpaid: null,
  },
];

test('the list carries the members who owe, not everyone who was ever fined', () => {
  const owing = owingOnly(rows);
  assert.equal(owing.length, 2);
  assert.deepEqual(owing.map((r) => r.name), ['Alice Wanjiru', 'Brian Otieno']);
});

test('most owed is the default order, because that is the list a meeting works down', () => {
  assert.deepEqual(sortOwed(rows, 'outstanding').map((r) => r.memberId), ['b', 'a', 'c']);
  assert.deepEqual(sortOwed(rows, 'fines').map((r) => r.memberId), ['b', 'c', 'a']);
  assert.deepEqual(sortOwed(rows, 'name').map((r) => r.memberId), ['a', 'b', 'c']);
});

test('Longest owing puts the oldest debt first and the undated last', () => {
  assert.deepEqual(sortOwed(rows, 'oldest').map((r) => r.memberId), ['b', 'a', 'c']);
});

test('a search finds a member by name, reg number or phone', () => {
  assert.ok(matchesOwedTerm(rows[0], 'alice'));
  assert.ok(matchesOwedTerm(rows[0], 'WANJIRU'));
  assert.ok(matchesOwedTerm(rows[1], 'WM-0002'));
  assert.ok(matchesOwedTerm(rows[1], '0722000111'));
  assert.equal(matchesOwedTerm(rows[1], 'Grace'), false);
});

test('a phone number finds the member however it was typed', () => {
  // The office types what is in front of it: a space after the fourth digit, a leading
  // zero, or the country code. All three are the same phone.
  for (const typed of ['0722 000 111', '0722000111', '+254 722 000 111', '254722000111', '722000111']) {
    assert.ok(matchesOwedTerm(rows[1], typed), typed);
  }
  // …and it does not match a different number that merely shares a prefix.
  assert.equal(matchesOwedTerm(rows[1], '0722000112'), false);
  assert.equal(matchesOwedTerm(rows[1], '0712345'), false);
});

test('a fragment is matched as text, and the tail rule is what adds the formatted number', () => {
  // Three digits is a substring search like any other: it finds the rows that contain
  // them, and typing more is the office's job. The phone-tail rule exists for the
  // formatted number — a search that plain substring matching would miss.
  assert.ok(matchesOwedTerm(rows[1], '722'));
  assert.ok(matchesOwedTerm(rows[1], 'Otien'));
  // Nothing in this row contains "555", so it finds nothing — the point being that a
  // short fragment does not quietly match every member.
  assert.equal(matchesOwedTerm(rows[1], '555'), false);
});

test('searching and sorting compose, and clearing the box brings everyone back', () => {
  assert.deepEqual(searchOwed(rows, 'otieno', 'outstanding').map((r) => r.memberId), ['b']);
  assert.deepEqual(searchOwed(rows, '   ', 'outstanding').map((r) => r.memberId), ['b', 'a']);
  assert.deepEqual(searchOwed(rows, 'nobody here', 'outstanding'), []);
});

test('the count and the total describe the members who owe, nothing else', () => {
  const summary = owedSummary(rows);
  assert.equal(summary.members, 2);
  assert.equal(summary.fines, 4);
  assert.equal(summary.total, 3000);
  assert.equal(summary.oldest.toISOString(), '2026-01-05T00:00:00.000Z');
});

test('a group with no debts summarises to nothing rather than NaN', () => {
  const summary = owedSummary([rows[2]]);
  assert.deepEqual(summary, { members: 0, fines: 0, total: 0, oldest: null });
});
