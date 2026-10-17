import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import PublicLookup from './pages/PublicLookup.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { ToastProvider } from './components/shared/Toast.jsx';
import OfflineBanner from './components/shared/OfflineBanner.jsx';
import UpdateBanner from './components/shared/UpdateBanner';
import Loader from './components/shared/Loader.jsx';

// Everything except the members' lookup page is lazy-loaded, including the
// constitution: it is reached from the members' area by a handful of visitors, and
// it brings its own 29 KB stylesheet with it — nobody who opens the link to check a
// balance should pay for either.
const PublicConstitution = lazy(() => import('./pages/PublicConstitution.jsx'));
const AdminLogin = lazy(() => import('./pages/AdminLogin.jsx'));
const PasswordReset = lazy(() => import('./pages/PasswordReset.jsx'));
// Everything behind a sign-in is one lazily loaded module (AdminRoutes), so the members' page carries none
// of the admin route table.
const AdminRoutes = lazy(() => import('./AdminRoutes.jsx'));

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
        <UpdateBanner />
        <Suspense fallback={<Loader />}>
          <Routes>
            <Route path="/" element={<PublicLookup />} />
            {/* Members only: the page fetches the text for an ID recorded against
                a member, and there is no public link to it anywhere. */}
            <Route path="/constitution" element={<PublicConstitution />} />
            <Route path="/admin/login" element={<AdminLogin />} />
            {/* Both steps of a forgotten password: asking for the link, and choosing a new
                password from it. Public, because the person cannot sign in. */}
            <Route path="/admin/forgot-password" element={<PasswordReset />} />
            <Route path="/admin/reset-password" element={<PasswordReset />} />
            <Route path="/admin/*" element={<AdminRoutes />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ToastProvider>
    </AuthProvider>
  );
}
