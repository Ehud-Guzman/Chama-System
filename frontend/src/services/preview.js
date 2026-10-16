import api, { TOKEN_KEY, REAL_TOKEN_KEY } from './api';

// The super admin looking at the app as another role (Control Room → Accounts and sessions).
//
// The real session is parked under REAL_TOKEN_KEY and the preview token takes its place under
// TOKEN_KEY, so every request in between is made as the borrowed role — read-only, by the server's
// rule. `applyMe` is the auth context's way of taking in what /api/auth/me says.
//
// Its own module, not part of AuthContext: this is only ever needed behind the Control Room, and
// the auth context is loaded by the members' page, whose download is held to a budget.

// Sign in, read-only, as another role. If anything goes wrong half way, the real session is put
// straight back.
export async function startPreview(role, applyMe) {
  const real = localStorage.getItem(TOKEN_KEY);
  if (!real) throw new Error('You are not signed in.');
  const res = await api.post('/api/superadmin/preview', { role });
  try {
    localStorage.setItem(REAL_TOKEN_KEY, real);
    localStorage.setItem(TOKEN_KEY, res.data.token);
    const me = await api.get('/api/auth/me');
    applyMe(me.data);
    return res.data;
  } catch (err) {
    localStorage.setItem(TOKEN_KEY, real);
    localStorage.removeItem(REAL_TOKEN_KEY);
    throw err;
  }
}

export async function exitPreview(applyMe) {
  const real = localStorage.getItem(REAL_TOKEN_KEY);
  if (real) {
    localStorage.setItem(TOKEN_KEY, real);
    localStorage.removeItem(REAL_TOKEN_KEY);
  }
  const me = await api.get('/api/auth/me');
  applyMe(me.data);
}
