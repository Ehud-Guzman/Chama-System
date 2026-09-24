import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import PublicLookup from './pages/PublicLookup.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { ToastProvider } from './components/shared/Toast.jsx';
import OfflineBanner from './components/shared/OfflineBanner.jsx';
import Loader from './components/shared/Loader.jsx';
import RoleGuard from './components/layout/RoleGuard.jsx';

// Everything except the members' lookup page is lazy-loaded, including the
// constitution: it is reached from the members' area by a handful of visitors, and
// it brings its own 29 KB stylesheet with it — nobody who opens the link to check a
// balance should pay for either.
const PublicConstitution = lazy(() => import('./pages/PublicConstitution.jsx'));
const AdminLogin = lazy(() => import('./pages/AdminLogin.jsx'));
const ProtectedRoute = lazy(() => import('./components/layout/ProtectedRoute.jsx'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard.jsx'));
const AdminSettings = lazy(() => import('./pages/AdminSettings.jsx'));
const MembersList = lazy(() => import('./pages/MembersList.jsx'));
const MemberDetail = lazy(() => import('./pages/MemberDetail.jsx'));
const FinanceLedger = lazy(() => import('./pages/FinanceLedger.jsx'));
const FinanceMemberLedger = lazy(() => import('./pages/FinanceMemberLedger.jsx'));
const FinanceSetup = lazy(() => import('./pages/FinanceSetup.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const Minutes = lazy(() => import('./pages/Minutes.jsx'));
const Documents = lazy(() => import('./pages/Documents.jsx'));
const Reminders = lazy(() => import('./pages/Reminders.jsx'));
const DisciplinaryFines = lazy(() => import('./pages/DisciplinaryFines.jsx'));
const AuditTrail = lazy(() => import('./pages/AuditTrail.jsx'));
const MyAccount = lazy(() => import('./pages/MyAccount.jsx'));

export default function App() {
  // Take down the splash that index.html painted.
  //
  // It is removed here, in the one component that is always mounted, and only after React has
  // committed — so the app's own first screen is already on the glass when the mark goes, never the
  // other way round. A splash removed a moment too early is a blank screen, which is the thing the
  // splash exists to prevent.
  //
  // If the app throws before committing, this never runs and the mark stays with its own "Try
  // again" button, which is a better answer than an empty page. The slow-connection line and that
  // button are put in place by index.html itself, because they have to work when nothing else has
  // loaded.
  useEffect(() => {
    document.getElementById('splash')?.remove();
  }, []);

  return (
    <AuthProvider>
      <ToastProvider>
        <OfflineBanner />
        <Suspense fallback={<Loader />}>
          <Routes>
            <Route path="/" element={<PublicLookup />} />
            {/* Members only: the page fetches the text for an ID recorded against
                a member, and there is no public link to it anywhere. */}
            <Route path="/constitution" element={<PublicConstitution />} />
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route element={<ProtectedRoute />}>
              <Route
                path="/admin/dashboard"
                element={
                  <RoleGuard roles={['super_admin', 'admin', 'treasurer']}>
                    <AdminDashboard />
                  </RoleGuard>
                }
              />
              <Route
                path="/admin/settings"
                element={
                  /* The tooling behind this page is admin-only at the API too
                     (api/settings, api/fine-types, api/auth/admins, api/backup), so
                     the guard and the server agree about who may be here. */
                  <RoleGuard roles={['super_admin', 'admin']}>
                    <AdminSettings />
                  </RoleGuard>
                }
              />
              <Route
                path="/admin/members"
                element={
                  <RoleGuard roles={['super_admin', 'admin', 'treasurer']}>
                    <MembersList />
                  </RoleGuard>
                }
              />
              <Route
                path="/admin/members/:id"
                element={
                  <RoleGuard roles={['super_admin', 'admin', 'treasurer']}>
                    <MemberDetail />
                  </RoleGuard>
                }
              />
              <Route
                path="/admin/finance"
                element={
                  <RoleGuard roles={['super_admin', 'admin', 'treasurer']}>
                    <FinanceLedger />
                  </RoleGuard>
                }
              />
              <Route
                path="/admin/finance/setup"
                element={
                  <RoleGuard roles={['super_admin', 'admin', 'treasurer']}>
                    <FinanceSetup />
                  </RoleGuard>
                }
              />
              <Route
                path="/admin/finance/:id"
                element={
                  <RoleGuard roles={['super_admin', 'admin', 'treasurer']}>
                    <FinanceMemberLedger />
                  </RoleGuard>
                }
              />
              {/* The old single-entry / weekly-grid log screen is retired — the
                  member list is the one way in. Kept as a redirect so a bookmark
                  or an old shared link still lands somewhere useful. */}
              <Route path="/admin/log" element={<Navigate to="/admin/finance" replace />} />
              <Route
                path="/admin/reports"
                element={
                  <RoleGuard roles={['super_admin', 'admin', 'treasurer', 'secretary']}>
                    <Reports />
                  </RoleGuard>
                }
              />
              <Route
                path="/admin/minutes"
                element={
                  <RoleGuard roles={['super_admin', 'admin', 'secretary']}>
                    <Minutes />
                  </RoleGuard>
                }
              />
              <Route
                path="/admin/reminders"
                element={
                  <RoleGuard roles={['super_admin', 'admin', 'treasurer']}>
                    <Reminders />
                  </RoleGuard>
                }
              />
              <Route
                path="/admin/documents"
                element={
                  <RoleGuard roles={['super_admin', 'admin', 'treasurer', 'secretary']}>
                    <Documents />
                  </RoleGuard>
                }
              />
              <Route
                path="/admin/disciplinary"
                element={
                  <RoleGuard roles={['super_admin', 'admin', 'disciplinary']}>
                    <DisciplinaryFines />
                  </RoleGuard>
                }
              />
              {/* The audit trail is its own destination, not a panel under the
                  reports. The guard is the set of roles the API lets read it. */}
              <Route
                path="/admin/audit"
                element={
                  <RoleGuard roles={['super_admin', 'admin', 'treasurer', 'secretary']}>
                    <AuditTrail />
                  </RoleGuard>
                }
              />
              {/* Every signed-in role reaches this one, so it carries no RoleGuard:
                  it is where a treasurer, secretary or disciplinary officer changes
                  his own password and enrols his own second factor, since neither
                  Settings nor the dashboard is his to open. */}
              <Route path="/admin/account" element={<MyAccount />} />
            </Route>
            <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ToastProvider>
    </AuthProvider>
  );
}
