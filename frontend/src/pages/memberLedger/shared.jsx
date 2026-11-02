import { METHOD_LABELS } from '../../utils/format';

export const METHODS = Object.keys(METHOD_LABELS);

// The four things the treasurer can put on a member's page. `kind` maps
// straight onto the API's single write endpoint, and the amount each one
// prefills with is what members actually owe — so the usual entry is: tap the
// member, tap Weekly, paste the M-Pesa message, tap Log.
// The two things the treasurer can add to a member's page. Tea is not here on
// purpose — it is deducted automatically every week, so there is nothing to log
// and nothing to edit.
export const KINDS = [
  { value: 'weekly', label: 'Weekly', hint: 'The weekly contribution due' },
  { value: 'expense', label: 'Expense', hint: 'Money spent from the Tea Fund' },
];
