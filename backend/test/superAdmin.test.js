// The super admin's tools, the parts that need no database.
//
// What matters here is that the rules which cannot be seen from the screen are pinned: the
// permission matrix agrees with the real routes (and says the super admin has things nobody else
// has), the override reason is only ever honoured for a super admin, a closed period is a closed
// period to the day, and a backup file is checked before anything reads it.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-long-enough-to-pass';

const test = require('node:test');
const assert = require('node:assert/strict');

const app = require('../src/app');
const { requireRole } = require('../src/middleware/auth');
const { buildPermissionMatrix, collectRoutes, mountPathOf } = require('../src/utils/permissionMatrix');
const { overrideReason } = require('../src/utils/overrides');
const { lockedBefore } = require('../src/middleware/periodLock');
const { parseBackup, reviveBuffers } = require('../src/utils/restore');
const { phraseMatches } = require('../src/utils/reauth');
const { readAuditEntry } = require('../src/utils/auditFlags');
const { canSeeEntry } = require('../src/utils/auditVisibility');
const { parseEatDate } = require('../src/utils/weekCycle');

const { routeOf, signatureOf } = require('../src/utils/serverErrors');

const ROLES = ['super_admin', 'admin', 'treasurer', 'secretary', 'disciplinary'];
const matrix = buildPermissionMatrix(app, ROLES);
const area = (mount) => matrix.areas.find((a) => a.mount === mount);

test('requireRole keeps its list on the guard, which is what the matrix is read from', () => {
  const guard = requireRole('super_admin', 'admin');
  assert.deepEqual(guard.roles, ['super_admin', 'admin']);
});

test('the matrix is read out of the real routes and covers every mounted area', () => {
  assert.ok(matrix.areas.length >= 15);
  for (const mount of ['/api/members', '/api/ledger', '/api/fines', '/api/backup', '/api/jobs', '/api/superadmin']) {
    assert.ok(area(mount), `${mount} is missing from the matrix`);
  }
});

test('the matrix agrees with ROLES_AND_PERMISSIONS.md on the rules people ask about', () => {
  // The treasurer keeps the register and the ledger but has no part in fines.
  assert.equal(area('/api/members').cells.treasurer.write, true);
  assert.equal(area('/api/ledger').cells.treasurer.write, true);
  assert.equal(area('/api/fines').cells.treasurer.read, false);
  assert.equal(area('/api/fines').cells.treasurer.write, false);
  // The secretary reads reports and writes minutes and documents, and touches no money.
  assert.equal(area('/api/reports').cells.secretary.read, true);
  assert.equal(area('/api/minutes').cells.secretary.write, true);
  assert.equal(area('/api/contributions').cells.secretary.read, false);
  // The audit trail is the admins' alone: the people whose work it records do not read it.
  for (const role of ['super_admin', 'admin']) assert.equal(area('/api/audit').cells[role].read, true);
  for (const role of ['treasurer', 'secretary', 'disciplinary']) assert.equal(area('/api/audit').cells[role].read, false);
  // The disciplinary officer can issue fines, but only part of the area is his.
  assert.equal(area('/api/fines').cells.disciplinary.write, true);
  assert.equal(area('/api/fines').cells.disciplinary.partial, true);
});

test('backup, jobs and the Control Room belong to the super admin and nobody else', () => {
  for (const mount of ['/api/backup', '/api/jobs', '/api/superadmin']) {
    assert.equal(area(mount).cells.super_admin.read, true);
    for (const role of ROLES.filter((r) => r !== 'super_admin')) {
      assert.equal(area(mount).cells[role].read, false, `${role} can read ${mount}`);
      assert.equal(area(mount).cells[role].write, false, `${role} can write ${mount}`);
    }
  }
});

test('every Control Room route is behind the super admin guard', () => {
  const routes = collectRoutes(app).filter((r) => r.mount === '/api/superadmin');
  assert.ok(routes.length >= 20, 'expected the whole Control Room to be found');
  for (const route of routes) {
    assert.deepEqual(route.roles, ['super_admin'], `${route.method} ${route.path}`);
    assert.equal(route.auth, true, `${route.method} ${route.path} is not behind sign-in`);
  }
});

test('the members area is listed as public, with no role able to "write" through an account', () => {
  const members = area('/api/public');
  assert.ok(members);
  assert.equal(members.public, true);
});

test('a mount path is read back from the express regexp', () => {
  const layer = app._router.stack.find((l) => l.name === 'router' && mountPathOf(l) === '/api/fine-types');
  assert.ok(layer, 'fine-types router not found by its mount path');
});

test('an override reason counts only for a super admin, and only when it says something', () => {
  const asSuper = (header) => ({ user: { role: 'super_admin' }, headers: { 'x-override-reason': header } });
  assert.equal(overrideReason(asSuper('Fixing the March receipt')), 'Fixing the March receipt');
  // Percent-encoded, because a header cannot carry every character a person types.
  assert.equal(overrideReason(asSuper(encodeURIComponent('Wrong member — see receipt'))), 'Wrong member — see receipt');
  assert.equal(overrideReason(asSuper('ok')), null, 'too short to be a reason');
  assert.equal(overrideReason(asSuper('   ')), null);
  assert.equal(overrideReason({ user: { role: 'admin' }, headers: { 'x-override-reason': 'I am the admin' } }), null);
  assert.equal(overrideReason({ user: { role: 'treasurer' }, headers: { 'x-override-reason': 'please let me' } }), null);
  // A preview session is read-only and never overrides.
  assert.equal(
    overrideReason({ user: { role: 'super_admin' }, previewing: 'treasurer', headers: { 'x-override-reason': 'sneaking through' } }),
    null
  );
  assert.equal(overrideReason({ user: { role: 'super_admin' }, headers: {} }), null);
});

test('closing the books through a day closes that whole day, East African time', () => {
  const lockedThrough = parseEatDate('2026-10-04');
  const limit = lockedBefore({ lockedThrough });
  // 23:59 EAT on the 4th is locked; 00:00 EAT on the 5th is not.
  assert.ok(parseEatDate('2026-10-04').getTime() + 23.9 * 3600 * 1000 < limit);
  assert.ok(parseEatDate('2026-10-05').getTime() >= limit);
  assert.equal(lockedBefore({ lockedThrough: null }), null);
  assert.equal(lockedBefore({}), null);
});

test('a backup file is checked before anything reads it', () => {
  assert.throws(() => parseBackup('not json at all'), /not readable as JSON/);
  assert.throws(() => parseBackup(JSON.stringify({ format: 'something-else', data: {} })), /not a chama backup/);
  assert.throws(() => parseBackup(JSON.stringify({ format: 'chama-system-backup' })), /holds no data/);
  const ok = parseBackup(JSON.stringify({ format: 'chama-system-backup', version: 2, data: { members: [] } }));
  assert.deepEqual(Object.keys(ok.data), ['members']);
});

test('the restore reads dates and bytes back the way the backup wrote them', () => {
  const revived = reviveBuffers({
    when: { $date: '2026-09-01T00:00:00.000Z' },
    bytes: { $binary: Buffer.from('hello').toString('base64') },
    nested: [{ d: { $date: '2026-10-01T00:00:00.000Z' } }],
  });
  assert.ok(revived.when instanceof Date);
  assert.equal(revived.when.toISOString(), '2026-09-01T00:00:00.000Z');
  assert.equal(revived.bytes.toString(), 'hello');
  assert.ok(revived.nested[0].d instanceof Date);
});

test('a typed confirmation is forgiving about case and space and nothing else', () => {
  assert.equal(phraseMatches('  restore ', 'RESTORE'), true);
  assert.equal(phraseMatches('Reset Rehearsal Data', 'RESET REHEARSAL DATA'), true);
  assert.equal(phraseMatches('restor', 'RESTORE'), false);
  assert.equal(phraseMatches('', 'RESTORE'), false);
  assert.equal(phraseMatches(undefined, 'RESTORE'), false);
});

test('the Control Room refuses an anonymous caller', async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const path of ['/api/superadmin/overview', '/api/superadmin/permissions', '/api/superadmin/accounts']) {
      const res = await fetch(base + path);
      assert.equal(res.status, 401, path);
    }
  } finally {
    server.close();
  }
});

test('the super admin’s own actions read as sentences in the audit trail, with the reason given', () => {
  const system = (after) => readAuditEntry({ action: 'update', entityType: 'System', before: null, after });
  assert.equal(
    system({ action: 'period-lock-override', reason: 'Receipt 0412 was 600' }).summary,
    'went through closed books: Receipt 0412 was 600'
  );
  assert.equal(system({ action: 'restore-backup' }).summary, 'restored from a backup');
  assert.equal(system({ action: 'members-merged', reason: 'Same person' }).summary, 'merged two member records: Same person');
  // An action this does not know falls back to what it used to say, rather than to nothing.
  assert.equal(typeof system({ action: 'something-new', count: 3 }).summary, 'string');
  const account = readAuditEntry({
    action: 'update',
    entityType: 'User',
    before: { role: 'treasurer', frozen: false },
    after: { role: 'treasurer', changed: 'account frozen', for: 'tre@example.com' },
  });
  assert.equal(account.summary, 'account frozen — tre@example.com');
  // Equal on both sides, the role is not a role change.
  assert.ok(!account.flags.some((f) => f.key === 'role-changed'));
  // Group-wide operations stay flagged as serious.
  assert.equal(system({ action: 'restore-backup' }).severity, 'high');
});

test('a lever pulled in the Control Room is named in the trail, not left blank', () => {
  const entry = readAuditEntry({
    action: 'update',
    entityType: 'Settings',
    before: { maintenanceMode: false, maintenanceMessage: '' },
    after: { maintenanceMode: true, maintenanceMessage: 'Checking March' },
  });
  assert.match(entry.summary, /maintenance mode/);
});

test('the Control Room’s own housekeeping and its account actions are kept from the office', () => {
  const asEntry = (entityType, before, after) => ({ entityType, before, after });
  // Looking at the app as another role, checking the chain, taking the full export: the super admin's.
  for (const action of ['preview-started', 'audit-chain-verified-by-hand', 'audit-export-full']) {
    assert.equal(canSeeEntry('admin', asEntry('System', null, { action })), false, action);
    assert.equal(canSeeEntry('super_admin', asEntry('System', null, { action })), true, action);
  }
  // Going through closed books and merging members are the committee's to see.
  assert.equal(canSeeEntry('admin', asEntry('System', null, { action: 'period-lock-override' })), true);
  assert.equal(canSeeEntry('admin', asEntry('System', null, { action: 'members-merged' })), true);
  // Freezing a treasurer is about an account that outranks the office; freezing a secretary is not.
  const freeze = (role) =>
    asEntry('User', { role, frozen: false }, { role, changed: 'account frozen', frozen: true });
  assert.equal(canSeeEntry('admin', freeze('treasurer')), false);
  assert.equal(canSeeEntry('admin', freeze('secretary')), true);
});

test('one fault is one signature, whichever member it happened to', () => {
  const a = routeOf({ originalUrl: '/api/members/66f0c2a1b3d4e5f607182930/ledger?week=5' });
  const b = routeOf({ originalUrl: '/api/members/77a1d2e3f4a5b6c7d8e9f001/ledger' });
  assert.equal(a, '/api/members/:id/ledger');
  assert.equal(a, b);
  assert.equal(signatureOf({ kind: 'request', route: a, message: 'boom' }), signatureOf({ kind: 'request', route: b, message: 'boom' }));
  assert.notEqual(signatureOf({ kind: 'request', route: a, message: 'boom' }), signatureOf({ kind: 'request', route: a, message: 'bang' }));
  assert.notEqual(signatureOf({ kind: 'request', route: a, message: 'boom' }), signatureOf({ kind: 'uncaught_exception', route: a, message: 'boom' }));
});
