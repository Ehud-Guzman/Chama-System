// The treasurer's ledger controller.
//
// The handlers live in controllers/ledger/:
//
//   read   the member list with every week, and one member's ledger
//   logs   logging one payment against a member
//   week   collecting a whole week at once, and taking it back
//   setup  the week cycle and the opening balances (the go-live screen)
//
// This file only gathers them, so every route and test that requires it keeps working.

const { listLedger, memberLedger } = require('./ledger/read');
const { createLog } = require('./ledger/logs');
const { collectWeek, undoCollectWeek } = require('./ledger/week');
const { getSetup, updateSetup } = require('./ledger/setup');

module.exports = {
  listLedger,
  memberLedger,
  createLog,
  collectWeek,
  undoCollectWeek,
  getSetup,
  updateSetup,
};
