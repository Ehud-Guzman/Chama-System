import axios from 'axios';

export const TOKEN_KEY = 'cm_token';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Expired/invalid session on an admin page → back to login
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const onAdminPage =
      window.location.pathname.startsWith('/admin') &&
      window.location.pathname !== '/admin/login';
    if (err.response?.status === 401 && onAdminPage) {
      localStorage.removeItem(TOKEN_KEY);
      window.location.assign('/admin/login');
    }
    return Promise.reject(err);
  }
);

// Human-readable message from any API error
export function apiMessage(err, fallback = 'Something went wrong. Please try again.') {
  return err?.response?.data?.message || fallback;
}

export default api;
