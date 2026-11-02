// Mail: how the app sends email, and what the emails say.
//
// The pieces live in utils/mailer/, one file per job:
//
//   providers  the HTTPS mail providers' request shapes (no network, so they are testable)
//   config     is mail set up, who it is from, and what is wrong when it is not
//   api        sending over a provider's HTTPS API
//   smtp       sending over SMTP: the cached transport and its IPv4 lookup
//   send       choosing the road and sending or verifying a message
//   failures   turning a failed send into words the office can act on
//   templates  the emails themselves: reminders, fines, password reset, statements, alerts
//
// This file only gathers them, so every caller and test that requires it keeps working.

const { API_PROVIDERS: __apiProviders } = require('./mailer/providers');
const { buildStatementEmail, buildSecurityAlertEmail, buildReminderEmail, buildFineIssuedEmail, buildFineSettledEmail, buildPasswordResetEmail } = require('./mailer/templates');
const { cleanEmail, isValidEmail, isMailConfigured, assertMailConfigured, describeMailConfig, parseMailFrom, mailConfigurationProblem } = require('./mailer/config');
const { describeMailError, isConnectionFailure, mailFailure } = require('./mailer/failures');
const { describeMailEndpoint, resolveIpv4, transportOptions } = require('./mailer/smtp');
const { providerMessage } = require('./mailer/api');
const { activeMailTransport, sendMail, verifyMail } = require('./mailer/send');

module.exports = {
  __apiProviders,
  buildStatementEmail,
  buildSecurityAlertEmail,
  cleanEmail,
  isValidEmail,
  isMailConfigured,
  assertMailConfigured,
  describeMailConfig,
  describeMailError,
  isConnectionFailure,
  describeMailEndpoint,
  mailFailure,
  parseMailFrom,
  providerMessage,
  mailConfigurationProblem,
  activeMailTransport,
  resolveIpv4,
  transportOptions,
  sendMail,
  verifyMail,
  buildReminderEmail,
  buildFineIssuedEmail,
  buildFineSettledEmail,
  buildPasswordResetEmail,
};
