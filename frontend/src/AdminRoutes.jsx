import { lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/layout/ProtectedRoute.jsx';
import RoleGuard from './components/layout/RoleGuard.jsx';

// Everything behind a sign-in, in a module of its own.
//
// The members' page is the one most people open, on a phone, on mobile data, and its download is held
// to a budget (npm run report:bundle). The admin route table used to sit in App.jsx and so was
// carried by every member who only wanted to check a balance. It is loaded here instead, the moment
// somebody goes to /admin/..., and every screen in it is still loaded on demand when it is opened.
// The sign-in, forgotten-password and reset pages stay in App.jsx: they are the door to this.
const AdminDashboard = lazy(() => import('./pages/AdminDashboard.jsx'));
const AdminSettings = lazy(() => import('./pages/AdminSettings.jsx'));
const MembersList = lazy(() => import('./pages/MembersList.jsx'));
const MemberDetail = lazy(() => import('./pages/MemberDetail.jsx'));
const FinanceLedger = lazy(() => import('./pages/FinanceLedger.jsx'));
const FinanceMemberLedger = lazy(() => import('./pages/FinanceMemberLedger.jsx'));
const Expenses = lazy(() => import('./pages/Expenses.jsx'));
const Loans = lazy(() => import('./pages/Loans.jsx'));
const Fines = lazy(() => import('./pages/Fines.jsx'));
const FinanceSetup = lazy(() => import('./pages/FinanceSetup.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const Minutes = lazy(() => import('./pages/Minutes.jsx'));
const Documents = lazy(() => import('./pages/Documents.jsx'));
const Reminders = lazy(() => import('./pages/Reminders.jsx'));
const DisciplinaryFines = lazy(() => import('./pages/DisciplinaryFines.jsx'));
const AuditTrail = lazy(() => import('./pages/AuditTrail.jsx'));
const MyAccount = lazy(() => import('./pages/MyAccount.jsx'));
const ControlRoom = lazy(() => import('./pages/ControlRoom.jsx'));

// Who may open what, said once. The guard on each screen is the set of roles the API lets use it, so
// the menu, the guard and the server agree. (Settings' tooling is admin-only at the API too, and so is the audit
// trail; the Control Room's routes refuse every role
// but the super admin on the server, and its guard only keeps the page out of their way.)
const MONEY_ROLES = ['super_admin', 'admin', 'treasurer'];
const OFFICE_ROLES = [...MONEY_ROLES, 'secretary'];
const ADMIN_ROLES = ['super_admin', 'admin'];

// [path under /admin, screen, roles]
const GUARDED = [
  ['dashboard', AdminDashboard, MONEY_ROLES],
  ['settings', AdminSettings, ADMIN_ROLES],
  ['members', MembersList, MONEY_ROLES],
  ['members/:id', MemberDetail, MONEY_ROLES],
  ['finance', FinanceLedger, MONEY_ROLES],
  ['finance/setup', FinanceSetup, MONEY_ROLES],
  ['finance/expenses', Expenses, MONEY_ROLES],
  ['finance/:id', FinanceMemberLedger, MONEY_ROLES],
  ['loans', Loans, MONEY_ROLES],
  ['reports', Reports, OFFICE_ROLES],
  ['minutes', Minutes, ['super_admin', 'admin', 'secretary']],
  ['reminders', Reminders, MONEY_ROLES],
  ['documents', Documents, OFFICE_ROLES],
  ['fines', Fines, ADMIN_ROLES],
  ['disciplinary', DisciplinaryFines, ['super_admin', 'admin', 'disciplinary']],
  ['audit', AuditTrail, ADMIN_ROLES],
  ['control', ControlRoom, ['super_admin']],
];

export default function AdminRoutes() {
  return (
    <Routes>
      <Route element={<ProtectedRoute />}>
        {GUARDED.map(([path, Page, roles]) => (
          <Route
            key={path}
            path={path}
            element={
              <RoleGuard roles={roles}>
                <Page />
              </RoleGuard>
            }
          />
        ))}
        {/* The old single-entry / weekly-grid log screen is retired — the member list is the one way
            in. Kept as a redirect so a bookmark or an old shared link still lands somewhere useful. */}
        <Route path="log" element={<Navigate to="/admin/finance" replace />} />
        {/* Every signed-in role reaches this one, so it carries no RoleGuard: it is where a treasurer,
            secretary or disciplinary officer changes his own password and enrols his own second
            factor, since neither Settings nor the dashboard is his to open. */}
        <Route path="account" element={<MyAccount />} />
      </Route>
      <Route path="/" element={<Navigate to="/admin/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
