import { lazy, Suspense } from 'react';
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

export default function App() {
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
            </Route>
            <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ToastProvider>
    </AuthProvider>
  );
}
