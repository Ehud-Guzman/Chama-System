// Where each role lands after login / when blocked from a route it can't use.
// The treasurer's workspace is the finance ledger — the member list they log
// against — so that is where they land, not the summary dashboard.
const ROLE_HOME = {
  secretary: '/admin/minutes',
  treasurer: '/admin/finance',
  disciplinary: '/admin/disciplinary',
};

export function roleHome(role) {
  return ROLE_HOME[role] || '/admin/dashboard';
}
