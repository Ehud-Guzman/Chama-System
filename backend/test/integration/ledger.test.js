// The rehearsal: the money paths, end to end, against a real MongoDB.
//
// Everything else in this suite tests pure functions or the API's surface. This is the
// one that logs a payment, issues and settles a fine, checks a duplicate submit does
// not double-count, watches the quarter-drop guard refuse a save, then takes a backup
// through the real endpoint and restores it into a second database — which is the
// rehearsal the live books should have before their first real collection week.
//
// It needs a scratch MongoDB and never touches the live one:
//
//   npm run test:integration                      (starts against 127.0.0.1:27017)
//   TEST_MONGO_URI=mongodb://host:27017/chama-x npm test
//
//   docker run -d --name chama-rehearsal -p 27017:27017 mongo:7
//
// It creates and drops its own databases (…-test and …-restored), so pointing it at a
// server is safe; the guard below refuses to run against a database whose name does not
// look like a scratch one.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-long-enough-to-pass';

const URI = process.env.TEST_MONGO_URI || '';
const skip = URI
  ? false
  : 'needs a scratch MongoDB — run npm run test:integration (see the note at the top of this file)';

// The database this test uses, and the one it restores into.
const TEST_DB = 'chama-rehearsal-test';
const RESTORED_DB = 'chama-rehearsal-restored';
const targetFor = (name) => URI.replace(/\/[^/?]*(\?|$)/, `/${name}$1`);

if (URI && !/rehearsal|scratch|test/i.test(URI)) {
  throw new Error(
    `TEST_MONGO_URI (${URI}) does not look like a scratch database — refusing to run. ` +
      'Name it with "rehearsal", "scratch" or "test" in it.'
  );
}

const app = require('../../src/app');
const Member = require('../../src/models/Member');
const User = require('../../src/models/User');
const Settings = require('../../src/models/Settings');
const Contribution = require('../../src/models/Contribution');
const Fine = require('../../src/models/Fine');
const { getOrCreateSettings, invalidateSettings } = require('../../src/utils/settings');
const { seedLedgerTypes, seedGroupFunds, getLedgerTypes } = require('../../src/utils/ledgerTypes');
const { seedDisciplinaryFineTypes } = require('../../src/utils/seedDisciplinaryFineTypes');
const { fridayOf } = require('../../src/utils/weekCycle');

let server;
let base;
let token;
let memberA;
let memberB;

const api = (method, route, body) =>
  fetch(`${base}${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function json(res) {
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

test.before(async () => {
  if (skip) return;

  await mongoose.connect(targetFor(TEST_DB), { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.dropDatabase();

  // A cycle that is live now: the anchor is the most recent Friday, so the opening
  // week is the week running today and nothing has been scored yet.
  const settings = await getOrCreateSettings();
  settings.cycleStartWeek = 92;
  settings.weeklyAmount = 1400;
  settings.chaiAmount = 100;
  settings.weekAnchorDate = fridayOf(new Date());
  await settings.save();
  invalidateSettings();

  await seedLedgerTypes();
  await seedGroupFunds();
  // The same seeding the app does at boot, so the disciplinary categories exist and a
  // fine can be issued the way the office issues one.
  await seedDisciplinaryFineTypes();

  const [a, b] = await Member.create([
    { name: 'Rehearsal One', phone: '0712000001', regNumber: 'R/001', openingBalance: 10000 },
    { name: 'Rehearsal Two', phone: '0712000002', regNumber: 'R/002', openingBalance: 0 },
  ]);
  memberA = a;
  memberB = b;

  await User.create({
    name: 'Rehearsal Admin',
    email: 'rehearsal@example.com',
    password: await bcrypt.hash('rehearsal-password', 10),
    role: 'super_admin',
    active: true,
  });

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const login = await api('POST', '/api/auth/login', {
    email: 'rehearsal@example.com',
    password: 'rehearsal-password',
  });
  const body = await json(login);
  assert.equal(login.status, 200, 'the rehearsal admin could not sign in');
  token = body.body.token;
});

test.after(async () => {
  if (skip) return;
  server?.close();
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
});

// ---------------------------------------------------------------------------------
// The figures
// ---------------------------------------------------------------------------------

test('the opening week is the baseline: his money is what he carried in', { skip }, async () => {
  const res = await json(await api('GET', `/api/ledger/members/${memberA._id}`));
  assert.equal(res.status, 200);
  // Nothing has been scored — the week running today has not closed — so his money is
  // exactly his carried-in figure. This is the rule that keeps an empty book reading
  // zero instead of billing everybody for a week nobody has collected yet.
  assert.equal(res.body.ledger.money, 10000);
  assert.equal(res.body.ledger.arrears ?? 0, 0);
});

test('a payment logged for the week is credited as cash', { skip }, async () => {
  const res = await json(
    await api('POST', `/api/ledger/members/${memberA._id}/log`, {
      kind: 'weekly',
      amount: 1400,
      method: 'cash',
      note: 'rehearsal',
      clientRequestId: 'rehearsal-payment-1',
    })
  );
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.entry.amount, 1400);
  assert.equal(res.body.fineDeducted, 0, 'fines are not paid out of a payment by default');
  assert.equal(res.body.netAmount, 1400);

  const ledger = await json(await api('GET', `/api/ledger/members/${memberA._id}`));
  assert.equal(ledger.body.ledger.money, 11400);
  // Tea is automatic for a scored week, and no week has closed yet, so nothing has
  // come off him for it.
  assert.equal(ledger.body.ledger.chaiDue ?? 0, 0);
});

test('the same submit twice is one payment, not two', { skip }, async () => {
  const before = await Contribution.countDocuments({ memberId: memberA._id });

  // Exactly what a dropped response or a double tap sends: the same idempotency key.
  const again = await json(
    await api('POST', `/api/ledger/members/${memberA._id}/log`, {
      kind: 'weekly',
      amount: 1400,
      method: 'cash',
      note: 'rehearsal',
      clientRequestId: 'rehearsal-payment-1',
    })
  );
  assert.equal(again.status, 200);
  assert.equal(again.body.replay, true);

  assert.equal(
    await Contribution.countDocuments({ memberId: memberA._id }),
    before,
    'a replay must not add a row'
  );

  const ledger = await json(await api('GET', `/api/ledger/members/${memberA._id}`));
  assert.equal(ledger.body.ledger.money, 11400, 'and must not change the money');
});

test('a fine can be issued and settled, and settling it moves no week', { skip }, async () => {
  const types = await json(await api('GET', '/api/fine-types'));
  assert.equal(types.status, 200);
  const type = (types.body.types || types.body.fineTypes || [])[0];
  assert.ok(type, 'no fine type to issue against');

  const issued = await json(
    await api('POST', '/api/fines', {
      memberId: memberB._id,
      typeId: type._id,
      amount: 500,
      reason: 'rehearsal',
    })
  );
  assert.equal(issued.status, 201, JSON.stringify(issued.body));
  const fine = issued.body.fine;
  assert.equal(fine.remaining, 500);

  const settled = await json(
    await api('POST', `/api/fines/${fine._id}/settle`, { amount: 200, method: 'cash' })
  );
  assert.equal(settled.status, 200, JSON.stringify(settled.body));
  assert.equal(settled.body.fine.remaining, 300, 'a part payment leaves the rest owed');
  assert.equal(settled.body.fine.status, 'pending');

  const full = await json(await api('POST', `/api/fines/${fine._id}/settle`, { amount: 300 }));
  assert.equal(full.body.fine.remaining, 0);
  assert.equal(full.body.fine.status, 'settled');

  // The fine money was handed over in cash rather than logged as a contribution, so
  // the week's figures must not have moved.
  const ledger = await json(await api('GET', `/api/ledger/members/${memberB._id}`));
  assert.equal(ledger.body.ledger.money, 0);

  // The fines live on the member's own record (the ledger panel shows the week).
  const record = await json(await api('GET', `/api/members/${memberB._id}`));
  assert.equal(record.status, 200);
  assert.equal(record.body.fines.totalOwed, 0);
  assert.equal(record.body.fines.pending.length, 0);
  assert.equal(record.body.fines.settled.length, 1);

  const stored = await Fine.findById(fine._id).lean();
  assert.equal(stored.remaining, 0);
  assert.equal(stored.settlements.length, 2);
});

test('a save that cuts the members total hard is refused until it is confirmed', { skip }, async () => {
  // 10,000 + 0 down to 1,000 is a 90% cut: the guard has to stop it before it writes.
  const balances = [
    { memberId: String(memberA._id), openingBalance: 1000 },
    { memberId: String(memberB._id), openingBalance: 0 },
  ];

  const refused = await json(await api('PATCH', '/api/ledger/setup', { balances }));
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  assert.ok(refused.body.confirmation, 'the refusal carries both totals for the caller to show');

  const untouched = await Member.findById(memberA._id).lean();
  assert.equal(untouched.openingBalance, 10000, 'a refused save writes nothing');

  const confirmed = await json(
    await api('PATCH', '/api/ledger/setup', { balances, confirm: true })
  );
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.equal((await Member.findById(memberA._id).lean()).openingBalance, 1000);

  // Put it back so the backup below is of a database in a known state. An increase is
  // never held back.
  await api('PATCH', '/api/ledger/setup', {
    balances: [
      { memberId: String(memberA._id), openingBalance: 10000 },
      { memberId: String(memberB._id), openingBalance: 0 },
    ],
  });
  assert.equal((await Member.findById(memberA._id).lean()).openingBalance, 10000);
});

test('a backup restores into another database with dates and ids intact', { skip }, async () => {
  const backupRes = await fetch(`${base}/api/backup`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(backupRes.status, 200);
  const backupText = await backupRes.text();
  const parsed = JSON.parse(backupText);
  assert.equal(parsed.format, 'chama-system-backup');
  assert.ok(parsed.data.members.length >= 2);

  const file = path.join(os.tmpdir(), `chama-rehearsal-backup-${Date.now()}.json`);
  fs.writeFileSync(file, backupText);

  // Restore through the real script, into a *different* database.
  const out = execFileSync(
    process.execPath,
    [
      path.join(__dirname, '..', '..', 'src', 'scripts', 'restoreBackup.js'),
      file,
      `--target=${targetFor(RESTORED_DB)}`,
      '--confirm-write',
    ],
    { encoding: 'utf8', env: { ...process.env, MONGO_URI: targetFor(RESTORED_DB) } }
  );
  assert.match(out, /0 collection\(s\) failed/);

  // Read it back with the raw driver: a Date that came back as a string would show up
  // here, and every week number computed from it would be wrong.
  const restoredConn = await mongoose.createConnection(targetFor(RESTORED_DB)).asPromise();
  try {
    const collections = (await restoredConn.db.listCollections().toArray()).map((c) => c.name);
    const restoredSettings = await restoredConn.collection('settings').findOne({ key: 'main' });
    assert.ok(
      restoredSettings,
      `settings did not come back. Collections in the restored database: ${collections.join(', ')}\n` +
        `--- restore said: ---\n${out}`
    );
    assert.ok(restoredSettings.weekAnchorDate instanceof Date, 'the anchor came back as a string');
    assert.equal(
      restoredSettings.weekAnchorDate.getTime(),
      fridayOf(new Date()).getTime(),
      'the anchor moved'
    );
    assert.equal(restoredSettings.weeklyAmount, 1400);

    const restoredMember = await restoredConn
      .collection('members')
      .findOne({ name: 'Rehearsal One' });
    assert.ok(restoredMember);
    assert.equal(restoredMember._id.toString(), String(memberA._id), 'the id changed');
    assert.equal(restoredMember.openingBalance, 10000);
    assert.ok(restoredMember.createdAt instanceof Date);

    assert.equal(
      await restoredConn.collection('contributions').countDocuments({ memberId: memberA._id }),
      await Contribution.countDocuments({ memberId: memberA._id })
    );

    // The restore leaves a trace of itself.
    assert.equal(
      await restoredConn.collection('auditlogs').countDocuments({ 'after.action': 'restore-backup' }),
      1
    );
  } finally {
    await restoredConn.db.dropDatabase().catch(() => {});
    await restoredConn.close();
    fs.unlinkSync(file);
  }
});


