// The sign-in controller.
//
// The handlers live in controllers/auth/:
//
//   common         what several share: the account shape, session and challenge tokens, sign-in records
//   signIn         signing in, the second factor, who am I, changing your own password
//   admins         the office accounts: list, create, switch off, reset a password or a second factor
//   twoFactor      setting up, enabling and disabling two-factor sign-in, and recovery codes
//   passwordReset  the emailed reset link
//
// This file only gathers them, so every route and test that requires it keeps working.

const { passwordResetAvailable, forgotPassword, resetPasswordWithToken } = require('./auth/passwordReset');
const { login, verifyTwoFactor, me, changeOwnPassword } = require('./auth/signIn');
const { beginTwoFactorSetup, enableTwoFactor, disableTwoFactor, regenerateRecoveryCodes } = require('./auth/twoFactor');
const { resetAdminTwoFactor, listAdmins, createAdmin, updateAdmin, resetAdminPassword } = require('./auth/admins');

module.exports = {
  passwordResetAvailable,
  forgotPassword,
  resetPasswordWithToken,
  login,
  verifyTwoFactor,
  me,
  changeOwnPassword,
  beginTwoFactorSetup,
  enableTwoFactor,
  disableTwoFactor,
  regenerateRecoveryCodes,
  resetAdminTwoFactor,
  listAdmins,
  createAdmin,
  updateAdmin,
  resetAdminPassword,
};
