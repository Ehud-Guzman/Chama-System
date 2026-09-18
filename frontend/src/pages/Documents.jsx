import { useCallback, useEffect, useState } from 'react';
import api, { apiMessage } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/shared/Toast';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import Loader from '../components/shared/Loader';
import { shortDate, formatBytes } from '../utils/format';
import { DOCUMENT_CATEGORIES, documentCategoryLabel } from '../utils/documentCategories';
import { opensInBrowser } from '../utils/documentFiles';
import { blobErrorMessage } from '../utils/blobError';

const BLANK = { title: '', category: 'title_deed', description: '', visibleToMembers: true };
const MAX_FILE_MB = 8;
// Uploading and deleting is limited to the roles the API allows
// (see backend/src/routes/documentRoutes.js) — everyone else can look.
const MANAGER_ROLES = ['super_admin', 'admin', 'secretary'];
// The chama's own records — title deeds, certificates, registration papers.
// Uploaded here, and published to members' phones (gated on a registered
// phone number) unless "Visible to members" is switched off.
export default function Documents() {
  const toast = useToast();
  const { user } = useAuth();
  const canManage = MANAGER_ROLES.includes(user?.role);

  const [documents, setDocuments] = useState([]);
  // The categories come from the API and are the group's own list — an admin
  // adds one here and it is instantly available on the upload form (and to
  // members, who only ever read the heading).
  const [categories, setCategories] = useState(DOCUMENT_CATEGORIES);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(BLANK);
  const [file, setFile] = useState(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [newCategory, setNewCategory] = useState('');
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [removingCategory, setRemovingCategory] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/documents');
      setDocuments(res.data.documents || []);
      if (res.data.categories?.length) setCategories(res.data.categories);
    } catch (err) {
      toast(apiMessage(err, 'Could not load documents'), 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Keep the upload form pointed at a category that actually exists: a fresh
  // upload after the old default was removed would otherwise post a heading the
  // server has never heard of.
  useEffect(() => {
    if (!categories.length) return;
    setForm((prev) =>
      categories.some((c) => c.value === prev.category)
        ? prev
        : { ...prev, category: categories[0].value }
    );
  }, [categories]);

  function resetForm() {
    setForm(BLANK);
    setFile(null);
    setFileInputKey((k) => k + 1);
  }

  // Adding a category is a small write of its own: the upload form updates as
  // soon as the server answers, without a full reload of the vault.
  async function addCategory() {
    const label = newCategory.trim();
    if (!label) {
      toast('Type the category name first', 'error');
      return;
    }

    setCategoryBusy(true);
    try {
      const res = await api.post('/api/documents/categories', { label });
      setCategories(res.data.categories || []);
      setNewCategory('');
      toast(`Category "${label}" added`);
    } catch (err) {
      toast(apiMessage(err, 'Could not add that category'), 'error');
    } finally {
      setCategoryBusy(false);
    }
  }

  async function confirmRemoveCategory() {
    setCategoryBusy(true);
    try {
      const res = await api.delete(`/api/documents/categories/${removingCategory.id}`);
      setCategories(res.data.categories || []);
      toast(`"${removingCategory.label}" removed`);
      setRemovingCategory(null);
    } catch (err) {
      toast(apiMessage(err, 'Could not remove that category'), 'error');
    } finally {
      setCategoryBusy(false);
    }
  }

  async function upload() {
    if (!file) {
      toast('Choose a file to upload', 'error');
      return;
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      toast(`That file is larger than ${MAX_FILE_MB} MB. Compress it and try again.`, 'error');
      return;
    }

    setBusy(true);
    try {
      const payload = new FormData();
      payload.append('file', file);
      payload.append('title', form.title.trim() || file.name);
      payload.append('category', form.category);
      payload.append('description', form.description.trim());
      payload.append('visibleToMembers', form.visibleToMembers ? 'true' : 'false');

      await api.post('/api/documents', payload);
      toast('Document uploaded');
      resetForm();
      load();
    } catch (err) {
      toast(apiMessage(err, 'Could not upload the document'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    setBusy(true);
    try {
      await api.delete(`/api/documents/${deleting.id}`);
      toast('Document removed');
      setDeleting(null);
      load();
    } catch (err) {
      toast(apiMessage(err, 'Could not remove the document'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function openDocument(doc, download) {
    setBusyId(doc.id);
    try {
      const res = await api.get(`/api/documents/${doc.id}/file`, {
        params: { download: download ? 1 : undefined },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data);

      if (!download && opensInBrowser(doc.mimeType)) {
        window.open(url, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = doc.fileName || 'document';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      toast(await blobErrorMessage(err, 'Could not open that document'), 'error');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <Loader />;

  return (
    <div className="space-y-4">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">Documents</p>
        <h1 className="mt-1 text-2xl font-bold">Chama documents</h1>
        <p className="mt-1 text-sm text-muted">
          Title deeds, certificates and other group records. Members open them on the public
          page by entering a phone number registered with the chama.
        </p>
      </header>

      {canManage ? (
        <section className="rounded-xl border border-rule bg-surface p-4 md:p-5">
          <h2 className="text-sm font-semibold">Upload a document</h2>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-widest text-muted">
                Title
              </span>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Land title deed — Nairobi plot"
                className="h-11 w-full rounded-lg border border-rule bg-page px-3 text-sm"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-widest text-muted">
                Category
              </span>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="h-11 w-full rounded-lg border border-rule bg-page px-3 text-sm"
              >
                {categories.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-widest text-muted">
              Description (optional)
            </span>
            <textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What this document is — plot number, who holds the original"
              className="w-full rounded-lg border border-rule bg-page px-3 py-2 text-sm"
            />
          </label>

          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-widest text-muted">
              File
            </span>
            <input
              key={fileInputKey}
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,image/*"
              className="block w-full rounded-lg border border-rule bg-page px-3 py-2 text-sm"
            />
          </label>

          {file && (
            <p className="amount mt-1 text-xs text-muted">
              {file.name} · {formatBytes(file.size)}
            </p>
          )}

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
                Shown on the public page once a member enters their registered phone number.
              </span>
            </span>
          </label>

          <button
            type="button"
            onClick={upload}
            disabled={busy}
            className="mt-4 min-h-11 rounded-lg bg-primary px-5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? 'Uploading…' : 'Upload document'}
          </button>

          <p className="mt-2 text-xs text-muted">
            PDF, Word, Excel or a photo — up to {MAX_FILE_MB} MB.
          </p>

          {/* The group's own headings. Kept in a <details> so the upload form
              stays the first thing on the screen, and folded away entirely on a
              phone where the file picker is the only thing being reached for. */}
          <details className="mt-4 border-t border-rule pt-3">
            <summary className="cursor-pointer text-sm font-semibold text-primary">
              Manage categories ({categories.length})
            </summary>

            <p className="mt-2 text-xs text-muted">
              Add the headings this group files papers under. Removing one never moves a
              document already filed under it.
            </p>

            <ul className="mt-2 divide-y divide-rule rounded-xl border border-rule">
              {categories.map((c) => (
                <li key={c.value} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0 truncate text-sm">{c.label}</span>

                  {c.builtIn ? (
                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-widest text-muted">
                      Fallback
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setRemovingCategory(c)}
                      className="min-h-9 shrink-0 rounded-lg px-2 text-xs font-medium text-alert"
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>

            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addCategory();
                  }
                }}
                placeholder="e.g. Water project agreement"
                maxLength={40}
                className="h-11 w-full rounded-lg border border-rule bg-page px-3 text-sm"
                aria-label="New category name"
              />

              <button
                type="button"
                onClick={addCategory}
                disabled={categoryBusy}
                className="min-h-11 shrink-0 rounded-lg border border-rule px-4 text-sm font-semibold text-primary disabled:opacity-60"
              >
                {categoryBusy ? 'Saving…' : 'Add category'}
              </button>
            </div>
          </details>
        </section>
      ) : (
        <p className="rounded-xl border border-rule bg-surface px-4 py-3 text-sm text-muted">
          Your role can view documents but not add or remove them.
        </p>
      )}

      <section className="rounded-xl border border-rule bg-surface">
        <div className="border-b border-rule p-4">
          <h2 className="text-sm font-semibold">Uploaded ({documents.length})</h2>
        </div>

        {documents.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No documents yet.</p>
        ) : (
          <ul className="divide-y divide-rule">
            {documents.map((doc) => (
              <li key={doc.id} className="p-4">
                <p className="truncate text-sm font-semibold">{doc.title}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {documentCategoryLabel(doc.category, categories, doc.categoryLabel)} ·{' '}
                  {shortDate(doc.uploadedAt)}
                  {doc.uploadedBy ? ` · ${doc.uploadedBy}` : ''}
                </p>
                {doc.description && (
                  <p className="mt-1 text-xs leading-5 text-muted">{doc.description}</p>
                )}
                <p className="amount mt-1 truncate text-[11px] text-muted">
                  {doc.fileName} · {formatBytes(doc.size)}
                </p>
                {!doc.visibleToMembers && (
                  <p className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-alert">
                    Hidden from members
                  </p>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => openDocument(doc, false)}
                    disabled={busyId === doc.id}
                    className="min-h-11 rounded-lg border border-rule px-3 text-sm font-medium text-primary disabled:opacity-60"
                  >
                    {busyId === doc.id ? 'Opening…' : 'View'}
                  </button>

                  <button
                    type="button"
                    onClick={() => openDocument(doc, true)}
                    disabled={busyId === doc.id}
                    className="min-h-11 rounded-lg border border-rule px-3 text-sm font-medium disabled:opacity-60"
                  >
                    Download
                  </button>

                  {canManage && (
                    <button
                      type="button"
                      onClick={() => setDeleting(doc)}
                      className="min-h-11 rounded-lg border border-rule px-3 text-sm font-medium text-alert"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={!!removingCategory}
        title="Remove this category?"
        body={
          removingCategory
            ? `"${removingCategory.label}" will no longer be offered when filing a document. Documents already filed under it keep their heading.`
            : ''
        }
        confirmLabel="Remove"
        danger
        busy={categoryBusy}
        onConfirm={confirmRemoveCategory}
        onCancel={() => setRemovingCategory(null)}
      />

      <ConfirmDialog
        open={!!deleting}
        title="Remove this document?"
        body={
          deleting
            ? `"${deleting.title}" will no longer be listed for members. The record stays in the audit trail.`
            : ''
        }
        confirmLabel="Remove"
        danger
        busy={busy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}