import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import PublicLookup from './pages/PublicLookup.jsx';
import PublicMemberDetail from './pages/PublicMemberDetail.jsx';
import PublicConstitution from './pages/PublicConstitution.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { ToastProvider } from './components/shared/Toast.jsx';
import Loader from './components/shared/Loader.jsx';
import RoleGuard from './components/layout/RoleGuard.jsx';

// Admin code is lazy-loaded — the public lookup bundle stays lean
const AdminLogin = lazy(() => import('./pages/AdminLogin.jsx'));
const ProtectedRoute = lazy(() => import('./components/layout/ProtectedRoute.jsx'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard.jsx'));
const MembersList = lazy(() => import('./pages/MembersList.jsx'));
const MemberDetail = lazy(() => import('./pages/MemberDetail.jsx'));
const ContributionsLog = lazy(() => import('./pages/ContributionsLog.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const Minutes = lazy(() => import('./pages/Minutes.jsx'));
const DisciplinaryFines = lazy(() => import('./pages/DisciplinaryFines.jsx'));

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Suspense fallback={<Loader />}>
          <Routes>
            <Route path="/" element={<PublicLookup />} />
            <Route path="/member/:id" element={<PublicMemberDetail />} />
            <Route path="/constitution" element={<PublicConstitution />} />
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route element={<ProtectedRoute />}>
              <Route
                path="/admin/dashboard"
                element={
                  <RoleGuard roles={['super_admin', 'admin']}>
                    <AdminDashboard />
                  </RoleGuard>
                }
              />
              <Route
                path="/admin/members"
                element={
                  <RoleGuard roles={['super_admin', 'admin']}>
                    <MembersList />
                  </RoleGuard>
                }
              />
              <Route
                path="/admin/members/:id"
                element={
                  <RoleGuard roles={['super_admin', 'admin']}>
                    <MemberDetail />
                  </RoleGuard>
                }
              />
              <Route
                path="/admin/log"
                element={
                  <RoleGuard roles={['super_admin', 'admin', 'treasurer']}>
                    <ContributionsLog />
                  </RoleGuard>
                }
              />
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
