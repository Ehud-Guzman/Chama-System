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
  // Only money that actually came in is subtracted: the tea the group took. The weeks that closed
  // (2,800 of them) are what he was expected to pay, not something taken off the figure — they ride
  // on the "owed" line, or nowhere at all when his payments covered them.
  assert.equal(
    position.identity,
    'Ksh 5,000 carried in + Ksh 4,200 paid in since week 92 − Ksh 200 tea deducted (Group fund)'
  );
  // The fallback is ignored whenever the cycle engine answered: it is a different question.
  assert.notEqual(position.held, 999);
});

test('the figure the older statements printed is carried, so the two reconcile', () => {
  // Held less every week that has closed: what this member's figure read while the expectation was
  // still being netted out of it (identical to `ledger.moneyNetOfDues` on the server).
  const position = passbookPosition({ ...LEDGER, moneyNetOfDues: 3400 });
  assert.equal(position.netOfDues, 3400);
  assert.equal(position.held - position.netOfDues, LEDGER.required);

  // With no ledger there is no such figure, and nothing is claimed about one.
  assert.equal(passbookPosition(null, 3400).netOfDues, null);
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
  assert.equal(
    oneWeek.held,
    4800,
    'arrears never change what he holds: a week nobody paid is owed, not money that moved'
  );

  const threeWeeks = passbookPosition({ ...LEDGER, arrears: 4200, weeksBehind: 3 });
  assert.equal(threeWeeks.arrearsText, 'Ksh 4,200 owed (3 weeks behind)');
  assert.equal(threeWeeks.held, LEDGER.money, 'and the figure at the top is untouched by them');
});

test('money owed with no week count still says what is owed', () => {
  // The engine can know there is money outstanding without being able to count closed weeks (a
  // member whose tracking starts mid-cycle), and a bare "owed" is better than a wrong "0 weeks".
  const position = passbookPosition({ ...LEDGER, arrears: 700, weeksBehind: 0 });
  assert.equal(position.arrearsText, 'Ksh 700 owed');
});

test('a member above the group\'s line is not told he is behind', () => {
  // Holding 198,840 against a line of 117,400: he missed a closed week and the money is still
  // uncollected, but the group does not chase him, so the card says so in the calm tone — and the
  // amount is still named, so nobody thinks the week vanished.
  const position = passbookPosition({
    ...LEDGER,
    money: 198840,
    arrears: 1400,
    weeksBehind: 1,
    moneyLimit: 117400,
    coveredByBalance: true,
    chasedArrears: 0,
    chasedWeeksBehind: 0,
  });

  assert.equal(position.arrearsText, null, 'nothing is being asked of him');
  assert.equal(position.upToDate, true);
  assert.equal(
    position.aheadText,
    'Ahead of the cycle — Ksh 1,400 of a closed week is not collected yet, and nothing is being '
      + 'asked of you.'
  );
  assert.equal(position.held, 198840);
  assert.equal(position.arrears, 1400, 'the plain record is still on the payload');
  assert.equal(position.chasedWeeksBehind, 0);
  assert.equal(position.moneyLimit, 117400);
});

test('below the line the card reads exactly as it did before the line existed', () => {
  // An older payload (no chased figures) has to behave like the plain record, and a member under
  // the line must never be let off: this is the safe direction for the fallback to fail in.
  const legacy = passbookPosition({ ...LEDGER, arrears: 1400, weeksBehind: 1 });
  assert.equal(legacy.arrearsText, 'Ksh 1,400 owed (1 week behind)');
  assert.equal(legacy.aheadText, null);

  const chased = passbookPosition({
    ...LEDGER,
    arrears: 1400,
    weeksBehind: 1,
    chasedArrears: 1400,
    chasedWeeksBehind: 1,
  });
  assert.equal(chased.arrearsText, 'Ksh 1,400 owed (1 week behind)');
  assert.equal(chased.aheadText, null);
  assert.equal(chased.upToDate, false);
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
