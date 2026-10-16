const { requireAuth } = require('../middleware/auth');

// Who may do what, read out of the routes themselves.
//
// ROLES_AND_PERMISSIONS.md is written by hand and has been wrong before. A table that is generated
// from the very `requireRole` lists that decide each request cannot be wrong in that way: what
// this prints is what the server enforces. The rules it follows are Express's own — a
// `router.use(requireRole(...))` applies to the routes declared after it, a role list on a single
// route narrows it further, and two lists on one route both have to be satisfied, so the allowed
// roles are their intersection.
//
// What it cannot see is a rule written inside a controller (the admin's "secretary and
// disciplinary accounts only", the audit trail narrowing what each role may read). Those are
// finer than a role and are described in the docs; the matrix says "part" by listing the routes
// so they can be found.

// What each mounted group of routes is, in the words the committee uses. A mount this table
// does not know still appears, under its path, so a new router can never silently be missing.
const AREAS = {
  '/api/auth': { label: 'Sign-in and accounts', note: 'Anyone signs in; creating and managing accounts is the office’s.' },
  '/api/members': { label: 'Member register', note: 'Add, edit, resign, import, export, statements.' },
  '/api/contributions': { label: 'Contributions', note: 'Money members pay in.' },
  '/api/ledger': { label: 'Finance ledger', note: 'Per-member logs, week collection, the week cycle and opening balances.' },
  '/api/expenses': { label: 'Expenses', note: 'Money spent out of the funds.' },
  '/api/fines': { label: 'Fines', note: 'Issue, settle, void, export.' },
  '/api/fine-types': { label: 'Fine types', note: 'What each infraction costs.' },
  '/api/types': { label: 'Contribution types', note: 'The funds money is paid into.' },
  '/api/reports': { label: 'Reports', note: 'Summaries, performance, monthly and weekly figures.' },
  '/api/minutes': { label: 'Meeting minutes', note: 'Write, import, publish and read.' },
  '/api/documents': { label: 'Document vault', note: 'Title deeds, certificates and the like.' },
  '/api/uploads': { label: 'Photo and logo uploads', note: 'Member photographs and the group logo.' },
  '/api/notifications': { label: 'Reminder emails', note: 'Chase members who are behind.' },
  '/api/settings': { label: 'Group settings', note: 'Name, logo, rules, switches.' },
  '/api/audit': { label: 'Audit trail', note: 'Who changed what, and when. What each role may read is narrowed inside.' },
  '/api/backup': { label: 'Backup', note: 'Download a copy of everything.' },
  '/api/jobs': { label: 'Scheduled jobs', note: 'Nightly backup, audit check, reminder sweep.' },
  '/api/superadmin': { label: 'Control Room', note: 'The super admin’s oversight and override tools.' },
  '/api/public': { label: 'Members’ area (no account)', note: 'A member opens his own record with his ID (and phone number, when the group asks for it); he can write one thing — his verdict on a chapter.' },
};

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// `^\/api\/members\/?(?=\/|$)` -> `/api/members`. Express 4 keeps a mount path only as a regexp.
function mountPathOf(layer) {
  return layer.regexp.source
    .replace('\\/?(?=\\/|$)', '')
    .replace(/^\^/, '')
    .replace(/\\\//g, '/');
}

function intersect(current, next) {
  if (!next) return current;
  if (!current) return next.slice();
  return current.filter((role) => next.includes(role));
}

// Every route the app serves, with the roles that may reach it. `roles: null` means "any signed-in
// role", and `auth: false` means no sign-in at all (the members' area, the health check).
function collectRoutes(app) {
  const found = [];
  const stack = app._router?.stack || [];

  for (const layer of stack) {
    // A route declared straight on the app (the public ones, the health check).
    if (layer.route) {
      const path = layer.route.path;
      for (const method of Object.keys(layer.route.methods)) {
        found.push({ method: method.toUpperCase(), path, mount: path.startsWith('/api/public') ? '/api/public' : path, roles: null, auth: false });
      }
      continue;
    }
    if (layer.name !== 'router' || !layer.handle?.stack) continue;

    const mount = mountPathOf(layer);
    let routerRoles = null;
    let routerAuth = false;

    for (const inner of layer.handle.stack) {
      if (!inner.route) {
        // router.use(...): applies to everything declared after it.
        if (inner.handle === requireAuth) routerAuth = true;
        if (inner.handle?.roles) {
          routerRoles = intersect(routerRoles, inner.handle.roles);
          routerAuth = true;
        }
        continue;
      }

      let roles = routerRoles;
      let auth = routerAuth;
      for (const handler of inner.route.stack) {
        if (handler.handle === requireAuth) auth = true;
        if (handler.handle?.roles) {
          roles = intersect(roles, handler.handle.roles);
          auth = true;
        }
      }
      for (const method of Object.keys(inner.route.methods)) {
        found.push({
          method: method.toUpperCase(),
          path: mount + (inner.route.path === '/' ? '' : inner.route.path),
          mount,
          roles,
          auth,
        });
      }
    }
  }
  return found;
}

// The grid: one row per area, one cell per role, saying whether that role can read and/or write.
function buildPermissionMatrix(app, roles) {
  const routes = collectRoutes(app).filter((route) => route.mount !== '/api/health' && !route.path.startsWith('/api/health'));
  const byMount = new Map();
  for (const route of routes) {
    if (!byMount.has(route.mount)) byMount.set(route.mount, []);
    byMount.get(route.mount).push(route);
  }

  const allows = (route, role) => (route.auth === false ? false : !route.roles || route.roles.includes(role));

  const areas = [...byMount.entries()].map(([mount, list]) => {
    const cells = {};
    for (const role of roles) {
      const reads = list.filter((route) => !WRITE_METHODS.has(route.method) && allows(route, role));
      const writes = list.filter((route) => WRITE_METHODS.has(route.method) && allows(route, role));
      const readable = list.filter((route) => !WRITE_METHODS.has(route.method));
      const writable = list.filter((route) => WRITE_METHODS.has(route.method));
      cells[role] = {
        read: reads.length > 0,
        write: writes.length > 0,
        // Some of the routes, not all: the role can reach part of the area. Worth a different
        // colour on the screen because "yes" would overstate it.
        partial:
          (reads.length > 0 && reads.length < readable.length) ||
          (writes.length > 0 && writes.length < writable.length),
      };
    }
    const info = AREAS[mount] || { label: mount, note: '' };
    return {
      mount,
      label: info.label,
      note: info.note,
      public: list.every((route) => route.auth === false),
      cells,
      routes: list.map((route) => ({
        method: route.method,
        path: route.path,
        roles: route.auth === false ? null : route.roles || roles,
      })),
    };
  });

  // The order the committee thinks in, not the order the app happens to mount things.
  const order = Object.keys(AREAS);
  areas.sort((a, b) => {
    const ia = order.indexOf(a.mount);
    const ib = order.indexOf(b.mount);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  return { roles, areas };
}

module.exports = { buildPermissionMatrix, collectRoutes, mountPathOf, AREAS };
