// What the "print a report" screen sends to the server.
//
// The part worth pinning is who is offered the spending section and what a ticked set turns into:
// a secretary must never be sent to ask for vouchers, and the same ticks must always make the same
// request.
import test from 'node:test';
import assert from 'node:assert/strict';

import { PRINT_SECTIONS, EXPENSE_PERIODS, printQuery, sectionsFor } from '../src/utils/printReport.js';

const ALL = PRINT_SECTIONS.map((s) => s.key);

test('the menu lists the sections in the order the page prints them', () => {
  assert.deepEqual(ALL, ['position', 'week', 'debts', 'extra', 'fines', 'expenses']);
});

test('the people who keep the books are offered the spending; the secretary is not', () => {
  for (const role of ['super_admin', 'admin', 'treasurer']) {
    assert.ok(sectionsFor(role).some((s) => s.key === 'expenses'), `${role} may print spending`);
  }
  const secretary = sectionsFor('secretary').map((s) => s.key);
  assert.deepEqual(secretary, ['position', 'week', 'debts', 'extra', 'fines']);
  // An unknown role gets the open sections only, never the restricted one.
  assert.ok(!sectionsFor(undefined).some((s) => s.key === 'expenses'));
});

test('a ticked set becomes one request, in print order, whatever order it was ticked in', () => {
  assert.deepEqual(printQuery(['fines', 'debts'], 'week', 'treasurer'), { sections: 'debts,fines' });
  assert.deepEqual(printQuery(new Set(['extra', 'position']), 'week', 'admin'), {
    sections: 'position,extra',
  });
});

test('the expenses period travels only with the expenses section', () => {
  assert.deepEqual(printQuery(['fines', 'expenses'], 'month', 'treasurer'), {
    sections: 'fines,expenses',
    expenses: 'month',
  });
  assert.deepEqual(printQuery(['fines'], 'month', 'treasurer'), { sections: 'fines' });
  // A period the server does not know is never sent; it asks for the week instead.
  assert.equal(printQuery(['expenses'], 'fortnight', 'admin').expenses, 'week');
  assert.deepEqual(
    EXPENSE_PERIODS.map((p) => p.value),
    ['week', 'month', 'all']
  );
});

test('a secretary who somehow has the spending ticked does not send it', () => {
  assert.deepEqual(printQuery(['debts', 'expenses'], 'all', 'secretary'), { sections: 'debts' });
  assert.equal(printQuery(['expenses'], 'all', 'secretary'), null, 'and with nothing else, nothing is sent');
});

test('nothing ticked, or nothing recognised, is no request at all', () => {
  assert.equal(printQuery([], 'week', 'admin'), null);
  assert.equal(printQuery(['loans'], 'week', 'admin'), null);
});
