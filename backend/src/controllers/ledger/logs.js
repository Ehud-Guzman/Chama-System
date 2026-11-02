// The treasurer's ledger controller, part: logs. controllers/ledgerController.js is the index the routes use.

const mongoose = require('mongoose');
const Member = require('../../models/Member');
const Contribution = require('../../models/Contribution');
const ContributionType = require('../../models/ContributionType');
const Expense = require('../../models/Expense');
const { isAfterToday } = require('../../utils/futureDate');
const { extractMpesaCodes } = require('../../utils/mpesaCode');
const { toEatDateString } = require('../../utils/weekCycle');
const { getLedgerTypes } = require('../../utils/ledgerTypes');
const { getOrCreateSettings } = require('../../utils/settings');
const { logAudit, snapshot } = require('../../utils/auditLogger');
const { logEvent } = require('../../middleware/requestLogger');
const { withOptionalTransaction, allocateFinePayment, recordFineSettlements } = require('../../utils/fineAllocation');
const { paymentsFromAllocations, announceFinesPaid } = require('../../utils/fineEmails');

const METHODS = ['cash', 'bank', 'mobile', 'other'];

// Everything the treasurer can put on a member's page. Tea is not here on
// purpose: it is automatic, so there is nothing to log and nothing to edit.
const LOG_KINDS = ['weekly', 'expense'];

// Shared validation for a new log line. Returns an error message or null.
function validateLog({ amount, date, method }) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return 'Amount must be a number greater than zero';
  if (!METHODS.includes(method)) return 'Method must be one of: cash, bank, mobile, other';
  if (date !== undefined && date !== null && date !== '') {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return 'Invalid date';
    if (isAfterToday(d)) return 'Date cannot be in the future';
  }
  return null;
}

// POST /api/ledger/members/:id/log — the one write the treasurer needs. Which
// collection it lands in is decided from the kind, so the UI can keep a single
// "Add a log" panel instead of a form per record type. `note` is free text and
// is where an M-Pesa or bank message gets pasted, kept on the entry itself so
// the evidence sits with the money it explains.
async function createLog(req, res, next) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: 'Member not found' });
    }
    const { kind, amount, date, method, note, description, fundTypeId, clientRequestId, confirmDuplicate } =
      req.body || {};

    if (!LOG_KINDS.includes(kind)) {
      return res.status(400).json({ message: `Kind must be one of: ${LOG_KINDS.join(', ')}` });
    }
    const member = await Member.findOne({ _id: req.params.id, active: true });
    if (!member) return res.status(400).json({ message: 'Member not found or inactive' });

    const invalid = validateLog({ amount, date, method });
    if (invalid) return res.status(400).json({ message: invalid });
    const value = Number(amount);
    const when = date ? new Date(date) : new Date();
    const text = String(note || '').trim();

    // A retried submit (dropped response, two taps) resolves to the entry it
    // already created rather than logging the same payment twice.
    if (clientRequestId) {
      const existing = await Contribution.findOne({ clientRequestId }).lean();
      if (existing) return res.status(200).json({ entry: existing, replay: true });
    }

    // The same M-Pesa code on a payment already in the books is, nearly always, the same money keyed
    // twice. Said before anything is written, with the payment it matches, and overridable: a code
    // pasted into a note is only text, and the treasurer can confirm it really is a second payment.
    // After the replay check above, so a payment sent again from the offline outbox is not mistaken
    // for a duplicate of itself.
    if (kind !== 'expense' && confirmDuplicate !== true) {
      for (const code of extractMpesaCodes(text)) {
        const earlier = await Contribution.findOne({
          deleted: false,
          // The code is letters and digits only, so it is safe inside a pattern.
          note: { $regex: String.raw`\b${code}\b` },
        })
          .populate('memberId', 'name')
          .lean();
        if (earlier) {
          const ksh = (n) => `Ksh ${Number(n || 0).toLocaleString('en-KE')}`;
          return res.status(409).json({
            message:
              `The M-Pesa code ${code} is already on a payment: ${ksh(earlier.grossAmount ?? earlier.amount)} ` +
              `for ${earlier.memberId?.name || 'a member'} on ${toEatDateString(earlier.date)}. ` +
              'If this really is a second payment, confirm it.',
            needsConfirmation: true,
            duplicateOf: { id: earlier._id, code },
          });
        }
      }
    }

    const types = await getLedgerTypes();
    // Whether a payment pays down pending fines first is the group's own policy,
    // and it is OFF unless the committee has turned it on (Settings.autoSettleFines).
    // Off, this endpoint behaves exactly as it did before: what he hands over is
    // his contribution, full stop.
    const settings = await getOrCreateSettings();
    const autoSettleFines = settings.autoSettleFines === true;

    if (kind === 'expense') {
      const fund = fundTypeId ? await ContributionType.findById(fundTypeId) : types.chai;
      if (!fund || !fund.tracksExpenses) {
        return res.status(400).json({ message: 'Choose a fund that tracks expenses' });
      }
      const expense = await Expense.create({
        typeId: fund._id,
        amount: value,
        date: when,
        description: String(description || '').trim(),
        note: text,
        loggedBy: req.user._id,
      });
      await logAudit({
        action: 'create',
        entityType: 'Expense',
        entityId: expense._id,
        performedBy: req.user._id,
        after: snapshot(expense),
      });
      logEvent('expense_logged', {
        rid: req.id,
        userId: String(req.user._id),
        fund: fund.name,
        amount: value,
      });
      return res.status(201).json({ entry: expense, kind });
    }

    const type = kindsToType(kind, types);
    if (!type) {
      return res.status(400).json({ message: 'Ledger type missing — run the ledger setup again' });
    }

    // Money logged here can pay down a pending fine first — the same rule the
    // contributions endpoint follows — but only when the group has switched that on
    // (Settings.autoSettleFines, off by default). Group-fund money (tea) belongs to
    // the group, not the member, so it is never redirected to a personal fine.
    //
    // When it does apply, all of it runs in one transaction: the fine allocation is
    // a read-modify-write on a shared document, so two payments landing together
    // would otherwise each see the same `remaining` and spend it twice.
    let contribution;
    let fineDeducted = 0;
    let netAmount = value;
    // Kept outside the transaction so the acknowledgement email can be sent after it
    // has committed — never from inside, where a mail failure could roll money back.
    let settledAllocations = [];
    try {
      contribution = await withOptionalTransaction(async (session) => {
        const split =
          type.isGroupFund || !autoSettleFines
            ? { netAmount: value, fineDeducted: 0, allocations: [] }
            : await allocateFinePayment(member._id, value, session);

        const [row] = await Contribution.create(
          [
            {
              memberId: member._id,
              typeId: type._id,
              amount: split.netAmount,
              grossAmount: split.fineDeducted > 0 ? value : null,
              fineDeducted: split.fineDeducted,
              date: when,
              method,
              note: text,
              loggedBy: req.user._id,
              clientRequestId: clientRequestId || undefined,
            },
          ],
          { session }
        );

        if (split.allocations.length) {
          await recordFineSettlements(split.allocations, row._id, session);
        }

        fineDeducted = split.fineDeducted;
        netAmount = split.netAmount;
        settledAllocations = split.allocations;
        return row;
      });
    } catch (err) {
      // Two near-simultaneous taps carrying the same key: the unique index decides,
      // and the loser returns the winner's entry rather than logging a second
      // payment (or a second fine deduction).
      if (err.code === 11000 && clientRequestId) {
        const existing = await Contribution.findOne({ clientRequestId }).lean();
        if (existing) return res.status(200).json({ entry: existing, replay: true });
      }
      throw err;
    }

    await logAudit({
      action: 'create',
      entityType: 'Contribution',
      entityId: contribution._id,
      performedBy: req.user._id,
      after: snapshot(contribution),
    });

    // The acknowledgement, after the payment is safely committed. One email for the
    // payment naming every fine it cleared, rather than one per fine: that is how the
    // money arrived and how the member remembers it. Not awaited — the screen has
    // already been told the payment is in, and the send's outcome goes to the request
    // log (utils/fineEmails logs fine_email_sent / _skipped / _failed).
    if (settledAllocations.length > 0) {
      paymentsFromAllocations(settledAllocations)
        .then((payments) =>
          announceFinesPaid({
            payments,
            member,
            totalPaid: fineDeducted,
            paidAt: when,
            performedBy: req.user._id,
            rid: req.id,
          })
        )
        .catch((err) => {
          // Reading the fines back failed, so the member is not emailed. The payment is
          // recorded either way; the log line is what says the acknowledgement did not
          // go out.
          logEvent('fine_email_lookup_failed', { rid: req.id, error: err.message }, 'error');
        });
    }

    res.status(201).json({
      entry: contribution,
      kind,
      // What the payment did besides being credited, so the screen can say
      // "Ksh 500 of that cleared a fine" instead of leaving it to be worked out.
      fineDeducted,
      netAmount,
    });
  } catch (err) {
    next(err);
  }
}

// Which bucket a log kind writes to. Tea has no kind: it is deducted
// automatically and never logged.
function kindsToType(kind, types) {
  if (kind === 'weekly') return types.weekly;
  return null;
}

module.exports = {
  METHODS,
  createLog,
};
