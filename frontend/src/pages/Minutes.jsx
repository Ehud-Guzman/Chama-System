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
      <header className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted">Minutes</p>
          <h1 className="mt-1 text-2xl font-bold">Meeting minutes</h1>
        </div>
        <div className="flex gap-2">
          {selectedId && (
            <button
              type="button"
              onClick={() => exportMinuteAsDocx(form)}
              className="min-h-12 rounded-xl border border-rule px-4 text-sm font-semibold hover:bg-canvas transition-colors"
              title="Download as Word document"
            >
              ↓ Export
            </button>
          )}
          <button
            type="button"
            onClick={importFromDocx}
            disabled={importing}
            className="min-h-12 rounded-xl border border-rule px-4 text-sm font-semibold disabled:opacity-40"
          >
            {importing ? 'Importing…' : 'Import from Word'}
          </button>
          <button
            type="button"
            onClick={startNew}
            className="min-h-12 rounded-xl bg-primary px-4 text-sm font-semibold text-white"
          >
            New minute
          </button>
        </div>
      </header>

      <div className="md:grid md:grid-cols-[320px_1fr] md:items-start md:gap-6">
        <section className="space-y-3">
          <div>
            <input
              type="text"
              placeholder="Search minutes…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-10 rounded-lg border border-rule px-3 text-sm"
              aria-label="Search minutes"
            />
          </div>
          {loading ? (
            <Loader />
          ) : filteredMinutes.length === 0 ? (
            <p className="rounded-xl border border-dashed border-rule px-4 py-6 text-center text-sm text-muted">
              {search ? 'No matches found.' : 'No minutes yet.'}
            </p>
          ) : (
            <div className="space-y-2">
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
                    className={`w-full text-left p-3 rounded-lg border transition-all ${
                      selectedId === m._id
                        ? 'border-primary bg-primary/5 shadow-sm'
                        : 'border-rule bg-surface hover:border-primary/30 hover:shadow-sm'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-sm font-semibold line-clamp-2 text-ink">{m.title}</p>
                      <div className="flex gap-1 flex-shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            exportMinuteAsDocx(m);
                          }}
                          title="Download as Word"
                          className="min-h-7 min-w-7 text-xs rounded text-muted hover:text-primary hover:bg-primary/10 transition-colors"
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
                          className="min-h-7 min-w-7 text-xs rounded text-muted hover:text-alert hover:bg-alert/10 transition-colors"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-muted mb-1">
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

        <section className="mt-5 md:mt-0">
          {selectedId === null ? (
            <p className="rounded-xl border border-dashed border-rule px-5 py-10 text-center text-sm text-muted">
              Select a minute, or start a new one.
            </p>
          ) : (
            <div className="space-y-3 rounded-xl border border-rule bg-surface p-5">
              {isDirty && (
                <p className="text-xs font-medium text-alert">Unsaved changes</p>
              )}
              <input
                type="text"
                required
                placeholder="Title, e.g. Weekly meeting — 21 May 2026"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="h-12 w-full rounded-xl border border-rule px-4 text-sm font-semibold"
                aria-label="Minute title"
              />
              <input
                type="date"
                max={todayISO()}
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="h-12 rounded-xl border border-rule px-3 text-sm"
              />
              <RichTextEditor
                key={selectedId}
                value={form.content}
                onChange={(html) => setForm({ ...form, content: html })}
                placeholder="Attendees, agenda, decisions, action items…"
              />
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={save}
                  disabled={busy}
                  className="min-h-12 flex-1 rounded-xl bg-primary text-sm font-semibold text-white disabled:opacity-60"
                >
                  {busy ? 'Saving…' : 'Save'}
                </button>
                {selectedId !== 'new' && (
                  <button
                    type="button"
                    onClick={() => setDeleting(minutes.find((m) => m._id === selectedId))}
                    className="min-h-12 rounded-xl border border-rule px-4 text-sm font-medium text-alert"
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
