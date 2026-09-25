// The block at the top of a member's passbook: what he holds, and whether he is behind.
//
// This is where a false statement would live. "Money held" and "paid in his own name" are different
// figures, and the passbook shows the second only when the cycle engine has no answer for him — so
// the label has to change with the figure, or a member reads a lifetime sum of his rows as the money
// the group is holding for him.
import test from 'node:test';
import assert from 'node:assert/strict';

import { passbookPosition } from '../src/utils/passbookPosition.js';

const LEDGER = {
  currentWeek: 94,
  cycleStartWeek: 92,
  openingBalance: 5000,
  paid: 4200,
  required: 2800,
  tea: 200,
  money: 6200,
  arrears: 0,
  weeksBehind: 0,
};

test('the figure on top is the money held, and the sum behind it is spelled out', () => {
  const position = passbookPosition(LEDGER, 999);

  assert.equal(position.label, 'Money held · week 94');
  assert.equal(position.held, 6200);
  assert.equal(
    position.identity,
    'Ksh 5,000 carried in + Ksh 4,200 paid in since week 92 − Ksh 3,000 due so far '
      + '(weekly contributions and tea)'
  );
  // The fallback is ignored whenever the cycle engine answered: it is a different question.
  assert.notEqual(position.held, 999);
});

test('a member who is up to date is said to be, not left blank', () => {
  const position = passbookPosition(LEDGER);
  assert.equal(position.upToDate, true);
  assert.equal(position.arrears, 0);
  assert.equal(position.arrearsText, null, 'nothing owing means nothing to warn about');
});

test('arrears carry how far back they go, and one week is not "1 weeks"', () => {
  const oneWeek = passbookPosition({ ...LEDGER, arrears: 1400, weeksBehind: 1, money: 4800 });
  assert.equal(oneWeek.arrearsText, 'Ksh 1,400 owed (1 week behind)');
  assert.equal(oneWeek.upToDate, false);
  assert.equal(oneWeek.held, 4800, 'arrears do not change what he holds — the engine already netted them');

  const threeWeeks = passbookPosition({ ...LEDGER, arrears: 4200, weeksBehind: 3 });
  assert.equal(threeWeeks.arrearsText, 'Ksh 4,200 owed (3 weeks behind)');
});

test('money owed with no week count still says what is owed', () => {
  // The engine can know there is money outstanding without being able to count closed weeks (a
  // member whose tracking starts mid-cycle), and a bare "owed" is better than a wrong "0 weeks".
  const position = passbookPosition({ ...LEDGER, arrears: 700, weeksBehind: 0 });
  assert.equal(position.arrearsText, 'Ksh 700 owed');
});

test('with no ledger the card says what the figure really is', () => {
  const position = passbookPosition(null, 3400);

  assert.equal(position.label, 'Paid in his own name');
  assert.equal(position.held, 3400);
  assert.equal(position.identity, null, 'there is no carried-in/paid-in story to tell');
  // Nothing is claimed about arrears the engine never answered for.
  assert.equal(position.upToDate, false);
  assert.equal(position.arrearsText, null);
});

test('a missing or unreadable fallback is a zero, never "Ksh NaN"', () => {
  assert.equal(passbookPosition(null, undefined).held, 0);
  assert.equal(passbookPosition(null, 'nonsense').held, 0);
  assert.equal(passbookPosition(null, '1400').held, 1400);
});
