import { Navigate, Outlet } from 'react-router-dom';
import { Suspense } from 'react';
import { useAuth } from '../../context/AuthContext';
import AdminLayout from './AdminLayout';
import Loader from '../shared/Loader';

export default function ProtectedRoute() {
  const { user, loading } = useAuth();

  if (loading) return <Loader label="Checking session…" />;
  if (!user) return <Navigate to="/admin/login" replace />;

  return (
    <AdminLayout>
      {/* The page chunk loads inside the shell, not instead of it: the sidebar
          and the bottom bar stay painted while the next page's JavaScript
          arrives, so a navigation reads as a swap rather than a blank screen.
          Every admin page is still lazy-loaded; only the boundary moved. */}
      <Suspense fallback={<Loader />}>
        <Outlet />
      </Suspense>
    </AdminLayout>
  );
}
