// What changed between the two halves of an audit entry, as a list a person can read.
//
// An audit entry stores the record as it was and as it became, whole. For a member that is forty
// fields of which two moved, so the raw view is for evidence and this is for reading: one line per
// field that differs, "phone: 0712… → 0733…". Nested values (a next-of-kin list, a family block)
// are compared as a whole and shown as JSON, because explaining which child's name changed would
// be a second feature.
//
// Pure, so it can be tested without a browser.

// Fields that change on every save and say nothing about the edit.
const NOISE = new Set(['updatedAt', '__v']);

function sameValue(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function changedFields(before, after) {
  const was = before && typeof before === 'object' ? before : null;
  const now = after && typeof after === 'object' ? after : null;
  if (!was && !now) return [];

  const keys = new Set([...Object.keys(was || {}), ...Object.keys(now || {})]);
  const rows = [];
  for (const key of keys) {
    if (NOISE.has(key)) continue;
    const from = was ? was[key] : undefined;
    const to = now ? now[key] : undefined;
    if (!sameValue(from, to)) rows.push({ field: key, from, to });
  }
  return rows.sort((a, b) => a.field.localeCompare(b.field));
}

// A value as one short line.
export function showValue(value) {
  if (value === undefined) return '—';
  if (value === null) return 'empty';
  if (typeof value === 'string') return value === '' ? 'empty' : value;
  if (typeof value === 'object') {
    const text = JSON.stringify(value);
    return text.length > 140 ? `${text.slice(0, 137)}…` : text;
  }
  return String(value);
}
