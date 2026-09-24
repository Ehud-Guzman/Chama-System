// Money out, end to end, against a real MongoDB.
//
// The unit tests check the spending report's arithmetic on plain rows. This is the half
// that only a database can answer: that recording an expense through the API actually
// moves the fund's balance and the group's total, that the roles the menu allows are the
// roles the API allows, that a loan fund is listed but not deducted, and that deleting an
// entry puts the money back while the audit trail keeps the record.
//
// It needs a scratch MongoDB and never touches the live one:
//
//   npm run test:integration                      (starts against 127.0.0.1:27017)
//   TEST_MONGO_URI=mongodb://host:27017/chama-x npm test
//
// The guard below refuses to run against a database whose name does not look like a
// scratch one.
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-long-enough-to-pass';
// The two emails a fine sends are off for this file whether or not the machine it runs on
// has a working mail configuration: nothing here settles a fine, but a suite that sends
// mail at all is one whose result depends on somebody's mailbox.
process.env.FINE_EMAILS = 'off';

const URI = process.env.TEST_MONGO_URI || '';
const skip = URI
  ? false
  : 'needs a scratch MongoDB — run npm run test:integration (see the note at the top of this file)';

const TEST_DB = 'chama-rehearsal-expenses';
const targetFor = (name) => URI.replace(/\/[^/?]*(\?|$)/, `/${name}$1`);

if (URI && !/rehearsal|scratch|test/i.test(URI)) {
  throw new Error(
    `TEST_MONGO_URI (${URI}) does not look like a scratch database — refusing to run. ` +
      'Name it with "rehearsal", "scratch" or "test" in it.'
  );
}

const app = require('../../src/app');
const ContributionType = require('../../src/models/ContributionType');
const Member = require('../../src/models/Member');
const User = require('../../src/models/User');
const AuditLog = require('../../src/models/AuditLog');
const { getOrCreateSettings, invalidateSettings } = require('../../src/utils/settings');
const { seedLedgerTypes, seedGroupFunds } = require('../../src/utils/ledgerTypes');
const { CHAI_TYPE_NAME, WEEKLY_TYPE_NAME } = require('../../src/utils/ledgerTypes');
const { fridayOf } = require('../../src/utils/weekCycle');

let server;
let base;
let tokens = {};
let chai;
let weekly;
let loanFund;

const call = (bearer, method, route, body) =>
  fetch(`${base}${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function json(res) {
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function signIn(email) {
  const res = await call(null, 'POST', '/api/auth/login', { email, password: 'rehearsal-password' });
  const body = await json(res);
  assert.equal(res.status, 200, `${email} could not sign in`);
  return body.body.token;
}

// A date the office could have written: yesterday, mid-morning, so it is never in the
// future whatever hour the suite runs at.
const YESTERDAY = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

test.before(async () => {
  if (skip) return;

  await mongoose.connect(targetFor(TEST_DB), { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.dropDatabase();

  const settings = await getOrCreateSettings();
  settings.cycleStartWeek = 92;
  settings.weeklyAmount = 1400;
  settings.chaiAmount = 100;
  settings.weekAnchorDate = fridayOf(new Date());
  await settings.save();
  invalidateSettings();

  await seedLedgerTypes();
  await seedGroupFunds();

  chai = await ContributionType.findOne({ name: CHAI_TYPE_NAME });
  weekly = await ContributionType.findOne({ name: WEEKLY_TYPE_NAME });
  // A fund whose payouts are loans: money leaves it, but it is owed back, so it must be
  // listed on the report and left out of the deduction.
  loanFund = await ContributionType.create({
    name: 'Rehearsal Welfare Loan',
    isGroupFund: true,
    tracksExpenses: true,
    isRecoverable: true,
    active: true,
  });

  await Member.create({
    name: 'Rehearsal Payer',
    phone: '0712000010',
    regNumber: 'R/010',
    openingBalance: 1400,
  });

  await User.create([
    {
      name: 'Rehearsal Treasurer',
      email: 'expenses-treasurer@example.com',
      password: await bcrypt.hash('rehearsal-password', 10),
      role: 'treasurer',
      active: true,
    },
    {
      name: 'Rehearsal Secretary',
      email: 'expenses-secretary@example.com',
      password: await bcrypt.hash('rehearsal-password', 10),
      role: 'secretary',
      active: true,
    },
  ]);

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  tokens = {
    treasurer: await signIn('expenses-treasurer@example.com'),
    secretary: await signIn('expenses-secretary@example.com'),
  };
});

test.after(async () => {
  if (skip) return;
  server?.close();
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
});

test('recording an expense moves the fund and the group total, and the money comes back', { skip }, async () => {
  if (skip) return;

  const before = await json(await call(tokens.treasurer, 'GET', '/api/expenses/summary'));
  assert.equal(before.status, 200);
  const fundBefore = before.body.funds.find((f) => f.id === String(chai._id));
  assert.ok(fundBefore, 'the Tea Fund should be offered as a fund money can be spent from');
  const heldBefore = before.body.money.netBalance;
  const fundTotalBefore = before.body.groupFund.holds;

  const created = await json(
    await call(tokens.treasurer, 'POST', '/api/expenses', {
      typeId: chai._id,
      amount: 500,
      date: YESTERDAY,
      description: 'Tea and mandazi for the meeting',
      reference: 'VOUCHER 014',
      note: 'QDE7X1LMN Confirmed. Ksh500.00 paid to MAMA GRACE SUPPLIERS.',
    })
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.expense.reference, 'VOUCHER 014');
  assert.equal(created.body.expense.loggedBy.name, 'Rehearsal Treasurer');
  const expenseId = created.body.expense._id;

  const after = await json(await call(tokens.treasurer, 'GET', '/api/expenses/summary'));
  const fundAfter = after.body.funds.find((f) => f.id === String(chai._id));

  // The ledger's own balance moved, not just the report's arithmetic.
  assert.equal(fundAfter.balance, fundBefore.balance - 500);
  assert.equal(fundAfter.spent, fundBefore.spent + 500);
  // And the group holds 500 less than it did, because spending is deducted.
  assert.equal(after.body.money.totalExpenses, before.body.money.totalExpenses + 500);
  assert.equal(after.body.money.netBalance, heldBefore - 500);
  // The group's own funds — all of them added up — are 500 lighter too, and the 500 is
  // named as spent rather than merely gone from the bottom line.
  assert.equal(after.body.groupFund.holds, fundTotalBefore - 500);
  assert.equal(after.body.groupFund.spent, before.body.groupFund.spent + 500);
  assert.equal(after.body.groupFund.onLoan, before.body.groupFund.onLoan);
  assert.equal(after.body.expenses.length, 1);
  assert.equal(after.body.expenses[0].amount, 500);
  assert.equal(after.body.expenses[0].voucher ?? after.body.expenses[0].reference, 'VOUCHER 014');

  // A correction follows the money: the deduction is the corrected figure, not the old one.
  const corrected = await json(
    await call(tokens.treasurer, 'PATCH', `/api/expenses/${expenseId}`, {
      amount: 450,
      description: 'Tea and mandazi (receipt says 450)',
    })
  );
  assert.equal(corrected.status, 200);
  const afterCorrection = await json(await call(tokens.treasurer, 'GET', '/api/expenses/summary'));
  assert.equal(afterCorrection.body.money.totalExpenses, before.body.money.totalExpenses + 450);
  assert.equal(afterCorrection.body.groupFund.holds, fundTotalBefore - 450, 'the total fund follows the correction');

  // Deleting it puts the money back and leaves the trail behind.
  const removed = await json(await call(tokens.treasurer, 'DELETE', `/api/expenses/${expenseId}`));
  assert.equal(removed.status, 200);
  const afterDelete = await json(await call(tokens.treasurer, 'GET', '/api/expenses/summary'));
  assert.equal(afterDelete.body.expenses.length, 0);
  assert.equal(afterDelete.body.money.totalExpenses, before.body.money.totalExpenses);
  assert.equal(afterDelete.body.money.netBalance, heldBefore);
  assert.equal(afterDelete.body.groupFund.holds, fundTotalBefore, 'and the fund total is whole again');

  const trail = await AuditLog.find({ entityType: 'Expense', entityId: expenseId })
    .sort({ createdAt: 1 })
    .lean();
  assert.deepEqual(
    trail.map((entry) => entry.action),
    ['create', 'update', 'delete'],
    'a money record is never erased — every step is in the audit trail'
  );
  assert.ok(
    trail.every((entry) => entry.performedBy),
    'and every step names who did it'
  );
});


test('a loan fund is listed but not deducted from the group total', { skip }, async () => {
  if (skip) return;

  const before = await json(await call(tokens.treasurer, 'GET', '/api/expenses/summary'));

  const loan = await json(
    await call(tokens.treasurer, 'POST', '/api/expenses', {
      typeId: loanFund._id,
      amount: 1000,
      date: YESTERDAY,
      description: 'Advance to a member',
    })
  );
  assert.equal(loan.status, 201, JSON.stringify(loan.body));

  const after = await json(await call(tokens.treasurer, 'GET', '/api/expenses/summary'));

  // Listed on the report, and named as money still owed back...
  assert.equal(after.body.summary.total, before.body.summary.total + 1000);
  assert.equal(after.body.summary.advances, 1000);
  const row = after.body.byFund.find((f) => f.name === loanFund.name);
  assert.equal(row.spent, 1000);
  assert.equal(row.counted, 0, 'a loan is not money gone');
  // ...and NOT taken off what the group holds.
  assert.equal(after.body.money.totalExpenses, before.body.money.totalExpenses);
  assert.equal(after.body.money.netBalance, before.body.money.netBalance);
  // The group's funds are still 1,000 lighter — the money did leave — but it is named as
  // out on loan rather than spent, which is the difference between a group that has
  // helped a member and a group that has spent its fund.
  assert.equal(after.body.groupFund.holds, before.body.groupFund.holds - 1000);
  assert.equal(after.body.groupFund.spent, before.body.groupFund.spent);
  assert.equal(after.body.groupFund.onLoan, before.body.groupFund.onLoan + 1000);
});

test('only the office may record or read spending, and only against a real fund', { skip }, async () => {
  if (skip) return;

  const secretaryRead = await json(await call(tokens.secretary, 'GET', '/api/expenses/summary'));
  assert.equal(secretaryRead.status, 403, 'a secretary has no business in the funds');

  const secretaryWrite = await json(
    await call(tokens.secretary, 'POST', '/api/expenses', { typeId: chai._id, amount: 100 })
  );
  assert.equal(secretaryWrite.status, 403);

  const anonymous = await json(await call(null, 'GET', '/api/expenses/summary'));
  assert.equal(anonymous.status, 401);

  // A weekly personal contribution is not something money is spent from.
  const wrongFund = await json(
    await call(tokens.treasurer, 'POST', '/api/expenses', {
      typeId: weekly._id,
      amount: 100,
      date: YESTERDAY,
    })
  );
  assert.equal(wrongFund.status, 400);
  assert.match(wrongFund.body.message, /does not track expenses/);

  // Tomorrow's spending is a mistyped year far more often than a real entry: refused
  // before it can land in a month that has not happened.
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const future = await json(
    await call(tokens.treasurer, 'POST', '/api/expenses', {
      typeId: chai._id,
      amount: 100,
      date: tomorrow,
    })
  );
  assert.equal(future.status, 400);
  assert.match(future.body.message, /future/);

  // A nonsense amount is refused too: this is money, and zero leaves no trace of what
  // was bought.
  const zero = await json(
    await call(tokens.treasurer, 'POST', '/api/expenses', {
      typeId: chai._id,
      amount: 0,
      date: YESTERDAY,
    })
  );
  assert.equal(zero.status, 400);
  assert.match(zero.body.message, /greater than zero/);
});

test('the spending report comes back as a PDF and as a workbook', { skip }, async () => {
  if (skip) return;

  const pdf = await call(tokens.treasurer, 'GET', '/api/expenses/export?format=pdf');
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get('content-type'), /application\/pdf/);
  const pdfBytes = Buffer.from(await pdf.arrayBuffer());
  assert.equal(pdfBytes.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.ok(pdfBytes.length > 2000, 'the report should carry its tables, not a blank page');

  const xlsx = await call(tokens.treasurer, 'GET', '/api/expenses/export?format=xlsx');
  assert.equal(xlsx.status, 200);
  assert.match(xlsx.headers.get('content-type'), /spreadsheetml/);
  const xlsxBytes = Buffer.from(await xlsx.arrayBuffer());
  // A real xlsx is a zip: 'PK'.
  assert.equal(xlsxBytes.subarray(0, 2).toString('latin1'), 'PK');

  // The same two documents are refused to a role with no business in the funds.
  const denied = await call(tokens.secretary, 'GET', '/api/expenses/export?format=pdf');
  assert.equal(denied.status, 403);
});

test('the screen\'s own list endpoint offers the funds that can be spent from', { skip }, async () => {
  if (skip) return;

  const list = await json(await call(tokens.treasurer, 'GET', '/api/expenses'));
  assert.equal(list.status, 200);
  const names = list.body.funds.map((f) => f.name);
  assert.ok(names.includes(CHAI_TYPE_NAME), 'the Tea Fund is offered');
  assert.ok(names.includes(loanFund.name), 'so is the loan fund, flagged as one');
  assert.ok(!names.includes(WEEKLY_TYPE_NAME), 'a personal weekly contribution is not spendable');

  const loan = list.body.funds.find((f) => f.name === loanFund.name);
  assert.equal(loan.isRecoverable, true);
  assert.equal(typeof loan.balance, 'number');
});

