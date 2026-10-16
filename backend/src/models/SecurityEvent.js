const { Schema, model } = require('mongoose');

// Sign-ins that did not work, kept so the super admin can see them.
//
// They used to go to the request log and nowhere else, which meant "has anybody been trying to
// get into the chairman's account?" could only be answered by someone with access to the
// server's logs. They are not part of the audit trail on purpose: the trail is a chained record
// of what was done to the books, and a stranger guessing at the login page has done nothing to
// them. Mixing the two would let anyone with an internet connection write into the chain.
//
// Short-lived: a failed sign-in is only interesting while it is recent, so MongoDB expires them
// after ninety days and the collection cannot grow without bound.
const SecurityEventSchema = new Schema(
  {
    // A sign-in that failed, or a try at the members' gate (an ID number, and with the phone check
    // on, a phone number) that did.
    kind: { type: String, enum: ['login_failed', 'gate_failed'], default: 'login_failed', required: true },
    reason: {
      type: String,
      enum: [
        'wrong_password',
        'no_such_account',
        'deactivated',
        'wrong_2fa_code',
        // The members' gate. `wrong_phone` is the one that means somebody is aiming at a real member.
        'not_an_id',
        'no_such_member',
        'duplicate_id',
        'wrong_phone',
        'phone_missing',
      ],
      required: true,
    },
    // What was typed into the email box. Capped: this is text a stranger controls, and it is
    // also sometimes a password typed into the wrong field, so it is never stored longer than
    // an address could be.
    email: { type: String, default: '', maxlength: 160 },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    role: { type: String, default: null },
    ip: { type: String, default: '', maxlength: 64 },
    // Gate failures only: the one-way tag of the ID that was tried (never the number itself), and
    // the member it belongs to when it belongs to anyone.
    target: { type: String, default: '', maxlength: 16 },
    memberId: { type: Schema.Types.ObjectId, ref: 'Member', default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const NINETY_DAYS = 90 * 24 * 60 * 60;

// The expiry index doubles as the "newest first" index.
SecurityEventSchema.index({ createdAt: -1 }, { expireAfterSeconds: NINETY_DAYS });
SecurityEventSchema.index({ email: 1, createdAt: -1 });
SecurityEventSchema.index({ ip: 1, createdAt: -1 });
SecurityEventSchema.index({ target: 1, createdAt: -1 });

module.exports = model('SecurityEvent', SecurityEventSchema);
