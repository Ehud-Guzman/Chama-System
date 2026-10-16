// "3 minutes ago", "yesterday", "12 days ago" — for the Control Room's "last seen" and "last run".
//
// Takes `now` so it can be tested without a clock. Coarse on purpose: the point is to tell "here a
// moment ago" from "gone for a month", and a relative time to the second would only be read as
// precision it does not have. An exact time is shown beside it wherever that matters.
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function timeAgo(value, now = Date.now()) {
  if (!value) return 'never';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return 'never';
  const gap = now - then;
  if (gap < 0) return 'just now';
  if (gap < MINUTE) return 'just now';
  if (gap < HOUR) {
    const n = Math.floor(gap / MINUTE);
    return `${n} minute${n === 1 ? '' : 's'} ago`;
  }
  if (gap < DAY) {
    const n = Math.floor(gap / HOUR);
    return `${n} hour${n === 1 ? '' : 's'} ago`;
  }
  const days = Math.floor(gap / DAY);
  if (days === 1) return 'yesterday';
  if (days < 60) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return `${months} months ago`;
}

// "up 3 days 4 hours" for the server's uptime.
export function uptimeText(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days} day${days === 1 ? '' : 's'} ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}
