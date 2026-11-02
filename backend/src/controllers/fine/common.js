// The fines controller, part: common. controllers/fineController.js is the index the routes use.

const FineType = require('../../models/FineType');

// The disciplinary officer works in his own world: he issues conduct fines and has
// no business reading the treasurer's. So every read he makes is narrowed to
// disciplinary-category types — the same boundary createFine already enforces when
// he issues one — and his exports say so on the page.
async function scopeForUser(user) {
  if (user.role !== 'disciplinary') return { isScoped: false, filter: {}, scopeLabel: 'All fines' };

  const typeIds = await FineType.distinct('_id', { category: 'disciplinary' });
  return {
    isScoped: true,
    filter: { typeId: { $in: typeIds } },
    scopeLabel: 'Disciplinary fines',
  };
}

// The totals a screen or a report shows above the list.
function summariseFines(fines) {
  const issued = fines.reduce((sum, f) => sum + (Number(f.amount) || 0), 0);
  const outstanding = fines.reduce((sum, f) => sum + (Number(f.remaining) || 0), 0);
  return {
    count: fines.length,
    issued,
    outstanding,
    cleared: issued - outstanding,
    pendingCount: fines.filter((f) => Number(f.remaining) > 0).length,
    clearedCount: fines.filter((f) => Number(f.remaining) <= 0).length,
  };
}

function toFineJson(fine) {
  return {
    id: fine._id,
    date: fine.date,
    amount: fine.amount,
    remaining: fine.remaining,
    reason: fine.reason || '',
    status: Number(fine.remaining) > 0 ? 'pending' : 'settled',
    type: fine.typeId?.name || null,
    category: fine.typeId?.category || null,
    memberId: fine.memberId?._id || fine.memberId,
    memberName: fine.memberId?.name || null,
    memberRegNumber: fine.memberId?.regNumber || null,
    issuedBy: fine.issuedBy?.name || null,
    voided: fine.deleted === true,
    // What has been paid against it, oldest first, so the screen can show the history under the
    // fine and offer to undo a payment keyed in by mistake. `index` is the payment's place on the
    // fine, which is how an undo names it. `source` says how it was paid: taken from his balance,
    // cash he handed over, out of a contribution, or null for a payment recorded before the
    // office was asked (those are listed under "Past payments to check").
    payments: (fine.settlements || []).map((s, index) => ({
      index,
      amount: s.amount,
      date: s.date,
      source: s.source || (s.contributionId ? 'contribution' : null),
    })),
  };
}

module.exports = {
  scopeForUser,
  summariseFines,
  toFineJson,
};
