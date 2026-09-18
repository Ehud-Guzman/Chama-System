const Member = require('../models/Member');
const ContributionType = require('../models/ContributionType');
const Contribution = require('../models/Contribution');
const { getOrCreateSettings } = require('../utils/settings');
const { carriedInTotals } = require('../utils/carriedIn');
const { fundBalance } = require('../utils/fundBalance');
const { bucketForType } = require('../utils/ledgerTypes');
const { totalFinesCollected } = require('../utils/finesCollected');
const { visionAndMission } = require('../utils/groupIdentity');

// GET /api/public/overview — PUBLIC, no phone number needed.
// Group-wide totals only: chama name, membership size, and what has been raised
// per fund. Deliberately contains no per-member data — no name, no balance, no
// phone. A member's own record is opened by proving his number (publicLookup),
// not by browsing anything.
async function publicOverview(req, res, next) {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [settings, activeMembers, totalMembersEver, resignedCount, types, totals, thisWeekAgg, finesCollected] =
      await Promise.all([
        getOrCreateSettings(),
        Member.countDocuments({ active: true }),
        Member.countDocuments(),
        Member.countDocuments({ active: false, resignedAt: { $ne: null } }),
        ContributionType.find({ active: true }).sort({ name: 1 }).lean(),
        Contribution.aggregate([
          { $match: { deleted: false } },
          { $group: { _id: '$typeId', total: { $sum: '$amount' } } },
        ]),
        Contribution.aggregate([
          { $match: { deleted: false, date: { $gte: sevenDaysAgo } } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
        totalFinesCollected(),
      ]);

    // The Tea Fund is the one type the public page does not name: its 100 a week
    // is deducted from every member automatically rather than paid in, and its
    // income is derived rather than logged, so there is nothing in the books a
    // reader could trace the figure to. The office's own screens keep it.
    const isTea = (t) => bucketForType(t) === 'chai';

    const totalsMap = new Map(totals.map((t) => [String(t._id), t.total]));
    const byType = types.map((t) => ({
      name: t.name,
      description: t.description || '',
      isGroupFund: Boolean(t.isGroupFund),
      isTeaFund: isTea(t),
      // What the fund already held when the books opened — money that is real and
      // already inside the page's totals, and which would otherwise leave a fund
      // the paper ledger says is full reading as Ksh 0 here because no rows exist
      // against it yet.
      carriedIn: Number(t.openingBalance) || 0,
      totalContributed: totalsMap.get(String(t._id)) || 0,
    }));
    const collected = byType.reduce((sum, t) => sum + t.totalContributed, 0);
    // The money that was already on the books when the cycle opened — the
    // members' carried-forward balances and the funds' floats. "All-time" has to
    // mean it, or the public page tells every member that the years they paid
    // into the paper ledger never happened, and reads as if the group held
    // nothing but what this ledger has watched move.
    const carriedIn = await carriedInTotals();
    const totalContributed = collected + carriedIn.total;
    const thisWeekTotal = thisWeekAgg[0]?.total || 0;

    // Every fund the group holds money in, and what it holds: the one-time
    // carry-in entered at go-live, plus what has come in, minus what has gone out.
    // Expense-tracking funds alone used to be listed, which left the biggest fund
    // on the books (Fines & Penalties) missing from a card that claims to show what
    // each fund holds.
    const fundTypes = types.filter(
      (t) => !isTea(t) && (t.isGroupFund || t.tracksExpenses)
    );
    const fundBalances = await Promise.all(
      fundTypes.map(async (t) => ({
        name: t.name,
        tracksExpenses: Boolean(t.tracksExpenses),
        // The fund's one-time carry-in is what keeps a fund the paper ledger says
        // is full from reading as if the group had never collected anything.
        ...(await fundBalance(t._id, { carriedIn: t.openingBalance })),
      }))
    );
    // What the group has spent from the funds it tracks expenses on. fundBalance()
    // reports that as `totalExpenses`; reading a `spent` key here meant this always
    // summed to zero, so the page showed "Ksh 0 spent from tracked funds" and a
    // "cash held now" that never came down when the group paid for anything.
    const totalExpenses = fundBalances
      .filter((f) => f.tracksExpenses)
      .reduce((sum, f) => sum + (Number(f.totalExpenses) || 0), 0);

    // What the public page names. The Tea Fund is the only type left out, of both
    // lists; everything else is listed with its carry-in, so a fund whose money is
    // all brought forward shows that money instead of a misleading Ksh 0.
    const publicByType = byType
      .filter((t) => !t.isTeaFund)
      .map(({ name, description, carriedIn, totalContributed }) => ({
        name,
        description,
        carriedIn,
        totalContributed,
        total: carriedIn + totalContributed,
      }));
    // The fund rows carry the three figures a reader can check: what it already
    // held, what has been spent from it, and the balance that follows. `collected`
    // is deliberately not sent: fundBalance() reports "money in" (carry-in plus
    // rows) under a `totalContributed` name, and two different meanings for one
    // field across two lists is how a page ends up misreading its own numbers.
    const publicFundBalances = fundBalances.map(({ name, carriedIn, totalExpenses: spent, balance }) => ({
      name,
      carriedIn,
      spent,
      balance,
    }));

    res.json({
      chamaName: settings.chamaName,
      // The group's own statements and its mark, for the top of the page and its
      // foot. Both clauses fall back to the published constitution while Settings
      // holds nothing (utils/groupIdentity) — the vision and mission are meant to
      // be read by anyone, which is why they travel here and the rest of the
      // constitution does not.
      ...visionAndMission(settings),
      logoUrl: settings.logoUrl || '',
      activeMembers,
      totalMembersEver,
      resignedCount,
      byType: publicByType,
      totalContributed,
      // Named parts: the members' brought-forward balances, the funds' floats, and
      // what this ledger has watched come in since the cycle opened.
      carriedIn: carriedIn.total,
      carriedInMemberBalances: carriedIn.memberBalances,
      carriedInFundFloats: carriedIn.fundFloats,
      collected,
      totalExpenses,
      // What the group actually holds right now: everything raised, minus
      // everything spent from expense-tracking funds. This is the number that
      // answers "how much money does the chama have?" — totalContributed alone
      // answers a different question (lifetime raised).
      netBalance: totalContributed - totalExpenses,
      thisWeekTotal,
      fundBalances: publicFundBalances,
      finesCollected,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { publicOverview };
