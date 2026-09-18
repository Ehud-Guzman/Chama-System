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

// The family a member names on the admission form. Embedded, like the next-of-kin
// contacts, because it only ever belongs to one member and is always read with him.
const FamilySchema = new Schema(
  {
    spouseName: { type: String, default: '', trim: true },
    // Names only — the form has four ruled lines for children, but a family is not
    // four, so this is a list.
    children: { type: [String], default: [] },
    fatherName: { type: String, default: '', trim: true },
    motherName: { type: String, default: '', trim: true },
    fatherInLawName: { type: String, default: '', trim: true },
    motherInLawName: { type: String, default: '', trim: true },
  },
  { _id: false }
);

// The applicant's declaration at the foot of the admission form: he has read the
// constitution and accepts the weekly commitment.
const CommitmentSchema = new Schema(
  {
    agreed: { type: Boolean, default: false },
    agreedAt: { type: Date, default: null },
    // The name he signed under, as the paper form has a line for it. The date is
    // the record — "signed" with no date is not a record of anything.
    signedBy: { type: String, default: '', trim: true },
  },
  { _id: false }
);

// One office bearer's signature on the admission, from the form's "for official
// use only" block: name plus the date he signed.
const ApprovalSchema = new Schema(
  {
    role: { type: String, enum: ['chairperson', 'secretary', 'treasurer'], required: true },
    name: { type: String, default: '', trim: true },
    signedAt: { type: Date, default: Date.now },
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
    // --- The rest of the admission form --------------------------------------
    // Personal details it asks for beyond name and phone. All optional: the
    // register already holds members whose paper form never had them filled in.
    dateOfBirth: { type: Date, default: null },
    // Kenyan ID, passport, or "not yet issued" — free text on purpose, and the
    // field the members' area is keyed on: a member opens his own record, the
    // documents and the constitution by typing this number
    // (utils/nationalId.js normalises it, utils/publicAccess.js checks it).
    //
    // No unique index: the column also carries notes that are not numbers, and
    // several members can legitimately be blank. One ID is still meant to belong
    // to one member, so create/edit/import refuse a duplicate and the gate
    // answers 409 rather than showing the wrong passbook when one slips through.
    // The plain index below is what the gate's exact-match query rides on.
    nationalId: { type: String, default: '', trim: true, index: true },
    physicalAddress: { type: String, default: '', trim: true },
    // Spouse, children, parents and in-laws, as the form's family section asks.
    family: { type: FamilySchema, default: () => ({}) },
    commitment: { type: CommitmentSchema, default: () => ({}) },
    // Chairperson, secretary, treasurer — "membership approved by" on the form.
    approvals: { type: [ApprovalSchema], default: [] },
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
