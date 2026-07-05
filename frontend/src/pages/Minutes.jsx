import { useCallback, useEffect, useState } from 'react';
import api, { apiMessage } from '../services/api';
import { useToast } from '../components/shared/Toast';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import Loader from '../components/shared/Loader';
import { shortDate, todayISO } from '../utils/format';

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
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(null);

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

  function startNew() {
    setSelectedId('new');
    setForm(BLANK);
  }

  async function select(minute) {
    setSelectedId(minute._id);
    setForm({
      title: minute.title,
      date: new Date(minute.date).toISOString().slice(0, 10),
      content: minute.content || '',
    });
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
      }
      load();
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted">Minutes</p>
          <h1 className="mt-1 text-2xl font-bold">Meeting minutes</h1>
        </div>
        <button
          type="button"
          onClick={startNew}
          className="min-h-12 rounded-xl bg-primary px-4 text-sm font-semibold text-white"
        >
          New minute
        </button>
      </header>

      <div className="md:grid md:grid-cols-[280px_1fr] md:items-start md:gap-6">
        <section>
          {loading ? (
            <Loader />
          ) : minutes.length === 0 ? (
            <p className="rounded-xl border border-dashed border-rule px-5 py-8 text-center text-sm text-muted">
              No minutes yet.
            </p>
          ) : (
            <ul className="overflow-hidden rounded-xl border border-rule bg-surface">
              {minutes.map((m) => (
                <li key={m._id} className="border-b border-rule last:border-b-0">
                  <button
                    type="button"
                    onClick={() => select(m)}
                    aria-pressed={selectedId === m._id}
                    className={`block w-full px-4 py-3 text-left ${
                      selectedId === m._id ? 'bg-primary/5' : ''
                    }`}
                  >
                    <p className="truncate text-sm font-semibold">{m.title}</p>
                    <p className="text-xs text-muted">{shortDate(m.date)}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-5 md:mt-0">
          {selectedId === null ? (
            <p className="rounded-xl border border-dashed border-rule px-5 py-10 text-center text-sm text-muted">
              Select a minute, or start a new one.
            </p>
          ) : (
            <div className="space-y-3 rounded-xl border border-rule bg-surface p-5">
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
              <textarea
                rows={14}
                placeholder="Attendees, agenda, decisions, action items…"
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                className="w-full rounded-xl border border-rule px-4 py-3 text-sm leading-relaxed"
              />
              <div className="flex gap-3">
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
    </div>
  );
}
