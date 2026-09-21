// The member register as a spreadsheet: what the office downloads, edits and uploads again.
//
// The export endpoint is the other half of the import the round-trip test covers in isolation
// (test/xlsxRoundTrip.test.js). This suite goes through the real HTTP endpoint, because the two
// halves have to agree about the headings, and the headings are the contract: rename one in the
// export or in the parser and an edited roster comes back with a column the importer no longer
// recognises — quietly, since unknown columns are skipped rather than refused.
//
//   npm run test:integration
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const XLSX = require('xlsx');

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-long-enough-to-pass';

const URI = process.env.TEST_MONGO_URI || '';
const skip = URI
  ? false
  : 'needs a scratch MongoDB — run npm run test:integration (see the note at the top of this file)';

const TEST_DB = 'chama-rehearsal-member-export';
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
const { getOrCreateSettings } = require('../../src/utils/settings');
const { seedLedgerTypes } = require('../../src/utils/ledgerTypes');
const { parseMembersCSV } = require('../../src/utils/csvImport');
const { cleanDateOfBirth } = require('../../src/utils/memberDetails');

let server;
let base;
let token;

const api = (method, route, body) =>
  fetch(`${base}${route}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

test.before(async () => {
  if (skip) return;

  await mongoose.connect(targetFor(TEST_DB), { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.dropDatabase();

  await getOrCreateSettings();
  await seedLedgerTypes();

  await User.create({
    name: 'Export Admin',
    email: 'member-export@example.com',
    password: await bcrypt.hash('rehearsal-password', 10),
    role: 'super_admin',
    active: true,
  });

  await Member.create([
    {
      name: 'Eat Midnight',
      phone: '0715000001',
      regNumber: 'E/001',
      // What a date typed as "17 Apr 1990" becomes on a server in the group's own zone:
      // midnight EAT is 21:00 UTC the day before.
      dateOfBirth: new Date('1990-04-16T21:00:00.000Z'),
      nationalId: '15000001',
    },
    {
      name: 'Utc Midnight',
      phone: '0715000002',
      regNumber: 'E/002',
      // What the form and the importer produce: midnight UTC on the day.
      dateOfBirth: new Date('1990-04-17T00:00:00.000Z'),
      nationalId: '15000002',
    },
  ]);

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const login = await api('POST', '/api/auth/login', {
    email: 'member-export@example.com',
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

// The workbook, read the way the office's Excel would read it.
async function downloadExport() {
  const res = await api('GET', '/api/members/export');
  assert.equal(res.status, 200);
  const workbook = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return { sheet, rows: XLSX.utils.sheet_to_json(sheet, { defval: '' }) };
}

const rowFor = (rows, name) => {
  const row = rows.find((r) => r.Name === name);
  assert.ok(row, `${name} is missing from the export`);
  return row;
};

test('a date of birth exports as the day the office wrote', { skip }, async () => {
  const { rows } = await downloadExport();

  // Both storage shapes render as the 17th: one stored at midnight EAT, one at midnight UTC.
  // Before this was pinned, a date stored at midnight EAT was written out as the 16th from a UTC
  // server — a birth date exported a day early, which nobody would have questioned.
  assert.equal(rowFor(rows, 'Eat Midnight')['Date of birth'], '1990-04-17');
  assert.equal(rowFor(rows, 'Utc Midnight')['Date of birth'], '1990-04-17');
});

test('the export carries every column the importer reads', { skip }, async () => {
  const { rows } = await downloadExport();
  const headers = Object.keys(rows[0]);

  // The headings the parser has a field for. A rename on either side breaks the round trip
  // silently, because an unknown column is skipped rather than refused — so it is asserted here.
  for (const header of [
    'Name',
    'Phone',
    'Email',
    'Reg number',
    'Date of birth',
    'National ID',
    'Physical address',
    'Spouse',
    'Children',
    'Father',
    'Mother',
    'Father-in-law',
    'Mother-in-law',
    'Emergency contact',
    'Emergency relationship',
    'Emergency phone',
    'Notes',
  ]) {
    assert.ok(headers.includes(header), `the export no longer has a "${header}" column`);
  }
});

test('an exported register uploads again with its dates intact', { skip }, async () => {
  // The whole user story, through the real endpoint: download the roster, hand the sheet back as
  // CSV the way the browser does, and read it with the importer the upload uses.
  const { sheet } = await downloadExport();
  const parsed = parseMembersCSV(XLSX.utils.sheet_to_csv(sheet));

  const eat = parsed.find((r) => r.name === 'Eat Midnight');
  const utc = parsed.find((r) => r.name === 'Utc Midnight');
  assert.ok(eat && utc, 'both members should come back');

  assert.equal(cleanDateOfBirth(eat.dateOfBirth).value.toISOString().slice(0, 10), '1990-04-17');
  assert.equal(cleanDateOfBirth(utc.dateOfBirth).value.toISOString().slice(0, 10), '1990-04-17');
  // And the plain columns, which is what the office is usually editing when they touch the file.
  assert.equal(eat.phone, '0715000001');
  assert.equal(eat.regNumber, 'E/001');
  assert.equal(eat.nationalId, '15000001');
});

