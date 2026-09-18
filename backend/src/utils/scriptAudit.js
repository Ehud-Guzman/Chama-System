const User = require('../models/User');
const { logAudit } = require('./auditLogger');

// Who a maintenance script's writes are attributed to.
//
// A script has no session, but the audit trail still needs a name: "the balances
// changed at 14:02 on Tuesday" is only useful if it says who ran it. `--by=<email>`
// names the operator; without it the earliest super_admin is used, which is the
// account the office works under.
//
// If there is no account to name at all (a database that has not been set up yet),
// the run continues and says so. A maintenance script must not be blocked by the
// bookkeeping — but the books it changes are the reason the bookkeeping exists, so
// the warning is loud.
async function resolveScriptActor(email) {
  const wanted = String(email || '').trim().toLowerCase();
  if (wanted) {
    const named = await User.findOne({ email: wanted });
    if (!named) {
      throw new Error(`No admin account with email ${wanted}. Pass --by=<email> of an existing one.`);
    }
    return named;
  }
  return User.findOne({ role: 'super_admin' }).sort({ createdAt: 1 });
}

// `--by=<email>` off the command line, for every script's argument parsing.
function operatorEmailFromArgv() {
  const arg = process.argv.find((value) => value.startsWith('--by='));
  return arg ? arg.slice('--by='.length) : '';
}

async function logScriptRun({ actor, action = 'reset', summary, entityId, before = null }) {
  if (!actor) {
    console.warn(
      '  Warning: no admin account found, so this run is NOT in the audit trail. Pass --by=<email>.'
    );
    return null;
  }
  await logAudit({
    action,
    entityType: 'System',
    entityId: entityId || actor._id,
    performedBy: actor._id,
    before,
    after: summary,
  });
  return actor;
}

module.exports = { resolveScriptActor, operatorEmailFromArgv, logScriptRun };
