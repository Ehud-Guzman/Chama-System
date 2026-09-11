// Mirrors the backend policy in authController.js — at least 8 characters
// with a mix of letters and numbers.
export function weakPasswordMessage(password) {
  const value = String(password || '');
  if (value.length < 8) return 'Password must be at least 8 characters';
  if (!/[a-zA-Z]/.test(value) || !/[0-9]/.test(value)) {
    return 'Password must include both letters and numbers';
  }
  return null;
}
