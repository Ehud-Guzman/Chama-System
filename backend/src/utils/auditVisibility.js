// Which audit entries each role may read.
//
// The trail is the group's record of itself, and until now every role that could open it saw
// every line. That left the super admin with nothing the people under them could not see —
// including the lines about the accounts that sit beside or above those people. Two kinds of
// entry are now the super admin's alone:
//
//   * an entry about a privileged account (super admin, admin, treasurer): created, changed,
//     given a new role, deactivated. An admin can still see the secretary and disciplinary
//     accounts they manage; they cannot read about the accounts that outrank their own.
//   * backups downloaded or restored, and scheduled-job runs — the machinery only the super
//     admin can operate (ROLES_AND_PERMISSIONS.md).
//
// Everything else — money, members, records, settings, and the ledger operations an admin or
// treasurer runs themselves — stays with the roles that could read it before.
//
// Expressed as a Mongo condition rather than a filter over a fetched page, so the page, the
// total, the dropdowns and the export all agree on what exists.

const PRIVILEGED_ROLES = ['super_admin', 'admin', 'treasurer'];

// `System` entries are marked by the operation that wrote them (after.action, or
// before.action on a delete). Only these belong to the super admin; a ledger reset or a
// week collected is group-wide, and the committee is meant to see it.
const SUPER_ONLY_SYSTEM_ACTIONS = [
  'backup-download',
  'restore-backup',
  // The Control Room's own housekeeping: looking at the app as another role, checking the chain by
  // hand, taking the full export. Not news to the office, and nothing they act on.
  'preview-started',
  'audit-chain-verified-by-hand',
  'audit-export-full',
];
const SUPER_ONLY_ENTITIES = ['JobRun'];

const isSuperAdmin = (role) => role === 'super_admin';

// The condition that removes the super admin's entries. Applied to everyone else.
function hiddenFromOthers() {
  return {
    $nor: [
      { entityType: { $in: SUPER_ONLY_ENTITIES } },
      { entityType: 'System', 'after.action': { $in: SUPER_ONLY_SYSTEM_ACTIONS } },
      { entityType: 'System', 'before.action': { $in: SUPER_ONLY_SYSTEM_ACTIONS } },
      { entityType: 'User', 'after.role': { $in: PRIVILEGED_ROLES } },
      { entityType: 'User', 'before.role': { $in: PRIVILEGED_ROLES } },
    ],
  };
}

// `match` is the filter the reader asked for; the result is that filter, narrowed to what
// this role may see. $and, not a merge, so a reader's own `entityType` or `$or` is never
// overwritten by the restriction.
function restrictToRole(role, match = {}) {
  if (isSuperAdmin(role)) return match;
  const hidden = hiddenFromOthers();
  return Object.keys(match).length > 0 ? { $and: [match, hidden] } : hidden;
}

// The same rule on one stored entry, for code that already holds it.
function canSeeEntry(role, entry) {
  if (isSuperAdmin(role)) return true;
  if (SUPER_ONLY_ENTITIES.includes(entry.entityType)) return false;
  const marker = (entry.after && entry.after.action) || (entry.before && entry.before.action);
  if (entry.entityType === 'System' && SUPER_ONLY_SYSTEM_ACTIONS.includes(marker)) return false;
  if (entry.entityType === 'User') {
    const roles = [entry.after && entry.after.role, entry.before && entry.before.role];
    if (roles.some((r) => PRIVILEGED_ROLES.includes(r))) return false;
  }
  return true;
}

// Record types a role has no entries for, so the "Record type" dropdown does not offer a
// choice that can only ever come back empty.
function hiddenEntityTypes(role) {
  return isSuperAdmin(role) ? [] : SUPER_ONLY_ENTITIES;
}

module.exports = {
  PRIVILEGED_ROLES,
  SUPER_ONLY_SYSTEM_ACTIONS,
  restrictToRole,
  canSeeEntry,
  hiddenEntityTypes,
};
