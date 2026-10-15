// When a member stopped being a member, for the purpose of the books.
//
// The ledger charges every member the week's tea and expects his weekly contribution for every week
// that has closed. Both run to *today*, which is right for somebody who is still in the group and
// wrong for somebody who left: his record kept collecting tea and kept counting missed weeks for as
// long as the system ran, and the group's own tea income went the other way — it counted only the
// members who are active today, so the weeks he had really paid tea in disappeared the day he was
// made inactive.
//
// So his accounting ends on the day he was made inactive. This is the one place that says which day
// that is: the date recorded when he was deactivated or resigned, and for a member made inactive
// before the date was recorded, the resignation date, and failing that the last time his record
// changed (which is when he was made inactive unless somebody edited him afterwards; the
// backfill script `npm run members:backfill-inactive` reads the exact day from the audit trail).
//
// `null` for anybody still active: nothing ends.
function membershipEnd(member) {
  if (!member || member.active !== false) return null;
  const candidate = member.deactivatedAt || member.resignedAt || member.updatedAt || null;
  if (!candidate) return null;
  const at = new Date(candidate);
  return Number.isNaN(at.getTime()) ? null : at;
}

// The moment the books should be read as at: today, or the day he left if that came first.
function accountingNow(member, now = Date.now()) {
  const end = membershipEnd(member);
  return end && end.getTime() < now ? end.getTime() : now;
}

module.exports = { membershipEnd, accountingNow };
