import axios from 'axios';

export const TOKEN_KEY = 'cm_token';

// A phone on a dying 3G cell does not fail, it stalls: without a ceiling the
// request never settles, the button stays on "Saving…" and the admin has no way to
// tell a slow network from a broken app. 20s is long enough for a real mobile round
// trip and short enough that the failure is still attached to the action.
export const REQUEST_TIMEOUT_MS = 20000;

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000',
  timeout: REQUEST_TIMEOUT_MS,
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

// Human-readable message from any API error.
//
// The connection cases are named rather than lumped into the generic line: "no
// internet" and "the server took too long" are the two failures a member on mobile
// data actually meets, and each one tells him something different to do about it.
export function apiMessage(err, fallback = 'Something went wrong. Please try again.') {
  const serverMessage = err?.response?.data?.message;
  if (serverMessage) return serverMessage;

  const code = err?.code;
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
    return 'The server took too long to answer. Check your connection and try again.';
  }
  if (code === 'ERR_NETWORK' || err?.message === 'Network Error' || isOffline()) {
    return 'No connection. Check your data or Wi-Fi and try again.';
  }
  return fallback;
}

// Whether the browser thinks it is online. Not proof — a captive portal or a dead
// cell still reports online — but it turns the common case ("my bundle finished")
// into a message that names the actual problem.
export function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export default api;
