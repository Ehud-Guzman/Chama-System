// The extension is explicit because Node's resolver needs one and Vite does not: with it, this
// module can be imported by `node --test` (test/api.test.js) instead of only by the bundler.
import { queueRequest } from './offlineQueue.js';

export const TOKEN_KEY = 'cm_token';

// A phone on a dying 3G cell does not fail, it stalls: without a ceiling the
// request never settles, the button stays on "Saving…" and the admin has no way to
// tell a slow network from a broken app. 20s is long enough for a real mobile round
// trip and short enough that the failure is still attached to the action.
export const REQUEST_TIMEOUT_MS = 20000;

// `import.meta.env` belongs to Vite; the optional chaining lets this module be imported by the test
// runner, which has no Vite behind it.
const BASE_URL = import.meta.env?.VITE_API_URL || 'http://localhost:5000';

// -----------------------------------------------------------------------------
// The HTTP client, on `fetch`
// -----------------------------------------------------------------------------
//
// This was axios: 45 KB of source for the four things this app asks of it — a base URL, the bearer
// token on every request, a timeout, and an error whose shape never varies. Nothing outside this
// file ever imported axios, so the shape is kept and the dependency is gone: 17.7 KB off the wire
// for a first visit, a tenth of what a member's phone pays to open the app.
//
// Two things a bare `fetch` cannot do here, because callers already rely on them:
//
//   * **An error carries `response: { status, data }`** — every screen's message and the offline
//     queue's own classifyFailure/looksLikeDuplicate read those.
//   * **`config.data` stays as the caller passed it — an object, not a string.** The outbox stores
//     that body and replays it later, and axios had already JSON-serialised it by the time its
//     response interceptor saw it: the queue stored a *string*, and `{...body}` turned a queued
//     payment into `{"0":"{","1":"\"",…}` — a payment that could never be sent, discarded on the
//     next flush as "the server refused it". That is the bug this rewrite closes, which is why
//     serialisation now happens here, at the last moment, and nowhere else.
//
// `onUploadProgress` is served by XMLHttpRequest, which reports upload progress and fetch does not.
// One call site uses it (a document upload, where a 5 MB scan on a slow cell needs a moving number),
// so XHR is a fallback for that option rather than the general mechanism.

function authToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    // Private mode, or no storage at all. No token is a legitimate state: the public pages use it.
    return null;
  }
}

function withQuery(url, params) {
  if (!params) return url;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    // `undefined` is how a caller says "leave this filter out" (Documents.jsx passes
    // `download: undefined` when it is not downloading), so it is dropped, not sent as "undefined".
    if (value === undefined || value === null) continue;
    search.append(key, String(value));
  }
  const query = search.toString();
  if (!query) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${query}`;
}

function requestHeaders(config) {
  const headers = { ...(config.headers || {}) };
  const token = authToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

// The body as `fetch` wants it, and whether it needs a Content-Type of ours. FormData carries its
// own multipart boundary and must be left alone — setting that header by hand produces a body the
// server cannot parse, which is the classic way an upload breaks when a client is ported.
function bodyFor(data) {
  if (data === undefined || data === null) return { body: undefined, json: false };
  if (typeof FormData !== 'undefined' && data instanceof FormData) return { body: data, json: false };
  if (typeof data === 'string' || (typeof Blob !== 'undefined' && data instanceof Blob)) {
    return { body: data, json: false };
  }
  if (typeof URLSearchParams !== 'undefined' && data instanceof URLSearchParams) {
    return { body: data, json: false };
  }
  return { body: JSON.stringify(data), json: true };
}

function headersToObject(response) {
  const out = {};
  response.headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

// Every failure leaves through here, so the shape is one shape.
function failure({ config, status, data, headers, code, message }) {
  const err = new Error(message);
  err.config = config;
  if (code) err.code = code;
  if (status !== undefined) err.response = { status, data, headers: headers || {} };
  return err;
}

const TIMEOUT_MESSAGE = `timeout of ${REQUEST_TIMEOUT_MS}ms exceeded`;

async function readBody(response, responseType) {
  // A blob answer is read as a Blob whether the request succeeded or not: the API answers a refused
  // download with JSON, and `utils/blobError` unwraps that blob to find the real message (the
  // rate-limit text, say) instead of falling back to something vague.
  if (responseType === 'blob') return response.blob().catch(() => null);
  const text = await response.text().catch(() => '');
  if (!text) return null;
  if (!(response.headers.get('content-type') || '').includes('json')) return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// The 401 bounce and the outbox, in one place, whichever transport was used.
async function handleFailure(err) {
  const config = err.config || {};

  if (typeof window !== 'undefined') {
    // Expired/invalid session on an admin page → back to login.
    const onAdminPage =
      window.location.pathname.startsWith('/admin') &&
      window.location.pathname !== '/admin/login';
    if (err.response?.status === 401 && onAdminPage) {
      try {
        localStorage.removeItem(TOKEN_KEY);
      } catch {
        // Nothing to clean up when there is no storage.
      }
      window.location.assign('/admin/login');
    }
  }

  // A write the caller marked as queueable, that failed for a reason a retry could fix, goes into
  // the outbox instead of being lost (services/offlineQueue). It is opt-in per request, on purpose:
  // silently keeping somebody's failed save is only acceptable where the API already treats a
  // repeat as the same write, which is true of the ledger and not universally true.
  //
  // The error still rejects — the caller has to know it has not been saved yet, and there is a
  // screen telling it so. `queuedOffline` is set so the message can say "kept, will send".
  if (config.offlineQueue && !config.__queuedOffline) {
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
        // The browser will not store it (private mode, no quota, or a body it cannot read back).
        // The error stands as it was, which is the honest outcome: it really was not saved.
      }
    }
  }

  throw err;
}

async function sendWithFetch(config) {
  const { body, json } = bodyFor(config.data);
  const headers = requestHeaders(config);
  if (json && !headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/json';
  }

  // A per-request ceiling, with the module's 20s as the default. axios had this (`timeout` in the
  // config) and a port that dropped it would quietly make one slow endpoint unkillable.
  const timeoutMs = Number(config.timeout) > 0 ? Number(config.timeout) : REQUEST_TIMEOUT_MS;

  // The timeout is an AbortController rather than a race, so the socket is actually released: a
  // request abandoned but not aborted keeps the radio busy on a phone that needs it.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let response;
  try {
    response = await fetch(`${BASE_URL}${withQuery(config.url, config.params)}`, {
      method: (config.method || 'get').toUpperCase(),
      headers,
      body,
      signal: controller.signal,
      // The API is on its own origin and authenticates with the bearer token, so nothing else
      // travels with the request — cookies included.
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch (err) {
    if (timedOut) throw failure({ config, code: 'ECONNABORTED', message: TIMEOUT_MESSAGE });
    // A caller's own abort (a screen closing a search) must still reject, but the message should
    // not claim the connection is at fault.
    if (err?.name === 'AbortError') throw failure({ config, code: 'ERR_CANCELED', message: 'canceled' });
    throw failure({ config, code: 'ERR_NETWORK', message: 'Network Error' });
  } finally {
    clearTimeout(timer);
  }

  const headersOut = headersToObject(response);
  const data = await readBody(response, config.responseType);

  if (!response.ok) {
    return handleFailure(
      failure({
        config,
        status: response.status,
        data,
        headers: headersOut,
        code: 'ERR_BAD_REQUEST',
        message: `Request failed with status code ${response.status}`,
      })
    );
  }

  return { data, status: response.status, statusText: response.statusText, headers: headersOut, config };
}

// The one request shape `fetch` cannot express: an upload with a progress number. Used only when a
// caller asks for one, so the general path stays on fetch.
function sendWithProgress(config) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const { body, json } = bodyFor(config.data);
    const isBlob = config.responseType === 'blob';

    xhr.open((config.method || 'get').toUpperCase(), `${BASE_URL}${withQuery(config.url, config.params)}`, true);
    const headers = requestHeaders(config);
    if (json && !headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
    xhr.responseType = isBlob ? 'blob' : 'text';
    xhr.timeout = REQUEST_TIMEOUT_MS;

    if (xhr.upload && config.onUploadProgress) {
      xhr.upload.onprogress = (event) => config.onUploadProgress(event);
    }

    xhr.onload = () => {
      const raw = xhr.getResponseHeader('content-type') || '';
      let data = xhr.response;
      if (!isBlob && raw.includes('json') && typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          // A body that claims to be JSON and is not is left as text; the caller's message falls
          // back rather than showing a parse error to a member.
        }
      }
      const headersOut = {};
      for (const line of (xhr.getAllResponseHeaders() || '').split('\r\n')) {
        const at = line.indexOf(':');
        if (at > 0) headersOut[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ data, status: xhr.status, statusText: xhr.statusText, headers: headersOut, config });
        return;
      }
      reject(
        failure({
          config,
          status: xhr.status,
          data,
          headers: headersOut,
          code: 'ERR_BAD_REQUEST',
          message: `Request failed with status code ${xhr.status}`,
        })
      );
    };
    xhr.onerror = () => reject(failure({ config, code: 'ERR_NETWORK', message: 'Network Error' }));
    xhr.ontimeout = () => reject(failure({ config, code: 'ECONNABORTED', message: TIMEOUT_MESSAGE }));
    xhr.onabort = () => reject(failure({ config, code: 'ERR_CANCELED', message: 'canceled' }));
    xhr.send(body);
  }).catch((err) => handleFailure(err));
}

// The client itself. The axios call signatures are kept exactly — `get/delete(url, config)`,
// `post/put/patch(url, data, config)` — so not one call site in the app had to change.
function request(config) {
  const send = config.onUploadProgress ? sendWithProgress : sendWithFetch;
  return send(config);
}

const api = {
  request,
  get: (url, config = {}) => request({ ...config, url, method: 'get' }),
  delete: (url, config = {}) => request({ ...config, url, method: 'delete' }),
  post: (url, data, config = {}) => request({ ...config, url, data, method: 'post' }),
  put: (url, data, config = {}) => request({ ...config, url, data, method: 'put' }),
  patch: (url, data, config = {}) => request({ ...config, url, data, method: 'patch' }),
};

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
