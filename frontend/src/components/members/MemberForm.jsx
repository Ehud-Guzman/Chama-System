import { useRef, useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { useModal } from '../../hooks/useModal';
import { todayISO } from '../../utils/format';
import MemberAvatar from './MemberAvatar';

function toDateInput(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

// Create/edit member form, rendered inside a modal sheet.
export default function MemberForm({ initial, busy, onSubmit, onCancel }) {
  const [form, setForm] = useState({
    name: initial?.name || '',
    phone: initial?.phone || '',
    email: initial?.email || '',
    regNumber: initial?.regNumber || '',
    notes: initial?.notes || '',
    joinDate: toDateInput(initial?.joinDate),
    photoUrl: initial?.photoUrl || '',
    photoPublicId: initial?.photoPublicId || '',
    emailNotifications: initial?.emailNotifications !== false,
    nextOfKin: {
      name: initial?.nextOfKin?.name || '',
      relationship: initial?.nextOfKin?.relationship || '',
      phone: initial?.nextOfKin?.phone || '',
      email: initial?.nextOfKin?.email || '',
    },
  });
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const photoInputRef = useRef(null);
  const containerRef = useModal(true, onCancel);

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });
  const setKin = (field) => (e) =>
    setForm({ ...form, nextOfKin: { ...form.nextOfKin, [field]: e.target.value } });

  // The photo is uploaded as soon as it's picked rather than on submit: saving
  // the member then stays a single JSON request carrying the resulting URL, and
  // the admin sees the actual cropped image before committing to it.
  async function uploadPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setPhotoError('');
    setUploading(true);
    try {
      const payload = new FormData();
      payload.append('file', file);
      const res = await api.post('/api/uploads/member-photo', payload);
      setForm((prev) => ({ ...prev, photoUrl: res.data.url, photoPublicId: res.data.publicId }));
    } catch (err) {
      setPhotoError(apiMessage(err, 'Could not upload that photo'));
    } finally {
      setUploading(false);
      // Reset the input so picking the same file again still fires a change event
      e.target.value = '';
    }
  }

  // Clearing the publicId alongside the URL is what tells the server to delete
  // the Cloudinary asset rather than leave it orphaned.
  function removePhoto() {
    setPhotoError('');
    setForm((prev) => ({ ...prev, photoUrl: '', photoPublicId: '' }));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center sm:pb-4"
      role="dialog"
      aria-modal="true"
      aria-label={initial ? 'Edit member' : 'Add member'}
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <form
        ref={containerRef}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(form);
        }}
        className="max-h-[85dvh] w-full max-w-sm space-y-3 overflow-y-auto rounded-xl bg-surface p-5 shadow-xl sm:max-w-lg"
      >
        <h2 className="text-base font-semibold">{initial ? 'Edit member' : 'Add member'}</h2>

        {/* Photo. Uploaded the moment it is picked — the server crops it square
            around the face — so the admin sees the real image before saving the
            member. The avatar doubles as a trigger: on a phone, tapping the face
            you want to change is the obvious gesture, and it avoids rendering the
            browser's own "Choose File" control, which looks nothing like the rest
            of this form and is a small tap target. */}
        <div className="flex items-start gap-4">
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            onChange={uploadPhoto}
            className="hidden"
            aria-label="Profile photo"
          />

          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            disabled={uploading}
            className="shrink-0 rounded-full disabled:opacity-60"
            aria-label={form.photoUrl ? 'Change profile photo' : 'Add a profile photo'}
          >
            <MemberAvatar name={form.name} photoUrl={form.photoUrl} size="lg" />
          </button>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              Profile photo <span className="font-normal text-muted">(optional)</span>
            </p>

            <div className="flex flex-wrap items-center gap-x-4">
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                disabled={uploading}
                className="min-h-11 text-sm font-medium text-primary disabled:opacity-60"
              >
                {uploading ? 'Uploading…' : form.photoUrl ? 'Change photo' : 'Choose photo'}
              </button>

              {form.photoUrl && !uploading && (
                <button
                  type="button"
                  onClick={removePhoto}
                  className="min-h-11 text-sm font-medium text-alert"
                >
                  Remove
                </button>
              )}
            </div>

            <p className="text-xs text-muted">
              JPG or PNG, up to 5 MB. Cropped square automatically.
            </p>

            {photoError && (
              <p className="mt-1 text-xs font-medium text-alert" role="alert">
                {photoError}
              </p>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="m-name" className="mb-1 block text-sm font-medium">
            Name
          </label>
          <input
            id="m-name"
            type="text"
            required
            value={form.name}
            onChange={set('name')}
            className="h-12 w-full rounded-xl border border-rule px-4 text-sm"
          />
        </div>
        <div>
          <label htmlFor="m-phone" className="mb-1 block text-sm font-medium">
            Phone
          </label>
          <input
            id="m-phone"
            type="tel"
            inputMode="tel"
            required
            placeholder="07XX XXX XXX"
            value={form.phone}
            onChange={set('phone')}
            className="amount h-12 w-full rounded-xl border border-rule px-4 text-sm"
          />
        </div>
        <div>
          <label htmlFor="m-email" className="mb-1 block text-sm font-medium">
            Email <span className="font-normal text-muted">(for reminders)</span>
          </label>
          <input
            id="m-email"
            type="email"
            value={form.email}
            onChange={set('email')}
            className="amount h-12 w-full rounded-xl border border-rule px-4 text-sm"
          />
          <p className="mt-1 text-xs text-muted">
            Used for late-contribution and fine reminders. Leave blank if they have no email.
          </p>
        </div>
        <div>
          <label htmlFor="m-reg" className="mb-1 block text-sm font-medium">
            Reg number <span className="font-normal text-muted">(optional, auto-assigned)</span>
          </label>
          <input
            id="m-reg"
            type="text"
            value={form.regNumber}
            onChange={set('regNumber')}
            className="amount h-12 w-full rounded-xl border border-rule px-4 text-sm"
          />
        </div>
        <div>
          <label htmlFor="m-join-date" className="mb-1 block text-sm font-medium">
            Join date <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="m-join-date"
            type="date"
            max={todayISO()}
            value={form.joinDate}
            onChange={set('joinDate')}
            className="h-12 w-full rounded-xl border border-rule px-3 text-sm"
          />
          <p className="mt-1 text-xs text-muted">
            Anchors their weekly contribution schedule — week 1 starts here.
          </p>
        </div>
        <div>
          <label htmlFor="m-notes" className="mb-1 block text-sm font-medium">
            Notes <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id="m-notes"
            rows={2}
            value={form.notes}
            onChange={set('notes')}
            className="w-full rounded-xl border border-rule px-4 py-3 text-sm"
          />
        </div>
        {/* Next of kin — the person to call in an emergency. Name plus at least
            one way to reach them is what the server checks for. */}
        <fieldset className="rounded-xl border border-rule p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-widest text-muted">
            Next of kin
          </legend>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="kin-name" className="mb-1 block text-xs font-medium">
                Name
              </label>
              <input
                id="kin-name"
                type="text"
                value={form.nextOfKin.name}
                onChange={setKin('name')}
                className="h-11 w-full rounded-xl border border-rule px-3 text-sm"
              />
            </div>

            <div>
              <label htmlFor="kin-relationship" className="mb-1 block text-xs font-medium">
                Relationship
              </label>
              <input
                id="kin-relationship"
                type="text"
                placeholder="e.g. Spouse, brother"
                value={form.nextOfKin.relationship}
                onChange={setKin('relationship')}
                className="h-11 w-full rounded-xl border border-rule px-3 text-sm"
              />
            </div>

            <div>
              <label htmlFor="kin-phone" className="mb-1 block text-xs font-medium">
                Phone
              </label>
              <input
                id="kin-phone"
                type="tel"
                inputMode="tel"
                placeholder="07XX XXX XXX"
                value={form.nextOfKin.phone}
                onChange={setKin('phone')}
                className="amount h-11 w-full rounded-xl border border-rule px-3 text-sm"
              />
            </div>

            <div>
              <label htmlFor="kin-email" className="mb-1 block text-xs font-medium">
                Email
              </label>
              <input
                id="kin-email"
                type="email"
                value={form.nextOfKin.email}
                onChange={setKin('email')}
                className="amount h-11 w-full rounded-xl border border-rule px-3 text-sm"
              />
            </div>
          </div>
        </fieldset>

        <label className="flex items-start gap-2 rounded-xl border border-rule px-4 py-3 text-sm">
          <input
            type="checkbox"
            checked={form.emailNotifications}
            onChange={(e) => setForm({ ...form, emailNotifications: e.target.checked })}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            Email this member reminders
            <span className="block text-xs text-muted">
              Late contributions and unpaid fines. Switch off if they have asked not to be emailed.
            </span>
          </span>
        </label>

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-12 flex-1 rounded-xl border border-rule text-sm font-medium"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="min-h-12 flex-1 rounded-xl bg-primary text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? 'Saving…' : initial ? 'Save changes' : 'Add member'}
          </button>
        </div>
      </form>
    </div>
  );
}
