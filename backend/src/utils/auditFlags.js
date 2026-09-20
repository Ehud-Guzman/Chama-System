// What an audit entry means, and which ones deserve a second look.
//
// The trail is the group's own record of itself, and four hundred lines of
// "edited a contribution" answers none of the questions anybody actually asks. So
// every entry is put in one of four categories — money, people, records, settings
// — and the ones worth a second look carry the reason: an amount that moved, a row
// that moved to another member, a member's phone number changed (that number is how
// he opens his own record), an account's role changed, or a group-wide operation
// like a ledger reset.
//
// Pure functions over what was stored: no database and no clock, so the same entry
// reads the same way on the screen and in the export, and this can be tested
// without either.

const CATEGORY_BY_ENTITY = {
  Contribution: 'money',
  ContributionType: 'money',
  Expense: 'money',
  Fine: 'money',
  FineType: 'money',
  Member: 'people',
  User: 'people',
  Minute: 'records',
  ChamaDocument: 'records',
  DocumentCategory: 'records',
  ConstitutionDecision: 'records',
  Notification: 'records',
  Settings: 'settings',
  System: 'settings',
};

// The four cuts the screen offers, in the order it offers them.
const CATEGORIES = [
  { key: 'money', label: 'Money' },
  { key: 'people', label: 'People' },
  { key: 'records', label: 'Records' },
  { key: 'settings', label: 'Settings' },
];

// The fields worth comparing, per entity. A save also moves `updatedAt` and `__v`,
// so a raw diff would call every entry a change and the flags would mean nothing.
const WATCHED_FIELDS = {
  Member: ['name', 'phone', 'email', 'nationalId', 'regNumber', 'active', 'openingBalance', 'joinDate'],
  User: ['name', 'email', 'role', 'active'],
  Settings: ['chamaName', 'weeklyAmount', 'chaiAmount', 'cycleStartWeek', 'weekAnchorDate', 'constitution'],
  Contribution: ['memberId', 'typeId', 'amount', 'grossAmount', 'fineDeducted', 'date', 'method', 'deleted'],
  Expense: ['amount', 'date', 'description', 'typeId'],
  Fine: ['amount', 'remaining', 'status', 'reason', 'memberId', 'typeId'],
  ContributionType: ['name', 'weeklyAmount', 'isGroupFund', 'isWeekly', 'active'],
  FineType: ['name', 'defaultAmount', 'active'],
};

// Field names in the words the rest of the app uses, for the one-line summary.
const FIELD_LABELS = {
  name: 'name',
  phone: 'phone number',
  email: 'email',
  nationalId: 'ID number',
  regNumber: 'reg number',
  active: 'active',
  openingBalance: 'carried-in balance',
  joinDate: 'join date',
  role: 'role',
  weeklyAmount: 'weekly amount',
  chaiAmount: 'tea amount',
  cycleStartWeek: 'week number',
  weekAnchorDate: 'week start',
  chamaName: 'chama name',
  amount: 'amount',
  grossAmount: 'amount handed over',
  fineDeducted: 'fine deducted',
  remaining: 'amount left',
  status: 'status',
  reason: 'reason',
  date: 'date',
  method: 'method',
  deleted: 'deleted',
  memberId: 'member',
  typeId: 'fund',
  description: 'description',
  isGroupFund: 'group fund',
  isWeekly: 'weekly',
  defaultAmount: 'default amount',
  content: 'content',
};

// The phone number, the ID number and the reg number are the three things that
// decide whether somebody can open a member's own record, so a change to any of
// them is called out on its own.
const CREDENTIAL_FIELDS = ['phone', 'nationalId', 'regNumber'];

const MONEY_ENTITIES = ['Contribution', 'Expense', 'Fine', 'ContributionType', 'FineType'];

const ksh = (value) => `Ksh ${Number(value || 0).toLocaleString('en-KE')}`;

// Snapshots are stored JSON round-tripped, so a plain stringify compares them the
// way a reader would: dates as their ISO text, ids as their hex.
function asText(value) {
  return value === undefined || value === null ? '' : JSON.stringify(value);
}

function changed(before, after, field) {
  return asText(before ? before[field] : null) !== asText(after ? after[field] : null);
}

function describeFields(fields) {
  return fields.map((f) => FIELD_LABELS[f] || f).join(', ');
}

// One stored entry, read: its category, its flags, how loud it is, and the line a
// person would say about it. `before`/`after` are never returned — the screen gets
// what it prints, not a second copy of the register.
function readAuditEntry(entry) {
  const category = CATEGORY_BY_ENTITY[entry.entityType] || 'records';
  const before = entry.before || null;
  const after = entry.after || null;
  // A delete carries the record as it was, a create as it now is.
  const record = after || before || {};
  const flags = [];
  const add = (key, label, severity) => flags.push({ key, label, severity });

  const watched = WATCHED_FIELDS[entry.entityType] || [];
  const moved = watched.filter((field) => changed(before, after, field));

  // Anything removed is worth seeing, and money removed most of all.
  if (entry.action === 'delete' || record.deleted === true) {
    if (category === 'money') add('money-removed', 'money removed', 'high');
    else add('deleted', 'deleted', category === 'people' ? 'high' : 'watch');
  }

  if (category === 'money' && entry.action !== 'delete') {
    if (before && after && changed(before, after, 'amount')) {
      // A cut takes money off the books; a raise puts it on. Only one of those is
      // the shape of a mistake or a quiet correction.
      const cut = Number(after.amount) < Number(before.amount);
      add(cut ? 'amount-cut' : 'amount-raised', cut ? 'amount cut' : 'amount raised', cut ? 'high' : 'watch');
    }
    if (entry.entityType === 'Contribution') {
      if (moved.includes('memberId')) add('moved-member', 'moved to another member', 'high');
      if (moved.includes('typeId')) add('moved-fund', 'moved to another fund', 'watch');
      if (moved.includes('date')) add('re-dated', 're-dated to another week', 'watch');
    }
  }

  if (entry.entityType === 'Member') {
    if (moved.some((f) => CREDENTIAL_FIELDS.includes(f))) {
      add('credential', 'phone or ID changed', 'high');
    }
    if (moved.includes('active')) {
      add('member-status', before?.active ? 'member deactivated' : 'member reactivated', 'watch');
    }
    if (moved.includes('openingBalance')) add('opening-balance', 'carried-in balance changed', 'high');
  }

  if (entry.entityType === 'User') {
    if (moved.includes('role')) {
      add('role-changed', `role now ${record.role || 'changed'}`, 'high');
    } else {
      add('access-changed', entry.action === 'create' ? 'account created' : 'account changed', 'watch');
    }
  }

  // A group-wide operation moves everybody's figures at once: a ledger reset, a
  // restore, a batch posting, a prune. Rare enough that seeing one is the point.
  if (entry.entityType === 'System' || entry.action === 'reset') {
    add('group-wide', 'group-wide operation', 'high');
  } else if (entry.entityType === 'Settings') {
    add('group-wide', 'group-wide change', 'watch');
  }

  const severity = flags.some((f) => f.severity === 'high')
    ? 'high'
    : flags.length > 0
      ? 'watch'
      : null;

  return { category, flags, severity, summary: summarise(entry, { before, after, record, moved, category }) };
}

// The line under the entry: what actually moved, in the group's own words. Money is
// named as an amount and member records as a name; the sensitive fields are named by
// their change, never printed — the flag says a phone number moved, the screen does
// not show the number.
function summarise(entry, { before, after, record, moved, category }) {
  if (category === 'money' && MONEY_ENTITIES.includes(entry.entityType)) {
    if (entry.action === 'delete' || record.deleted === true) return ksh(record.amount);
    if (!before) return ksh(after?.amount);
    if (changed(before, after, 'amount')) return `${ksh(before?.amount)} → ${ksh(after?.amount)}`;
    const rest = moved.filter((f) => !['amount', 'deleted'].includes(f));
    return rest.length > 0 ? describeFields(rest) : ksh(after?.amount);
  }

  if (entry.entityType === 'Member') {
    const name = record.name || '';
    const rest = moved.filter((f) => f !== 'name');
    return rest.length > 0 ? `${name} · ${describeFields(rest)}` : name;
  }

  if (entry.entityType === 'User') return record.name || record.email || '';
  if (entry.entityType === 'Settings' || entry.entityType === 'System') return describeFields(moved);
  return record.name || record.title || '';
}

module.exports = {
  CATEGORIES,
  CATEGORY_BY_ENTITY,
  WATCHED_FIELDS,
  readAuditEntry,
};
