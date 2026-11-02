// The reminders controller.
//
// The handlers live in controllers/notification/:
//
//   dues  who owes what right now: the arrears, fines and the money line, per member
//   read  mail status, the reminders list, and the history of what was sent
//   send  sending the reminders, by hand or from the weekly sweep
//
// This file only gathers them, so every route, script and test that requires it keeps working.

const { mailStatus, listReminders, reminderHistory } = require('./notification/read');
const { sendReminders, deliverReminders } = require('./notification/send');
const { computeMemberDues, MAX_RECIPIENTS } = require('./notification/dues');

module.exports = {
  mailStatus,
  listReminders,
  sendReminders,
  reminderHistory,
  computeMemberDues,
  deliverReminders,
  MAX_RECIPIENTS,
};
