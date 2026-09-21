import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api, { TOKEN_KEY } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!localStorage.getItem(TOKEN_KEY));

  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) return;
    api
      .get('/api/auth/me')
      .then((res) => setUser(res.data.user))
      .catch((err) => {
        // Only a real "this token is invalid" response should sign the admin
        // out. A network error or a cold-starting free-tier backend (Render
        // spins down when idle) must not silently boot them to the login
        // screen — the interceptor already handles genuine 401s elsewhere.
        if (err.response?.status === 401) localStorage.removeItem(TOKEN_KEY);
      })
      .finally(() => setLoading(false));
  }, []);

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
    setUser(res.data.user);
    return { user: res.data.user };
  }, []);

  // Step two: the six-digit code (or one of the recovery codes).
  const completeTwoFactor = useCallback(async (challenge, code) => {
    const res = await api.post('/api/auth/2fa/verify', { challenge, code });
    localStorage.setItem(TOKEN_KEY, res.data.token);
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
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, completeTwoFactor, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
