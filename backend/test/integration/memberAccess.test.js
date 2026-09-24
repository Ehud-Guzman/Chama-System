// The register's permissions, end to end: who may see a member's file, and who may change the
// three fields on it that are more than a description of him.
//
// Three rules are proved here, each of which used to be true only of a screen:
//
//   1. the treasurer keeps the register — adding, editing, resigning, statements — but a member's
//      ID number, phone number and next of kin are an admin's to *replace* once they are on the
//      record. Recording a value that is not there is still the office's work;
//   2. the disciplinary officer's member list returns the identity fields his screen uses and
//      nothing else: no family, no contacts, no notes, no money;
//   3. an admin creates the two record-keeping accounts, and only the super admin hands out the
//      two roles that carry authority over money. A requested 'treasurer' used to fall through to
//      'admin', so the super admin's own dialog created an admin account while its toast said
//      "Treasurer added".
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

const TEST_DB = 'chama-rehearsal-memberaccess';
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

let server;
let base;
let superToken;
let adminToken;
let treasurerToken;
let disciplinaryToken;
let memberId;

const api = (method, route, body, token) =>
  fetch(`${base}${route}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

const send = async (method, route, body, token) => {
  const res = await api(method, route, body, token);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const signIn = async (email) => {
  const res = await api('POST', '/api/auth/login', { email, password: 'rehearsal-password' });
  const body = await res.json();
  assert.equal(res.status, 200, `${email} could not sign in`);
  return body.token;
};

test.before(async () => {
  if (skip) return;

  await mongoose.connect(targetFor(TEST_DB), { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.dropDatabase();

  const password = await bcrypt.hash('rehearsal-password', 10);
  for (const [name, email, role] of [
    ['Rehearsal Super', 'access-super@example.com', 'super_admin'],
    ['Rehearsal Admin', 'access-admin@example.com', 'admin'],
    ['Rehearsal Treasurer', 'access-treasurer@example.com', 'treasurer'],
    ['Rehearsal Disciplinary', 'access-disciplinary@example.com', 'disciplinary'],
  ]) {
    await User.create({ name, email, password, role, active: true });
  }

  // A member with everything on his record, so an omission from a response means something.
  const member = await Member.create({
    name: 'Rehearsal Member',
    phone: '0722000111',
    email: 'member@example.com',
    regNumber: 'REH-0001',
    nationalId: '12345678',
    notes: 'Pays on Thursdays',
    nextOfKin: [{ name: 'Mary', relationship: 'Spouse', phone: '0722000222', email: '' }],
    family: { spouseName: 'Mary', children: ['Ann'] },
  });
  memberId = String(member._id);

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  superToken = await signIn('access-super@example.com');
  adminToken = await signIn('access-admin@example.com');
  treasurerToken = await signIn('access-treasurer@example.com');
  disciplinaryToken = await signIn('access-disciplinary@example.com');
});

test.after(async () => {
  if (skip) return;
  server?.close();
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
});

// ---------------------------------------------------------------------------------
// The treasurer keeps the register
// ---------------------------------------------------------------------------------

test('the treasurer keeps the register: the list, one member, and a statement', { skip }, async () => {
  const list = await send('GET', '/api/members?status=all', null, treasurerToken);
  assert.equal(list.status, 200);
  assert.equal(list.body.members.length, 1);
  assert.equal(typeof list.body.members[0].balance, 'number');

  const one = await send('GET', `/api/members/${memberId}`, null, treasurerToken);
  assert.equal(one.status, 200);
  assert.equal(one.body.member.nationalId, '12345678');
});

test('a treasurer may record what is missing, and may correct everything else', { skip }, async () => {
  // A second member with nothing but a name and a phone number — the state most of this
  // register was entered in: no ID on file yet.
  const created = await send(
    'POST',
    '/api/members',
    { name: 'Half Entered', phone: '0733000444' },
    treasurerToken
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const halfId = String(created.body.member._id);
  assert.equal(created.body.member.nationalId || '', '');

  // Recording the ID of a member who has none is the office's work, whoever is holding the phone.
  const filled = await send('PATCH', `/api/members/${halfId}`, { nationalId: '55554444' }, treasurerToken);
  assert.equal(filled.status, 200, JSON.stringify(filled.body));
  assert.equal(filled.body.member.nationalId, '55554444');

  // …and once it is there, the next attempt to change it is the refusal two tests below.
  const again = await send('PATCH', `/api/members/${halfId}`, { nationalId: '11119999' }, treasurerToken);
  assert.equal(again.status, 403);

  // Correcting the record in every other way stays the treasurer's.
  const edited = await send(
    'PATCH',
    `/api/members/${halfId}`,
    { name: 'Half Entered Properly', notes: 'Added by the treasurer', email: 'half@example.com' },
    treasurerToken
  );
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.member.notes, 'Added by the treasurer');
});

test('a treasurer may not replace an ID, a phone number or the next of kin', { skip }, async () => {
  for (const [field, value, label] of [
    ['nationalId', '99998888', /ID number/],
    ['phone', '0799888777', /phone number/],
    ['nextOfKin', [{ name: 'John', relationship: 'Brother', phone: '0799888777' }], /next of kin/],
  ]) {
    const res = await send('PATCH', `/api/members/${memberId}`, { [field]: value }, treasurerToken);
    assert.equal(res.status, 403, `${field} should have been refused`);
    assert.match(res.body.message, label);
  }

  // Clearing one is the same act as changing it: the key is not taken off the door by
  // leaving the box empty.
  const cleared = await send('PATCH', `/api/members/${memberId}`, { nationalId: '' }, treasurerToken);
  assert.equal(cleared.status, 403);
  assert.match(cleared.body.message, /ID number/);

  // And the refusal really did leave the record alone.
  const member = await Member.findById(memberId).lean();
  assert.equal(member.nationalId, '12345678');
  assert.equal(member.phone, '0722000111');
});

test('sending the same value back is not a change, so the rest of the form still saves', { skip }, async () => {
  // The member form posts every field it holds, so a treasurer editing a member sends his ID,
  // phone and contacts back unchanged. That must not be read as an attempt to change them.
  const res = await send(
    'PATCH',
    `/api/members/${memberId}`,
    {
      name: 'Rehearsal Member',
      phone: '0722000111',
      nationalId: '12345678',
      notes: 'Edited with the whole form posted back',
      nextOfKin: [{ name: 'Mary', relationship: 'Spouse', phone: '0722000222', email: '' }],
    },
    treasurerToken
  );
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.member.notes, 'Edited with the whole form posted back');
});

test('an admin may change all three', { skip }, async () => {
  const res = await send(
    'PATCH',
    `/api/members/${memberId}`,
    {
      nationalId: '22223333',
      phone: '0711222333',
      nextOfKin: [{ name: 'Peter', relationship: 'Brother', phone: '0711222444', email: '' }],
    },
    adminToken
  );
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.member.nationalId, '22223333');

  // Put the record back the way the rest of this suite expects to find it.
  await send(
    'PATCH',
    `/api/members/${memberId}`,
    {
      nationalId: '12345678',
      phone: '0722000111',
      nextOfKin: [{ name: 'Mary', relationship: 'Spouse', phone: '0722000222', email: '' }],
    },
    adminToken
  );
});

// ---------------------------------------------------------------------------------
// The disciplinary officer reads identity, and nothing else
// ---------------------------------------------------------------------------------

test('the disciplinary officer is given the fields his screen uses, and no others', { skip }, async () => {
  const res = await send('GET', '/api/members?status=active&limit=500', null, disciplinaryToken);
  assert.equal(res.status, 200);

  const member = res.body.members.find((m) => String(m._id) === memberId);
  assert.ok(member, 'the officer must still be able to pick a member');

  // What he needs to pick the right person.
  assert.equal(member.name, 'Rehearsal Member');
  assert.equal(member.phone, '0722000111');
  assert.equal(member.regNumber, 'REH-0001');
  assert.equal(member.nationalId, '12345678');

  // What he does not: a member's family, his contacts, his notes, his photograph, and his money.
  for (const field of ['nextOfKin', 'notes', 'email', 'family', 'photoUrl', 'dateOfBirth']) {
    assert.equal(member[field], undefined, `${field} should not reach the disciplinary officer`);
  }
  for (const field of ['balance', 'arrears', 'weeksBehind', 'chaiDue', 'totalContributed']) {
    assert.equal(member[field], undefined, `${field} should not reach the disciplinary officer`);
  }

  // The office's own list is unchanged: the same request as an admin still carries the figures.
  const adminRes = await send('GET', '/api/members?status=active&limit=500', null, adminToken);
  const adminMember = adminRes.body.members.find((m) => String(m._id) === memberId);
  assert.equal(adminMember.nextOfKin.length, 1);
  assert.equal(typeof adminMember.balance, 'number');
});

// ---------------------------------------------------------------------------------
// Who may create which account
// ---------------------------------------------------------------------------------

test('an admin creates the record-keeping accounts, and is refused the money roles', { skip }, async () => {
  const refused = await send(
    'POST',
    '/api/auth/admins',
    {
      name: 'Another Treasurer',
      email: 'another-treasurer@example.com',
      password: 'rehearsal-password1',
      role: 'treasurer',
    },
    adminToken
  );
  assert.equal(refused.status, 403);
  assert.match(refused.body.message, /super admin/i);
  assert.match(refused.body.message, /treasurer/i);

  // A password the group's own policy accepts: letters and numbers, eight characters or more.
  const made = await send(
    'POST',
    '/api/auth/admins',
    {
      name: 'Another Secretary',
      email: 'another-secretary@example.com',
      password: 'rehearsal-password1',
      role: 'secretary',
    },
    adminToken
  );
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.user.role, 'secretary');
});

test('a requested treasurer becomes a treasurer, not an admin', { skip }, async () => {
  // The bug this pins: 'treasurer' was not in the accepted list, so it fell through to 'admin'
  // and the super admin's own Add-account dialog handed out admin rights while saying
  // "Treasurer added".
  const made = await send(
    'POST',
    '/api/auth/admins',
    {
      name: 'Proper Treasurer',
      email: 'proper-treasurer@example.com',
      password: 'rehearsal-password1',
      role: 'treasurer',
    },
    superToken
  );
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.user.role, 'treasurer');
});

test('a role this endpoint does not serve is named, not turned into an admin', { skip }, async () => {
  const res = await send(
    'POST',
    '/api/auth/admins',
    {
      name: 'Nobody',
      email: 'nobody@example.com',
      password: 'rehearsal-password1',
      role: 'chairperson',
    },
    superToken
  );
  assert.equal(res.status, 400);
  assert.match(res.body.message, /admin, treasurer, secretary or disciplinary/);
});
