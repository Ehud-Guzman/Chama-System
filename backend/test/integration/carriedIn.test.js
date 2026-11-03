// The carried-in totals: what the members and the funds already held when the books opened.
//
// Money held for a member who is no longer active is still the group's to account for, so it stays inside
// the members' total; it is also reported on its own, so a screen can say why the group's figure is more
// than what the active members hold between them.
//
// Needs a scratch MongoDB — see the note at the top of ledger.test.js. It creates and drops its own database
// and refuses a URI that does not look like a scratch one.
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

const URI = process.env.TEST_MONGO_URI || '';
const skip = URI
  ? false
  : 'needs a scratch MongoDB — run npm run test:integration (see the note at the top of ledger.test.js)';

const TEST_DB = 'chama-rehearsal-carriedin';
const targetFor = (name) => URI.replace(/\/[^/?]*(\?|$)/, `/${name}$1`);

if (URI && !/rehearsal|scratch|test/i.test(URI)) {
  throw new Error(`TEST_MONGO_URI (${URI}) does not look like a scratch database — refusing to run.`);
}

const Member = require('../../src/models/Member');
const ContributionType = require('../../src/models/ContributionType');
const { carriedInTotals } = require('../../src/utils/carriedIn');

test.before(async () => {
  if (skip) return;
  await mongoose.connect(targetFor(TEST_DB), { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.dropDatabase();
  await Member.create([
    { name: 'Carried Active', phone: '0712000041', regNumber: 'K/001', openingBalance: 100000 },
    { name: 'Carried Left', phone: '0712000042', regNumber: 'K/002', openingBalance: 40000, active: false },
    { name: 'Left With Nothing', phone: '0712000043', regNumber: 'K/003', openingBalance: 0, active: false },
  ]);
  await ContributionType.create({ name: 'Float Fund', isGroupFund: true, openingBalance: 5000 });
});

test.after(async () => {
  if (skip) return;
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
});

test('inactive members’ money stays in the members’ total and is also reported on its own', { skip }, async () => {
  const t = await carriedInTotals();
  assert.equal(t.memberBalances, 140000, 'every member, active or not');
  assert.equal(t.fundFloats, 5000);
  assert.equal(t.total, 145000);
  assert.equal(t.inactiveMemberBalances, 40000);
  assert.equal(t.inactiveMembers, 1, 'a member who left with nothing held is not counted');
});

test('with nobody inactive the extra figures are zero', { skip }, async () => {
  await Member.updateMany({}, { $set: { active: true } });
  const t = await carriedInTotals();
  assert.equal(t.inactiveMemberBalances, 0);
  assert.equal(t.inactiveMembers, 0);
  assert.equal(t.memberBalances, 140000);
});
