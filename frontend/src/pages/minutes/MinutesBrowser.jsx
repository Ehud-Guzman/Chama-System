import Loader from '../../components/shared/Loader';
import MinuteListRow from '../../components/minutes/MinuteListRow';
import { openingOf } from './shared';

export default function MinutesBrowser({ browsePanelHidden, everyMonthOpen, exportWord, exporting, groups, isMonthOpen, loading, minutes, search, select, selectedId, setDeleting, setSearch, startNew, term, toggleEveryMonth, toggleMonth, total }) {
  return (
    <section
      className={`min-w-0 overflow-hidden rounded-xl border border-rule bg-surface ${
        browsePanelHidden ? 'hidden lg:block' : ''
      }`}
    >
      <div className="border-b border-rule p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Documents</h2>
          {/* How many minutes this panel is holding. It says "of the total" whenever
              the office holds more than the screen loaded, because a pill reading
              "100 minutes" beside a record of 140 would be a quiet lie. */}
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-primary">
            {total > minutes.length
              ? `${minutes.length} of ${total}`
              : minutes.length === 1
                ? '1 minute'
                : `${minutes.length} minutes`}
          </span>
        </div>
        <input
          type="text"
          placeholder="Search minutes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-11 w-full rounded-lg border border-rule bg-canvas px-3 text-sm"
          aria-label="Search minutes"
        />
        {/* The box searches the whole of every minute — the body as well as the
            title — and a date typed as one (21/05/2026) finds that meeting. The
            answer is longer than a title, so it opens in the wide panel beside
            this list rather than being squeezed into it. */}
        <p className="mt-2 text-xs leading-5 text-muted">
          {term
            ? 'Searching every minute — the answer appears on the right.'
            : 'Any word from any meeting, in the minutes themselves.'}
        </p>
        {term && (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="mt-1 min-h-11 text-xs font-semibold text-primary"
          >
            Clear the search
          </button>
        )}
        <button
          type="button"
          onClick={startNew}
          className="mt-3 min-h-11 w-full rounded-lg bg-primary text-sm font-semibold text-white"
        >
          New minute
        </button>
      </div>
      {/* While a search is running on a phone the browse list stands down: the
          answer sits directly below this panel, and scrolling past every month to
          reach it would hide the thing that was just asked for. On a wide screen
          both are on show — the months here, the answer in the panel on the right. */}
      <div className={term ? 'hidden lg:block' : ''}>
        {loading ? (
          <div className="p-4">
            <Loader />
          </div>
        ) : groups.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No minutes yet.</p>
        ) : (
          <div>
            <div className="flex items-center justify-between gap-2 border-b border-rule bg-canvas px-4 py-1">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                By month
              </p>
              {/* A year of minutes is a lot of months to open one at a time, so the
                  whole list can be unfolded at once — and folded back again. */}
              {groups.length > 1 && (
                <button
                  type="button"
                  onClick={toggleEveryMonth}
                  className="min-h-11 text-xs font-semibold text-primary"
                >
                  {everyMonthOpen ? 'Close all months' : 'Open all months'}
                </button>
              )}
            </div>

            {groups.map((group) => (
              <div key={group.key}>
                <button
                  type="button"
                  onClick={() => toggleMonth(group.key)}
                  aria-expanded={isMonthOpen(group.key)}
                  className="flex min-h-12 w-full items-center justify-between gap-2 border-b border-rule px-4 text-left transition-colors hover:bg-canvas"
                >
                  <span className="min-w-0 truncate text-sm font-semibold">{group.label}</span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                    {group.minutes.length}
                    <svg
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      className={`h-4 w-4 transition-transform ${
                        isMonthOpen(group.key) ? 'rotate-180' : ''
                      }`}
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </span>
                </button>

                {isMonthOpen(group.key) &&
                  group.minutes.map((m) => (
                    <MinuteListRow
                      key={m._id}
                      minute={m}
                      active={selectedId === m._id}
                      preview={openingOf(m)}
                      exporting={exporting}
                      onSelect={select}
                      onExport={exportWord}
                      onDelete={setDeleting}
                    />
                  ))}
              </div>
            ))}
          </div>
        )}

        {/* The screen holds the newest hundred; the office may hold more than
            that, and saying so is the difference between a list and a claim about
            the record. */}
        {total > minutes.length && (
          <p className="border-t border-rule bg-canvas px-4 py-3 text-[11px] leading-5 text-muted">
            The newest {minutes.length} of {total} minutes are listed. The search box reaches
            the older ones — a word from the meeting, or its year (2025).
          </p>
        )}
      </div>
    </section>
  );
}
