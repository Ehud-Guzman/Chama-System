// Labels for document categories.
//
// The list itself now lives on the server (an admin maintains it on the documents
// screen — see backend/src/models/DocumentCategory.js), so these six are only the
// fallback: what to show before the list arrives, and what to fall back on for a
// document filed under a category that has since been removed.
export const DOCUMENT_CATEGORIES = [
  { value: 'title_deed', label: 'Title deed' },
  { value: 'certificate', label: 'Certificate' },
  { value: 'registration', label: 'Registration' },
  { value: 'constitution', label: 'Constitution' },
  { value: 'financial', label: 'Financial record' },
  { value: 'other', label: 'Other' },
];

// `categories` is the live list from the API when the caller has it; `stored`
// is the label snapshot a document carries from the day it was filed, which wins
// over everything — a filing that happened cannot be re-labelled afterwards.
export function documentCategoryLabel(value, categories, stored) {
  if (stored) return stored;
  const fromApi = (categories || []).find((c) => c.value === value);
  if (fromApi?.label) return fromApi.label;
  return DOCUMENT_CATEGORIES.find((c) => c.value === value)?.label || 'Other';
}
