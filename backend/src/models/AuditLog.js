const { Schema, model } = require('mongoose');

const AuditLogSchema = new Schema(
  {
    action: { type: String, enum: ['create', 'update', 'delete'], required: true },
    entityType: {
      type: String,
      enum: [
        'Member',
        'Contribution',
        'ContributionType',
        'Pledge',
        'Settings',
        'FineType',
        'Fine',
        'Expense',
        'Minute',
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
