// The fines controller.
//
// The handlers live in controllers/fine/:
//
//   common    who may see which fines, and the shape a fine is sent in
//   read      listing, summarising and exporting fines
//   office    issuing a fine, voiding one, and checking payments that came in by M-Pesa
//   payments  settling a fine, paying a member's fines, the member's position, undoing a payment
//
// This file only gathers them, so every route and test that requires it keeps working.

const { listFines, finesSummary, exportFines, exportMemberFines } = require('./fine/read');
const { createFine, paymentsToCheck, checkPayments, voidFine } = require('./fine/office');
const { settleFine, payMemberFines, memberFinePosition, undoFinePayment } = require('./fine/payments');

module.exports = {
  listFines,
  finesSummary,
  exportFines,
  exportMemberFines,
  createFine,
  settleFine,
  payMemberFines,
  memberFinePosition,
  undoFinePayment,
  paymentsToCheck,
  checkPayments,
  voidFine,
};
