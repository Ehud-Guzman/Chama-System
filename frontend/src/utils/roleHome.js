// Where each role lands after login / when blocked from a route it can't use.
const ROLE_HOME = {
  secretary: '/admin/minutes',
  treasurer: '/admin/dashboard',
  disciplinary: '/admin/disciplinary',
};

export function roleHome(role) {
  return ROLE_HOME[role] || '/admin/dashboard';
}
