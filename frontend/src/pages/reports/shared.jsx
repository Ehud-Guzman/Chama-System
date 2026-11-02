import { money } from '../../utils/format';

// Month keys arrive as 'YYYY-MM' (the group's own calendar month). A fixed list
// rather than a locale call: the same label on every device, in any language.
export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthLabel(key) {
  const [year, month] = String(key).split("-");
  return `${MONTH_SHORT[Number(month) - 1]} ${year.slice(2)}`;
}

// One month's funds, biggest first. Rendered twice on purpose: beside the
// month's own figures on a wide screen — where the row's middle was empty space
// doing nothing — and behind a tap on a phone, where a line per fund for every
// month would bury the month list it belongs to.
export function MonthFunds({ byType }) {
  return (
    <ul className="space-y-0.5">
      {byType.map((t) => (
        <li
          key={t.name}
          className="flex items-baseline justify-between gap-3 text-xs text-muted"
        >
          <span className="min-w-0 truncate">{t.name}</span>
          <span className="amount shrink-0">{money(t.total)}</span>
        </li>
      ))}
    </ul>
  );
}
