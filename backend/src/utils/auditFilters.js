const { CATEGORY_BY_ENTITY } = require('./auditFlags');
const { parseEatDate, DAY_MS } = require('./weekCycle');

// Filters as a Mongo match, kept apart from the controller so the translation can be
// tested without a database — the day boundary in particular, which is the kind of
// thing that goes wrong silently: a `to` date that stops at midnight would hide the
// 9pm collection entry somebody is looking for.
//
// `unusual` is not a match condition: whether an entry is worth a second look is
// decided by reading it, not by any field it was stored with.
const ENTITIES_BY_CATEGORY = Object.entries(CATEGORY_BY_ENTITY).reduce(
  (map, [entity, category]) => {
    map[category] = map[category] || [];
    map[category].push(entity);
    return map;
  },
  {}
);

const ACTIONS = ['create', 'update', 'delete', 'reset'];

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildFilters(query = {}) {
  const match = {};

  // The category first, then the exact record type: a reader who picks both has
  // narrowed twice, and the narrower one is the one they meant.
  if (query.category && ENTITIES_BY_CATEGORY[query.category]) {
    match.entityType = { $in: ENTITIES_BY_CATEGORY[query.category] };
  }
  if (query.entity) match.entityType = query.entity;
  if (ACTIONS.includes(query.action)) match.action = query.action;
  if (/^[0-9a-f]{24}$/i.test(String(query.by || ''))) match.performedBy = query.by;

  // Days are the group's days (EAT), and `to` includes everything that happened on
  // the day named — which is why it is an exclusive bound on the next midnight.
  const from = query.from ? parseEatDate(query.from) : null;
  const to = query.to ? new Date(parseEatDate(query.to).getTime() + DAY_MS) : null;
  if (from || to) {
    match.createdAt = {};
    if (from) match.createdAt.$gte = from;
    if (to) match.createdAt.$lt = to;
  }

  const text = String(query.q || '').trim();
  if (text) {
    // Escaped: a member's name can contain brackets, and a search is a search, not
    // a pattern anybody should be able to write.
    const rx = new RegExp(escapeRegex(text), 'i');
    match.$or = [
      { 'after.name': rx },
      { 'before.name': rx },
      { 'after.title': rx },
      { 'before.title': rx },
      { entityType: rx },
    ];
  }

  return { match, unusual: query.unusual === '1' || query.unusual === 'true' };
}

module.exports = { buildFilters, ENTITIES_BY_CATEGORY, ACTIONS, escapeRegex };
