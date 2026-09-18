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
  },
  { timestamps: true }
);

module.exports = model('AuditLog', AuditLogSchema);
