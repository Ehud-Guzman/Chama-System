import { money } from '../../utils/format';

// One fund, as the picker writes it: what it is called, what it holds, and — for a fund
// that has been spent past what it held — that it is overdrawn rather than showing a
// negative "holds". A loan fund is named as one, because money paid out of it is owed
// back rather than spent.
export function fundLabel(fund) {
  const balance = Number(fund.balance) || 0;
  const held = balance < 0 ? `overdrawn by ${money(-balance)}` : `holds ${money(balance)}`;
  return `${fund.name} — ${held}${fund.isRecoverable ? ' (loan fund)' : ''}`;
}

export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// 'YYYY-MM' as the group writes a month. A fixed list rather than a locale call, so
// the label is the same on every device.
export function monthLabel(key) {
  const [year, month] = String(key).split('-');
  return `${MONTH_SHORT[Number(month) - 1] || month} ${year}`;
}
