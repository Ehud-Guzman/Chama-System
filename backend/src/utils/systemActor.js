const User = require('../models/User');

// Who gets credited for something nobody did by hand.
//
// The audit trail requires a `performedBy` on every entry, and that is deliberate — an
// entry with no actor is an entry nobody is answerable for. But a nightly backup and a
// weekly sweep are not done by a person, so the honest answer is the account responsible
// for the process: someone has to own it.
//
// The convention is the one the maintenance scripts already use (`--by=<email>`, else the
// earliest super admin): the group's own first account, named in the entry itself so the
// trail reads "nightly-backup, credited to <whoever owns the system>" rather than pretending
// a committee member pressed something at 3am.
async function resolveSystemActor({ email = process.env.SYSTEM_ACTOR_EMAIL } = {}) {
  if (email) {
    const named = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (named) return named;
  }

  const fallback = await User.findOne({ role: 'super_admin' }).sort({ createdAt: 1 });
  if (!fallback) {
    // Only reachable on a database with no accounts at all, in which case there is nothing
    // to write about either.
    throw new Error('No account exists to attribute an automatic action to');
  }
  return fallback;
}

module.exports = { resolveSystemActor };
