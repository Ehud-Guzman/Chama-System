const { Schema, model } = require('mongoose');

const AuditLogSchema = new Schema(
  {
    action: { type: String, enum: ['create', 'update', 'delete', 'reset'], required: true },
    entityType: {
      type: String,
      enum: [
        'Member',
        'Contribution',
        'ContributionType',
        'Settings',
        'FineType',
        'Fine',
        'Expense',
        'Minute',
        'ChamaDocument',
        'DocumentCategory',
        'ConstitutionDecision',
        'Notification',
        'User',
        // Money arriving from outside the app — an M-Pesa payment the office has not
        // yet attached to a member, and the loan book.
        'MpesaTransaction',
        'Loan',
        // A scheduled job's own run record: a backup that did not happen is the kind of
        // thing that has to be visible, not inferred from an absence.
        'JobRun',
        // Group-wide maintenance rather than a record edit — a ledger reset has
        // to leave a trace of itself, and this is the only entity it belongs to.
        'System',
      ],
      required: true,
    },
    entityId: { type: Schema.Types.ObjectId, required: true },
    performedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    // --- The chain (utils/auditChain) ----------------------------------------
    // The hash of the entry before this one, this entry's own hash, and a monotonic
    // sequence number. Together they are what makes the trail tamper-evident: an
    // entry that is edited, deleted or inserted breaks every hash after it, and
    // `npm run verify:audit` names the entry where it breaks.
    //
    // All three are absent on entries written before the chain existed. That is
    // deliberate rather than backfilled: inventing a hash for history nobody can
    // recompute honestly would be a worse lie than an honest gap, and the verifier
    // skips them.
    prevHash: { type: String, default: null },
    hash: { type: String, default: null },
    chainSequence: { type: Number, default: null },
  },
  { timestamps: true }
);

// The audit screen pages through this newest-first, so the sort has to come off an
// index rather than an in-memory sort of a collection that only ever grows.
AuditLogSchema.index({ createdAt: -1 });

// The chain's own index. Unique, because two entries claiming the same place in the
// chain is exactly the fork this module exists to prevent: the writer's insert then
// fails and it retries against the real head instead of quietly producing two
// "entry 400"s. Sparse, because the entries written before the chain existed have no
// sequence number and must not collide with each other over the same null.
AuditLogSchema.index({ chainSequence: 1 }, { unique: true, sparse: true, name: 'audit_chain_sequence_unique' });

module.exports = model('AuditLog', AuditLogSchema);
