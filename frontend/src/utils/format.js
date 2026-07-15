const numberFmt = new Intl.NumberFormat('en-KE');

export function money(amount) {
  return `Ksh ${numberFmt.format(Number(amount) || 0)}`;
}

export function shortDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-KE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// Date + time, for real timestamps (e.g. AuditLog.createdAt) rather than the
// date-only values a member/contribution/expense date picker produces —
// those are always stored at midnight, so a time component would be noise.
export function shortDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-KE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// True when two values fall on the same calendar day (local time) —
// used to decide whether a "logged at" timestamp is worth showing
// alongside a date-only field, rather than always displaying it.
export function isSameCalendarDay(a, b) {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

export function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const METHOD_LABELS = {
  cash: 'Cash',
  bank: 'Bank',
  mobile: 'Mobile',
  other: 'Other',
};
