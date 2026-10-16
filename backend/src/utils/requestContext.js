const { AsyncLocalStorage } = require('async_hooks');

// Who is asking, available to code that was never handed the request.
//
// The audit trail wants the network address behind every entry ("which address changed this?"),
// and logAudit is called from forty places that have no `req`. Threading the address through all
// of them would touch every controller; an AsyncLocalStorage carries it for the life of the
// request instead, and anything outside a request (a script, a scheduled job) simply has none.
const storage = new AsyncLocalStorage();

function runWithRequest(context, fn) {
  return storage.run(context, fn);
}

function currentRequest() {
  return storage.getStore() || null;
}

module.exports = { runWithRequest, currentRequest };
