const { Schema, model } = require('mongoose');

// Singleton document — one row holds group-wide identity info.
// No multi-tenant support, so there is never more than one of these.
const SettingsSchema = new Schema(
  {
    // The single-row marker.
    //
    // A unique key plus an upsert is what makes "there is only ever one Settings
    // document" true *in the database*. Two concurrent cold starts used to be able
    // to create two rows, and since this document holds the week anchor, the weekly
    // amount and the tea, a second row would mean members' arrears differing
    // between requests depending on which row a query happened to return.
    key: { type: String, required: true, unique: true, default: 'main' },
    chamaName: { type: String, required: true, trim: true, default: 'Our Chama' },
    constitution: { type: String, default: '' },
    // The two statements the members' page prints under the group's totals.
    // Blank means "use the published constitution's own Chapter 2 wording" — see
    // utils/groupIdentity — so the page always has a statement to show even
    // before anyone has typed one in.
    vision: { type: String, default: '' },
    mission: { type: String, default: '' },
    // The group's logo, shown beside its name on the public page. Uploaded to
    // Cloudinary like member photos (utils/cloudinary → uploadGroupLogo) and kept
    // here as the URL plus the publicId that replacing or removing it needs.
    logoUrl: { type: String, default: '' },
    logoPublicId: { type: String, default: '' },
    // First week the group-wide weekly reconciliation should evaluate. Weeks
    // before this are pre-tracking history (e.g. a bulk paper-ledger import
    // that only gives a cumulative snapshot, not a per-week breakdown) and
    // would otherwise show as false "everyone defaulted" for every one of
    // them. Null means reconcile from each member's own join date, as before.
    weeklyTrackingStartDate: { type: Date, default: null },
    // --- Week cycle (the group-wide 1,400 / 100 maths) -----------------------
    // Friday that week `cycleStartWeek` begins on. Pinned once by
    // getOrCreateSettings() and never moved: it is the reference every
    // historical week number is counted from.
    weekAnchorDate: { type: Date, default: null },
    // Week number the anchor belongs to — 92 at go-live, +1 every Friday after.
    cycleStartWeek: { type: Number, default: 92 },
    // Required personal contribution per week (constitution §7.1).
    weeklyAmount: { type: Number, default: 1400 },
    // Tea Fund contribution per week. Tracked on its own and never mixed into a
    // member's personal figures — the fund belongs to the Group (§7.2).
    chaiAmount: { type: Number, default: 100 },
    // Whether money logged against a member first pays down his pending fines.
    //
    // OFF, and it is meant to be: this is the one switch in the API that changes
    // what the books say about money that has not been paid yet. Off, the books
    // behave exactly as they always have — what the member hands over is his
    // contribution, and a fine is cleared by hand from his page (Fines → Pay).
    // On, a payment is split: the fines come off first, and the week is still
    // credited the full cash the member actually handed over (utils/memberLedger
    // reads grossAmount for that), so his weekly figures do not move — only the
    // fine stops showing as outstanding.
    //
    // It exists as a setting rather than a constant because it is the committee's
    // call, not a developer's, and because a deploy must never be able to change
    // figures on its own.
    autoSettleFines: { type: Boolean, default: false },
    // Whether two-factor authentication is in use at all.
    //
    // OFF by default, and that is the point: the feature is built and ready, but until the
    // committee decides it wants it, nobody is asked for a code and nobody can enrol. One switch,
    // in one place, that a super admin controls - rather than a feature that quietly starts
    // challenging people because a deploy carried new code.
    //
    // While it is off, an account that had already enrolled is not challenged either: "off" has to
    // mean off, or the switch is decoration. Their enrolment is kept, not deleted, so turning it
    // back on restores exactly the state it was in - the panel says how many accounts that affects
    // before anybody flips it.
    twoFactorAuthEnabled: { type: Boolean, default: false },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = model('Settings', SettingsSchema);
