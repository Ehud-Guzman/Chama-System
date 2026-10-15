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

  const unknown = await pay(m, { amount: 100, source: 'mpesa-magic', fineId: fines[0]._id });
  assert.equal(unknown.status, 400);

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

test('nothing more than he holds can be taken from his balance', { skip }, async () => {
  const { m, fines } = await member(200, [500]);

  const refused = await pay(m, { amount: 300, source: 'balance', fineId: fines[0]._id });
  assert.equal(refused.status, 400);
  assert.match(refused.body.message, /He holds only Ksh 200/);
  assert.equal(await held(m), 200);
  assert.equal((await Fine.findById(fines[0]._id).lean()).remaining, 500);

  // What he does hold can be taken, and the rest paid in cash.
  assert.equal((await pay(m, { amount: 200, source: 'balance', fineId: fines[0]._id })).status, 200);
  assert.equal((await pay(m, { amount: 300, source: 'cash', fineId: fines[0]._id })).status, 200);
  assert.equal(await held(m), 0);
  assert.equal((await Fine.findById(fines[0]._id).lean()).remaining, 0);

  // And a member who holds nothing cannot have anything taken at all.
  const broke = await member(0, [100]);
  const none = await pay(broke.m, { amount: 100, source: 'balance', fineId: broke.fines[0]._id });
  assert.equal(none.status, 400);
  assert.match(none.body.message, /holds nothing/);
});

test('each payment is for one named fine, and cannot be more than that fine', { skip }, async () => {
  const { m, fines } = await member(5000, [300, 500, 100]);

  // Nothing is spread over several fines: a payment that names none is refused.
  const unnamed = await pay(m, { amount: 450, source: 'cash' });
  assert.equal(unnamed.status, 400);
  assert.match(unnamed.body.message, /Choose which fine/);
  assert.equal(await held(m), 5000);

  // More than that one fine is refused even though he owes more in total.
  const tooBig = await pay(m, { amount: 400, source: 'cash', fineId: fines[0]._id });
  assert.equal(tooBig.status, 400);
  assert.match(tooBig.body.message, /more than the Ksh 300 still owed on this fine/);

  // A part payment on the second fine touches that fine only.
  const part = await pay(m, { amount: 150, source: 'balance', fineId: fines[1]._id });
  assert.equal(part.status, 200, JSON.stringify(part.body));
  assert.equal(part.body.fines.length, 1);
  assert.equal(part.body.fines[0].remaining, 350);
  assert.equal((await Fine.findById(fines[0]._id).lean()).remaining, 300, 'the oldest is untouched');
  assert.equal((await Fine.findById(fines[2]._id).lean()).remaining, 100, 'so is the newest');
  assert.equal(await held(m), 4850);
  assert.equal((await Member.findById(m._id).lean()).fineDebits.length, 1);
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

  assert.equal((await call('POST', `/api/fines/member/${m._id}/pay`, { amount: 100, source: 'cash' }, officer)).status, 403);
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
