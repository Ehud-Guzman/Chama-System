// "Date cannot be in the future" has to mean the group's today, not the server's.
//
// The server keeps UTC and the group keeps East Africa Time, three hours ahead, so between midnight
// and 3am EAT the two disagree about what day it is. The screens offer today's date as the latest
// choice; the server used to refuse it for those three hours.
const test = require('node:test');
const assert = require('node:assert/strict');

const { isAfterToday } = require('../src/utils/futureDate');

// 01:00 on 16 October in Nairobi is still 22:00 on the 15th in UTC.
const ONE_AM_EAT = Date.parse('2026-10-15T22:00:00Z');

test('between midnight and 3am EAT, today is still today', () => {
  // The date input sends a bare date, which reaches the server as that day at UTC midnight.
  assert.equal(isAfterToday('2026-10-16', ONE_AM_EAT), false);
  assert.equal(isAfterToday(new Date('2026-10-16'), ONE_AM_EAT), false);
});

test('tomorrow is the future, at any hour', () => {
  assert.equal(isAfterToday('2026-10-17', ONE_AM_EAT), true);
  assert.equal(isAfterToday('2026-10-17', Date.parse('2026-10-16T20:59:00Z')), true); // 23:59 EAT
});

test('yesterday and earlier are never the future', () => {
  assert.equal(isAfterToday('2026-10-15', ONE_AM_EAT), false);
  assert.equal(isAfterToday('2025-01-01', ONE_AM_EAT), false);
});

test('midday is midday', () => {
  const noon = Date.parse('2026-10-16T09:00:00Z');
  assert.equal(isAfterToday('2026-10-16', noon), false);
  assert.equal(isAfterToday('2026-10-17', noon), true);
});

test('something that is not a date is not the future (the caller rejects it as invalid)', () => {
  assert.equal(isAfterToday('not a date', ONE_AM_EAT), false);
});
