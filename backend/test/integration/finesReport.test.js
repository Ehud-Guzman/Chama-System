// "Who owes what", end to end: the fines report the office works from.
//
// The list used to answer one question — how much does each member owe — and stop at a
// hundred rows without saying so. This pins what it answers now: how long the debt has
// stood, what it is for, how many members owe in total, and that the workbook carries the
// same fields rather than a nested object rendered as "[object Object]".
//
//   npm run test:integration
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-long-enough-to-pass';

const URI = process.env.TEST_MONGO_URI || '';
const skip = URI
  ? false
  : 'needs a scratch MongoDB — run npm run test:integration (see the note at the top of this file)';

const TEST_DB = 'chama-rehearsal-finesreport';
const targetFor = (name) => URI.replace(/\/[^/?]*(\?|$)/, `/${name}$1`);

if (URI && !/rehearsal|scratch|test/i.test(URI)) {
  throw new Error(
    `TEST_MONGO_URI (${URI}) does not look like a scratch database — refusing to run. ` +
      'Name it with "rehearsal", "scratch" or "test" in it.'
  );
}

const app = require('../../src/app');
const XLSX = require('xlsx');
const User = require('../../src/models/User');
const Member = require('../../src/models/Member');
const Fine = require('../../src/models/Fine');
const FineType = require('../../src/models/FineType');

let server;
let base;
let token;
let lateType;
let meetingType;
let alice;
let brian;

const api = (method, route, body) =>
  fetch(`${base}${route}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

const getJson = async (route) => {
  const res = await api('GET', route);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

test.before(async () => {
  if (skip) return;

  await mongoose.connect(targetFor(TEST_DB), { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.dropDatabase();

  await User.create({
    name: 'Rehearsal Admin',
    email: 'fines-report@example.com',
    password: await bcrypt.hash('rehearsal-password', 10),
    role: 'admin',
    active: true,
  });

  [alice, brian] = await Member.create([
    { name: 'Alice Wanjiru', phone: '0712345678', regNumber: 'WM-0001', nationalId: '10000001' },
    { name: 'Brian Otieno', phone: '0722000111', regNumber: 'WM-0002', nationalId: '10000002' },
  ]);

  [lateType, meetingType] = await FineType.create([
    { name: 'Late arrival', category: 'financial', defaultAmount: 500 },
    { name: 'Missing meeting', category: 'financial', defaultAmount: 200 },
  ]);

  // Alice owes on two types and has one fine already paid off (the April one), so her
  // "oldest" must be the March fine and not the cleared one. Brian owes a single larger
  // fine from January, which is the oldest debt in the group.
  await Fine.create([
    {
      memberId: alice._id,
      typeId: lateType._id,
      amount: 500,
      remaining: 500,
      date: new Date('2026-03-12T00:00:00.000Z'),
      reason: 'Late to the meeting',
      issuedBy: alice._id,
    },
    {
      memberId: alice._id,
      typeId: meetingType._id,
      amount: 200,
      remaining: 0,
      date: new Date('2026-04-02T00:00:00.000Z'),
      reason: 'Missed a meeting (paid)',
      issuedBy: alice._id,
    },
    {
      memberId: alice._id,
      typeId: lateType._id,
      amount: 500,
      remaining: 500,
      date: new Date('2026-05-20T00:00:00.000Z'),
      reason: 'Late again',
      issuedBy: alice._id,
    },
    {
      memberId: brian._id,
      typeId: meetingType._id,
      amount: 1000,
      remaining: 400,
      date: new Date('2026-01-05T00:00:00.000Z'),
      reason: 'Missed a meeting, part paid',
      issuedBy: alice._id,
    },
  ]);

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const res = await api('POST', '/api/auth/login', {
    email: 'fines-report@example.com',
    password: 'rehearsal-password',
  });
  const body = await res.json();
  assert.equal(res.status, 200, 'the rehearsal admin could not sign in');
  token = body.token;
});

test.after(async () => {
  if (skip) return;
  server?.close();
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
});

test('the report dates each member\'s debt and says what it is for', { skip }, async () => {
  const { status, body } = await getJson('/api/reports/fines');
  assert.equal(status, 200);

  const byName = Object.fromEntries(body.byMember.map((m) => [m.name, m]));
  const aliceRow = byName['Alice Wanjiru'];
  const brianRow = byName['Brian Otieno'];
  assert.ok(aliceRow && brianRow, 'both members owing must be on the list');

  // Who they are and how to reach them — the line somebody reads out before a phone call.
  assert.equal(aliceRow.regNumber, 'WM-0001');
  assert.equal(aliceRow.phone, '0712345678');
  assert.equal(aliceRow.outstanding, 1000);
  assert.equal(aliceRow.fines, 2, 'the cleared April fine is not counted as owed');
  assert.equal(new Date(aliceRow.oldestUnpaid).toISOString().slice(0, 10), '2026-03-12');

  // What she owes it for — the one line that is still owed on, with its own date.
  assert.deepEqual(aliceRow.types.map((t) => t.name), ['Late arrival']);
  assert.equal(aliceRow.types[0].outstanding, 1000);
  assert.equal(aliceRow.types[0].count, 2);
  assert.equal(new Date(aliceRow.types[0].oldest).toISOString().slice(0, 10), '2026-03-12');

  // The biggest debt sorts first, and the oldest is a different member — which is exactly
  // why the list offers both orders rather than picking one for the office.
  assert.equal(body.byMember[0].name, 'Alice Wanjiru');
  const byOldest = [...body.byMember].sort(
    (a, b) => new Date(a.oldestUnpaid) - new Date(b.oldestUnpaid)
  );
  assert.equal(byOldest[0].name, 'Brian Otieno');
});

test('the totals count the members owing, and date the oldest debt', { skip }, async () => {
  const { body } = await getJson('/api/reports/fines');

  assert.equal(body.totals.membersOwing, 2);
  assert.equal(body.totals.outstanding, 1400);
  assert.equal(body.totals.count, 4, 'every fine not voided is on the report');
  assert.equal(body.totals.pendingCount, 3);
  assert.equal(new Date(body.totals.oldestUnpaid).toISOString().slice(0, 10), '2026-01-05');
});

test('a capped list says so rather than reading as the whole answer', { skip }, async () => {
  const { body } = await getJson('/api/reports/fines');
  assert.equal(typeof body.byMemberLimit, 'number');
  assert.ok(body.byMemberLimit >= body.byMember.length);
  assert.equal(body.byMemberTruncated, false);
});

test('the discipline screen\'s own report answers the same two questions', { skip }, async () => {
  // Both screens read the same debts through different endpoints — one aggregate, one
  // shared builder — so this is the tripwire for the two drifting apart.
  const { status, body } = await getJson('/api/fines/summary');
  assert.equal(status, 200);

  const aliceRow = body.byMember.find((m) => m.name === 'Alice Wanjiru');
  assert.ok(aliceRow);
  assert.equal(aliceRow.outstanding, 1000);
  assert.equal(new Date(aliceRow.oldestUnpaid).toISOString().slice(0, 10), '2026-03-12');
  assert.equal(aliceRow.types[0].name, 'Late arrival');
  assert.equal(body.totals.membersOwing, 2);
  assert.equal(new Date(body.totals.oldestUnpaid).toISOString().slice(0, 10), '2026-01-05');
});

test('the workbook carries the same fields, with no nested object in a cell', { skip }, async () => {
  const res = await api('GET', '/api/reports/fines/export');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /spreadsheet/);

  const buffer = Buffer.from(await res.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets['By member'];
  assert.ok(sheet, 'the report must carry a By member sheet');

  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const aliceRow = rows.find((row) => row.Member === 'Alice Wanjiru');
  assert.ok(aliceRow, 'the member is on the sheet');

  // The columns the office asked for, filled from the same figures the screen shows.
  assert.equal(aliceRow['Still owed'], 1000);
  assert.equal(aliceRow.Phone, '0712345678');
  assert.equal(aliceRow['Owing since'], '2026-03-12');
  assert.match(String(aliceRow['What for']), /Late arrival/);

  // And the thing this test exists for: the per-member breakdown is nested, and a nested
  // object written straight into a sheet is a cell reading "[object Object]".
  for (const row of rows) {
    for (const value of Object.values(row)) {
      assert.doesNotMatch(String(value), /\[object Object\]/);
    }
  }
});

// <<<END>>>
