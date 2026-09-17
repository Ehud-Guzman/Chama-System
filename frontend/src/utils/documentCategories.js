// Labels for the categories the backend accepts
// (see backend/src/models/ChamaDocument.js — keep the two lists in step).
export const DOCUMENT_CATEGORIES = [
  { value: 'title_deed', label: 'Title deed' },
  { value: 'certificate', label: 'Certificate' },
  { value: 'registration', label: 'Registration' },
  { value: 'constitution', label: 'Constitution' },
  { value: 'financial', label: 'Financial record' },
  { value: 'other', label: 'Other' },
];

export function documentCategoryLabel(value) {
  return DOCUMENT_CATEGORIES.find((c) => c.value === value)?.label || 'Other';
}