import HighlightedText from '../shared/HighlightedText';

// One line in a minutes list.
//
// Used twice on the office's screen and it has to mean the same thing in both places:
// the month groups on the left, and the search results on the right. The two differ
// only in what the small line under the title says — the minute's opening words while
// browsing, the sentence the searched word was found in as a result — and in whether
// the searched word is marked, so they are one component rather than two copies that
// quietly drift apart.
//
// The row is not a button: it used to contain two more buttons (download, delete),
// which is invalid HTML and reads to a screen reader as buttons inside a button. The
// title is the control; the two actions sit beside it as siblings, each a real 44px
// target so a delete is never a mis-tap away from a download.
export default function MinuteListRow({
  minute,
  active = false,
  term = '',
  preview = '',
  note = '',
  exporting = false,
  onSelect,
  onExport,
  onDelete,
}) {
  // A minute whose date cannot be read says so rather than printing "Invalid Date" —
  // the undated group in the list is where such a minute lands, and this is the row
  // that explains it.
  const at = new Date(minute.date);
  const dateLabel = minute.date && !Number.isNaN(at.getTime())
    ? at.toLocaleDateString('en-KE', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'No date';

  return (
    <div
      className={`flex items-start gap-2 border-b border-rule p-3 last:border-b-0 ${
        active ? 'bg-primary/10' : ''
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect(minute)}
        aria-pressed={active}
        className="min-w-0 flex-1 rounded-lg p-1 text-left transition-colors active:bg-elevation"
      >
        <HighlightedText
          text={minute.title}
          term={term}
          className="line-clamp-2 block text-sm font-semibold text-ink"
        />
        <span className="mb-1 mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
          {dateLabel}
          {minute.visibleToMembers === false && (
            <span className="rounded bg-alert/10 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-widest text-alert">
              Not for members
            </span>
          )}
        </span>
        {preview && (
          <HighlightedText
            text={preview}
            term={term}
            className="line-clamp-2 block text-xs text-muted"
          />
        )}
        {note && <span className="mt-0.5 block text-xs italic text-muted">{note}</span>}
      </button>

      <div className="flex shrink-0 gap-1">
        <button
          type="button"
          onClick={() => onExport(minute)}
          disabled={exporting}
          aria-label={`Download ${minute.title} as a Word document`}
          title="Download as Word"
          className="flex h-11 w-11 items-center justify-center rounded-lg text-base text-muted transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-40"
        >
          ↓
        </button>
        <button
          type="button"
          onClick={() => onDelete(minute)}
          aria-label={`Delete ${minute.title}`}
          title="Delete"
          className="flex h-11 w-11 items-center justify-center rounded-lg text-muted transition-colors hover:bg-alert/10 hover:text-alert"
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="mx-auto h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          >
            <path d="M3 6h18" />
            <path d="M8 6V4h8v2" />
            <path d="M19 6l-1 14H6L5 6" />
            <path d="M10 11v5" />
            <path d="M14 11v5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
