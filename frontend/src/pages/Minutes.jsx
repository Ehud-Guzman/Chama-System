import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api, { apiMessage } from '../services/api';
import { useToast } from '../components/shared/Toast';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import ErrorState from '../components/shared/ErrorState';
import { groupMinutesByMonth } from '../utils/minuteGroups';
import { pageCountLabel, pageCountTitle } from '../utils/minutePages';
import { todayISO } from '../utils/format';
import MinutesBrowser from './minutes/MinutesBrowser';
import MinutesPanel from './minutes/MinutesPanel';

const BLANK = { title: '', date: todayISO(), content: '', visibleToMembers: true };

// How many minutes the list on the left loads in one go, asked for explicitly rather
// than left to the API's default of twenty: an office with two years of minutes could
// not reach the older ones at all. A hundred is the endpoint's own ceiling, and the
// list says out loud when the office holds more than it is showing — a truncated list
// must never read as the whole answer.
const BROWSE_LIMIT = 100;

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
  // The panel on the right — the minute being written or read. Only ever scrolled to on a
  // phone, where opening a minute replaces the list (see the effect below).
  const panelRef = useRef(null);

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

  // The minute on screen, found among the ones loaded — it is the payload that carries its page
  // count, and the form deliberately holds only the four fields a person edits.
  const openMinute =
    selectedId && selectedId !== 'new'
      ? [...minutes, ...results].find((m) => m._id === selectedId) || null
      : null;

  // "3 pages", and the rule it was counted under, in one place for all three screens
  // (utils/minutePages) — the office bills by this figure.
  const pageCountOf = (minute) => pageCountTitle(minute?.pages) || '';
  const pageLabelOf = (minute) => pageCountLabel(minute?.pages);

  // Whether the browse panel should stand down so the right-hand panel can take the whole
  // phone screen. This began as the search fix — a phone would otherwise scroll past every
  // month to reach the answer it had just asked for — and opening a minute is the same
  // situation, on the same phone: the minute used to be *below* a year of months, so
  // tapping a title in the list looked like it had done nothing at all. On a wide screen
  // both panels are on show and this is false; on a phone the panel carrying the minute is
  // the one on screen, and the way back to the record is on it.
  //
  // An open minute takes the search box with it, because the box belongs to the record and
  // the record is one tap away again ("← All minutes"). A search *answer* keeps its box:
  // the answer is not a place you stay in, and refining the word is the whole point of it.
  const browsePanelHidden = selectedId !== null;

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

  // A minute opened on a phone replaced the list, so the tap has to land somewhere that
  // reads as an answer. Left to the browser the page simply gets shorter, and the scroll
  // position it clamps to can be halfway down the editor — the office taps a title and
  // arrives in the middle of a minute. So the panel comes to the top itself. Never on a
  // wide screen: there the panel is beside the list, nothing moved, and jumping the page
  // would be the app being twitchy for no reason.
  useEffect(() => {
    if (selectedId === null) return;
    if (!window.matchMedia('(max-width: 1023px)').matches) return;
    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [selectedId]);

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
    else if (pendingSwitch?.type === 'list') applyToList();
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

  // Back to the record from an open minute. On a wide screen this is bookkeeping — the list
  // is still in its own panel to the left — but on a phone the minute *replaced* the list
  // (see where the browse panel stands down), so this is the only way back to it.
  function applyToList() {
    setSelectedId(null);
    setForm(BLANK);
    setBaseline(BLANK);
  }

  function backToList() {
    if (isDirty) {
      setPendingSwitch({ type: 'list' });
      return;
    }
    applyToList();
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
        {/* On a phone this panel is the record, and the panel beside it is the minute: one
            or the other is on screen, never both. With a minute open it stands down
            entirely — the search box above an open minute is chrome between the office and
            what it just tapped, and "← All minutes" on the panel is the way back. */}
        <MinutesBrowser
          browsePanelHidden={browsePanelHidden}
          everyMonthOpen={everyMonthOpen}
          exportWord={exportWord}
          exporting={exporting}
          groups={groups}
          isMonthOpen={isMonthOpen}
          loading={loading}
          minutes={minutes}
          search={search}
          select={select}
          selectedId={selectedId}
          setDeleting={setDeleting}
          setSearch={setSearch}
          startNew={startNew}
          term={term}
          toggleEveryMonth={toggleEveryMonth}
          toggleMonth={toggleMonth}
          total={total}
        />

        {/* min-w-0 on both columns: a grid item's automatic minimum width is its content,
            and rich text brought in from a Word document can be wider than a phone (a
            wide table, a long URL). Without this the panel stretches the page instead of
            the text wrapping inside it. scroll-mt-20 clears the sticky phone header when
            the panel is brought to the top on a tap (see the effect above). */}
        <MinutesPanel
          backToList={backToList}
          backToResults={backToResults}
          busy={busy}
          exportWord={exportWord}
          exporting={exporting}
          form={form}
          importFromDocx={importFromDocx}
          importing={importing}
          isDirty={isDirty}
          minutes={minutes}
          openMinute={openMinute}
          pageCountOf={pageCountOf}
          pageLabelOf={pageLabelOf}
          panelRef={panelRef}
          results={results}
          save={save}
          searchError={searchError}
          searchTruncated={searchTruncated}
          select={select}
          selectedId={selectedId}
          setDeleting={setDeleting}
          setForm={setForm}
          term={term}
          waiting={waiting}
          warmImport={warmImport}
        />
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
