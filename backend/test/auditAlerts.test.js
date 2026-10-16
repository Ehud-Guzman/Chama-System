// What earns the super admin an email, how often, and how failed sign-ins are read.
//
// The failure these guard against is an alert that cries wolf: a message every Monday for the
// weekly collection, fifty messages for one bulk delete, or one every time a stranger mistypes
// an address. An alert people stop opening is worse than none, so most of these cases are things
// that must NOT send.
//
// Pure: no database, no mail.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  alertableFlags,
  withinBudget,
  resetBudget,
  alertsEnabled,
  MAX_PER_HOUR,
} = require('../src/utils/superAdminAlerts');
const { summariseSignIns, summariseGate, countAttention } = require('../src/utils/auditOversight');
const { buildSecurityAlertEmail } = require('../src/utils/mailer');

const keys = (entry) => alertableFlags(entry).map((f) => f.key);

test('the shapes of money and access moving earn an alert', () => {
  assert.deepEqual(
    keys({ action: 'update', entityType: 'Contribution', before: { amount: 1400 }, after: { amount: 400 } }),
    ['amount-cut']
  );
  assert.deepEqual(
    keys({ action: 'delete', entityType: 'Expense', before: { amount: 5000 }, after: null }),
    ['money-removed']
  );
  assert.ok(
    keys({ action: 'update', entityType: 'Contribution', before: { memberId: 'a' }, after: { memberId: 'b' } }).includes('moved-member')
  );
  assert.ok(
    keys({ action: 'update', entityType: 'Member', before: { phone: '1' }, after: { phone: '2' } }).includes('credential')
  );
  assert.ok(
    keys({ action: 'update', entityType: 'User', before: { role: 'secretary' }, after: { role: 'admin' } }).includes('role-changed')
  );
});

test('ordinary and routine entries do not', () => {
  // A new contribution, an amount raised, a fine from a balance, and the weekly collection are
  // all flagged or high somewhere in the trail — none of them is worth an email.
  assert.deepEqual(keys({ action: 'create', entityType: 'Contribution', before: null, after: { amount: 1400 } }), []);
  assert.deepEqual(
    keys({ action: 'update', entityType: 'Contribution', before: { amount: 400 }, after: { amount: 1400 } }),
    []
  );
  assert.deepEqual(
    keys({ action: 'create', entityType: 'System', before: null, after: { action: 'collect-week', total: 90000 } }),
    []
  );
  assert.deepEqual(keys({ action: 'update', entityType: 'Fine', before: {}, after: { paidFromBalance: { amount: 100 } } }), []);
});

test('a ledger reset does earn one', () => {
  assert.ok(
    keys({ action: 'reset', entityType: 'System', before: null, after: { action: 'reset-ledger' } }).includes('group-wide')
  );
});

test('an hour holds a handful of messages, then goes quiet, then recovers', () => {
  resetBudget();
  const start = 1_000_000;
  for (let i = 0; i < MAX_PER_HOUR; i += 1) assert.equal(withinBudget(start + i), true, `message ${i + 1}`);
  // Fifty rows deleted at once are one afternoon's worth of email, not fifty.
  assert.equal(withinBudget(start + 100), false);
  assert.equal(withinBudget(start + 59 * 60 * 1000), false);
  // An hour later the allowance is back.
  assert.equal(withinBudget(start + 61 * 60 * 1000), true);
  resetBudget();
});

test('alerts can be switched off', () => {
  const was = process.env.SECURITY_ALERTS;
  try {
    delete process.env.SECURITY_ALERTS;
    assert.equal(alertsEnabled(), true);
    for (const off of ['off', 'false', 'No', '0', 'disabled']) {
      process.env.SECURITY_ALERTS = off;
      assert.equal(alertsEnabled(), false, off);
    }
    process.env.SECURITY_ALERTS = 'on';
    assert.equal(alertsEnabled(), true);
  } finally {
    if (was === undefined) delete process.env.SECURITY_ALERTS;
    else process.env.SECURITY_ALERTS = was;
  }
});

test('what a stranger typed cannot inject markup into the email', () => {
  const { html, text, subject } = buildSecurityAlertEmail({
    chamaName: 'Example Chama',
    subject: '5 failed sign-ins',
    lines: ['5 attempts for <script>alert(1)</script>@x.com'],
  });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(text.includes('<script>')); // plain text stays literal, which is safe in plain text
  assert.equal(subject, 'Example Chama: 5 failed sign-ins');
});

// --- Failed sign-ins ---------------------------------------------------------

const event = (email, reason, extra = {}) => ({
  email,
  reason,
  createdAt: new Date('2026-10-14T10:00:00Z'),
  ip: '203.0.113.7',
  ...extra,
});

test('an attack on a real privileged account outranks a pile of typos', () => {
  const events = [
    ...Array.from({ length: 6 }, () => event('typo@example.com', 'no_such_account')),
    ...Array.from({ length: 3 }, () => event('chair@example.com', 'wrong_password', { userId: 'u1', role: 'admin' })),
    event('sec@example.com', 'wrong_password', { userId: 'u2', role: 'secretary' }),
  ];
  const summary = summariseSignIns(events);
  assert.equal(summary.failed, 10);
  assert.deepEqual(summary.accounts.map((a) => a.email), ['chair@example.com', 'typo@example.com', 'sec@example.com']);
  assert.equal(summary.accounts[0].isAccount, true);
  assert.deepEqual(summary.accounts[0].reasons, ['wrong_password']);
  assert.deepEqual(summary.addresses, [{ ip: '203.0.113.7', count: 10 }]);
});

test('no failed sign-ins is a quiet summary, not an error', () => {
  assert.deepEqual(summariseSignIns([]), { failed: 0, accounts: [], addresses: [] });
});

test('the dashboard count is serious entries by other people, and only those', () => {
  const cut = { action: 'update', entityType: 'Contribution', before: { amount: 1400 }, after: { amount: 400 } };
  const entries = [
    { ...cut, performedBy: { role: 'admin' } },
    { ...cut, performedBy: { role: 'treasurer' } },
    // The super admin's own edit is not news to the super admin.
    { ...cut, performedBy: { role: 'super_admin' } },
    // Ordinary work.
    { action: 'create', entityType: 'Contribution', before: null, after: { amount: 1400 }, performedBy: { role: 'admin' } },
    // The weekly collection is "high" in the trail but is not news: it is the same bar as the emails,
    // or the banner is on every week and nobody reads it.
    { action: 'create', entityType: 'System', before: null, after: { action: 'collect-week' }, performedBy: { role: 'treasurer' } },
  ];
  assert.equal(countAttention(entries), 2);
  assert.equal(countAttention([]), 0);
});

// --- Failed tries at the members' gate -----------------------------------------

test('a real member being aimed at is listed above a number nobody holds', () => {
  const tries = [
    ...Array.from({ length: 8 }, () => event('', 'no_such_member', { target: 'aaaaaaaaaaaa' })),
    ...Array.from({ length: 3 }, () => event('', 'wrong_phone', { target: 'bbbbbbbbbbbb', memberId: { name: 'Example Member' } })),
  ];
  const summary = summariseGate(tries);
  assert.equal(summary.failed, 11);
  assert.deepEqual(summary.targets.map((t) => t.target), ['bbbbbbbbbbbb', 'aaaaaaaaaaaa']);
  assert.equal(summary.targets[0].memberName, 'Example Member');
  assert.deepEqual(summary.targets[0].reasons, ['wrong_phone']);
  assert.deepEqual(summary.addresses, [{ ip: '203.0.113.7', count: 11 }]);
});

test('no failed tries at the gate is a quiet summary', () => {
  assert.deepEqual(summariseGate([]), { failed: 0, targets: [], addresses: [] });
});
