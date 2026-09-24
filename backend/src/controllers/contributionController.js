const Contribution = require('../models/Contribution');
const Member = require('../models/Member');
const ContributionType = require('../models/ContributionType');
const { logAudit, snapshot } = require('../utils/auditLogger');
const { sendWorkbook } = require('../utils/xlsxExport');
const { getOrCreateSettings } = require('../utils/settings');
// Shared with the ledger's own log endpoint (utils/fineAllocation). They were
// private here once, which is exactly how the two write paths drifted apart: this
// one paid down fines, the one the member panel actually calls did not.
const {
  withOptionalTransaction,
  allocateFinePayment,
  recordFineSettlements,
  reverseFineSettlements,
} = require('../utils/fineAllocation');
// A payment that clears fines is acknowledged by email, once per payment. The module
// never throws, so a broken mail server cannot fail a contribution.
const { announceFinesPaid, paymentsFromAllocations } = require('../utils/fineEmails');

const METHODS = ['cash', 'bank', 'mobile', 'other'];
const DUPLICATE_WINDOW_MS = 10 * 1000;

// Shared validation for create/update. Returns an error message or null.
function validateFields({ amount, date, method }, { partial = false } = {}) {
  if (!partial || amount !== undefined) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return 'Amount must be a number greater than zero';
  }
  if (!partial || method !== undefined) {
    if (!METHODS.includes(method)) return 'Method must be one of: cash, bank, mobile, other';
  }
  if (date !== undefined && date !== null && date !== '') {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return 'Invalid date';
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    if (d > endOfToday) return 'Date cannot be in the future';
  }
  return null;
}

// GET /api/contributions?memberId=&method=&page=&limit=
async function listContributions(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const filter = { deleted: false };
    if (req.query.memberId) filter.memberId = req.query.memberId;
    if (req.query.typeId) filter.typeId = req.query.typeId;
    if (req.query.method && METHODS.includes(req.query.method)) filter.method = req.query.method;

    const [contributions, total] = await Promise.all([
      Contribution.find(filter)
        .sort({ date: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('memberId', 'name phone regNumber')
        .populate('loggedBy', 'name')
        .populate('typeId', 'name isGroupFund')
        .lean(),
      Contribution.countDocuments(filter),
    ]);

    res.json({ contributions, total, page, pages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    next(err);
  }
}

// POST /api/contributions — loggedBy comes from the JWT, never the body
async function createContribution(req, res, next) {
  try {
    const { memberId, typeId, amount, date, method, note, clientRequestId } = req.body || {};

    // Idempotent replay: the same submit attempt (e.g. a retried request after
    // a dropped response) resolves to the original document, not a new one.
    if (clientRequestId) {
      const existing = await Contribution.findOne({ clientRequestId })
        .populate('memberId', 'name phone regNumber')
        .populate('typeId', 'name')
        .lean();
      if (existing) return res.status(200).json({ contribution: existing, replay: true });
    }

    const [member, type] = await Promise.all([
      Member.findById(memberId),
      ContributionType.findById(typeId),
    ]);
    if (!member || !member.active) {
      return res.status(400).json({ message: 'Member not found or inactive' });
    }
    if (!type || !type.active) {
      return res.status(400).json({ message: 'Contribution type not found or inactive' });
    }
    const invalid = validateFields({ amount, date, method });
    if (invalid) return res.status(400).json({ message: invalid });

    // Heuristic guard for duplicate submissions that don't carry a matching
    // clientRequestId (e.g. two browser tabs each generating their own key).
    const recentDuplicate = await Contribution.findOne({
      memberId: member._id,
      typeId: type._id,
      amount: Number(amount),
      method,
      deleted: false,
      createdAt: { $gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
    }).lean();
    if (recentDuplicate) {
      return res.status(409).json({
        message: 'This looks like a duplicate of a contribution just logged for this member. Refresh and check before retrying.',
      });
    }

    let contribution;
    // Kept outside the transaction so the acknowledgement email is sent after it has
    // committed, where a mail failure cannot touch the money.
    let settledAllocations = [];
    // Paying fines out of a contribution is the group's own policy and it is off
    // unless somebody has turned it on (Settings.autoSettleFines). Off, the books
    // behave exactly as they did before: the payment is contribution in full.
    const settings = await getOrCreateSettings();
    const autoSettleFines = settings.autoSettleFines === true;
    try {
      contribution = await withOptionalTransaction(async (session) => {
        // Group-fund money (e.g. Chai) belongs to the group, not the
        // individual — it must never be redirected to settle a personal fine.
        const { netAmount, fineDeducted, allocations } =
          type.isGroupFund || !autoSettleFines
            ? { netAmount: Number(amount), fineDeducted: 0, allocations: [] }
            : await allocateFinePayment(member._id, Number(amount), session);

        const [created] = await Contribution.create(
          [
            {
              memberId: member._id,
              typeId: type._id,
              amount: netAmount,
              grossAmount: fineDeducted > 0 ? Number(amount) : null,
              fineDeducted,
              date: date ? new Date(date) : new Date(),
              method,
              note: String(note || '').trim(),
              loggedBy: req.user._id,
              clientRequestId: clientRequestId || undefined,
            },
          ],
          { session }
        );

        if (allocations.length) {
          await recordFineSettlements(allocations, created._id, session);
        }
        settledAllocations = allocations;
        return created;
      });
    } catch (err) {
      // Two near-simultaneous requests with the same key both passed the
      // replay check above; the unique index is what actually decides the
      // race. The loser fetches and returns the winner's document.
      if (err.code === 11000 && clientRequestId) {
        const winner = await Contribution.findOne({ clientRequestId })
          .populate('memberId', 'name phone regNumber')
          .populate('typeId', 'name')
          .lean();
        if (winner) return res.status(200).json({ contribution: winner, replay: true });
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

    // Told after the payment is committed, never from inside the transaction, and not
    // awaited: see utils/fineEmails. One email, naming every fine the money cleared.
    if (settledAllocations.length > 0) {
      const settledTotal = settledAllocations.reduce((sum, a) => sum + (Number(a.applied) || 0), 0);
      paymentsFromAllocations(settledAllocations)
        .then((payments) =>
          announceFinesPaid({
            payments,
            member,
            totalPaid: settledTotal,
            paidAt: date ? new Date(date) : new Date(),
            performedBy: req.user._id,
            rid: req.id,
          })
        )
        .catch(() => {});
    }

    const populated = await Contribution.findById(contribution._id)
      .populate('memberId', 'name phone regNumber')
      .populate('typeId', 'name')
      .lean();
    res.status(201).json({ contribution: populated });
  } catch (err) {
    next(err);
  }
}

// POST /api/contributions/bulk — logs many contributions in one request, one
// per non-empty grid cell (member × type) from the weekly logging grid.
// Shares the same fine-deduction/audit-log behavior as a single create.
// `clientRequestId`, if provided, is a per-batch key: each entry is keyed
// off it so a retried/duplicated batch submission resolves to the entries
// already logged instead of creating a second copy of the whole batch. One
// bad or duplicate row is skipped and reported rather than failing the rest.
async function bulkCreateContributions(req, res, next) {
  try {
    const { date, method, note, entries, clientRequestId } = req.body || {};

    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ message: 'No entries to log' });
    }
    if (!METHODS.includes(method)) {
      return res.status(400).json({ message: 'Method must be one of: cash, bank, mobile, other' });
    }
    const parsedDate = date ? new Date(date) : new Date();
    if (Number.isNaN(parsedDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date' });
    }
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    if (parsedDate > endOfToday) {
      return res.status(400).json({ message: 'Date cannot be in the future' });
    }

    const memberIds = [...new Set(entries.map((e) => e.memberId))];
    const typeIds = [...new Set(entries.map((e) => e.typeId))];
    const [members, types] = await Promise.all([
      Member.find({ _id: { $in: memberIds } }),
      ContributionType.find({ _id: { $in: typeIds } }),
    ]);
    // Resolved once for the whole batch: whether a row pays down the member's
    // pending fines first is the group's policy and it is off by default
    // (Settings.autoSettleFines).
    const settings = await getOrCreateSettings();
    const autoSettleFines = settings.autoSettleFines === true;
    const memberMap = new Map(members.map((m) => [String(m._id), m]));
    const typeMap = new Map(types.map((t) => [String(t._id), t]));

    const sharedNote = String(note || '').trim();
    const createdIds = [];
    const skipped = [];

    for (const entry of entries) {
      const member = memberMap.get(String(entry.memberId));
      const type = typeMap.get(String(entry.typeId));
      const amount = Number(entry.amount);
      const label = `${member?.name || entry.memberId} — ${type?.name || entry.typeId}`;

      if (!member || !member.active) {
        skipped.push({ ...entry, reason: `${label}: member not found or inactive` });
        continue;
      }
      if (!type || !type.active) {
        skipped.push({ ...entry, reason: `${label}: type not found or inactive` });
        continue;
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        skipped.push({ ...entry, reason: `${label}: amount must be greater than zero` });
        continue;
      }

      const entryClientId = clientRequestId
        ? `${clientRequestId}:${member._id}:${type._id}`
        : undefined;

      // Reset per entry: this is the money that cleared a fine for THIS member, and it
      // is what the acknowledgement at the bottom of the loop reports.
      let settledAllocations = [];

      try {
        if (entryClientId) {
          const existing = await Contribution.findOne({ clientRequestId: entryClientId }).select('_id');
          if (existing) {
            // Already logged by an earlier attempt at this same batch — not
            // an error, just nothing new to do for this cell.
            continue;
          }
        }

        const recentDuplicate = await Contribution.findOne({
          memberId: member._id,
          typeId: type._id,
          amount,
          method,
          deleted: false,
          createdAt: { $gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
        }).lean();
        if (recentDuplicate) {
          skipped.push({ ...entry, reason: `${label}: duplicate of a contribution just logged, skipped` });
          continue;
        }

        const contribution = await withOptionalTransaction(async (session) => {
          const { netAmount, fineDeducted, allocations } =
            type.isGroupFund || !autoSettleFines
              ? { netAmount: amount, fineDeducted: 0, allocations: [] }
              : await allocateFinePayment(member._id, amount, session);

          const [created] = await Contribution.create(
            [
              {
                memberId: member._id,
                typeId: type._id,
                amount: netAmount,
                grossAmount: fineDeducted > 0 ? amount : null,
                fineDeducted,
                date: parsedDate,
                method,
                note: sharedNote,
                loggedBy: req.user._id,
                clientRequestId: entryClientId,
              },
            ],
            { session }
          );
          if (allocations.length) {
            await recordFineSettlements(allocations, created._id, session);
          }
          settledAllocations = allocations;
          return created;
        });

        await logAudit({
          action: 'create',
          entityType: 'Contribution',
          entityId: contribution._id,
          performedBy: req.user._id,
          after: snapshot(contribution),
        });

        // Per entry, because each entry is one member's payment and clears whatever of
        // his fines it covers — the same acknowledgement the member panel sends.
        if (settledAllocations.length > 0) {
          const settledTotal = settledAllocations.reduce(
            (sum, a) => sum + (Number(a.applied) || 0),
            0
          );
          paymentsFromAllocations(settledAllocations)
            .then((payments) =>
              announceFinesPaid({
                payments,
                member,
                totalPaid: settledTotal,
                paidAt: parsedDate,
                performedBy: req.user._id,
                rid: req.id,
              })
            )
            .catch(() => {});
        }

        createdIds.push(contribution._id);
      } catch (err) {
        // A single bad row (e.g. a duplicate-key race on entryClientId)
        // shouldn't sink contributions already logged for everyone else.
        skipped.push({
          ...entry,
          reason: err.code === 11000 ? `${label}: already logged` : `${label}: ${err.message}`,
        });
      }
    }

    res.status(201).json({ created: createdIds.length, skipped });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/contributions/:id
async function updateContribution(req, res, next) {
  try {
    const contribution = await Contribution.findById(req.params.id);
    if (!contribution || contribution.deleted) {
      return res.status(404).json({ message: 'Contribution not found' });
    }

    const { typeId, amount, date, method, note, expectedUpdatedAt } = req.body || {};
    // Optimistic concurrency: if the editor tells us what version it loaded
    // and someone else has since changed the record, refuse to overwrite it.
    if (expectedUpdatedAt && new Date(expectedUpdatedAt).getTime() !== contribution.updatedAt.getTime()) {
      return res.status(409).json({
        message: 'This contribution was changed by someone else since you opened it. Refresh and try again.',
      });
    }
    // A contribution whose payment was partly redirected to a fine can't be
    // safely re-amounted here — the deduction would need to be recomputed
    // against fines that may have changed since. Delete and re-log instead.
    if (
      contribution.fineDeducted > 0 &&
      amount !== undefined &&
      Number(amount) !== contribution.amount
    ) {
      return res.status(400).json({
        message: 'This contribution had part of its payment applied to a fine. Delete it and log it again to change the amount.',
      });
    }
    const before = snapshot(contribution);
    const invalid = validateFields({ amount, date, method }, { partial: true });
    if (invalid) return res.status(400).json({ message: invalid });

    if (typeId !== undefined) {
      const type = await ContributionType.findById(typeId);
      if (!type) return res.status(400).json({ message: 'Contribution type not found' });
      if (!type.active && String(type._id) !== String(contribution.typeId)) {
        return res.status(400).json({ message: 'Contribution type is inactive' });
      }
      contribution.typeId = type._id;
    }
    if (amount !== undefined) contribution.amount = Number(amount);
    if (date !== undefined && date !== null && date !== '') contribution.date = new Date(date);
    if (method !== undefined) contribution.method = method;
    if (note !== undefined) contribution.note = String(note).trim();

    await contribution.save();
    await logAudit({
      action: 'update',
      entityType: 'Contribution',
      entityId: contribution._id,
      performedBy: req.user._id,
      before,
      after: snapshot(contribution),
    });
    const populated = await Contribution.findById(contribution._id)
      .populate('memberId', 'name phone regNumber')
      .populate('typeId', 'name')
      .lean();
    res.json({ contribution: populated });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/contributions/:id — soft delete
async function deleteContribution(req, res, next) {
  try {
    const contribution = await Contribution.findById(req.params.id);
    if (!contribution || contribution.deleted) {
      return res.status(404).json({ message: 'Contribution not found' });
    }
    const before = snapshot(contribution);

    await withOptionalTransaction(async (session) => {
      contribution.deleted = true;
      await contribution.save({ session });
      // Undo any fine deduction this payment made — otherwise a voided
      // contribution leaves a fine marked "paid" by money that no longer
      // exists on the ledger.
      if (contribution.fineDeducted > 0) {
        await reverseFineSettlements(contribution._id, session);
      }
    });

    await logAudit({
      action: 'delete',
      entityType: 'Contribution',
      entityId: contribution._id,
      performedBy: req.user._id,
      before,
      after: snapshot(contribution),
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// GET /api/contributions/import-template — one row per active member (Name,
// Reg number), one column per active contribution type using its exact name.
// Weekly types are pre-filled with their default amount.
//
// The screen this was written for (the bulk weekly grid) has been retired in
// favour of logging member by member — the log endpoint, where each payment
// keeps its own M-Pesa note — so this template and POST /bulk are now only
// reachable by something calling the API directly. They are left in place
// because a scripted import is still the right tool for a one-off backfill.
async function bulkImportTemplate(req, res, next) {
  try {
    const [members, types] = await Promise.all([
      Member.find({ active: true }).sort({ name: 1 }).lean(),
      ContributionType.find({ active: true }).sort({ name: 1 }).lean(),
    ]);

    const sheetRows = members.map((m) => {
      const row = { Name: m.name, 'Reg number': m.regNumber || '' };
      for (const t of types) {
        row[t.name] = t.isWeekly && t.weeklyAmount > 0 ? t.weeklyAmount : '';
      }
      return row;
    });

    sendWorkbook(res, 'contributions-import-template.xlsx', [{ name: 'Week', rows: sheetRows }]);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listContributions,
  createContribution,
  bulkCreateContributions,
  bulkImportTemplate,
  updateContribution,
  deleteContribution,
};
