const { toMoney } = require('./money');

// Where this week stands, as the three answers a collection day asks for.
//
// The reports screen used to open with a twelve-week bar chart, and everybody who looked at it said
// the same thing: the bars were all the same height. Every active member pays the same weekly amount,
// so a chart of what came in each week says "the roster paid 1,400" twelve times and cannot show the
// one thing worth knowing — which weeks are still short. What the office actually opens the app to
// ask on a Thursday is none of those long-run questions: it is "is this week's money in yet, and who
// is still to bring it?" That is a single week, measured against what that week asked for, and it
// moves as the money comes in — 0% on a Friday morning, full by Thursday night.
//
// Kept out of the controller so the rule can be tested without a database: `rows` is one line per
// member who has put anything in this week (`{ memberId, paid }`, gross cash, tea excluded), and
// everything else is arithmetic over that and the roster.
function summariseWeekProgress({ rows = [], activeMemberIds = [], expected = 0, weeklyAmount = 0 } = {}) {
  const active = new Set(activeMemberIds.map(String));
  const members = active.size;
  const asked = toMoney(expected);

  // Money in, whoever brought it: a member who paid a week's amount and then left the group has
  // still paid it, and taking his money out of the week's figure would make the group look short of
  // money it is holding.
  let paid = 0;
  let paidCount = 0;
  let partialCount = 0;
  for (const row of rows) {
    const amount = toMoney(row.paid);
    paid = toMoney(paid + amount);
    // The three counts are the *roster's*: a payment from somebody who is no longer an active
    // member is his money, but he is not one of the members this week is asking.
    if (!active.has(String(row._id ?? row.memberId))) continue;
    if (amount >= weeklyAmount && weeklyAmount > 0) paidCount += 1;
    else if (amount > 0) partialCount += 1;
  }

  // Expected is the roster's own arithmetic: the weekly amount times the members it is asked of.
  // Nothing paid in yet means nothing was short — the week is still running — so the shortfall is
  // the gap between what has come in and what the week asks for, and never a negative.
  const shortfall = toMoney(Math.max(0, asked - paid));
  const percent = asked > 0 ? Math.min(100, Math.round((paid / asked) * 100)) : 0;

  return {
    members,
    expected: asked,
    paid,
    shortfall,
    // How many are still to bring anything at all, which is the list the office chases.
    paidCount,
    partialCount,
    noneCount: Math.max(0, members - paidCount - partialCount),
    percent,
    settled: asked > 0 && shortfall <= 0,
  };
}

module.exports = { summariseWeekProgress };
