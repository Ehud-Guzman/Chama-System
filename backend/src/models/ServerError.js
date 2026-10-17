const { Schema, model } = require('mongoose');

// A server fault the API raised (a 500, an unhandled rejection, an uncaught exception), grouped by
// what it was and where, with a count — so a fault that happens forty times is one row that says
// forty, not forty rows and not forty emails.
//
// Kept thirty days and then expired by the database itself: this is for noticing and fixing, not a
// history. It holds the message and the first lines of the stack, never a request body, a token or a
// member's details.
const ServerErrorSchema = new Schema(
  {
    // A short hash of (kind, route with ids removed, message). The same fault has the same signature.
    signature: { type: String, required: true, unique: true },
    kind: { type: String, enum: ['request', 'unhandled_rejection', 'uncaught_exception'], required: true },
    message: { type: String, default: '', maxlength: 400 },
    method: { type: String, default: '' },
    route: { type: String, default: '', maxlength: 200 },
    status: { type: Number, default: 500 },
    stack: { type: String, default: '', maxlength: 800 },
    count: { type: Number, default: 1 },
    firstAt: { type: Date, default: Date.now },
    lastAt: { type: Date, default: Date.now },
    lastRequestId: { type: String, default: '' },
    // When the super admin was last emailed about this one, so a repeating fault is one message per
    // quiet period and not one per occurrence.
    notifiedAt: { type: Date, default: null },
  },
  { timestamps: false }
);

ServerErrorSchema.index({ lastAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60, name: 'server_error_ttl' });

module.exports = model('ServerError', ServerErrorSchema);
