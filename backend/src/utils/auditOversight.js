// The super admin's read on the people who hold authority, not on the records.
//
// The trail answers "what changed". Oversight answers the questions a super admin is
// actually accountable for: which of my officers is cutting, deleting or moving money more
// than the rest, and whose accounts are weaker than they should be. Both are derived — from
// the trail and from the user list — so there is nothing new to store and nothing here that
// can drift from what the trail says.
//
// Pure functions over what was read: no database and no clock of their own.
const { readAuditEntry } = require('./auditFlags');
const { alertableFlags } = require('./superAdminAlerts');
const { PRIVILEGED_ROLES } = require('./auditVisibility');

// Per person, over the entries given: how much they did and how much of it is the kind of
// thing worth asking about. `entries` carry `performedBy` populated with { _id, name, role }.
//
// Counts, not verdicts. Ten deletes can be a clean-up and one cut can be fraud; the table is
// there to show who to ask, and the trail underneath is where the answer is.
function summariseActors(entries) {
  const byActor = new Map();

  for (const entry of entries) {
    const actor = entry.performedBy;
    if (!actor || !actor._id) continue;
    const key = String(actor._id);
    if (!byActor.has(key)) {
      byActor.set(key, {
        id: key,
        name: actor.name || 'Unknown',
        role: actor.role || null,
        entries: 0,
        serious: 0,
        deletes: 0,
        amountCuts: 0,
        moneyRemoved: 0,
        movedMoney: 0,
        lastAt: null,
      });
    }
    const row = byActor.get(key);
    const read = readAuditEntry(entry);

    row.entries += 1;
    if (read.severity === 'high') row.serious += 1;
    if (entry.action === 'delete') row.deletes += 1;
    for (const flag of read.flags) {
      if (flag.key === 'amount-cut') row.amountCuts += 1;
      if (flag.key === 'money-removed') row.moneyRemoved += 1;
      if (flag.key === 'moved-member' || flag.key === 'moved-fund') row.movedMoney += 1;
    }
    if (!row.lastAt || new Date(entry.createdAt) > new Date(row.lastAt)) row.lastAt = entry.createdAt;
  }

  // The most worth asking about first: serious entries, then money taken off the books.
  return [...byActor.values()].sort(
    (a, b) =>
      b.serious - a.serious ||
      b.moneyRemoved + b.amountCuts - (a.moneyRemoved + a.amountCuts) ||
      b.entries - a.entries
  );
}

// The accounts that carry authority, and what protects each. A privileged account with no
// second factor when the group has switched it on is the weak point worth naming; so is an
// officer whose password has never been changed from the one they were handed.
function accountPosture(users, { twoFactorGroupOn = false } = {}) {
  return users
    .filter((u) => PRIVILEGED_ROLES.includes(u.role))
    .map((u) => {
      const notes = [];
      const hasSecondFactor = Boolean(u.twoFactor && u.twoFactor.enabled);
      if (!u.active) notes.push('deactivated');
      if (u.active && twoFactorGroupOn && !hasSecondFactor) notes.push('no second factor');
      if (u.active && !u.passwordChangedAt) notes.push('password never changed');
      return {
        id: String(u._id),
        name: u.name,
        role: u.role,
        active: u.active,
        secondFactor: hasSecondFactor,
        passwordChangedAt: u.passwordChangedAt || null,
        notes,
      };
    })
    .sort((a, b) => b.notes.length - a.notes.length || a.name.localeCompare(b.name));
}

// Failed sign-ins, grouped by what was typed and by where it came from. `events` are
// SecurityEvent rows. A privileged account being guessed at is ranked above a made-up address,
// because the first is an attack on something and the second is usually a typo.
function summariseSignIns(events) {
  const accounts = new Map();
  const addresses = new Map();

  for (const e of events) {
    const email = e.email || '(blank)';
    if (!accounts.has(email)) {
      accounts.set(email, { email, count: 0, lastAt: null, reasons: new Set(), role: null, isAccount: false });
    }
    const row = accounts.get(email);
    row.count += 1;
    row.reasons.add(e.reason);
    if (e.userId) {
      row.isAccount = true;
      row.role = e.role || row.role;
    }
    if (!row.lastAt || new Date(e.createdAt) > new Date(row.lastAt)) row.lastAt = e.createdAt;

    if (e.ip) addresses.set(e.ip, (addresses.get(e.ip) || 0) + 1);
  }

  const rank = (r) => (r.isAccount && PRIVILEGED_ROLES.includes(r.role) ? 1 : 0);
  return {
    failed: events.length,
    accounts: [...accounts.values()]
      .map((r) => ({ ...r, reasons: [...r.reasons] }))
      .sort((a, b) => rank(b) - rank(a) || b.count - a.count),
    addresses: [...addresses.entries()]
      .map(([ip, count]) => ({ ip, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  };
}

// What belongs on the super admin's front page: entries by anyone else that are the shape of money or
// access moving — the same bar the alert emails use (superAdminAlerts.alertableFlags), so the banner
// and the inbox never disagree. It used to count every "high" entry, which includes the weekly
// collection and every ledger operation, and a banner that is always on is one nobody reads.
function countAttention(entries, { isSelf = () => false } = {}) {
  let serious = 0;
  for (const entry of entries) {
    const actor = entry.performedBy;
    if (actor && (actor.role === 'super_admin' || isSelf(actor))) continue;
    if (alertableFlags(entry).length > 0) serious += 1;
  }
  return serious;
}

// Failed tries at the members' gate, grouped by the ID that was aimed at (a one-way tag — the number
// itself is never stored) and by address. A real member being aimed at (`wrong_phone`: the ID was
// right, the phone was not) is listed above a number nobody holds, which is usually somebody
// mistyping. `events` are SecurityEvent rows with `memberId` populated as { name }.
function summariseGate(events) {
  const targets = new Map();
  const addresses = new Map();

  for (const e of events) {
    const key = e.target || '(not an ID)';
    if (!targets.has(key)) {
      targets.set(key, { target: key, count: 0, lastAt: null, reasons: new Set(), memberName: '' });
    }
    const row = targets.get(key);
    row.count += 1;
    row.reasons.add(e.reason);
    if (e.memberId && e.memberId.name) row.memberName = e.memberId.name;
    if (!row.lastAt || new Date(e.createdAt) > new Date(row.lastAt)) row.lastAt = e.createdAt;
    if (e.ip) addresses.set(e.ip, (addresses.get(e.ip) || 0) + 1);
  }

  const rank = (r) => (r.reasons.includes('wrong_phone') ? 1 : 0);
  return {
    failed: events.length,
    targets: [...targets.values()]
      .map((r) => ({ ...r, reasons: [...r.reasons] }))
      .sort((a, b) => rank(b) - rank(a) || b.count - a.count),
    addresses: [...addresses.entries()]
      .map(([ip, count]) => ({ ip, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  };
}

module.exports = { summariseActors, accountPosture, summariseSignIns, summariseGate, countAttention };
