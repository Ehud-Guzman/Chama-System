import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api, { apiMessage } from '../services/api';
import { useToast } from '../components/shared/Toast';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import ErrorState from '../components/shared/ErrorState';
import Loader from '../components/shared/Loader';
import MinuteListRow from '../components/minutes/MinuteListRow';
import RichTextEditor from '../components/minutes/RichTextEditor';
import { groupMinutesByMonth } from '../utils/minuteGroups';
import { todayISO } from '../utils/format';

const BLANK = { title: '', date: todayISO(), content: '', visibleToMembers: true };

// How many minutes the list on the left loads in one go, asked for explicitly rather
// than left to the API's default of twenty: an office with two years of minutes could
// not reach the older ones at all. A hundred is the endpoint's own ceiling, and the
// list says out loud when the office holds more than it is showing — a truncated list
// must never read as the whole answer.
const BROWSE_LIMIT = 100;

// The opening words of a minute, for a row in the browse list. A search result shows
// the sentence the word was found in instead (the server sends it), because that is
// what says why the minute is a result.
function openingOf(minute) {
  if (!minute?.content) return '';
  return `${minute.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)}…`;
}

// How long the search box waits for the typing to stop before it asks the API. The
// minutes are searched on the server — every word of every meeting, not the handful
// of rows this screen happens to hold — so the pause is what turns a word typed at
// speed into one request instead of eight.
const SEARCH_PAUSE_MS = 300;

// Admin-only meeting minutes — never exposed on any public route, matching
// the group's choice to keep individual member issues (fines, disputes)
// private even though contributions themselves are fully open.
export default function Minutes() {
  const toast = useToast();
  const [minutes, setMinutes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedId, setSelectedId] = useState(null); // null | 'new' | minute._id
  const [form, setForm] = useState(BLANK);
  // What the form looked like right after load/select/save — used to detect
  // unsaved edits so switching minutes doesn't silently discard them.
  const [baseline, setBaseline] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [pendingSwitch, setPendingSwitch] = useState(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  // How many minutes the office holds, which is not the same as how many are loaded:
  // the difference is what the list has to be honest about.
  const [total, setTotal] = useState(0);
  // Which month groups are open, or null while nobody has opened one by hand — in
  // which case the newest month is the one open. Keeping the answer as a set of keys
  // rather than a flag per group means a month that arrives later (a minute saved
  // into it) needs no state of its own.
  const [openMonths, setOpenMonths] = useState(null);
  const [search, setSearch] = useState('');
  // What the API answered for the term on screen. Null means "not searching": the
  // list being browsed is the loaded one.
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const [searchError, setSearchError] = useState('');
  // Bumped when a minute is saved or deleted, so an open search asks again: a word
  // that has just been edited out of a minute must stop being a result.
  const [searchNonce, setSearchNonce] = useState(0);
  const searchTimer = useRef(null);

  const isDirty = JSON.stringify(form) !== JSON.stringify(baseline);

  const term = search.trim();
  // A search does not filter the list on the left: a minute's body is not in that
  // payload at all, and the minute somebody is looking for is usually one from months
  // back that was never loaded. The server is asked instead, and its answer is what
  // the wide panel on the right shows — the whole answer, not the first few of it.
  const results = term ? searchResults || [] : [];
  // The first search has nothing to show yet. Saying "no matches" for the half
  // second before the answer arrives would be saying something untrue.
  const waiting = Boolean(term) && searching && searchResults === null;

  // The list on the left as months, newest first.
  const groups = useMemo(() => groupMinutesByMonth(minutes), [minutes]);
  const newestMonth = groups[0]?.key ?? null;
  // Nothing has been opened by hand yet, so the newest month is open — the list is
  // never an accordion with every lid down.
  const isMonthOpen = (key) => (openMonths === null ? key === newestMonth : openMonths.has(key));
  const everyMonthOpen = groups.length > 0 && groups.every((group) => isMonthOpen(group.key));

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await api.get('/api/minutes', { params: { limit: BROWSE_LIMIT } });
      setMinutes(res.data.minutes);
      // The endpoint counts what it holds, not what it sent: the office can then be
      // told that the screen is showing part of a longer record.
      setTotal(res.data.total ?? res.data.minutes.length);
    } catch (err) {
      setLoadError(apiMessage(err, 'Could not load minutes'));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Every word of every meeting is searched by the API — title, body and date —
  // because none of that is in the list this screen loaded. The request waits for a
  // pause in the typing, and an answer that arrives after the term has moved on is
  // dropped rather than allowed to overwrite a newer one.
  useEffect(() => {
    const wanted = search.trim();
    clearTimeout(searchTimer.current);

    if (!wanted) {
      setSearchResults(null);
      setSearching(false);
      setSearchTruncated(false);
      setSearchError('');
      return undefined;
    }

    let cancelled = false;
    setSearching(true);
    setSearchError('');

    searchTimer.current = setTimeout(async () => {
      try {
        const res = await api.get('/api/minutes', { params: { q: wanted } });
        if (cancelled) return;
        setSearchResults(res.data.minutes || []);
        setSearchTruncated(Boolean(res.data.truncated));
      } catch (err) {
        if (cancelled) return;
        setSearchResults([]);
        setSearchError(apiMessage(err, 'Could not search the minutes'));
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, SEARCH_PAUSE_MS);

    return () => {
      cancelled = true;
      clearTimeout(searchTimer.current);
    };
  }, [search, searchNonce]);

  // Warn on tab close/refresh too, not just in-app navigation
  useEffect(() => {
    if (!isDirty) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  function applyNew() {
    setSelectedId('new');
    setForm(BLANK);
    setBaseline(BLANK);
  }

  function applySelect(minute) {
    const next = {
      title: minute.title,
      date: new Date(minute.date).toISOString().slice(0, 10),
      content: minute.content || '',
      visibleToMembers: minute.visibleToMembers !== false,
    };
    setSelectedId(minute._id);
    setForm(next);
    setBaseline(next);
  }

  function startNew() {
    if (isDirty) {
      setPendingSwitch({ type: 'new' });
      return;
    }
    applyNew();
  }

  function select(minute) {
    if (selectedId === minute._id) return;
    if (isDirty) {
      setPendingSwitch({ type: 'select', minute });
      return;
    }
    applySelect(minute);
  }

  function confirmDiscard() {
    if (pendingSwitch?.type === 'new') applyNew();
    else if (pendingSwitch?.type === 'select') applySelect(pendingSwitch.minute);
    else if (pendingSwitch?.type === 'results') applyResults();
    setPendingSwitch(null);
  }

  // Opening and closing a month. The set is rebuilt from what is open *effectively*
  // (which is the newest month until somebody clicks), so the first click on a month
  // does not quietly close the month that was open by default.
  function toggleMonth(key) {
    const open = openMonths === null ? new Set(newestMonth ? [newestMonth] : []) : new Set(openMonths);
    if (open.has(key)) open.delete(key);
    else open.add(key);
    setOpenMonths(open);
  }

  function toggleEveryMonth() {
    setOpenMonths(everyMonthOpen ? new Set() : new Set(groups.map((group) => group.key)));
  }

  // Back to the search answers without losing the question: the term stays in the box,
  // so the next result opens with one tap rather than being typed again.
  function applyResults() {
    setSelectedId(null);
    setForm(BLANK);
    setBaseline(BLANK);
  }

  function backToResults() {
    if (isDirty) {
      setPendingSwitch({ type: 'results' });
      return;
    }
    applyResults();
  }

  async function save() {
    if (!form.title.trim()) {
      toast('Enter a title', 'error');
      return;
    }
    setBusy(true);
    try {
      if (selectedId === 'new') {
        const res = await api.post('/api/minutes', form);
        toast('Minutes saved');
        setSelectedId(res.data.minute._id);
      } else {
        await api.patch(`/api/minutes/${selectedId}`, form);
        toast('Minutes updated');
      }
      setBaseline(form);
      load();
      setSearchNonce((n) => n + 1);
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    setBusy(true);
    try {
      await api.delete(`/api/minutes/${deleting._id}`);
      toast('Minutes deleted');
      setDeleting(null);
      if (selectedId === deleting._id) {
        setSelectedId(null);
        setForm(BLANK);
        setBaseline(BLANK);
      }
      load();
      setSearchNonce((n) => n + 1);
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function importFromDocx() {
    setImporting(true);
    try {
      // ~250 KB of parser, fetched only when a Word file is actually imported.
      // Anything that can be left out of the first page load is left out.
      const { promptForDocxImport } = await import('../utils/importDocx');
      const html = await promptForDocxImport();
      // The office closed the dialog without choosing a file. That is not a failure
      // and must not be answered with a word that just disappears from the editor.
      if (html === null) return;
      setForm({ ...form, content: html });
      toast('Word document imported');
    } catch (err) {
      toast(apiMessage(err) || 'Failed to import document', 'error');
    } finally {
      setImporting(false);
    }
  }

  // The parser behind the Import button is a quarter of a megabyte. Warming it when
  // the pointer (or the keyboard) heads for the button means the download is usually
  // finished before a file has been chosen — without putting it in the page load for
  // everyone who never imports anything.
  function warmImport() {
    import('../utils/importDocx')
      .then((mod) => mod.preloadDocxParser())
      .catch(() => {});
  }

  // Same reasoning on the way out: `docx` is only needed to build the file, and
  // building it takes a moment on mobile data, so the button says so.
  async function exportWord(doc) {
    setExporting(true);
    try {
      const { exportMinuteAsDocx } = await import('../utils/exportDocx');
      exportMinuteAsDocx(doc);
    } catch {
      toast('Could not build the Word file. Please try again.', 'error');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">Minutes</p>
        <h1 className="mt-1 text-2xl font-bold">Meeting minutes</h1>
        {/* How many minutes the group has on file. This is the question the screen is
            opened with, and the one figure that does not move while the list is searched
            or a month is opened — so it sits above both panels rather than inside either
            of them. Held back until the count is known: "0 minutes on file" flashing on
            the way in would be a statement about the record that is simply not true. */}
        {!loading && !loadError && (
          <p className="mt-1 text-sm text-muted">
            {total === 0
              ? 'No minutes on file yet'
              : total === 1
                ? '1 minute on file'
                : `${total} minutes on file`}
          </p>
        )}
      </header>

      {loadError && <ErrorState title="Could not load the minutes" message={loadError} onRetry={load} />}

      <div className="grid gap-4 lg:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)] lg:items-start">
        <section className="overflow-hidden rounded-xl border border-rule bg-surface">
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

        <section>
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
                {term && (
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
                )}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted">
                      {selectedId === 'new' ? 'New minute' : 'Minute details'}
                    </p>
                    <h2 className="mt-1 truncate text-lg font-bold">
                      {form.title.trim() || 'Untitled minute'}
                    </h2>
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

              <div className="flex flex-wrap gap-3 border-t border-rule p-4">
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
      </div>

      <ConfirmDialog
        open={!!deleting}
        title="Delete these minutes?"
        body={deleting ? `"${deleting.title}" will be removed.` : ''}
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
      <ConfirmDialog
        open={!!pendingSwitch}
        title="Discard unsaved changes?"
        body="Your edits to this minute haven't been saved."
        confirmLabel="Discard"
        danger
        onConfirm={confirmDiscard}
        onCancel={() => setPendingSwitch(null)}
      />
    </div>
  );
}
