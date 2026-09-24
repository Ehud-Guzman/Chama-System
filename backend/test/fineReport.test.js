// "Who owes what" in the fines report: the two questions that come straight after it.
//
// The list used to answer only "how much" — a name and a number. What a treasurer asks
// next is how long the debt has stood and what it is for, and those answers have to come
// from the same rows as the total, or the row and the heading can disagree.
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildFineGroupReport } = require('../src/utils/fineReport');

// One fine as the report's own mapper sees it: populated member and type, remaining owed.
function fine({ member, type, category = 'financial', amount = 500, remaining = 500, date }) {
  return {
    _id: `${member}-${type}-${date}`,
    amount,
    remaining,
    date: new Date(date),
    reason: 'Rehearsal',
    settlements: [],
    deleted: false,
    memberId: { _id: member, name: `Member ${member}`, regNumber: `WM-${member}`, phone: '0700000000', active: true },
    typeId: { name: type, category },
  };
}

const FIXTURES = [
  fine({ member: 'a', type: 'Late arrival', amount: 500, remaining: 500, date: '2026-03-12' }),
  fine({ member: 'a', type: 'Missing meeting', amount: 200, remaining: 0, date: '2026-04-02' }),
  fine({ member: 'a', type: 'Late arrival', amount: 500, remaining: 500, date: '2026-05-20' }),
  fine({ member: 'b', type: 'Disrespect', category: 'disciplinary', amount: 1000, remaining: 400, date: '2026-01-05' }),
  fine({ member: 'c', type: 'Absence', amount: 300, remaining: 0, date: '2026-02-11' }),
];

test('each member\'s row says how long he has owed it, from his unpaid fines only', () => {
  const report = buildFineGroupReport({ fines: FIXTURES });
  const a = report.byMember.find((m) => m.memberId === 'a');

  // His oldest *unpaid* fine is March; the April one was cleared and the May one is
  // newer, and neither of those is the date a meeting is told.
  assert.equal(a.oldestUnpaid.toISOString().slice(0, 10), '2026-03-12');
  assert.equal(a.newestUnpaid.toISOString().slice(0, 10), '2026-05-20');
  assert.equal(a.outstanding, 1000);

  const c = report.byMember.find((m) => m.memberId === 'c');
  assert.equal(c.oldestUnpaid, null, 'a member who owes nothing has no owing-since date');
  assert.deepEqual(c.types, []);
});

test('a member\'s row carries what he owes it for, biggest line first', () => {
  const report = buildFineGroupReport({ fines: FIXTURES });
  const a = report.byMember.find((m) => m.memberId === 'a');

  assert.deepEqual(
    a.types.map((t) => [t.name, t.outstanding, t.count]),
    [
      ['Late arrival', 1000, 2],
    ]
  );

  const b = report.byMember.find((m) => m.memberId === 'b');
  assert.equal(b.types.length, 1);
  assert.equal(b.types[0].category, 'disciplinary');
  assert.equal(b.types[0].outstanding, 400);
  assert.equal(b.types[0].oldest.toISOString().slice(0, 10), '2026-01-05');
});

test('two fine types land as two lines, sorted by what is still owed on each', () => {
  const report = buildFineGroupReport({
    fines: [
      fine({ member: 'a', type: 'Late arrival', amount: 200, remaining: 200, date: '2026-03-01' }),
      fine({ member: 'a', type: 'Missing meeting', amount: 900, remaining: 900, date: '2026-03-02' }),
    ],
  });
  const a = report.byMember.find((m) => m.memberId === 'a');
  assert.deepEqual(a.types.map((t) => t.name), ['Missing meeting', 'Late arrival']);
});

test('the totals count the members owing, and date the oldest debt — not the oldest fine', () => {
  const report = buildFineGroupReport({ fines: FIXTURES });

  assert.equal(report.totals.membersOwing, 2, 'two members owe something');
  assert.equal(report.totals.outstanding, 1400);
  // The oldest fine of all is January (member b, unpaid) — and here that is also the
  // oldest debt. Member c's February fine was cleared, so it cannot move this date.
  assert.equal(report.totals.oldestUnpaid.toISOString().slice(0, 10), '2026-01-05');
  assert.equal(report.totals.firstDate.toISOString().slice(0, 10), '2026-01-05');

  const clearedOnly = buildFineGroupReport({ fines: [FIXTURES[1], FIXTURES[4]] });
  assert.equal(clearedOnly.totals.membersOwing, 0);
  assert.equal(clearedOnly.totals.oldestUnpaid, null);
  assert.equal(clearedOnly.totals.outstanding, 0);
});

test('a member with no unpaid fines still appears, with nothing to date', () => {
  // The report lists everyone who was fined — "who did we fine" is its own question —
  // and the owing-since date and the breakdown are simply empty for a cleared member.
  const report = buildFineGroupReport({ fines: FIXTURES });
  assert.equal(report.byMember.length, 3);
  const c = report.byMember.find((m) => m.memberId === 'c');
  assert.equal(c.fines, 1);
  assert.equal(c.outstanding, 0);
});

test('the biggest debt sorts first, and a tie falls back to the name', () => {
  const report = buildFineGroupReport({ fines: FIXTURES });
  assert.deepEqual(report.byMember.map((m) => m.memberId), ['a', 'b', 'c']);
});
