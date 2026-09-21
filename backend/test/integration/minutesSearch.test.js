// Searching the minutes, end to end: the office's search and the members' one.
//
// The reason this needs a real database is the rule no pure test can prove: the
// candidates come from a Mongo regex over stored HTML, and it is the controller that
// then drops the hits which matched only markup. A fake query would pass while the
// real one returned `href` as a word somebody said in a meeting. What a stored minute
// actually contains — sanitized, with the editor's own markup in it — is the input
// this rule is about.
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

const TEST_DB = 'chama-rehearsal-minutes';
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

let server;
let base;
let token;

const MEMBER_ID = '91110001';

const api = (method, route, body) =>
  fetch(`${base}${route}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

async function search(route) {
  const res = await api('GET', route);
  return { status: res.status, ...(await res.json()) };
}

// The minutes the whole file searches. Written through the API, so what is searched
// is what an office typing into the editor would really have stored.
const MINUTES = [
  {
    title: 'Weekly meeting — 21 May 2026',
    date: '2026-05-21',
    content:
      '<p>The group agreed the <strong>fertilizer</strong> subsidy would be revisited in June.</p>',
    visibleToMembers: true,
  },
  {
    title: 'Committee meeting — 04 Jun 2026',
    date: '2026-06-04',
    content: '<p>The (chairman) opened at 7:05pm and the water project was approved.</p>',
    visibleToMembers: true,
  },
  {
    // Named a member's conduct, so the office keeps it off the members' page.
    title: 'Disciplinary hearing',
    date: '2026-07-02',
    content: '<p>The fertilizer complaint against a member was heard.</p>',
    visibleToMembers: false,
  },
  {
    // A minute whose only interesting word is inside its markup: `href` and the URL
    // in it are in the document to a regex and were never said at a meeting.
    title: 'Link meeting',
    date: '2026-07-09',
    content: '<p><a href="https://example.co.ke/agenda">the agenda</a></p>',
    visibleToMembers: true,
  },
];

const written = {};

const idsOf = (body) => body.minutes.map((minute) => String(minute._id)).sort();
const byId = (body, minute) => body.minutes.find((found) => String(found._id) === String(minute._id));

test.before(async () => {
  if (skip) return;

  await mongoose.connect(targetFor(TEST_DB), { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.dropDatabase();

  await User.create({
    name: 'Rehearsal Secretary',
    email: 'minutes@example.com',
    password: await bcrypt.hash('rehearsal-password', 10),
    role: 'super_admin',
    active: true,
  });

  await Member.create({
    name: 'Minutes Reader',
    phone: '0713000010',
    regNumber: 'M/001',
    nationalId: MEMBER_ID,
  });

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const login = await api('POST', '/api/auth/login', {
    email: 'minutes@example.com',
    password: 'rehearsal-password',
  });
  const body = await login.json();
  assert.equal(login.status, 200, 'the rehearsal secretary could not sign in');
  token = body.token;

  for (const [index, minute] of MINUTES.entries()) {
    const res = await api('POST', '/api/minutes', minute);
    assert.equal(res.status, 201, `could not write "${minute.title}"`);
    written[index] = (await res.json()).minute;
  }

  // A minute that was written and then withdrawn: a search must not raise it.
  const withdrawn = await api('POST', '/api/minutes', {
    title: 'Withdrawn minute',
    date: '2026-07-16',
    content: '<p>The tractor purchase was cancelled.</p>',
  });
  const withdrawnId = (await withdrawn.json()).minute._id;
  const removed = await api('DELETE', `/api/minutes/${withdrawnId}`);
  assert.equal(removed.status, 200);
});

test.after(async () => {
  if (skip) return;
  server?.close();
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
});

test('a word from the body finds the meeting, with the sentence it was found in', { skip }, async () => {
  const found = await search('/api/minutes?q=fertilizer');
  assert.equal(found.status, 200);
  assert.equal(found.total, 2, 'both minutes that mention fertilizer should be found');
  assert.deepEqual(idsOf(found), [written[0]._id, written[2]._id].map(String).sort());

  const may = byId(found, written[0]);
  assert.equal(may.match.field, 'content');
  assert.match(may.match.snippet, /fertilizer/);
  assert.match(may.match.snippet, /subsidy/);
  // The whole minute comes back, so a result can be opened for editing as it stands.
  assert.match(may.content, /fertilizer/);
  assert.equal(found.truncated, false, 'four minutes is nowhere near the scan ceiling');

  // Capital letters are the reader's business, not the search's.
  const shouted = await search('/api/minutes?q=FERTILIZER');
  assert.deepEqual(idsOf(shouted), idsOf(found));
});

test('a hit on the markup is not a result', { skip }, async () => {
  // `href` and `strong` are in the stored HTML of these minutes and in nobody's
  // mouth. A result showing a sentence with no such word in it is worse than none.
  for (const term of ['href', 'strong', 'https']) {
    const found = await search(`/api/minutes?q=${encodeURIComponent(term)}`);
    assert.equal(found.status, 200);
    assert.equal(found.total, 0, `"${term}" is markup, not a word from a meeting`);
  }

  // The words the reader can see in that link are found.
  const agenda = await search('/api/minutes?q=agenda');
  assert.equal(agenda.total, 1);
  assert.equal(agenda.minutes[0].match.field, 'content');
  assert.match(agenda.minutes[0].match.snippet, /the agenda/);
});

test('a title, a word and a date are all searched', { skip }, async () => {
  const title = await search('/api/minutes?q=disciplinary');
  assert.equal(title.total, 1);
  assert.equal(title.minutes[0].match.field, 'title');
  assert.equal(title.minutes[0].match.snippet, '');

  const day = await search('/api/minutes?q=21/05/2026');
  assert.equal(day.total, 1);
  assert.equal(String(day.minutes[0]._id), String(written[0]._id));
  assert.equal(day.minutes[0].match.field, 'date');

  // A year is a question about dates, and the withdrawn minute is not an answer.
  const year = await search('/api/minutes?q=2026');
  assert.equal(year.total, 4);
  assert.equal(year.minutes.some((minute) => minute.title === 'Withdrawn minute'), false);
});

test('what was typed is characters, not a pattern', { skip }, async () => {
  // A full stop is a full stop. Left unescaped it would match every character in
  // every minute and so return all four; what it finds are the three whose words
  // actually contain one. The link minute's dots are in its href — markup, which is
  // never what a search is looking at.
  const stops = await search('/api/minutes?q=.');
  assert.equal(stops.status, 200);
  assert.equal(stops.total, 3);
  assert.equal(stops.minutes.some((minute) => minute.title === 'Link meeting'), false);

  // The brackets around `(chairman)` are the office's punctuation: they do not throw
  // as a group, and the word inside them is found as it was written.
  const literal = await search(`/api/minutes?q=${encodeURIComponent('(chairman)')}`);
  assert.equal(literal.status, 200);
  assert.equal(literal.total, 1);
  assert.equal(String(literal.minutes[0]._id), String(written[1]._id));

  // Money is money: nobody has said "1,400" in these minutes, and a comma is not a
  // pattern that might have found something.
  const money = await search('/api/minutes?q=1%2C400');
  assert.equal(money.status, 200);
  assert.equal(money.total, 0);
});

test('a minute withheld from members is still found by the office', { skip }, async () => {
  const office = await search('/api/minutes?q=fertilizer');
  assert.equal(office.total, 2);

  const members = await search(`/api/public/minutes?nationalId=${MEMBER_ID}&q=fertilizer`);
  assert.equal(members.status, 200);
  assert.equal(members.total, 1, 'the disciplinary minute must not reach a member');
  assert.equal(String(members.minutes[0].id), String(written[0]._id));

  // What a member gets is the sentence the word was found in — and never the body.
  assert.match(members.minutes[0].preview, /fertilizer subsidy/);
  for (const minute of members.minutes) {
    assert.equal('content' in minute, false, 'the members list must not carry a minute body');
  }

  const hearing = await search(`/api/public/minutes?nationalId=${MEMBER_ID}&q=disciplinary`);
  assert.equal(hearing.total, 0);

  // The gate still stands in front of the search itself.
  const ungated = await search('/api/public/minutes?q=fertilizer');
  assert.equal(ungated.status, 400);
});

test('browsing the minutes is unchanged', { skip }, async () => {
  const browsed = await search('/api/minutes');
  assert.equal(browsed.status, 200);
  assert.equal(browsed.total, 4);
  assert.equal(browsed.page, 1);
  assert.equal(browsed.pages, 1);
  assert.deepEqual(
    idsOf(browsed),
    [written[0]._id, written[1]._id, written[2]._id, written[3]._id].map(String).sort()
  );
  for (const minute of browsed.minutes) {
    assert.equal('match' in minute, false, 'a browse row has no search match to show');
  }

  const members = await search(`/api/public/minutes?nationalId=${MEMBER_ID}`);
  assert.equal(members.status, 200);
  assert.equal(members.total, 3, 'the disciplinary minute is not published to members');
  for (const minute of members.minutes) {
    assert.equal('content' in minute, false);
  }
});
