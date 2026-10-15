// The meeting report, end to end: a real database, the real ledger engine, the real route.
//
// The unit tests pin the arithmetic on figures handed to the builder. What only a database can pin is
// that the *right* figures are handed to it — that "below the line" is the reminders screen's own
// reading of the ledger, that the spending section honours the role gate, and that a section nobody
// asked for costs nothing. The assertions read the printed page back out of the PDF the endpoint
// actually returns.
//
//   npm run test:integration
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-long-enough-to-pass';

const URI = process.env.TEST_MONGO_URI || '';
const skip = URI
  ? false
  : 'needs a scratch MongoDB — run npm run test:integration (see the note at the top of this file)';

const TEST_DB = 'chama-rehearsal-meetingreport';
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
const Expense = require('../../src/models/Expense');
const Contribution = require('../../src/models/Contribution');
const ContributionType = require('../../src/models/ContributionType');
const { invalidateSettings } = require('../../src/utils/settings');

let server;
let base;
let adminToken;
let secretaryToken;
let admin;

// The money line's default for the week the books opened (utils/reminderLimit). A fresh database
// opens on week 92, so this is this week's line.
const LINE = 114_600;

const call = (token, route) =>
  fetch(`${base}${route}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

// What the page says. pdfkit deflates each content stream and writes every string as hex inside a
// TJ array, so reading it back is inflating the streams and decoding the hex.
function pdfText(buffer) {
  const raw = buffer.toString('latin1');
  const lines = [];
  for (const stream of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content;
    try {
      content = zlib.inflateSync(Buffer.from(stream[1], 'latin1')).toString('latin1');
    } catch {
      continue; // not a content stream (a font or an image)
    }
    for (const match of content.matchAll(/\[((?:<[0-9a-fA-F]*>|\s|-?\d+(?:\.\d+)?)*)\]\s*TJ/g)) {
      let line = '';
      for (const hex of match[1].matchAll(/<([0-9a-fA-F]*)>/g)) {
        line += Buffer.from(hex[1], 'hex').toString('latin1');
      }
      lines.push(line);
    }
  }
  return lines.join('\n');
}

async function printed(token, query) {
  const res = await call(token, `/api/reports/print${query}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return { res, status: res.status, buffer, text: res.status === 200 ? pdfText(buffer) : '' };
}

test.before(async () => {
  if (skip) return;

  await mongoose.connect(targetFor(TEST_DB), { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.dropDatabase();
  invalidateSettings();

  [admin] = await User.create([
    {
      name: 'Rehearsal Treasurer',
      email: 'print-admin@example.com',
      password: await bcrypt.hash('rehearsal-password', 10),
      role: 'admin',
      active: true,
    },
    {
      name: 'Rehearsal Secretary',
      email: 'print-secretary@example.com',
      password: await bcrypt.hash('rehearsal-password', 10),
      role: 'secretary',
      active: true,
    },
  ]);

  // Three members measured against the line: one well above it, one well below, and one exactly
  // on it. None of them has an unpaid week — the opening week is the baseline and nothing is due.
  const [alice, brian] = await Member.create([
    { name: 'Alice Wanjiru', phone: '0712345678', regNumber: 'WM-0001', nationalId: '10000001', openingBalance: 130_000 },
    { name: 'Brian Otieno', phone: '0722000111', regNumber: 'WM-0002', nationalId: '10000002', openingBalance: 100_000 },
    { name: 'Carol Njeri', phone: '0733000222', regNumber: 'WM-0003', nationalId: '10000003', openingBalance: LINE },
  ]);

  // Alice brings this week's 1,400, so the week has money in it and she holds a little more.
  const weekly = await ContributionType.create({
    name: 'Weekly Contribution',
    isWeekly: true,
    isGroupFund: false,
    weeklyAmount: 1400,
  });
  await Contribution.create({
    memberId: alice._id,
    typeId: weekly._id,
    amount: 1400,
    method: 'cash',
    loggedBy: admin._id,
  });

  const fineType = await FineType.create({ name: 'Late arrival', category: 'financial', defaultAmount: 500 });
  await Fine.create({
    memberId: brian._id,
    typeId: fineType._id,
    amount: 700,
    remaining: 700,
    date: new Date('2026-01-05T00:00:00.000Z'),
    reason: 'Late, twice',
    issuedBy: admin._id,
  });

  // One purchase this week, and one from long ago that the week must not list.
  await Expense.create([
    { source: 'group', amount: 5000, date: new Date(), description: 'Chairs for the hall', reference: 'V-100', loggedBy: admin._id },
    { source: 'group', amount: 9000, date: new Date('2020-02-02T00:00:00.000Z'), description: 'Old purchase', reference: 'V-001', loggedBy: admin._id },
  ]);

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  for (const [email, assign] of [
    ['print-admin@example.com', (t) => (adminToken = t)],
    ['print-secretary@example.com', (t) => (secretaryToken = t)],
  ]) {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'rehearsal-password' }),
    });
    const body = await res.json();
    assert.equal(res.status, 200, `${email} could not sign in`);
    assign(body.token);
  }
});

test.after(async () => {
  if (skip) return;
  server?.close();
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
});

test('the whole page: below the line is a debt, above it is extra, and each section carries its total', { skip }, async () => {
  const { res, status, buffer, text } = await printed(adminToken, '');

  assert.equal(status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition'), /meeting-report-week-92\.pdf/);
  assert.match(buffer.toString('latin1'), /^%PDF-/);

  // The line, and the member who is under it by exactly the distance to it.
  assert.ok(text.includes(`Ksh ${LINE.toLocaleString('en-KE')}`), 'the money line is stated');
  assert.ok(text.includes('Brian Otieno (WM-0002)'));
  assert.ok(text.includes('Ksh 14,600'), 'Brian holds 100,000 against 114,600: 14,600 below');

  // Above the line: Alice by her carried-in balance and the 1,400 she has brought; Carol on it.
  assert.ok(text.includes('Alice Wanjiru (WM-0001)'));
  assert.ok(text.includes('Ksh 16,800'), 'Alice holds 131,400 against 114,600: 16,800 over');
  assert.ok(text.includes('Carol Njeri (WM-0003)'), 'a member exactly on the line is above it');

  // The totals that close the two sections, and the glance that repeats them.
  assert.ok(text.includes('1 of 3 members'), 'one member is below the line');
  assert.ok(text.includes('2 of 3 members'), 'two are at or above it');
  assert.ok(text.includes('1 of 3 members, Ksh 14,600 short'));
  assert.ok(text.includes('2 of 3 members, Ksh 16,800 over'));

  // The week's collection: Alice's 1,400 of the 4,200 the three members are asked for.
  assert.ok(text.includes("This week's collection - week 92"));
  assert.ok(text.includes('Ksh 1,400 of Ksh 4,200'));

  // Fines and spending.
  assert.ok(text.includes('Ksh 700'), 'the fine Brian still owes');
  assert.ok(text.includes('Chairs for the hall'), "this week's purchase is listed");
  assert.ok(!text.includes('Old purchase'), 'and the old one is not, in the default period');
});

test('only the sections asked for are printed', { skip }, async () => {
  const { status, text } = await printed(adminToken, '?sections=fines');

  assert.equal(status, 200);
  assert.ok(text.includes('Who owes what'));
  assert.ok(text.includes('Brian Otieno (WM-0002)'));
  assert.ok(!text.includes('Members below the line'));
  assert.ok(!text.includes('Expenses -'));
  assert.ok(!text.includes('Where the money stands'));
});

test('the spending section can reach back over everything on record', { skip }, async () => {
  const week = await printed(adminToken, '?sections=expenses&expenses=week');
  assert.ok(week.text.includes('Chairs for the hall'));
  assert.ok(!week.text.includes('Old purchase'));

  const all = await printed(adminToken, '?sections=expenses&expenses=all');
  assert.ok(all.text.includes('Chairs for the hall'));
  assert.ok(all.text.includes('Old purchase'));
  assert.ok(all.text.includes('Ksh 14,000'), 'both purchases are totalled: 5,000 + 9,000');
});

test('the secretary may print the page, but not the spending', { skip }, async () => {
  // Asked for by name: refused.
  const named = await printed(secretaryToken, '?sections=debts,expenses');
  assert.equal(named.status, 403);

  // The rest of the page is hers.
  const rest = await printed(secretaryToken, '?sections=debts,extra,fines');
  assert.equal(rest.status, 200);
  assert.ok(rest.text.includes('Brian Otieno (WM-0002)'));

  // Naming nothing means everything she may have: the page without the spending, not a refusal.
  const everything = await printed(secretaryToken, '');
  assert.equal(everything.status, 200);
  assert.ok(everything.text.includes('Members below the line'));
  assert.ok(!everything.text.includes('Expenses -'));
  assert.ok(!everything.text.includes('Chairs for the hall'));
});

test('a bad request is refused with a message, and the page needs a sign-in', { skip }, async () => {
  const unknown = await call(adminToken, '/api/reports/print?sections=debts,loans');
  assert.equal(unknown.status, 400);
  assert.match((await unknown.json()).message, /Unknown section: loans/);

  const empty = await call(adminToken, '/api/reports/print?sections=');
  assert.equal(empty.status, 400);

  const period = await call(adminToken, '/api/reports/print?sections=expenses&expenses=fortnight');
  assert.equal(period.status, 400);
  assert.match((await period.json()).message, /Unknown expenses period/);

  const anonymous = await call(null, '/api/reports/print');
  assert.equal(anonymous.status, 401);
});

test('the summary still opens with the same week after the week figures were shared', { skip }, async () => {
  // computeThisWeek now feeds both the summary card and the printed page; this is the card's side.
  const res = await call(adminToken, '/api/reports/summary');
  assert.equal(res.status, 200);
  const { thisWeek } = await res.json();

  assert.equal(thisWeek.weekNumber, 92);
  assert.equal(thisWeek.weeklyAmount, 1400);
  assert.equal(thisWeek.members, 3);
  assert.equal(thisWeek.expected, 4200, '1,400 × 3 active members');
  assert.equal(thisWeek.paid, 1400, "Alice's weekly contribution");
  assert.equal(thisWeek.shortfall, 2800);
  assert.equal(thisWeek.paidCount, 1);
  assert.equal(thisWeek.noneCount, 2);
});
