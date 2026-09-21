import { useCallback, useEffect, useRef, useState } from 'react';
import api, { apiMessage } from '../services/api';
import { useToast } from '../components/shared/Toast';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import ErrorState from '../components/shared/ErrorState';
import HighlightedText from '../components/shared/HighlightedText';
import Loader from '../components/shared/Loader';
import RichTextEditor from '../components/minutes/RichTextEditor';
import { todayISO } from '../utils/format';

const BLANK = { title: '', date: todayISO(), content: '', visibleToMembers: true };

// The minutes list is a long list on a phone: showing every document in an inner
// scroll region traps the drag gesture that is trying to scroll the page. Show the
// newest few and let the reader ask for the rest.
const LIST_PREVIEW = 6;

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
  const [showAllMinutes, setShowAllMinutes] = useState(false);
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
  // A search replaces the list rather than filtering it. It has to: a minute's body
  // is not in the list payload at all, and the minute somebody is looking for is
  // usually one from months back that was never loaded. What the server sends back
  // is already the whole answer, so all of it is shown rather than the first six.
  const shown = term ? searchResults || [] : minutes;
  const listing = term || showAllMinutes ? shown : shown.slice(0, LIST_PREVIEW);
  // The first search has nothing to show yet. Saying "no matches" for the half
  // second before the answer arrives would be saying something untrue.
  const waiting = Boolean(term) && searching && searchResults === null;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await api.get('/api/minutes');
      setMinutes(res.data.minutes);
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
    setPendingSwitch(null);
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
      </header>

      {loadError && <ErrorState title="Could not load the minutes" message={loadError} onRetry={load} />}

      <div className="grid gap-4 lg:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)] lg:items-start">
        <section className="overflow-hidden rounded-xl border border-rule bg-surface">
          <div className="border-b border-rule p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">Documents</h2>
              <span className="text-xs text-muted">
                {term ? `${shown.length} found` : `${shown.length} shown`}
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
                title — and a date typed as one (21/05/2026) finds that meeting. */}
            <p className="mt-2 text-xs leading-5 text-muted">
              {term && searching
                ? 'Searching every minute…'
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
          {searchError && (
            <p
              className="border-b border-rule bg-alert/5 px-4 py-3 text-xs font-medium text-alert"
              role="alert"
            >
              {searchError}
            </p>
          )}
          {term && searchTruncated && (
            <p className="border-b border-rule bg-canvas px-4 py-2 text-xs leading-5 text-muted">
              The newest matches, up to a hundred. Add another word to narrow it down.
            </p>
          )}
          {loading || waiting ? (
            <div className="p-4">
              <Loader />
            </div>
          ) : shown.length === 0 && !searchError ? (
            <p className="px-4 py-8 text-center text-sm text-muted">
              {term ? `No minute contains “${term}”.` : 'No minutes yet.'}
            </p>
          ) : shown.length === 0 ? null : (
            <div>
              {listing.map((m) => {
                // A search result opens with the sentence the word was found in
                // (the server sends it); a browse row shows the minute's first line.
                const opening = m.content
                  ? `${m.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)}…`
                  : '';
                const preview = m.match?.snippet || opening;

                return (
                  // The row is not a button any more: it used to contain two more
                  // buttons (download, delete), which is invalid HTML and reads to a
                  // screen reader as buttons inside a button. The title is the
                  // control; the two actions sit beside it as siblings, each a real
                  // 44px target so a delete is never a mis-tap away from a download.
                  <div
                    key={m._id}
                    className={`flex items-start gap-2 border-b border-rule p-3 last:border-b-0 ${
                      selectedId === m._id ? 'bg-primary/10' : ''
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => select(m)}
                      aria-pressed={selectedId === m._id}
                      className="min-w-0 flex-1 rounded-lg p-1 text-left transition-colors active:bg-elevation"
                    >
                      <HighlightedText
                        text={m.title}
                        term={term}
                        className="line-clamp-2 block text-sm font-semibold text-ink"
                      />
                      <span className="mb-1 mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                        {new Date(m.date).toLocaleDateString('en-KE', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                        {m.visibleToMembers === false && (
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
                    </button>

                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => exportWord(m)}
                        disabled={exporting}
                        aria-label={`Download ${m.title} as a Word document`}
                        title="Download as Word"
                        className="flex h-11 w-11 items-center justify-center rounded-lg text-base text-muted transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-40"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleting(m)}
                        aria-label={`Delete ${m.title}`}
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
              })}

              {/* The "newest six, ask for the rest" clamp is for browsing. A search
                  answer is the whole answer and is shown whole — the server has
                  already capped it. */}
              {!term && !showAllMinutes && shown.length > LIST_PREVIEW && (
                <button
                  type="button"
                  onClick={() => setShowAllMinutes(true)}
                  className="min-h-12 w-full border-t border-rule text-sm font-semibold text-primary"
                >
                  Show all {shown.length} documents
                </button>
              )}
              {!term && showAllMinutes && shown.length > LIST_PREVIEW && (
                <button
                  type="button"
                  onClick={() => setShowAllMinutes(false)}
                  className="min-h-12 w-full border-t border-rule text-sm font-semibold text-muted"
                >
                  Show the newest {LIST_PREVIEW}
                </button>
              )}
            </div>
          )}
        </section>

        <section>
          {selectedId === null ? (
            <p className="rounded-xl border border-dashed border-rule px-5 py-10 text-center text-sm text-muted">
              Select a minute, or start a new one.
            </p>
          ) : (
            <div className="rounded-xl border border-rule bg-surface">
              <div className="border-b border-rule p-4">
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
