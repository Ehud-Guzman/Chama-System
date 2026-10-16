// Paying a fine, end to end: does it come off the person?
//
// A fine marked paid used to lower what the member owed and do nothing else, so a member whose fine
// was taken "from his money" still showed all of it, and nothing recorded whether the money had been
// his or handed over on the side. These pin the behaviour that replaced it, against a real MongoDB:
//
//   * a payment must say how it was made — out of his balance, or in cash;
//   * out of his balance comes off what the group holds for him, never more than he holds;
//   * in cash leaves his balance alone;
//   * a payment redirected out of a contribution comes off his balance too;
//   * a payment keyed in by mistake can be taken back, and voiding a fine gives its money back;
//   * payments recorded before the system asked are listed, and move nothing until somebody says.
//
//   npm run test:integration
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-long-enough-to-pass';
// The rehearsal never sends mail, whatever the machine it runs on has configured.
process.env.FINE_EMAILS = 'off';

const URI = process.env.TEST_MONGO_URI || '';
const skip = URI
  ? false
  : 'needs a scratch MongoDB — run npm run test:integration (see the note at the top of this file)';

const TEST_DB = 'chama-rehearsal-finepayments';
const targetFor = (name) => URI.replace(/\/[^/?]*(\?|$)/, `/${name}$1`);

if (URI && !/rehearsal|scratch|test/i.test(URI)) {
  throw new Error(
    `TEST_MONGO_URI (${URI}) does not look like a scratch database — refusing to run. ` +
      'Name it with "rehearsal", "scratch" or "test" in it.'
  );
}

const app = require('../../src/app');
const User = require('../../src/models/User');
const Member = require('../../src/models/Member');
const Fine = require('../../src/models/Fine');
const AuditLog = require('../../src/models/AuditLog');
const FineType = require('../../src/models/FineType');
const { getOrCreateSettings, invalidateSettings } = require('../../src/utils/settings');
const { seedLedgerTypes, seedGroupFunds } = require('../../src/utils/ledgerTypes');
const { totalFinesCollected } = require('../../src/utils/finesCollected');
const { fridayOf } = require('../../src/utils/weekCycle');

let server;
let base;
let token;
let fineType;
let adminId;

const api = (method, route, body, auth = token) =>
  fetch(`${base}${route}`, {
    method,
    headers: {
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

async function call(method, route, body, auth) {
  const res = await api(method, route, body, auth);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

let counter = 0;
// A member who holds `opening` and owes the fines given, oldest first.
async function member(opening, fines = []) {
  counter += 1;
  const m = await Member.create({
    name: `Payer ${counter}`,
    phone: `07100000${String(counter).padStart(2, '0')}`,
    regNumber: `FP/${String(counter).padStart(3, '0')}`,
    openingBalance: opening,
  });
  const made = [];
  for (const [index, amount] of fines.entries()) {
    made.push(
      await Fine.create({
        memberId: m._id,
        typeId: fineType._id,
        amount,
        remaining: amount,
        reason: `Fine ${index + 1}`,
        // Oldest first, a month apart, all in the past so any payment date is after them.
        date: new Date(Date.UTC(2026, index, 1)),
        issuedBy: adminId,
      })
    );
  }
  return { m, fines: made };
}

const held = async (m) => (await call('GET', `/api/ledger/members/${m._id}`)).body.ledger.money;
const pay = (m, body) => call('POST', `/api/fines/member/${m._id}/pay`, body);

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

  const admin = await User.create({
    name: 'Rehearsal Admin',
    email: 'fine-payments@example.com',
    password: await bcrypt.hash('rehearsal-password', 10),
    role: 'super_admin',
    active: true,
  });
  adminId = admin._id;
  fineType = await FineType.create({ name: 'Late arrival', category: 'financial', defaultAmount: 500 });

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const login = await call('POST', '/api/auth/login', {
    email: 'fine-payments@example.com',
    password: 'rehearsal-password',
  });
  assert.equal(login.status, 200, 'the rehearsal admin could not sign in');
  token = login.body.token;
});

test.after(async () => {
  if (skip) return;
  server?.close();
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
});

test('a payment that does not say how it was made is refused, and nothing moves', { skip }, async () => {
  const { m, fines } = await member(5000, [500]);

  const bare = await call('POST', `/api/fines/${fines[0]._id}/settle`, { amount: 100 });
  assert.equal(bare.status, 400);
  assert.match(bare.body.message, /Say how this was paid/);

  const unknown = await pay(m, { source: 'mpesa-magic' });
  assert.equal(unknown.status, 400);
  assert.equal((await pay(m, {})).status, 400);

  assert.equal((await Fine.findById(fines[0]._id).lean()).remaining, 500);
  assert.equal(await held(m), 5000);
});

test('a fine taken from his balance comes off what he holds, and the working still adds up', { skip }, async () => {
  const { m, fines } = await member(5000, [500]);

  const paid = await call('POST', `/api/fines/${fines[0]._id}/settle`, { amount: 300, source: 'balance' });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.fine.remaining, 200);
  assert.deepEqual(paid.body.held, { before: 5000, after: 4700 });

  assert.equal(await held(m), 4700, 'his balance went down by exactly what was taken');
  const stored = await Member.findById(m._id).lean();
  assert.equal(stored.fineDebits.length, 1);
  assert.equal(stored.fineDebits[0].amount, 300);
  assert.equal(String(stored.fineDebits[0].fineId), String(fines[0]._id));

  // The same figure on his own record, and the working behind it agrees with the figure.
  const record = await call('GET', `/api/members/${m._id}`);
  assert.equal(record.body.ledger.money, 4700);
  assert.equal(record.body.ledger.finesPaid, 300);
  assert.equal(record.body.walk.balanced, true);
  assert.equal(record.body.walk.closing.held, 4700);
  assert.equal(record.body.walk.totals.finesOff, 300);

  const ledgerPage = await call('GET', `/api/ledger/members/${m._id}`);
  assert.equal(ledgerPage.body.walk.balanced, true);
  assert.equal(ledgerPage.body.walk.closing.finesOwed, 200);

  // The money was already in the group's hands, so it is not new cash.
  const settlement = (await Fine.findById(fines[0]._id).lean()).settlements[0];
  assert.equal(settlement.source, 'balance');
  assert.equal(String(settlement.recordedBy), String(adminId));
});

test('a fine paid in cash on the side leaves his balance alone, and is new cash for the group', { skip }, async () => {
  const before = await totalFinesCollected();
  const { m, fines } = await member(5000, [500]);

  const paid = await call('POST', `/api/fines/${fines[0]._id}/settle`, { amount: 500, source: 'cash' });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.fine.remaining, 0);
  assert.equal(paid.body.held, null, 'a cash payment says nothing about his balance');

  assert.equal(await held(m), 5000);
  assert.equal((await Member.findById(m._id).lean()).fineDebits.length, 0);
  assert.equal((await totalFinesCollected()) - before, 500);
});

test('from his balance it takes no more than he holds: the oldest fines first, the rest stay owed', { skip }, async () => {
  const { m, fines } = await member(700, [500, 300, 100]);

  const paid = await pay(m, { source: 'balance' });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.totalApplied, 700);
  assert.deepEqual(
    paid.body.fines.map((f) => [f.paid, f.remaining]),
    [
      [500, 0],
      [200, 100],
    ],
    'the oldest is cleared, the next is part paid, and the newest is not reached'
  );
  assert.equal(await held(m), 0);
  assert.equal((await Fine.findById(fines[2]._id).lean()).remaining, 100);

  // Cash settles what is left.
  const rest = await pay(m, { source: 'cash' });
  assert.equal(rest.status, 200, JSON.stringify(rest.body));
  assert.equal(rest.body.totalApplied, 200);
  assert.equal(await held(m), 0);

  // And a member who holds nothing cannot have anything taken at all.
  const broke = await member(0, [100]);
  const none = await pay(broke.m, { source: 'balance' });
  assert.equal(none.status, 400);
  assert.match(none.body.message, /holds nothing/);
  assert.equal((await Fine.findById(broke.fines[0]._id).lean()).remaining, 100);
});

test('Pay clears every fine at once, and each fine records its own payment', { skip }, async () => {
  const { m, fines } = await member(5000, [300, 500, 100]);

  const paid = await pay(m, { source: 'balance' });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.totalApplied, 900);
  assert.deepEqual(paid.body.held, { before: 5000, after: 4100 });
  assert.deepEqual(
    paid.body.fines.map((f) => [f.paid, f.remaining]),
    [
      [300, 0],
      [500, 0],
      [100, 0],
    ],
    'every fine is reported as paid, oldest first'
  );

  for (const [i, expected] of [300, 500, 100].entries()) {
    const stored = await Fine.findById(fines[i]._id).lean();
    assert.equal(stored.remaining, 0);
    assert.equal(stored.settlements.length, 1, 'one payment on each fine');
    assert.equal(stored.settlements[0].amount, expected);
    assert.equal(stored.settlements[0].source, 'balance');
  }
  const debits = (await Member.findById(m._id).lean()).fineDebits;
  assert.deepEqual(debits.map((d) => d.amount).sort((a, b) => a - b), [100, 300, 500], 'one entry per fine');
  assert.equal(await held(m), 4100);

  const record = await call('GET', `/api/members/${m._id}`);
  assert.equal(record.body.walk.balanced, true);
  assert.equal(record.body.walk.totals.finesOff, 900);

  // Nothing is left to pay.
  const again = await pay(m, { source: 'balance' });
  assert.equal(again.status, 400);
  assert.match(again.body.message, /owes no fines/);

  // One fine's payment can still be taken back on its own, returning just its share.
  const undone = await call('POST', `/api/fines/${fines[1]._id}/payments/0/undo`, { amount: 500 });
  assert.equal(undone.status, 200, JSON.stringify(undone.body));
  assert.equal(undone.body.returnedToBalance, 500);
  assert.equal(await held(m), 4600);
  assert.equal((await Fine.findById(fines[0]._id).lean()).remaining, 0, 'the others stay paid');
});

test('a payment dated before a fine was issued leaves that fine owed', { skip }, async () => {
  const { m, fines } = await member(5000, [300, 200, 100]); // issued 1 Jan, 1 Feb, 1 Mar 2026

  const paid = await pay(m, { source: 'cash', date: '2026-02-10' });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.totalApplied, 500, 'only the two fines that existed on that day');
  assert.equal((await Fine.findById(fines[2]._id).lean()).remaining, 100);

  const tooEarly = await pay(m, { source: 'cash', date: '2025-12-01' });
  assert.equal(tooEarly.status, 400);
  assert.match(tooEarly.body.message, /before it was issued/);
});

test('the audit trail names the share of his balance each fine took', { skip }, async () => {
  const { m, fines } = await member(1000, [300, 200]);
  assert.equal((await pay(m, { source: 'balance' })).status, 200);

  const entries = await AuditLog.find({ entityType: 'Fine', entityId: { $in: fines.map((f) => f._id) }, action: 'update' })
    .sort({ createdAt: 1 })
    .lean();
  const trail = entries.map((e) => e.after.paidFromBalance).filter(Boolean);
  assert.deepEqual(
    trail.map((t) => [t.amount, t.heldBefore, t.heldAfter]),
    [
      [300, 1000, 700],
      [200, 700, 500],
    ]
  );
});

test('Pay in cash clears every fine and leaves his balance alone', { skip }, async () => {
  const before = await totalFinesCollected();
  const { m, fines } = await member(100, [300, 200]);

  const paid = await pay(m, { source: 'cash' });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.totalApplied, 500);
  assert.equal(paid.body.held, null);
  assert.equal(await held(m), 100);
  assert.equal((await Member.findById(m._id).lean()).fineDebits.length, 0);
  assert.equal((await totalFinesCollected()) - before, 500);
  assert.equal((await Fine.findById(fines[1]._id).lean()).remaining, 0);
});

test('a payment keyed in by mistake can be taken back, and the money goes back to him', { skip }, async () => {
  const { m, fines } = await member(5000, [500]);
  await call('POST', `/api/fines/${fines[0]._id}/settle`, { amount: 300, source: 'balance' });
  await call('POST', `/api/fines/${fines[0]._id}/settle`, { amount: 100, source: 'cash' });
  assert.equal(await held(m), 4700);

  // A stale screen naming the wrong amount is turned away rather than undoing something else.
  const stale = await call('POST', `/api/fines/${fines[0]._id}/payments/0/undo`, { amount: 999 });
  assert.equal(stale.status, 409);

  const undone = await call('POST', `/api/fines/${fines[0]._id}/payments/0/undo`, { amount: 300 });
  assert.equal(undone.status, 200, JSON.stringify(undone.body));
  assert.equal(undone.body.returnedToBalance, 300);
  assert.equal(undone.body.fine.remaining, 400);
  assert.equal(undone.body.fine.payments.length, 1);
  assert.equal(await held(m), 5000, 'the 300 is his again');
  assert.equal((await Member.findById(m._id).lean()).fineDebits.length, 0);

  // A cash payment taken back gives nothing to his balance, because it never came out of it.
  const cash = await call('POST', `/api/fines/${fines[0]._id}/payments/0/undo`, { amount: 100 });
  assert.equal(cash.status, 200);
  assert.equal(cash.body.returnedToBalance, 0);
  assert.equal(cash.body.fine.remaining, 500);
  assert.equal(await held(m), 5000);
});

test('voiding a fine that was paid from his balance gives the money back', { skip }, async () => {
  const { m, fines } = await member(5000, [500]);
  await call('POST', `/api/fines/${fines[0]._id}/settle`, { amount: 250, source: 'balance' });
  await call('POST', `/api/fines/${fines[0]._id}/settle`, { amount: 100, source: 'cash' });
  assert.equal(await held(m), 4750);

  const voided = await call('DELETE', `/api/fines/${fines[0]._id}`);
  assert.equal(voided.status, 200, JSON.stringify(voided.body));
  assert.equal(voided.body.returnedToBalance, 250);
  assert.equal(voided.body.cashReceived, 100, 'cash he handed over is reported, not silently kept or lost');
  assert.equal(await held(m), 5000);
  assert.equal((await Member.findById(m._id).lean()).fineDebits.length, 0);

  assert.equal((await call('DELETE', `/api/fines/${fines[0]._id}`)).status, 404, 'a voided fine cannot be voided again');
});

test('payments recorded before the system asked are listed, and move nothing until somebody says', { skip }, async () => {
  const { m, fines } = await member(5000, [500, 300]);
  // The shape every earlier manual payment has: no `source` at all.
  await Fine.updateOne(
    { _id: fines[0]._id },
    { $set: { remaining: 100 }, $push: { settlements: { contributionId: null, amount: 400, date: new Date('2026-05-01') } } }
  );
  await Fine.updateOne(
    { _id: fines[1]._id },
    { $set: { remaining: 0 }, $push: { settlements: { contributionId: null, amount: 300, date: new Date('2026-05-02') } } }
  );

  const listed = await call('GET', '/api/fines/payments/to-check');
  assert.equal(listed.status, 200);
  const mine = listed.body.payments.filter((p) => String(p.memberId) === String(m._id));
  assert.deepEqual(
    mine.map((p) => [p.amount, p.index]),
    [
      [400, 0],
      [300, 0],
    ]
  );
  assert.equal(await held(m), 5000, 'until somebody says, nothing moves');

  const done = await call('POST', '/api/fines/payments/check', {
    items: [
      { fineId: String(fines[0]._id), index: 0, amount: 400, source: 'balance' },
      { fineId: String(fines[1]._id), index: 0, amount: 300, source: 'cash' },
    ],
  });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.done, 2);
  assert.deepEqual(done.body.failed, []);
  assert.equal(await held(m), 4600, 'only the one taken from his balance moved it, dated the day it was paid');
  const debit = (await Member.findById(m._id).lean()).fineDebits[0];
  assert.equal(new Date(debit.date).toISOString().slice(0, 10), '2026-05-01');

  // Said once is said: asking again is told so rather than taking the money twice.
  const again = await call('POST', '/api/fines/payments/check', {
    items: [{ fineId: String(fines[0]._id), index: 0, amount: 400, source: 'balance' }],
  });
  assert.equal(again.body.done, 0);
  assert.match(again.body.failed[0].message, /already been sorted out/);
  assert.equal(await held(m), 4600);

  const left = await call('GET', '/api/fines/payments/to-check');
  assert.equal(left.body.payments.filter((p) => String(p.memberId) === String(m._id)).length, 0);
});

test('an earlier payment cannot be taken from a balance that does not hold it', { skip }, async () => {
  const { m, fines } = await member(100, [500]);
  await Fine.updateOne(
    { _id: fines[0]._id },
    { $set: { remaining: 0 }, $push: { settlements: { contributionId: null, amount: 500, date: new Date('2026-05-01') } } }
  );

  const res = await call('POST', '/api/fines/payments/check', {
    items: [{ fineId: String(fines[0]._id), index: 0, amount: 500, source: 'balance' }],
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.done, 0);
  assert.match(res.body.failed[0].message, /He holds only Ksh 100/);
  assert.equal(await held(m), 100);

  // Cash is always possible.
  const cash = await call('POST', '/api/fines/payments/check', {
    items: [{ fineId: String(fines[0]._id), index: 0, amount: 500, source: 'cash' }],
  });
  assert.equal(cash.body.done, 1);
});

test('a payment redirected to a fine as it is logged comes off his balance too', { skip }, async () => {
  const settings = await getOrCreateSettings();
  settings.autoSettleFines = true;
  await settings.save();
  invalidateSettings();

  try {
    const { m, fines } = await member(5000, [400]);
    const before = await held(m);

    const logged = await call('POST', `/api/ledger/members/${m._id}/log`, {
      kind: 'weekly',
      amount: 1400,
      method: 'cash',
    });
    assert.equal(logged.status, 201, JSON.stringify(logged.body));
    assert.equal(logged.body.fineDeducted, 400);
    assert.equal((await Fine.findById(fines[0]._id).lean()).remaining, 0);

    // 1,400 handed over, 400 of it spent on the fine: his balance rises by the 1,000 that stayed his.
    assert.equal(await held(m), before + 1000);
    const record = await call('GET', `/api/members/${m._id}`);
    assert.equal(record.body.walk.balanced, true);
    assert.equal(record.body.walk.closing.held, before + 1000);
  } finally {
    settings.autoSettleFines = false;
    await settings.save();
    invalidateSettings();
  }
});

test('only the office takes payments: the disciplinary officer cannot', { skip }, async () => {
  await User.create({
    name: 'Discipline',
    email: 'discipline@example.com',
    password: await bcrypt.hash('rehearsal-password', 10),
    role: 'disciplinary',
    active: true,
  });
  const login = await call('POST', '/api/auth/login', {
    email: 'discipline@example.com',
    password: 'rehearsal-password',
  });
  const officer = login.body.token;
  const { m, fines } = await member(5000, [500]);

  assert.equal((await call('POST', `/api/fines/member/${m._id}/pay`, { source: 'cash' }, officer)).status, 403);
  assert.equal((await call('POST', `/api/fines/${fines[0]._id}/settle`, { amount: 100, source: 'cash' }, officer)).status, 403);
  assert.equal((await call('GET', `/api/fines/member/${m._id}/position`, undefined, officer)).status, 403);
  assert.equal((await call('GET', '/api/fines/payments/to-check', undefined, officer)).status, 403);
});

test('the payment screen is told what he owes and what the group holds for him', { skip }, async () => {
  const { m } = await member(2500, [300, 200]);
  const position = await call('GET', `/api/fines/member/${m._id}/position`);
  assert.equal(position.status, 200);
  assert.equal(position.body.held, 2500);
  assert.equal(position.body.owed, 500);
  assert.equal(position.body.member.canEmail, false, 'no address on file: the screen offers another way to tell him');
  assert.deepEqual(
    position.body.fines.map((f) => f.reason),
    ['Fine 1', 'Fine 2'],
    'oldest first, so he can choose the one being paid'
  );
});

test('searching the fines finds a member by a bit of his name', { skip }, async () => {
  const { m } = await member(0, [100]);
  const found = await call('GET', `/api/fines?status=pending&search=${encodeURIComponent(m.name.slice(0, 7))}`);
  assert.equal(found.status, 200);
  assert.ok(found.body.fines.some((f) => String(f.memberId) === String(m._id)));
  const none = await call('GET', '/api/fines?status=pending&search=zzzz-nobody');
  assert.equal(none.body.fines.length, 0);
  // A search typed with regex characters is a search, not an error.
  assert.equal((await call('GET', `/api/fines?search=${encodeURIComponent('(.*[')}`)).status, 200);
});

test('a payment sent twice with the same key is recorded once', { skip }, async () => {
  const { m, fines } = await member(5000, [500, 300]);
  const body = { source: 'balance', clientRequestId: 'retry-key-1' };

  const first = await pay(m, body);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.replay, false);

  // The same submit again — a dropped connection, a double tap. Every fine cleared the first time,
  // so a retry must be told it is the payment, not "he owes no fines".
  const second = await pay(m, body);
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(second.body.replay, true);
  assert.equal(second.body.totalApplied, 800);
  assert.equal(second.body.fines.length, 2);
  assert.deepEqual(second.body.held, { before: 5000, after: 4200 });

  for (const fine of fines) {
    const stored = await Fine.findById(fine._id).lean();
    assert.equal(stored.remaining, 0);
    assert.equal(stored.settlements.length, 1, 'taken off once');
  }
  assert.equal((await Member.findById(m._id).lean()).fineDebits.length, 2, 'and off his balance once');
  assert.equal(await held(m), 4200);

  // A different key is a different payment, and there is nothing left for it to pay.
  const other = await pay(m, { source: 'cash', clientRequestId: 'retry-key-3' });
  assert.equal(other.status, 400, 'nothing left to pay');
});

test('voiding a fine that was paid out of a logged payment puts the money back on that payment', { skip }, async () => {
  const settings = await getOrCreateSettings();
  settings.autoSettleFines = true;
  await settings.save();
  invalidateSettings();

  try {
    const { m, fines } = await member(5000, [400]);
    const before = await held(m);
    const logged = await call('POST', `/api/ledger/members/${m._id}/log`, { kind: 'weekly', amount: 1400, method: 'cash' });
    assert.equal(logged.status, 201, JSON.stringify(logged.body));
    assert.equal(await held(m), before + 1000, 'the 400 went to the fine');

    const voided = await call('DELETE', `/api/fines/${fines[0]._id}`);
    assert.equal(voided.status, 200, JSON.stringify(voided.body));
    assert.equal(voided.body.returnedToPayments, 400);

    assert.equal(await held(m), before + 1400, 'the whole payment is his again');
    const Contribution = require('../../src/models/Contribution');
    const row = await Contribution.findOne({ memberId: m._id, deleted: false }).lean();
    assert.equal(row.fineDeducted, 0);
    assert.equal(row.amount, 1400);
    assert.equal(row.grossAmount, null);

    // Deleting that payment afterwards must not try to give the (voided) fine anything back.
    const removed = await call('DELETE', `/api/contributions/${row._id}`);
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    assert.equal(await held(m), before);
  } finally {
    settings.autoSettleFines = false;
    await settings.save();
    invalidateSettings();
  }
});

test('a member who leaves holding money or owing fines is not resigned until it is written down', { skip }, async () => {
  const { m } = await member(3000, [200]);

  const refused = await call('POST', `/api/members/${m._id}/resign`, { reason: 'Moved away' });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.held, 3000);
  assert.equal(refused.body.owed, 200);
  assert.match(refused.body.message, /Write down how that was settled/);
  assert.equal((await Member.findById(m._id).lean()).active, true, 'nothing happened');

  const done = await call('POST', `/api/members/${m._id}/resign`, {
    reason: 'Moved away',
    settlement: 'Paid out Ksh 2,800 by M-Pesa, fine taken from it',
  });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const stored = await Member.findById(m._id).lean();
  assert.equal(stored.active, false);
  assert.equal(stored.resignationSettlement, 'Paid out Ksh 2,800 by M-Pesa, fine taken from it');
});

test('a member with nothing held and nothing owed resigns without a note', { skip }, async () => {
  const { m } = await member(0, []);
  const done = await call('POST', `/api/members/${m._id}/resign`, { reason: 'Left' });
  assert.equal(done.status, 200, JSON.stringify(done.body));
});

test('the same M-Pesa code on a second payment is flagged, and can be confirmed', { skip }, async () => {
  const { m: first } = await member(0, []);
  const { m: second } = await member(0, []);
  const note = 'SK9X2Q1LMN Confirmed. Ksh1,400.00 sent to WAZO MOJA on 17/9/26.';
  const log = (m, extra = {}) =>
    call('POST', `/api/ledger/members/${m._id}/log`, { kind: 'weekly', amount: 1400, method: 'mobile', note, ...extra });

  const one = await log(first, { clientRequestId: 'mpesa-first' });
  assert.equal(one.status, 201, JSON.stringify(one.body));

  // The same code against anybody is the same money keyed twice.
  const dup = await log(second);
  assert.equal(dup.status, 409);
  assert.equal(dup.body.needsConfirmation, true);
  assert.match(dup.body.message, /SK9X2Q1LMN is already on a payment: Ksh 1,400 for Payer/);
  assert.equal(await held(second), 0, 'nothing was written');

  // A retry of the first payment from the offline outbox is that payment, not a duplicate of it.
  const replay = await log(first, { clientRequestId: 'mpesa-first' });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replay, true);

  // The treasurer can confirm it really is a second payment.
  const confirmed = await log(second, { confirmDuplicate: true });
  assert.equal(confirmed.status, 201, JSON.stringify(confirmed.body));

  // A deleted payment frees its code.
  const Contribution = require('../../src/models/Contribution');
  await Contribution.updateMany({ memberId: { $in: [first._id, second._id] } }, { $set: { deleted: true } });
  const { m: third } = await member(0, []);
  assert.equal((await log(third)).status, 201);
});
