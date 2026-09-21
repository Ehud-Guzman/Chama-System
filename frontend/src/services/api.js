import axios from 'axios';
import { queueRequest } from './offlineQueue';

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
  async (err) => {
    const onAdminPage =
      window.location.pathname.startsWith('/admin') &&
      window.location.pathname !== '/admin/login';
    if (err.response?.status === 401 && onAdminPage) {
      localStorage.removeItem(TOKEN_KEY);
      window.location.assign('/admin/login');
    }

    // A write the caller marked as queueable, that failed for a reason a retry could fix, goes
    // into the outbox instead of being lost (services/offlineQueue). It is opt-in per request, on
    // purpose: silently keeping somebody's failed save is only acceptable where the API already
    // treats a repeat as the same write, which is true of the ledger and not universally true.
    //
    // The error still rejects — the caller has to know it has not been saved yet, and there is a
    // screen telling it so. `queuedOffline` is set so the message can say "kept, will send".
    const config = err.config;
    if (config?.offlineQueue && !config.__queuedOffline) {
      const status = err.response?.status;
      const worthRetrying = status === undefined || status === 408 || status === 429 || status >= 500;
      if (worthRetrying) {
        try {
          await queueRequest({
            url: config.url,
            method: config.method,
            body: config.data,
            label: config.offlineLabel || '',
          });
          config.__queuedOffline = true;
          err.queuedOffline = true;
        } catch {
          // The browser will not store it (private mode, no quota). The error stands as it was,
          // which is the honest outcome: it really was not saved.
        }
      }
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
