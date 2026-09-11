import { useCallback, useEffect, useState } from 'react';
import api, { apiMessage } from '../services/api';
import { useToast } from '../components/shared/Toast';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import Loader from '../components/shared/Loader';
import RichTextEditor from '../components/minutes/RichTextEditor';
import { shortDate, todayISO } from '../utils/format';
import { exportMinuteAsDocx } from '../utils/exportDocx';
import { promptForDocxImport } from '../utils/importDocx';

const BLANK = { title: '', date: todayISO(), content: '' };

// Admin-only meeting minutes — never exposed on any public route, matching
// the group's choice to keep individual member issues (fines, disputes)
// private even though contributions themselves are fully open.
export default function Minutes() {
  const toast = useToast();
  const [minutes, setMinutes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null); // null | 'new' | minute._id
  const [form, setForm] = useState(BLANK);
  // What the form looked like right after load/select/save — used to detect
  // unsaved edits so switching minutes doesn't silently discard them.
  const [baseline, setBaseline] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [pendingSwitch, setPendingSwitch] = useState(null);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState('');

  const isDirty = JSON.stringify(form) !== JSON.stringify(baseline);

  const filteredMinutes = minutes.filter((m) =>
    m.title.toLowerCase().includes(search.toLowerCase()) ||
    new Date(m.date).toLocaleDateString('en-KE').includes(search)
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/minutes');
      setMinutes(res.data.minutes);
    } catch (err) {
      toast(apiMessage(err, 'Could not load minutes'), 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

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
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function importFromDocx() {
    setImporting(true);
    try {
      const html = await promptForDocxImport();
      setForm({ ...form, content: html });
      toast('Word document imported');
    } catch (err) {
      toast(apiMessage(err) || 'Failed to import document', 'error');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">Minutes</p>
        <h1 className="mt-1 text-2xl font-bold">Meeting minutes</h1>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)] lg:items-start">
        <section className="overflow-hidden rounded-xl border border-rule bg-surface">
          <div className="border-b border-rule p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">Documents</h2>
              <span className="text-xs text-muted">{filteredMinutes.length} shown</span>
            </div>
            <input
              type="text"
              placeholder="Search minutes…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-11 w-full rounded-lg border border-rule bg-canvas px-3 text-sm"
              aria-label="Search minutes"
            />
            <button
              type="button"
              onClick={startNew}
              className="mt-3 min-h-11 w-full rounded-lg bg-primary text-sm font-semibold text-white"
            >
              New minute
            </button>
          </div>
          {loading ? (
            <div className="p-4">
              <Loader />
            </div>
          ) : filteredMinutes.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">
              {search ? 'No matches found.' : 'No minutes yet.'}
            </p>
          ) : (
            <div className="max-h-[38rem] overflow-y-auto">
              {filteredMinutes.map((m) => {
                const contentPreview = m.content
                  ? m.content
                      .replace(/<[^>]*>/g, '')
                      .trim()
                      .substring(0, 60)
                      .replace(/\s+/g, ' ')
                  : '';

                return (
                  <button
                    key={m._id}
                    type="button"
                    onClick={() => select(m)}
                    className={`w-full border-b border-rule p-4 text-left transition-colors last:border-b-0 ${
                      selectedId === m._id
                        ? 'bg-primary/10'
                        : 'hover:bg-elevation'
                    }`}
                  >
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <p className="line-clamp-2 text-sm font-semibold text-ink">{m.title}</p>
                      <div className="flex flex-shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            exportMinuteAsDocx(m);
                          }}
                          title="Download as Word"
                          className="min-h-8 min-w-8 rounded text-xs text-muted transition-colors hover:bg-primary/10 hover:text-primary"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleting(m);
                          }}
                          title="Delete"
                          aria-label={`Delete ${m.title}`}
                          className="min-h-8 min-w-8 rounded text-xs text-muted transition-colors hover:bg-alert/10 hover:text-alert"
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
                    <p className="mb-1 text-xs text-muted">
                      {new Date(m.date).toLocaleDateString('en-KE', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </p>
                    {contentPreview && (
                      <p className="text-xs text-muted line-clamp-1">{contentPreview}…</p>
                    )}
                  </button>
                );
              })}
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
                        onClick={() => exportMinuteAsDocx(form)}
                        className="min-h-11 rounded-lg border border-rule px-3 text-sm font-semibold transition-colors hover:bg-canvas"
                        title="Download as Word document"
                      >
                        ↓ Export
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={importFromDocx}
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
