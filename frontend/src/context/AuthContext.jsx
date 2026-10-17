import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api, { TOKEN_KEY, REAL_TOKEN_KEY } from '../services/api';

const AuthContext = createContext(null);

// Ends every session this browser holds: the live one and any parked by a preview (services/preview).
const forgetSessions = () => [TOKEN_KEY, REAL_TOKEN_KEY].forEach((key) => localStorage.removeItem(key));

// While the super admin is looking at the app as another role, the real session is parked under
// REAL_TOKEN_KEY (services/api) and the preview token takes its place under TOKEN_KEY — see
// services/preview. Kept in localStorage (not memory) so a refresh in the middle of a preview can
// still find its way back.

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!localStorage.getItem(TOKEN_KEY));
  // Set while the super admin has switched maintenance mode on (everyone else can read, not save).
  const [maintenance, setMaintenance] = useState(null);
  // Set while the super admin is previewing another role: { role, realName }.
  const [preview, setPreview] = useState(null);

  // What /api/auth/me says, in one place: the account, and the two states that change what every
  // screen should show whoever is looking.
  const applyMe = useCallback((data) => {
    setUser(data.user);
    setMaintenance(data.maintenance || null);
    setPreview(data.preview || null);
  }, []);

  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) return;
    api
      .get('/api/auth/me')
      .then((res) => applyMe(res.data))
      .catch((err) => {
        // Only a real "this token is invalid" response should sign the admin
        // out. A network error or a cold-starting free-tier backend (Render
        // spins down when idle) must not silently boot them to the login
        // screen — the interceptor already handles genuine 401s elsewhere.
        if (err.response?.status === 401) {
          forgetSessions();
        }
      })
      .finally(() => setLoading(false));
  }, [applyMe]);

  // Step one of the sign-in.
  //
  // Returns either `{ user }` — signed in — or `{ twoFactorRequired: true, challenge, email }`,
  // which means the password was right and the code has not been given yet. The caller has to
  // handle both, and the token is only stored in the first case: a challenge is not a session
  // and the API refuses it as one, so putting it in localStorage would be storing something
  // that looks like a credential and is not.
  const login = useCallback(async (email, password) => {
    const res = await api.post('/api/auth/login', { email, password });
    if (res.data.twoFactorRequired) {
      return {
        twoFactorRequired: true,
        challenge: res.data.challenge,
        email: res.data.email || email,
      };
    }
    localStorage.setItem(TOKEN_KEY, res.data.token);
    // A fresh sign-in is a fresh start: a session parked by an earlier preview is not this person's.
    localStorage.removeItem(REAL_TOKEN_KEY);
    setUser(res.data.user);
    return { user: res.data.user };
  }, []);

  // Step two: the six-digit code (or one of the recovery codes).
  const completeTwoFactor = useCallback(async (challenge, code) => {
    const res = await api.post('/api/auth/2fa/verify', { challenge, code });
    localStorage.setItem(TOKEN_KEY, res.data.token);
    localStorage.removeItem(REAL_TOKEN_KEY);
    setUser(res.data.user);
    return {
      user: res.data.user,
      // The screen says so when a recovery code was spent: an admin who used one needs to know
      // he is now one code poorer, and that the code he just typed no longer works.
      usedRecoveryCode: Boolean(res.data.usedRecoveryCode),
      recoveryCodesRemaining: res.data.recoveryCodesRemaining,
    };
  }, []);

  const logout = useCallback(() => {
    forgetSessions();
    setUser(null);
    setMaintenance(null);
    setPreview(null);
  }, []);

  // Re-reads the account and the maintenance state, for the screen that has just changed either.
  const refreshMe = useCallback(async () => {
    const res = await api.get('/api/auth/me');
    applyMe(res.data);
    return res.data;
  }, [applyMe]);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        completeTwoFactor,
        logout,
        maintenance,
        preview,
        refreshMe,
        // Starting and leaving a preview live in services/preview, which only the super admin's
        // lazy-loaded screens import: this file is on the members' page's critical path and
        // carries nothing it does not need.
        applyMe,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
