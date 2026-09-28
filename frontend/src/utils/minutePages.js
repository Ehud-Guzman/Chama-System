// How long a minute is, in the words every screen uses for it.
//
// The figure comes from the server: the minute's own page count on A4 at 12pt with one-inch margins
// (backend/src/utils/minutePages), worked out when the minute was saved. The office bills by it and
// a member on a phone reads it before spending his bundle opening a forty-page minute, so it is
// worth one place rather than three — the office's list, the office's open minute and the members'
// own page all say the same thing because they all ask this.
//
// The extension is explicit because Node's resolver needs one and Vite does not — the same rule
// services/api.js follows so its module can be imported by `node --test`.

// "3 pages", or null when there is no count to show. Null is a real answer rather than zero: a
// minute saved before the count existed has never been laid out, and scripts/countMinutePages.js
// fills those in. Printing "0 pages" for it would be a wrong answer said confidently.
export function pageCountLabel(pages) {
  const count = Number(pages);
  if (!Number.isFinite(count) || count <= 0) return null;
  return `${count} page${count === 1 ? '' : 's'}`;
}

// The rule the number was counted under, for the `title` of whatever prints it. A figure somebody
// is billing by has to be checkable, and this is the sentence that makes it so: whoever asks "why
// four pages and not three?" can be answered with what a page means here.
export const PAGE_COUNT_RULE = 'A4 at 12pt, one-inch margins, counted from the minute as a document';

export function pageCountTitle(pages) {
  const label = pageCountLabel(pages);
  if (!label) return null;
  return `${label} — ${PAGE_COUNT_RULE}`;
}
