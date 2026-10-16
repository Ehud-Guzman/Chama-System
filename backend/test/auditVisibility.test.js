// Who may read which audit entries, and the oversight read built for the super admin.
//
// The point of the restriction is what the lower roles can no longer see, so most of the
// cases are an admin or treasurer failing to find something — and the rest check that
// ordinary entries were not swept up with it.
//
// Pure: no database.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  restrictToRole,
  canSeeEntry,
  hiddenEntityTypes,
} = require('../src/utils/auditVisibility');
const { summariseActors, accountPosture } = require('../src/utils/auditOversight');
const { verifyChain, chainedEntry } = require('../src/utils/auditChain');

const userEntry = (role, action = 'update') => ({
  action,
  entityType: 'User',
  before: action === 'create' ? null : { role },
  after: action === 'delete' ? null : { role },
});

test('the super admin is not restricted at all', () => {
  const match = { entityType: 'Fine' };
  assert.equal(restrictToRole('super_admin', match), match);
  assert.equal(canSeeEntry('super_admin', userEntry('admin')), true);
  assert.deepEqual(hiddenEntityTypes('super_admin'), []);
});

test('everyone else gets the same filter, narrowed rather than replaced', () => {
  const asked = { entityType: 'Contribution', $or: [{ 'after.name': /x/i }] };
  for (const role of ['admin', 'treasurer', 'secretary']) {
    const out = restrictToRole(role, asked);
    // The reader's own filter survives untouched inside the $and.
    assert.equal(out.$and[0], asked);
    assert.ok(out.$and[1].$nor.length > 0);
  }
  // With nothing asked, the restriction stands alone.
  assert.ok(restrictToRole('admin', {}).$nor);
});

test('entries about admin, treasurer and super admin accounts are the super admin\'s alone', () => {
  for (const role of ['super_admin', 'admin', 'treasurer']) {
    for (const action of ['create', 'update', 'delete']) {
      assert.equal(canSeeEntry('admin', userEntry(role, action)), false, `${action} ${role}`);
      assert.equal(canSeeEntry('treasurer', userEntry(role, action)), false);
    }
  }
});

test('a role being taken away from a privileged account is hidden too', () => {
  // The account is an admin before the change and a secretary after it: the entry is about
  // an admin account either way.
  const demoted = { action: 'update', entityType: 'User', before: { role: 'admin' }, after: { role: 'secretary' } };
  assert.equal(canSeeEntry('admin', demoted), false);
});

test('the accounts an admin manages stay visible to them', () => {
  assert.equal(canSeeEntry('admin', userEntry('secretary')), true);
  assert.equal(canSeeEntry('admin', userEntry('disciplinary', 'create')), true);
});

test('backups, restores and job runs are hidden; ledger operations are not', () => {
  const system = (action) => ({ action: 'create', entityType: 'System', after: { action } });
  assert.equal(canSeeEntry('admin', system('backup-download')), false);
  assert.equal(canSeeEntry('admin', system('restore-backup')), false);
  assert.equal(canSeeEntry('admin', { action: 'create', entityType: 'JobRun', after: {} }), false);
  // A week collected or taken back is the committee's business, and an admin runs it.
  assert.equal(canSeeEntry('admin', system('collect-week')), true);
  assert.equal(canSeeEntry('admin', { action: 'delete', entityType: 'System', before: { action: 'undo-collect-week' } }), true);
  assert.deepEqual(hiddenEntityTypes('admin'), ['JobRun']);
});

test('money, members and records are untouched by the restriction', () => {
  for (const entityType of ['Contribution', 'Expense', 'Fine', 'Member', 'Minute', 'Settings']) {
    assert.equal(canSeeEntry('secretary', { action: 'update', entityType, before: {}, after: {} }), true, entityType);
  }
});

// --- Oversight --------------------------------------------------------------

const actor = (id, name, role) => ({ _id: id, name, role });
const at = (iso) => new Date(iso);

test('officers are ranked by the entries worth asking about, not by volume', () => {
  const busy = actor('a1', 'Busy Admin', 'admin');
  const cutter = actor('a2', 'Quiet Treasurer', 'treasurer');
  const entries = [
    ...Array.from({ length: 6 }, () => ({
      action: 'create', entityType: 'Contribution', performedBy: busy,
      before: null, after: { amount: 1400 }, createdAt: at('2026-10-10T08:00:00Z'),
    })),
    {
      action: 'update', entityType: 'Contribution', performedBy: cutter,
      before: { amount: 1400 }, after: { amount: 400 }, createdAt: at('2026-10-12T08:00:00Z'),
    },
    {
      action: 'delete', entityType: 'Expense', performedBy: cutter,
      before: { amount: 5000 }, after: null, createdAt: at('2026-10-13T08:00:00Z'),
    },
  ];

  const [first, second] = summariseActors(entries);
  assert.equal(first.name, 'Quiet Treasurer');
  assert.equal(first.amountCuts, 1);
  assert.equal(first.moneyRemoved, 1);
  assert.equal(first.deletes, 1);
  assert.equal(first.serious, 2);
  assert.equal(first.lastAt.toISOString(), '2026-10-13T08:00:00.000Z');
  assert.equal(second.name, 'Busy Admin');
  assert.equal(second.entries, 6);
  assert.equal(second.serious, 0);
});

test('an entry with no known actor is skipped rather than invented', () => {
  assert.deepEqual(
    summariseActors([{ action: 'create', entityType: 'Fine', performedBy: null, after: {}, createdAt: new Date() }]),
    []
  );
});

test('account posture names the weak spots, and only for accounts that hold authority', () => {
  const users = [
    { _id: 'u1', name: 'Chair', role: 'admin', active: true, twoFactor: { enabled: false }, passwordChangedAt: null },
    { _id: 'u2', name: 'Safe Treasurer', role: 'treasurer', active: true, twoFactor: { enabled: true }, passwordChangedAt: new Date() },
    { _id: 'u3', name: 'Secretary', role: 'secretary', active: true, twoFactor: { enabled: false }, passwordChangedAt: null },
    { _id: 'u4', name: 'Gone Admin', role: 'admin', active: false, twoFactor: { enabled: false }, passwordChangedAt: null },
  ];

  const on = accountPosture(users, { twoFactorGroupOn: true });
  assert.deepEqual(on.map((a) => a.name), ['Chair', 'Gone Admin', 'Safe Treasurer']);
  assert.deepEqual(on[0].notes, ['no second factor', 'password never changed']);
  // A deactivated account is not nagged about its second factor.
  assert.deepEqual(on[1].notes, ['deactivated']);
  assert.deepEqual(on[2].notes, []);

  // With two-factor off for the group, its absence is not a finding.
  const off = accountPosture(users, { twoFactorGroupOn: false });
  assert.deepEqual(off[0].notes, ['password never changed']);
});

// --- The chain across a batch boundary --------------------------------------

test('a trail read in batches is checked across the join', () => {
  const made = [];
  let previous = null;
  for (let i = 0; i < 4; i += 1) {
    const next = chainedEntry({
      previous,
      entry: { action: 'create', entityType: 'Fine', entityId: `e${i}`, performedBy: 'u', before: null, after: { amount: i } },
      createdAt: new Date('2026-01-02T10:00:00.000Z'),
    });
    made.push(next);
    previous = next;
  }

  const [first, second] = [made.slice(0, 2), made.slice(2)];
  assert.equal(verifyChain(first).ok, true);
  assert.equal(verifyChain(second, { continueFrom: first[1] }).ok, true);

  // The second batch is internally perfect, but it does not follow the first.
  const stranger = made[0];
  const wrongJoin = verifyChain(second, { continueFrom: stranger });
  assert.equal(wrongJoin.ok, false);

  // Without the join the same break was invisible — which is the gap this closes.
  assert.equal(verifyChain(second).ok, true);
});
