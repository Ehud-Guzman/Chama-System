import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import PublicLookup from './pages/PublicLookup.jsx';
import PublicMemberDetail from './pages/PublicMemberDetail.jsx';
import PublicConstitution from './pages/PublicConstitution.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { ToastProvider } from './components/shared/Toast.jsx';
import Loader from './components/shared/Loader.jsx';

// Admin code is lazy-loaded — the public lookup bundle stays lean
const AdminLogin = lazy(() => import('./pages/AdminLogin.jsx'));
const ProtectedRoute = lazy(() => import('./components/layout/ProtectedRoute.jsx'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard.jsx'));
const MembersList = lazy(() => import('./pages/MembersList.jsx'));
const MemberDetail = lazy(() => import('./pages/MemberDetail.jsx'));
const ContributionsLog = lazy(() => import('./pages/ContributionsLog.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));

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
              <Route path="/admin/dashboard" element={<AdminDashboard />} />
              <Route path="/admin/members" element={<MembersList />} />
              <Route path="/admin/members/:id" element={<MemberDetail />} />
              <Route path="/admin/log" element={<ContributionsLog />} />
              <Route path="/admin/reports" element={<Reports />} />
            </Route>
            <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ToastProvider>
    </AuthProvider>
  );
}
