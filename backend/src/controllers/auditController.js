const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const { CATEGORIES, readAuditEntry } = require('../utils/auditFlags');
const { buildFilters, ACTIONS } = require('../utils/auditFilters');
const { aboutSheet } = require('../utils/aboutSheet');
const { getOrCreateSettings } = require('../utils/settings');
const { sendWorkbook } = require('../utils/xlsxExport');
const { EAT_OFFSET_MS } = require('../utils/weekCycle');
// The trail, in the shape somebody audits it in: filtered, newest first, with the
// entries worth a second look already marked.
//
// Two things make it readable rather than merely complete. It is cut by category —
// money, people, records, settings — because "who touched the money" and "who
// changed a document" are different questions with different readers; and every
// entry is read by utils/auditFlags, which names what moved (an amount, a phone
// number, a role) so the odd ones stand out of four hundred lines of ordinary
// typing.
//
// What the screen receives is what it prints: action, entity, who, when, the derived
// flags and a one-line summary. The stored before/after snapshots — whole member
// records, national IDs, family, next of kin — are read here to work out the flags
// and are never sent, which is the same rule the reports screen held to.
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
// How many entries one classification pass reads. Everything this endpoint says
// about "how much of this is unusual" is counted over this window, and it says so:
// a bounded answer that admits its bound beats a total that quietly walks a
// collection that only ever grows.
const SCAN = 2000;
const EXPORT_MAX = 5000;

// One page's worth of stored entries. before/after are loaded because the flags are
// read from them, and dropped again by present().
function entryQuery(match, limit, skip = 0) {
  return AuditLog.find(match)
    .select('action entityType entityId performedBy createdAt before after')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('performedBy', 'name')
    .lean();
}

// A stored entry as the screen sees it.
function present(entry) {
  const read = readAuditEntry(entry);
  return {
    _id: entry._id,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    performedBy: entry.performedBy
      ? { _id: entry.performedBy._id, name: entry.performedBy.name }
      : null,
    createdAt: entry.createdAt,
    category: read.category,
    flags: read.flags,
    severity: read.severity,
    summary: read.summary,
  };
}

// What the window holds, so the top of the screen can answer "is anything going on?"
// before anybody reads a single line.
function countRead(entries) {
  return entries.reduce(
    (counts, e) => {
      if (e.flags.length > 0) counts.unusual += 1;
      if (e.severity === 'high') counts.serious += 1;
      if (e.category === 'money' && e.action === 'update') counts.moneyChanged += 1;
      if (e.action === 'delete') counts.removed += 1;
      if (e.entityType === 'User') counts.access += 1;
      return counts;
    },
    { scanned: entries.length, unusual: 0, serious: 0, moneyChanged: 0, removed: 0, access: 0 }
  );
}

// EAT, like every other time this system shows. A trail rendered in UTC would put a
// 9pm collection entry on the following day.
function eatStamp(value) {
  const at = new Date(new Date(value).getTime() + EAT_OFFSET_MS);
  const iso = at.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

// GET /api/audit — the trail, filtered and paged
//
//   ?category=money|people|records|settings   ?action=create|update|delete|reset
//   ?entity=Contribution                      ?by=<userId>
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD            ?q=<name or entity>
//   ?unusual=1                                ?page=&limit=
async function list(req, res, next) {
  try {
    const { match, unusual } = buildFilters(req.query);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_LIMIT));
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);

    const [scanned, total] = await Promise.all([
      entryQuery(match, SCAN),
      AuditLog.countDocuments(match),
    ]);
    const read = scanned.map(present);
    const flagged = unusual ? read.filter((e) => e.flags.length > 0) : [];

    const start = (page - 1) * limit;
    let entries;
    let pages;
    if (unusual) {
      // Reading is what decides this filter, so it pages over what the window found
      // rather than over the collection — and the response says the window was used.
      entries = flagged.slice(start, start + limit);
      pages = Math.max(1, Math.ceil(flagged.length / limit));
    } else {
      // Inside the window the page is cut from what has already been read; past it
      // the page comes straight from the database, so page 40 is still page 40.
      entries =
        start + limit <= read.length
          ? read.slice(start, start + limit)
          : (await entryQuery(match, limit, start)).map(present);
      pages = Math.max(1, Math.ceil(total / limit));
    }

    // The filter dropdowns: which entities have ever been touched, and which
    // accounts have ever done anything. Names only — who signed an entry is part of
    // the record, their email address is not this screen's business.
    const [entities, users] = await Promise.all([
      AuditLog.distinct('entityType'),
      User.find().select('name').sort({ name: 1 }).lean(),
    ]);

    res.json({
      entries,
      page,
      pages,
      limit,
      total: unusual ? flagged.length : total,
      // True when the counts and the unusual filter only saw the newest SCAN
      // entries. The screen says so rather than implying it read everything.
      limited: scanned.length >= SCAN,
      counts: countRead(read),
      categories: CATEGORIES,
      options: {
        actions: ACTIONS,
        entities: entities.sort(),
        users: users.map((u) => ({ id: u._id, name: u.name })),
      },
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/audit/export — the same trail (same filters) as an .xlsx workbook, with
// the flagged entries on their own sheet so the odd ones can be read first.
async function exportList(req, res, next) {
  try {
    const { match, unusual } = buildFilters(req.query);
    const read = (await entryQuery(match, EXPORT_MAX)).map(present);
    const shown = unusual ? read.filter((e) => e.flags.length > 0) : read;
    const counts = countRead(read);

    const rows = shown.map((e) => ({
      When: eatStamp(e.createdAt),
      Who: e.performedBy?.name || 'Unknown',
      Action: e.action,
      Category: e.category,
      Entity: e.entityType,
      'What changed': e.summary,
      Flags: e.flags.map((f) => f.label).join(', '),
      Severity: e.severity || '',
    }));

    sendWorkbook(res, 'audit-trail.xlsx', [
      aboutSheet({
        name: 'Audit trail',
        settings: await getOrCreateSettings(),
        req,
        counts: [
          ['Entries exported', rows.length],
          ['Entries read', counts.scanned],
          ['Unusual in those', counts.unusual],
          ['Serious in those', counts.serious],
        ],
        notes:
          'Every create, edit, delete and group-wide operation this ledger has recorded, newest ' +
          'first, with the filters the screen had applied. "Flags" names what moved in an entry — an ' +
          'amount cut, a row moved to another member, a phone number changed, a role changed, a ' +
          'group-wide operation — and the "Unusual" sheet repeats just those. The stored snapshots ' +
          'the flags are read from stay in the database, not in this workbook.',
      }),
      { name: 'Audit trail', rows },
      { name: 'Unusual', rows: rows.filter((r) => r.Flags) },
    ]);
  } catch (err) {
    next(err);
  }
}

module.exports = { list, exportList };

