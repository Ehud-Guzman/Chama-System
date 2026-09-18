const { Schema, model } = require('mongoose');

// One of a member's emergency contacts. Embedded (never its own collection)
// because it only ever belongs to one member and is always read together with
// them.
const NextOfKinSchema = new Schema(
  {
    name: { type: String, default: '', trim: true },
    relationship: { type: String, default: '', trim: true },
    // Not normalized like the member's own phone: this is often a relative's
    // number, which may be a landline or a non-Kenyan mobile.
    phone: { type: String, default: '', trim: true },
    email: { type: String, default: '', trim: true, lowercase: true },
  },
  { _id: false }
);

const MemberSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    // `unique: true` already creates an index — no need for `index: true` too.
    phone: { type: String, required: true, unique: true, trim: true },
    email: { type: String, default: '', trim: true, lowercase: true },
    // Cloudinary-hosted profile photo. The publicId is kept alongside the URL so
    // the old asset can be deleted when a photo is replaced — otherwise every
    // re-upload leaves an orphan behind in the Cloudinary account.
    photoUrl: { type: String, default: '' },
    photoPublicId: { type: String, default: '' },
    // The people the office calls in an emergency — a spouse, the children, the
    // in-laws. A list, because one contact is rarely enough. Records created
    // before the list existed hold a single object here; every read goes through
    // utils/nextOfKin.nextOfKinList(), which accepts both shapes, so no migration
    // was needed.
    nextOfKin: { type: [NextOfKinSchema], default: [] },
    // Late-contribution and fine reminder emails. On by default: the point of
    // collecting an email is to use it. Off for a member who asks us to stop.
    emailNotifications: { type: Boolean, default: true },
    regNumber: { type: String, unique: true, sparse: true },
    notes: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    active: { type: Boolean, default: true },
    // Anchor for this member's own weekly-contribution schedule (week 1 starts here).
    joinDate: { type: Date, default: Date.now },
    // What the member's paper-ledger balance was when the week cycle opened
    // (verified per member at the audit). Everything the cycle computes sits on
    // top of it, which is how a member's "money" starts where the old sheet
    // left him instead of restarting at zero.
    openingBalance: { type: Number, default: 0 },
    // Free text for where that figure came from (e.g. "audit 19-Aug-2026").
    openingBalanceNote: { type: String, default: '' },
    resignedAt: { type: Date, default: null },
    resignationReason: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = model('Member', MemberSchema);
