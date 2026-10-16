// The super admin's way through a refusal — with a reason on the record.
//
// Some rules in this system stop everybody else: a closed period, and (through maintenance
// mode) any write at all. The super admin is the one account that can put things right, so it
// may go through them, but never silently: the request must carry a written reason, and the
// audit trail keeps it next to the entry it explains. A rule with an unaccountable exception is
// not a rule, and this is what keeps the exception accountable.
//
// The reason travels in the X-Override-Reason header, percent-encoded (a header cannot carry
// every character a person types), so no controller's body handling had to change.
const MIN_REASON_LENGTH = 5;
const MAX_REASON_LENGTH = 300;

function overrideReason(req) {
  if (req.user?.role !== 'super_admin' || req.previewing) return null;
  const raw = req.headers?.['x-override-reason'];
  if (!raw) return null;
  let text;
  try {
    text = decodeURIComponent(String(raw));
  } catch {
    text = String(raw);
  }
  text = text.trim();
  return text.length >= MIN_REASON_LENGTH ? text.slice(0, MAX_REASON_LENGTH) : null;
}

module.exports = { overrideReason, MIN_REASON_LENGTH, MAX_REASON_LENGTH };
