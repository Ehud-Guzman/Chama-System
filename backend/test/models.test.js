// A new field in the settings document is a new rule in the books, so the
// defaults are pinned here: `autoSettleFines` is off (money paid is contribution
// unless the committee says otherwise), the singleton key is 'main', and money
// fields round to two decimal places on the way in (utils/money).
const test = require('node:test');
const assert = require('node:assert/strict');

// The models are compiled without a connection: this suite checks the *shape* of
// what will be written, which is exactly what a bad default would break.
const Settings = require('../src/models/Settings');
const Member = require('../src/models/Member');
const Contribution = require('../src/models/Contribution');
const Fine = require('../src/models/Fine');

test('a payment does not pay fines by default', () => {
  const settings = new Settings({});
  assert.equal(settings.autoSettleFines, false);
});

test('one reminder per member per week is the default', () => {
  // A member who is behind stays behind, so a cap that defaulted to "no limit" would undo
  // itself on the first deploy. 0 is the deliberate way to say "no limit".
  assert.equal(new Settings({}).reminderMaxPerWeek, 1);
});

test('settings is a single row keyed "main"', () => {
  assert.equal(new Settings({}).key, 'main');
  const unique = Settings.schema.indexes().find(([index]) => index.key === 1);
  assert.ok(unique, 'a unique index on `key` is what makes the row a singleton');
  assert.equal(unique[1].unique, true);
});

test('money is rounded on the way into every model', () => {
  // The setter runs on construction, on save and on a $set, so no code path can
  // store a figure with float drift in it.
  assert.equal(new Member({ openingBalance: 10.005 }).openingBalance, 10.01);
  assert.equal(new Contribution({ amount: 1400.567 }).amount, 1400.57);
  assert.equal(new Fine({ amount: 500, remaining: 500.444 }).remaining, 500.44);
  assert.equal(new Contribution({ amount: 1400 }).amount, 1400);
});

test('a money field carries the bounds and the rounding', () => {
  const amount = Contribution.schema.path('amount');
  // One setter (the rounding) and a min/max pair written to be read by a person.
  assert.equal(amount.setters.filter((setter) => typeof setter === 'function').length, 1);
  assert.equal(amount.options.min[0], 0);
  assert.equal(amount.options.max[0], 1_000_000_000);
  assert.equal(typeof amount.options.min[1], 'string');
  assert.ok(amount.options.min[1].length > 0, 'a refused amount says why');
});

test('one national ID can only belong to one member, in the database', () => {
  const indexes = Member.schema.indexes();
  const onId = indexes.find(([index]) => index.nationalId === 1);
  assert.ok(onId, 'the gate queries by nationalId, so it is indexed');
  assert.equal(onId[1].unique, true);
  // Partial: blanks and free-text notes ("not yet issued") stay out of the index,
  // otherwise several members without a number could not exist at all.
  assert.deepEqual(onId[1].partialFilterExpression, { nationalId: { $type: 'string', $gt: '' } });
});
