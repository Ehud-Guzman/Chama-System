import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import AdminLayout from './AdminLayout';
import Loader from '../shared/Loader';

export default function ProtectedRoute() {
  const { user, loading } = useAuth();

  if (loading) return <Loader label="Checking session…" />;
  if (!user) return <Navigate to="/admin/login" replace />;

  return (
    <AdminLayout>
      <Outlet />
    </AdminLayout>
  );
}
