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
