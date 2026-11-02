import { todayISO } from '../../utils/format';
import Loader from '../../components/shared/Loader';
import MinuteListRow from '../../components/minutes/MinuteListRow';
import RichTextEditor from '../../components/minutes/RichTextEditor';
import { openingOf } from './shared';

export default function MinutesPanel({ backToList, backToResults, busy, exportWord, exporting, form, importFromDocx, importing, isDirty, minutes, openMinute, pageCountOf, pageLabelOf, panelRef, results, save, searchError, searchTruncated, select, selectedId, setDeleting, setForm, term, waiting, warmImport }) {
  return (
    <section ref={panelRef} className="min-w-0 scroll-mt-20">
      {selectedId === null && term ? (
        // The answer to a search, in the room an answer needs. Every word of every
        // minute was searched — the body as well as the title — so a result has to
        // say why it is one: the sentence the word was found in, with the word
        // marked. That does not fit down the side of a list.
        <div className="overflow-hidden rounded-xl border border-rule bg-surface">
          <div className="border-b border-rule p-4">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <h2 className="min-w-0 text-sm font-semibold">
                {waiting ? 'Searching…' : <>Results for “{term}”</>}
              </h2>
              {/* How many meetings the word was found in, which is the whole answer
                  to a search — counted here rather than left to be added up from the
                  rows below. */}
              {!waiting && (
                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-primary">
                  {results.length === 1 ? '1 found' : `${results.length} found`}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs leading-5 text-muted">
              The title, the date, and every word of the minute itself — not only what the
              list beside this one happens to hold.
            </p>
            {/* A failure, and an answer that was cut short, are said on the answer
                itself rather than beside the box that asked the question. */}
            {searchError && (
              <p
                className="mt-2 rounded-lg bg-alert/5 px-3 py-2 text-xs font-medium text-alert"
                role="alert"
              >
                {searchError}
              </p>
            )}
            {searchTruncated && (
              <p className="mt-2 rounded-lg bg-canvas px-3 py-2 text-xs leading-5 text-muted">
                There are more matches than can be shown at once, so these are the newest, up
                to a hundred. Add another word to narrow it down.
              </p>
            )}
          </div>

          {waiting ? (
            <div className="p-6">
              <Loader />
            </div>
          ) : results.length === 0 && !searchError ? (
            <p className="px-4 py-10 text-center text-sm text-muted">
              No minute contains “{term}”.
            </p>
          ) : results.length === 0 ? null : (
            <div>
              {results.map((m) => {
                // The sentence the word was found in (the server sends it) is a
                // better thing to open a result with than the minute's first line.
                const snippet = m.match?.snippet || '';
                return (
                  <MinuteListRow
                    key={m._id}
                    minute={m}
                    term={term}
                    active={selectedId === m._id}
                    preview={snippet || openingOf(m)}
                    // A result with nothing marked in the title and no sentence to
                    // show is a date match: saying so beats an empty result the
                    // reader cannot account for.
                    note={
                      !snippet && m.match?.field === 'date'
                        ? 'This meeting is on the date you searched.'
                        : ''
                    }
                    exporting={exporting}
                    onSelect={select}
                    onExport={exportWord}
                    onDelete={setDeleting}
                  />
                );
              })}
            </div>
          )}
        </div>
      ) : selectedId === null ? (
        <p className="rounded-xl border border-dashed border-rule px-5 py-10 text-center text-sm text-muted">
          Select a minute, or start a new one.
        </p>
      ) : (
        <div className="rounded-xl border border-rule bg-surface">
          <div className="border-b border-rule p-4">
            {term ? (
              // The search is still there behind this minute — the term stays in the
              // box — so the other results are one tap away, and a minute opened
              // from the results can be read without losing the search.
              <button
                type="button"
                onClick={backToResults}
                className="mb-1 inline-flex min-h-11 items-center text-xs font-semibold text-primary"
              >
                ← Back to the search results
              </button>
            ) : (
              // Not a search: the minute was opened from the record, and on a phone it
              // took the screen. The list is not beside it to be tapped, so the way
              // back has to be on the panel itself.
              <button
                type="button"
                onClick={backToList}
                className="mb-1 inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-primary lg:hidden"
              >
                ← All minutes
              </button>
            )}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted">
                  {selectedId === 'new' ? 'New minute' : 'Minute details'}
                </p>
                <h2 className="mt-1 truncate text-lg font-bold">
                  {form.title.trim() || 'Untitled minute'}
                </h2>
                {/* How many pages this minute is on A4 at 12pt — the group's own rule, and
                    the figure the office bills by. Counted from the document when it was
                    saved (utils/minutePages), so it is a page count rather than a guess at
                    one, and it is what a printed copy will run to. It disappears while the
                    minute has unsaved edits, because the count is of what is stored: an
                    edited minute's real figure is the one it gets when it is saved. */}
                {openMinute && !isDirty && pageLabelOf(openMinute) && (
                  <p
                    className="amount mt-1 text-xs text-muted"
                    title={pageCountOf(openMinute)}
                  >
                    {pageLabelOf(openMinute)}
                  </p>
                )}
                {isDirty && <p className="mt-1 text-xs font-medium text-alert">Unsaved changes</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedId && (
                  <button
                    type="button"
                    onClick={() => exportWord(form)}
                    disabled={exporting}
                    aria-label="Download this minute as a Word document"
                    className="min-h-11 rounded-lg border border-rule px-3 text-sm font-semibold transition-colors hover:bg-canvas disabled:opacity-60"
                    title="Download as Word document"
                  >
                    {exporting ? 'Preparing…' : '↓ Export'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={importFromDocx}
                  // Reaching for the button is notice enough to start fetching the
                  // parser, so the pick itself is usually instant.
                  onPointerEnter={warmImport}
                  onFocus={warmImport}
                  disabled={importing}
                  className="min-h-11 rounded-lg border border-rule px-3 text-sm font-semibold disabled:opacity-40"
                >
                  {importing ? 'Importing…' : 'Import Word'}
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem]">
              <div>
                <label htmlFor="minute-title" className="mb-1 block text-xs font-medium">
                  Title
                </label>
                <input
                  id="minute-title"
                  type="text"
                  required
                  placeholder="Title, e.g. Weekly meeting - 21 May 2026"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="h-11 w-full rounded-lg border border-rule bg-canvas px-3 text-sm font-semibold"
                  aria-label="Minute title"
                />
              </div>
              <div>
                <label htmlFor="minute-date" className="mb-1 block text-xs font-medium">
                  Date
                </label>
                <input
                  id="minute-date"
                  type="date"
                  max={todayISO()}
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  className="h-11 w-full rounded-lg border border-rule bg-canvas px-3 text-sm"
                />
              </div>
            </div>

            {/* Minutes go to members' phones by default (that is the point of
                collecting them), but one naming a member's disciplinary issue
                can be held back — the members' page then never shows it. */}
            <label className="mt-3 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.visibleToMembers}
                onChange={(e) => setForm({ ...form, visibleToMembers: e.target.checked })}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                Visible to members
                <span className="block text-xs text-muted">
                  Shown on the public page to anyone who enters a registered ID number.
                </span>
              </span>
            </label>
          </div>

          <div className="p-4">
          <RichTextEditor
            key={selectedId}
            value={form.content}
            onChange={(html) => setForm({ ...form, content: html })}
            placeholder="Attendees, agenda, decisions, action items…"
          />
          </div>

          {/* Save is the one control needed while writing, and on a phone the editor is
              tall enough that a plain row at its foot sits below the fold the whole time
              somebody is typing — so the office had to scroll to the bottom of a minute
              to keep what it had just written. It rides above the tab bar there instead
              (the bar is 64px, plus the home-indicator inset), and is ordinary markup
              from md up, where the panel is wide and the button is always in sight. */}
          <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 flex flex-wrap gap-3 border-t border-rule bg-surface p-4 md:static md:z-auto">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="min-h-12 flex-1 rounded-lg bg-primary text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            {selectedId !== 'new' && (
              <button
                type="button"
                onClick={() => setDeleting(minutes.find((m) => m._id === selectedId))}
                className="min-h-12 rounded-lg border border-rule px-4 text-sm font-medium text-alert"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
