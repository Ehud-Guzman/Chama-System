// The weekly budget, and who has already been emailed.
//
// Two questions with consequences: how many reminders a member may have in a week — the thing
// that stops a member who is behind being told so every few days — and what counts as one of
// them, which is the thing that decides whether the answer is right. Both are pure functions
// here, so this suite needs no database, no clock and no mail account: the module's one query is
// the read of the audit trail, and the arithmetic it feeds is what is checked below.
//
// The week is pinned to a fixture rather than to "now", because a test that passes on a Friday
// and fails on a Thursday is a test nobody trusts.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_MAX_PER_WEEK,
  MAX_PER_WEEK_CEILING,
  normaliseMaxPerWeek,
  weekWindow,
  reminderFilter,
  allowanceFor,
  overLimitReason,
  kindLabel,
} = require('../src/utils/reminderLog');
const { EAT_OFFSET_MS } = require('../src/utils/weekCycle');

const FRIDAY = new Date('2026-09-18T00:00:00+03:00');
const WEDNESDAY_SAME_WEEK = new Date('2026-09-23T12:00:00+03:00');
const THURSDAY_JUST_CLOSED = new Date('2026-09-17T23:59:00+03:00');
const NEXT_FRIDAY = new Date('2026-09-25T00:00:00+03:00');

// The weekday read in EAT rather than in the machine's own zone, which is the same rule the
// module under test follows.
const weekday = (value) =>
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][
    new Date(new Date(value).getTime() + EAT_OFFSET_MS).getUTCDay()
  ];

test('the fixtures are the days this suite thinks they are', () => {
  assert.equal(weekday(FRIDAY), 'Fri');
  assert.equal(weekday(WEDNESDAY_SAME_WEEK), 'Wed');
  assert.equal(weekday(THURSDAY_JUST_CLOSED), 'Thu');
  assert.equal(weekday(NEXT_FRIDAY), 'Fri');
});

test('the limit is one a week unless the group says otherwise', () => {
  assert.equal(DEFAULT_MAX_PER_WEEK, 1);
  // Blank, missing and unreadable all fall back to the default rather than to "no limit": a
  // settings document written before this field existed must not open the floodgates.
  for (const value of [undefined, null, '', '   ', 'lots', NaN, {}]) {
    assert.equal(normaliseMaxPerWeek(value), DEFAULT_MAX_PER_WEEK, `${String(value)} -> default`);
  }
  // A string is what a form posts, and it means the number it looks like.
  assert.equal(normaliseMaxPerWeek('3'), 3);
  assert.equal(normaliseMaxPerWeek(3), 3);
});

test('a limit that is not a whole number is not obeyed blindly', () => {
  assert.equal(normaliseMaxPerWeek(2.9), 2, 'a fraction of a reminder does not exist');
  assert.equal(normaliseMaxPerWeek(-4), 0, 'a negative limit is not a lock');
  assert.equal(normaliseMaxPerWeek(999), MAX_PER_WEEK_CEILING, 'the ceiling holds');
  assert.equal(normaliseMaxPerWeek(0), 0, 'zero is kept — it means no limit');
});

test("the week is the group's own week, Friday to Thursday", () => {
  const friday = weekWindow(FRIDAY);
  const wednesday = weekWindow(WEDNESDAY_SAME_WEEK);
  const thursday = weekWindow(THURSDAY_JUST_CLOSED);
  const nextFriday = weekWindow(NEXT_FRIDAY);

  // The window opens at Friday 00:00 EAT — the same instant the ledger counts a week from.
  assert.equal(weekday(friday.weekStart), 'Fri');
  assert.equal(
    new Date(friday.weekStart.getTime() + EAT_OFFSET_MS).toISOString().slice(11, 19),
    '00:00:00'
  );
  assert.equal(friday.since.getTime(), friday.weekStart.getTime(), 'the filter and the label agree');

  // Everything from Friday to the following Thursday is one week...
  assert.equal(wednesday.weekStart.getTime(), friday.weekStart.getTime());
  // ...and the Thursday before it belongs to the week that has closed, not to this one. A cap
  // that counted "the last seven days" would put these two in the same bucket, and a member
  // would get two reminders inside what the ledger calls one week.
  assert.notEqual(thursday.weekStart.getTime(), friday.weekStart.getTime());
  assert.ok(thursday.weekStart.getTime() < friday.weekStart.getTime());
  assert.notEqual(nextFriday.weekStart.getTime(), friday.weekStart.getTime());
});

test('a reminder is recognised from the audit entry alone', () => {
  const filter = reminderFilter({ memberIds: ['member-a', 'member-b'], since: FRIDAY });

  assert.equal(filter.entityType, 'Notification');
  assert.equal(filter['after.channel'], 'email');
  // `null` is the point: entries written before the kind was recorded are reminders too, so the
  // cap does not forget this week's sends on the day it is deployed.
  assert.deepEqual(filter['after.kind'], { $in: [null, 'reminder'] });
  assert.deepEqual(filter.entityId, { $in: ['member-a', 'member-b'] });
  assert.equal(filter.createdAt.$gte.getTime(), FRIDAY.getTime());

  // Fine emails carry their own kind ('fine_issued', 'fine_paid'), which this excludes: they
  // record something that happened to the member rather than nudging him about it.
  assert.ok(!filter['after.kind'].$in.includes('fine_issued'));
  assert.ok(!filter['after.kind'].$in.includes('fine_paid'));
});

test('the filter is narrow when the caller has no members to ask about', () => {
  const filter = reminderFilter();
  assert.equal('entityId' in filter, false, 'no member list means no member clause');
  assert.equal('createdAt' in filter, false, 'no window means everything, which the history uses');
});

test('a member is allowed his first reminder and refused his next', () => {
  assert.deepEqual(allowanceFor(0, DEFAULT_MAX_PER_WEEK), {
    unlimited: false,
    max: 1,
    sent: 0,
    remaining: 1,
    allowed: true,
  });

  const refused = allowanceFor(1, DEFAULT_MAX_PER_WEEK);
  assert.equal(refused.allowed, false);
  assert.equal(refused.remaining, 0);

  // A limit lowered from three to one leaves members above it rather than below, and the answer
  // is the same: he has had his.
  assert.equal(allowanceFor(3, 1).allowed, false);
  // Two allowed, one taken: still room.
  assert.equal(allowanceFor(1, 2).allowed, true);
  assert.equal(allowanceFor(1, 2).remaining, 1);
  // The count is coerced, not trusted: a string is still a count.
  assert.equal(allowanceFor('2', '3').allowed, true);
  assert.equal(allowanceFor(undefined, 1).allowed, true);
});

test('no limit is a real choice, and it is not the same as no reminders', () => {
  const unlimited = allowanceFor(9, 0);
  assert.equal(unlimited.allowed, true);
  assert.equal(unlimited.unlimited, true);
  assert.equal(unlimited.remaining, null, 'a number here would be meaningless');
  // A negative limit is read as no limit, not as a lockdown: refusing to email anybody is not
  // something a typo should be able to do.
  assert.equal(allowanceFor(9, -1).allowed, true);
});

test('the reason names the count, the limit and where to change it', () => {
  const once = overLimitReason(allowanceFor(1, 1));
  assert.match(once, /Already emailed once this week/);
  assert.match(once, /limit 1/);
  assert.match(once, /Settings/, 'a limit with no way to change it is a dead end');

  assert.match(overLimitReason(allowanceFor(4, 3)), /4 times this week \(limit 3\)/);
});

test('each kind of email is named on the history screen', () => {
  assert.equal(kindLabel('reminder'), 'Reminder');
  assert.equal(kindLabel('fine_issued'), 'Fine issued');
  assert.equal(kindLabel('fine_paid'), 'Fine payment');
  // Entries written before the kind existed are reminders, and are labelled as such.
  assert.equal(kindLabel(undefined), 'Reminder');
  assert.equal(kindLabel(null), 'Reminder');
});
