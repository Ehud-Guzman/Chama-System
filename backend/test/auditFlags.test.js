// What the audit trail is allowed to shout about.
//
// The trail records every change, which means most of it is ordinary typing; the
// value of it is entirely in which entries stand out, so these tests pin what is
// flagged and — just as important — what is not. A flag that fires on every save is
// a flag nobody reads, and one that misses a cut contribution or a changed phone
// number is worse than no flag at all, because it reads as reassurance.
//
// Pure: no database, no clock.
const test = require('node:test');
const assert = require('node:assert/strict');

const { readAuditEntry, CATEGORY_BY_ENTITY, CATEGORIES } = require('../src/utils/auditFlags');

const keys = (read) => read.flags.map((f) => f.key);

// Snapshots are stored JSON round-tripped, so a date is an ISO string and an id is
// hex text by the time they are read back.
const contribution = (over = {}) => ({
  amount: 1400,
  date: '2026-09-18T00:00:00.000Z',
  memberId: '65a0000000000000000000m1',
  typeId: '65a0000000000000000000t1',
  method: 'cash',
  deleted: false,
  updatedAt: '2026-09-19T06:00:00.000Z',
  __v: 1,
  ...over,
});

test('every entity lands in the category its reader expects', () => {
  assert.equal(CATEGORY_BY_ENTITY.Contribution, 'money');
  assert.equal(CATEGORY_BY_ENTITY.Member, 'people');
  assert.equal(CATEGORY_BY_ENTITY.User, 'people');
  assert.equal(CATEGORY_BY_ENTITY.Minute, 'records');
  assert.equal(CATEGORY_BY_ENTITY.Settings, 'settings');
  // The four the screen offers are the four that exist, in its order.
  assert.deepEqual(
    CATEGORIES.map((c) => c.key),
    ['money', 'people', 'records', 'settings']
  );
});

test('an ordinary edit is not shouted about', () => {
  // updatedAt and __v move on every save: a raw diff would call this a change.
  const read = readAuditEntry({
    action: 'update',
    entityType: 'Contribution',
    before: contribution(),
    after: contribution({ updatedAt: '2026-09-19T07:30:00.000Z', __v: 2 }),
  });
  assert.deepEqual(read.flags, []);
  assert.equal(read.severity, null);
  assert.equal(read.summary, 'Ksh 1,400');
});

test('money cut off the books is the loudest thing in the trail', () => {
  const read = readAuditEntry({
    action: 'update',
    entityType: 'Contribution',
    before: contribution({ amount: 1400 }),
    after: contribution({ amount: 700 }),
  });
  assert.ok(keys(read).includes('amount-cut'));
  assert.equal(read.severity, 'high');
  assert.equal(read.summary, 'Ksh 1,400 → Ksh 700');

  // The other direction is worth seeing too, but it is not the shape of a quiet
  // correction, so it is a note rather than an alarm.
  const raised = readAuditEntry({
    action: 'update',
    entityType: 'Contribution',
    before: contribution({ amount: 1400 }),
    after: contribution({ amount: 2800 }),
  });
  assert.ok(keys(raised).includes('amount-raised'));
  assert.equal(raised.severity, 'watch');
});


test('a row that moves is flagged, because the money moved with it', () => {
  const toAnother = readAuditEntry({
    action: 'update',
    entityType: 'Contribution',
    before: contribution(),
    after: contribution({ memberId: '65a0000000000000000000m9' }),
  });
  assert.ok(keys(toAnother).includes('moved-member'));
  assert.equal(toAnother.severity, 'high');

  // A re-dated payment is how a week's money quietly changes hands; in a ledger
  // whose whole rule is "a week closes on its Thursday" that is worth a look.
  const redated = readAuditEntry({
    action: 'update',
    entityType: 'Contribution',
    before: contribution(),
    after: contribution({ date: '2026-09-11T00:00:00.000Z' }),
  });
  assert.ok(keys(redated).includes('re-dated'));
});

test('a deleted row is flagged with the money it carried', () => {
  const read = readAuditEntry({
    action: 'delete',
    entityType: 'Contribution',
    before: contribution({ amount: 2500 }),
    after: null,
  });
  assert.ok(keys(read).includes('money-removed'));
  assert.equal(read.severity, 'high');
  assert.equal(read.summary, 'Ksh 2,500');
});

test("a member's phone number is a credential, so changing it is called out", () => {
  // A synthetic name and balance throughout: the real ones were here once, and a name is member
  // data even when it is only a test fixture (see the README).
  const read = readAuditEntry({
    action: 'update',
    entityType: 'Member',
    before: { name: 'Example Member', phone: '0712345678', active: true, openingBalance: 120000 },
    after: { name: 'Example Member', phone: '0799999999', active: true, openingBalance: 120000 },
  });
  assert.ok(keys(read).includes('credential'));
  assert.equal(read.severity, 'high');
  // Named by the change, never by the value: the trail says a phone number moved,
  // it does not print the number.
  assert.equal(read.summary, 'Example Member · phone number');
  assert.ok(!read.summary.includes('0799999999'));
});

test('the carried-in balance is the base every figure stands on', () => {
  const read = readAuditEntry({
    action: 'update',
    entityType: 'Member',
    before: { name: 'Example Member', openingBalance: 120000 },
    after: { name: 'Example Member', openingBalance: 100000 },
  });
  assert.ok(keys(read).includes('opening-balance'));
  assert.equal(read.severity, 'high');
});

test('an account changing role is an access change, not a name edit', () => {
  const read = readAuditEntry({
    action: 'update',
    entityType: 'User',
    before: { name: 'Anne', role: 'secretary', active: true },
    after: { name: 'Anne', role: 'admin', active: true },
  });
  assert.ok(keys(read).includes('role-changed'));
  assert.equal(read.severity, 'high');
  assert.equal(read.summary, 'Anne');
});

test('a group-wide operation reads as one', () => {
  // A ledger reset or a restore moves everybody's figures at once.
  const system = readAuditEntry({
    action: 'reset',
    entityType: 'System',
    before: null,
    after: { openingBalance: 0 },
  });
  assert.ok(keys(system).includes('group-wide'));
  assert.equal(system.severity, 'high');
  assert.equal(system.category, 'settings');

  // The week figures are group-wide too, and a change to them is worth naming.
  const settings = readAuditEntry({
    action: 'update',
    entityType: 'Settings',
    before: { weeklyAmount: 1400, chaiAmount: 100 },
    after: { weeklyAmount: 1500, chaiAmount: 100 },
  });
  assert.ok(keys(settings).includes('group-wide'));
  assert.equal(settings.severity, 'watch');
  assert.equal(settings.summary, 'weekly amount');
});

test('records that carry no money are recorded without alarm', () => {
  const read = readAuditEntry({
    action: 'create',
    entityType: 'Minute',
    before: null,
    after: { title: 'Min 12/2026', content: '<p>Adjourned</p>' },
  });
  assert.equal(read.category, 'records');
  assert.deepEqual(read.flags, []);
  assert.equal(read.summary, 'Min 12/2026');
});
