import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

// Blocks direct URL access to a route for roles that don't have it in nav
// (e.g. secretary hitting /admin/log or /admin/members).
export default function RoleGuard({ roles, redirectTo = '/admin/dashboard', children }) {
  const { user } = useAuth();
  if (user && !roles.includes(user.role)) {
    return <Navigate to={redirectTo} replace />;
  }
  return children;
}
