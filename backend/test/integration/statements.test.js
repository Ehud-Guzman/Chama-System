// The statements, end to end: the two the office downloads, the two a member downloads for himself,
// and the period each of them can be narrowed to.
//
// This one is worth a real server and a real database because a statement is the artefact that
// leaves the building. It is printed, handed over, argued about at a meeting, and filed — so what
// matters are the things only the whole path can prove: that the period's figures reconcile against
// real stored contributions, that both formats are actually the format they claim to be, that a
// member can download his own and only his own, and that a request without a period still answers
// exactly as it always did.
//
//   npm run test:integration
//   docker run -d --name chama-rehearsal -p 27017:27017 mongo:7
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

const TEST_DB = 'chama-rehearsal-statements';
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
const Contribution = require('../../src/models/Contribution');
const { getOrCreateSettings, invalidateSettings } = require('../../src/utils/settings');
const { seedLedgerTypes, seedGroupFunds, getLedgerTypes } = require('../../src/utils/ledgerTypes');
const { fridayOf, parseEatDate } = require('../../src/utils/weekCycle');

let server;
let base;
let token;
let member;
let otherMember;
let weeklyType;
let chaiType;
let admin;

const api = (method, route, body) =>
  fetch(`${base}${route}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

// These endpoints answer with a file, so the interesting assertions are on the bytes: a PDF starts
// with `%PDF`, and an .xlsx is a zip, which starts with `PK`.
async function download(route) {
  const res = await api('GET', route);
  const buffer = Buffer.from(await res.arrayBuffer());
  return { status: res.status, type: res.headers.get('content-type'), buffer };
}

test.before(async () => {
  if (skip) return;

  await mongoose.connect(targetFor(TEST_DB), { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.dropDatabase();

  // A cycle that is live now, so weeks close as the clock moves rather than depending on a date
  // baked into the test.
  const settings = await getOrCreateSettings();
  settings.cycleStartWeek = 92;
  settings.weeklyAmount = 1400;
  settings.chaiAmount = 100;
  settings.weekAnchorDate = fridayOf(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000));
  await settings.save();
  invalidateSettings();

  await seedLedgerTypes();
  await seedGroupFunds();

  // The two types the money actually goes into. `getLedgerTypes` is the accessor the app itself uses,
  // so the test cannot pick a fund the ledger screen would not offer.
  const types = await getLedgerTypes();
  weeklyType = types.weekly;
  chaiType = types.chai;
  assert.ok(weeklyType, 'the weekly contribution type should be seeded');

  admin = await User.create({
    name: 'Rehearsal Admin',
    email: 'statements@example.com',
    password: await bcrypt.hash('rehearsal-password', 10),
    role: 'super_admin',
    active: true,
  });

  [member, otherMember] = await Member.create([
    {
      name: 'Statement Rehearsal',
      phone: '0713000001',
      regNumber: 'S/001',
      nationalId: '90000001',
      openingBalance: 20000,
      joinDate: parseEatDate('2025-01-06'),
    },
    {
      name: 'Someone Else',
      phone: '0713000002',
      regNumber: 'S/002',
      nationalId: '90000002',
      openingBalance: 0,
    },
  ]);

  // Money spread over three months, so a month, a quarter and a year each have something in them.
  const rows = [];
  const now = new Date();
  for (const monthsBack of [2, 1, 0]) {
    const when = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 8) - 3 * 60 * 60 * 1000
    );
    if (when.getTime() > Date.now()) continue;
    rows.push({
      memberId: member._id,
      typeId: weeklyType._id,
      amount: 1400,
      date: when,
      method: 'cash',
      loggedBy: admin._id,
    });
    rows.push({
      memberId: member._id,
      typeId: weeklyType._id,
      amount: 600,
      date: when,
      method: 'cash',
      loggedBy: admin._id,
      note: 'extra',
    });
    if (chaiType) {
      rows.push({
        memberId: member._id,
        typeId: chaiType._id,
        amount: 400,
        date: when,
        method: 'cash',
        loggedBy: admin._id,
      });
    }
  }
  // One row for somebody else, so "his own and only his own" is testable.
  rows.push({
    memberId: otherMember._id,
    typeId: weeklyType._id,
    amount: 9999,
    date: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
    method: 'cash',
    loggedBy: admin._id,
  });
  await Contribution.create(rows);

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const login = await api('POST', '/api/auth/login', {
    email: 'statements@example.com',
    password: 'rehearsal-password',
  });
  const body = await login.json();
  assert.equal(login.status, 200, 'the rehearsal admin could not sign in');
  token = body.token;
});

test.after(async () => {
  if (skip) return;
  server?.close();
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
});

// ---------------------------------------------------------------------------------
// The formats
// ---------------------------------------------------------------------------------

test('the office can download a statement as a PDF and as a workbook', { skip }, async () => {
  const pdf = await download(`/api/members/${member._id}/statement`);
  assert.equal(pdf.status, 200);
  assert.match(pdf.type, /application\/pdf/);
  // It really is a PDF, not an error page wearing a PDF content type.
  assert.equal(pdf.buffer.subarray(0, 4).toString(), '%PDF');
  assert.ok(pdf.buffer.length > 2000, 'a statement this thin is a failure page');

  const xlsx = await download(`/api/members/${member._id}/statement/excel`);
  assert.equal(xlsx.status, 200);
  assert.match(xlsx.type, /spreadsheetml/);
  // An .xlsx is a zip archive, so it starts with PK.
  assert.equal(xlsx.buffer.subarray(0, 2).toString(), 'PK');
});

test('a statement with no period is the whole book, exactly as it always was', { skip }, async () => {
  // The default must not have moved: every existing link and bookmark has to keep working, and the
  // passbook JSON must stay free of a field nobody asked for.
  const lookup = await api('GET', '/api/public/lookup?nationalId=90000001');
  const profile = await lookup.json();
  assert.equal(lookup.status, 200);
  assert.equal(profile.period, undefined, 'the passbook JSON must not carry a period block');
  assert.ok(profile.ledger, 'the whole-book ledger is still there');

  const pdf = await download(`/api/members/${member._id}/statement`);
  assert.equal(pdf.status, 200);
});

// ---------------------------------------------------------------------------------
// The period
// ---------------------------------------------------------------------------------

test('a period statement reconciles against the real stored contributions', { skip }, async () => {
  const XLSX = require('xlsx');
  const year = new Date().getUTCFullYear();

  const res = await download(`/api/members/${member._id}/statement/excel?year=${year}`);
  assert.equal(res.status, 200);

  // Read the workbook back rather than trusting the PDF bytes: the workbook is machine-readable, so
  // this checks the figures the office will actually see on the sheet.
  const workbook = XLSX.read(res.buffer, { type: 'buffer' });
  const summary = XLSX.utils.sheet_to_json(workbook.Sheets.Summary, { header: 1 });
  const fields = Object.fromEntries(
    summary.filter((row) => row.length >= 2).map((row) => [String(row[0]), row[1]])
  );

  // The scope is printed on the statement, and it is the period that was asked for.
  assert.match(String(fields['Period covered']), new RegExp(`^${year}-01-01 to `));
  // And it says, in words, whether the arithmetic worked.
  assert.equal(fields['The arithmetic adds up'], 'Yes');

  // The figures are the engine's, so the identity holds: opening + in − tea = closing. The weeks
  // that closed are reported beside the balance rather than taken off it (utils/memberLedger), so
  // they are deliberately outside this sum: a closed week nobody paid is arrears, not money that
  // moved. The old reading — opening + in − weeks − tea — is asserted under it, as today's figure
  // less every week that closed, because that is what every statement printed before the rule
  // changed reads as and the office has to be able to reconcile the two.
  const keyFor = (pattern) => Object.keys(fields).find((key) => pattern.test(key));
  const opening = Number(fields[`Money at the start (${year}-01-01)`]);
  const paidIn = Number(fields['Paid in during the period']);
  const weeks = Number(fields[keyFor(/^Weeks that closed/)]);
  const tea = Number(fields['Tea deducted (Group fund)']);
  const closing = Number(fields[keyFor(/^Money at the end/)]);

  assert.ok(Number.isFinite(opening) && Number.isFinite(closing));
  assert.equal(
    Math.round((opening + paidIn - tea) * 100) / 100,
    closing,
    `${opening} + ${paidIn} − ${tea} should be ${closing}`
  );
  assert.equal(
    Math.round((opening + paidIn - weeks - tea) * 100) / 100,
    Math.round((closing - weeks) * 100) / 100,
    'the old arithmetic is today\'s figure less the weeks that closed'
  );

  // He was carried in with 20,000, and the payments logged this year are inside the period — so this
  // is real money rather than an empty shell that happens to balance.
  assert.equal(opening, 20000);
  assert.ok(paidIn > 0, 'the period should contain the payments that were logged');

  // The weeks and the tea move in lockstep — the engine charges tea for exactly the weeks it scores —
  // which is what makes "less the weeks" checkable by eye: weeks / 1,400 × 100 = tea.
  assert.equal(tea, Math.round((weeks / 1400) * 100));
});

test('a month, a quarter and a year each cover the months they claim', { skip }, async () => {
  const XLSX = require('xlsx');
  const year = new Date().getUTCFullYear();

  for (const [query, expected] of [
    [`year=${year}&month=1`, 1],
    [`year=${year}&quarter=1`, 3],
    [`range=this-year`, null], // however many months have happened, up to twelve
  ]) {
    const res = await download(`/api/members/${member._id}/statement/excel?${query}`);
    assert.equal(res.status, 200, query);

    const workbook = XLSX.read(res.buffer, { type: 'buffer' });
    const monthly = XLSX.utils.sheet_to_json(workbook.Sheets['Month by month'], { header: 1 });
    const monthRows = monthly
      .slice(1)
      .filter((row) => row[0] && !String(row[0]).startsWith('TOTAL'));

    if (expected) {
      assert.equal(monthRows.length, expected, `${query} should list ${expected} month(s)`);
    } else {
      assert.ok(monthRows.length >= 1 && monthRows.length <= 12, `${query} listed ${monthRows.length}`);
    }
  }
});

test('a period that cannot be understood is refused before any file is made', { skip }, async () => {
  for (const query of [
    'from=2026-02-31', // passes a regex, is not a date
    'from=2026-12-01&to=2026-01-01', // backwards
    'quarter=9',
    'year=1899',
    'range=forever',
  ]) {
    const res = await api('GET', `/api/members/${member._id}/statement?${query}`);
    assert.equal(res.status, 400, query);
    const body = await res.json();
    // A sentence, because an operator is the one who reads it.
    assert.equal(typeof body.message, 'string');
    assert.ok(body.message.length > 10, `${query}: "${body.message}"`);
  }
});

// ---------------------------------------------------------------------------------
// The member's own copy
// ---------------------------------------------------------------------------------

test('a member downloads his own statement for a period, and nobody else’s', { skip }, async () => {
  const XLSX = require('xlsx');

  const mine = await download('/api/public/lookup/statement?nationalId=90000001&range=this-year');
  assert.equal(mine.status, 200);
  assert.match(mine.type, /application\/pdf/);
  assert.equal(mine.buffer.subarray(0, 4).toString(), '%PDF');

  const mineExcel = await download(
    '/api/public/lookup/statement/excel?nationalId=90000001&range=this-year'
  );
  assert.equal(mineExcel.status, 200);
  assert.equal(mineExcel.buffer.subarray(0, 2).toString(), 'PK');

  // The gate still holds: an ID nobody holds opens nothing, period or no period.
  const stranger = await api('GET', '/api/public/lookup/statement?nationalId=12345678');
  assert.equal(stranger.status, 404);

  // And another member's money must not appear on his statement.
  const workbook = XLSX.read(mineExcel.buffer, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets['Contribution history'], { header: 1 });
  assert.equal(
    rows.some((row) => row.includes(9999)),
    false,
    'another member’s contribution appeared on this statement'
  );
});


