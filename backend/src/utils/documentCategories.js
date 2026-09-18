const DocumentCategory = require('../models/DocumentCategory');

// The categories the group started with. `value` is what the documents already
// in the vault store, so the six originals keep their exact slugs.
const DEFAULT_DOCUMENT_CATEGORIES = [
  { value: 'title_deed', label: 'Title deed' },
  { value: 'certificate', label: 'Certificate' },
  { value: 'registration', label: 'Registration' },
  { value: 'constitution', label: 'Constitution' },
  { value: 'financial', label: 'Financial record' },
  { value: 'other', label: 'Other' },
];

// The category every document falls back to, and the one that can never be
// removed — an upload with no category still has to be filed.
const FALLBACK_CATEGORY = 'other';

// Turns "Water project agreement" into "water_project_agreement" — letters from
// ASCII only, so a stray accent or emoji can't become an unreadable slug.
function slugifyCategory(label) {
  return String(label || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

// Idempotent, exactly like seedLedgerTypes: safe on every boot and on the first
// request that needs the list. $setOnInsert only, so a category the admin renamed
// or removed by hand is never resurrected.
let seededOnce = false;
async function ensureDocumentCategories() {
  if (seededOnce) return;
  await Promise.all(
    DEFAULT_DOCUMENT_CATEGORIES.map((category) =>
      DocumentCategory.updateOne(
        { value: category.value },
        { $setOnInsert: { ...category, seeded: true } },
        { upsert: true }
      )
    )
  );
  seededOnce = true;
}

// Every category a document may be filed under, fallback last so it reads as the
// one you pick when nothing else fits.
async function listDocumentCategories() {
  await ensureDocumentCategories();
  const rows = await DocumentCategory.find({ deleted: false }).sort({ label: 1 }).lean();
  return rows
    .map((row) => ({
      id: String(row._id),
      value: row.value,
      label: row.label,
      seeded: Boolean(row.seeded),
      builtIn: row.value === FALLBACK_CATEGORY,
      createdAt: row.createdAt,
    }))
    .sort((a, b) => {
      if (a.builtIn !== b.builtIn) return a.builtIn ? 1 : -1;
      return a.label.localeCompare(b.label);
    });
}

// True when `value` is a category a document may actually use. Uploads are
// checked against this rather than trusting whatever the browser posted.
async function categoryExists(value) {
  const slug = String(value || '').trim().toLowerCase();
  if (!slug) return false;
  await ensureDocumentCategories();
  const found = await DocumentCategory.findOne({ value: slug, deleted: false }).lean();
  return Boolean(found);
}

module.exports = {
  DEFAULT_DOCUMENT_CATEGORIES,
  FALLBACK_CATEGORY,
  slugifyCategory,
  ensureDocumentCategories,
  listDocumentCategories,
  categoryExists,
};
