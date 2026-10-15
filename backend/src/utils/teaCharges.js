const Member = require('../models/Member');
const { scoredWeeks } = require('./weekCycle');
const { membershipEnd } = require('./membership');

// How many member-weeks of automatic tea the group has charged: one for every member for every
// closed week of the cycle, until the day he left.
//
// The Tea Fund's income is derived rather than logged (100 a member a week), so the figure is this
// count times the weekly tea. It used to be the closed weeks times the members who are *active today*,
// which meant a member's past weeks left the fund the moment he was made inactive — and, the other
// way, that nothing stopped charging him once he had gone. Counting each leaver only to the day he
// left keeps what he paid while he was a member, and stops there.
//
// One implementation, because three screens (the reports summary, the treasurer's member page and
// the setup screen) work the Tea Fund out and would otherwise disagree about a member who left.
async function teaMemberWeeks(config, { activeMembers, leavers } = {}) {
  const [active, gone] = await Promise.all([
    activeMembers === undefined ? Member.countDocuments({ active: true }) : activeMembers,
    leavers === undefined
      ? Member.find({ active: false }).select('active deactivatedAt resignedAt updatedAt').lean()
      : leavers,
  ]);

  return (
    scoredWeeks(config) * active +
    gone.reduce((sum, member) => {
      const end = membershipEnd(member);
      return sum + (end ? scoredWeeks(config, end.getTime()) : 0);
    }, 0)
  );
}

module.exports = { teaMemberWeeks };
