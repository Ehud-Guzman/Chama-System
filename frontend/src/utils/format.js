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

// Local calendar date of any value, as the `yyyy-mm-dd` a date input needs.
// todayISO() only ever describes "now"; this is for dates that come back from
// the API (week boundaries), which are instants and would land on the previous
// day if they were formatted in UTC.
export function isoDateOf(value) {
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO() {
  return isoDateOf(new Date());
}

// File sizes for the document vault — one decimal place above a kilobyte.
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export const METHOD_LABELS = {
  cash: 'Cash',
  bank: 'Bank',
  mobile: 'Mobile',
  other: 'Other',
};
