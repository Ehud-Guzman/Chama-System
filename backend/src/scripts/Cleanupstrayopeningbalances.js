// One-time cleanup for the stray "Opening Balances (Paper Ledger)" member.
//
// Based on listStrayMemberContributions.js / listRealOpeningBalancesContributions.js
// output:
//   - 4 entries (the week-60 "Opening ... balance before week 62" ones) have
//     NO counterpart on the real "Opening Balances" member — they get
//     REASSIGNED to the real member, not deleted, so that money isn't lost.
//   - The other 10 entries (weeks 62-67 Fines & Penalties / Tea Balance) are
//     exact duplicates of data already correctly on the real member — they
//     get DELETED from the stray member only.
//
// After this runs cleanly, the stray member will have 0 contributions left
// and is safe to deactivate/delete via the app's own member management —
// this script does not delete the Member document itself.
//
// Usage:
//   node src/scripts/cleanupStrayOpeningBalances.js            (dry run)
//   node src/scripts/cleanupStrayOpeningBalances.js --confirm-cleanup   (actually do it)

require('dotenv').config();

const mongoose = require('mongoose');
const User = require('../models/User');
const Member = require('../models/Member');
const Contribution = require('../models/Contribution');
const { logAudit, snapshot } = require('../utils/auditLogger');

const CONFIRMED = process.argv.includes('--confirm-cleanup');

// Matches the 4 week-60 opening-balance notes exactly, e.g.
// "Opening Fines/Penalties balance before week 62"
const OPENING_NOTE_PATTERN = /^Opening .+ balance before week 62$/;

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is not set.');
  }

  await mongoose.connect(process.env.MONGO_URI);

  const stray = await Member.findOne({ name: 'Opening Balances (Paper Ledger)' });
  if (!stray) {
    console.log('Stray member not found — nothing to do (maybe already cleaned up?).');
    await mongoose.disconnect();
    return;
  }

  const real = await Member.findOne({ name: 'Opening Balances' });
  if (!real) {
    throw new Error('Real "Opening Balances" member not found — something is wrong, stopping.');
  }

  const contributions = await Contribution.find({ memberId: stray._id });

  const toReassign = contributions.filter((c) => OPENING_NOTE_PATTERN.test(c.note || ''));
  const toDelete = contributions.filter((c) => !OPENING_NOTE_PATTERN.test(c.note || ''));

  console.log(`Found ${contributions.length} contribution(s) on the stray member.`);
  console.log(`  To reassign to real "Opening Balances": ${toReassign.length}`);
  console.log(`  To delete (duplicates): ${toDelete.length}\n`);

  // Safety check — abort if the split doesn't match what we expect from the
  // earlier investigation, rather than silently acting on a surprise.
  if (toReassign.length !== 4 || toDelete.length !== 10) {
    console.error(
      `Expected 4 to reassign and 10 to delete, got ${toReassign.length} and ${toDelete.length}. ` +
      `Something's changed since the last check — stopping without touching anything.`
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log('REASSIGN (moving to real "Opening Balances"):');
  for (const c of toReassign) {
    console.log(`  ${c.date.toISOString().slice(0, 10)}  Ksh ${c.amount}  — ${c.note}`);
  }

  console.log('\nDELETE (duplicates already correctly on real member):');
  let deleteTotal = 0;
  for (const c of toDelete) {
    console.log(`  ${c.date.toISOString().slice(0, 10)}  Ksh ${c.amount}  — ${c.note}`);
    deleteTotal += c.amount;
  }
  console.log(`\nTotal being removed from the double-counted figure: Ksh ${deleteTotal}`);

  if (!CONFIRMED) {
    console.log('\nDRY RUN ONLY. Nothing was written. Re-run with --confirm-cleanup to actually do this.');
    await mongoose.disconnect();
    return;
  }

  const admin = await User.findOne({ role: 'super_admin' });
  if (!admin) {
    throw new Error('No super admin found — run seedSuperAdmin.js first.');
  }

  console.log('\nApplying changes...');

  for (const c of toReassign) {
    const before = snapshot(c);
    c.memberId = real._id;
    await c.save();

    try {
      await logAudit({
        action: 'update',
        entityType: 'Contribution',
        entityId: c._id,
        performedBy: admin._id,
        before,
        after: snapshot(c),
      });
    } catch (auditErr) {
      console.warn(`  ⚠ Reassigned Ksh ${c.amount} (${c.note}) but audit log failed: ${auditErr.message}`);
    }
  }
  console.log(`  Reassigned ${toReassign.length} contribution(s).`);

  for (const c of toDelete) {
    const before = snapshot(c);
    await Contribution.deleteOne({ _id: c._id });

    try {
      await logAudit({
        action: 'delete',
        entityType: 'Contribution',
        entityId: c._id,
        performedBy: admin._id,
        before,
      });
    } catch (auditErr) {
      console.warn(`  ⚠ Deleted Ksh ${c.amount} (${c.note}) but audit log failed: ${auditErr.message}`);
    }
  }
  console.log(`  Deleted ${toDelete.length} duplicate contribution(s).`);

  console.log('\nDone. The stray member now has 0 contributions — safe to deactivate/delete via the app whenever you want.');

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});