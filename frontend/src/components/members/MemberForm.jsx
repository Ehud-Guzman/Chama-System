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

// The relationships offered as you type. Free text is allowed on top of these:
// the office knows this family, and "Uncle" has to be writable.
const KIN_RELATIONSHIPS = [
  'Spouse',
  'Son',
  'Daughter',
  'Child',
  'Father',
  'Mother',
  'Brother',
  'Sister',
  'In-law',
  'Guardian',
  'Other',
];

// The quick-add chips. These are the three the office is asked for most often.
const KIN_QUICK_ADD = ['Spouse', 'Child', 'In-law'];

function blankKin(relationship = '') {
  return { name: '', relationship, phone: '', email: '' };
}

// A member's contacts, whichever shape the API sent back: the list, the single
// object older records still hold, or nothing at all.
function kinFrom(value) {
  const raw = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
  const list = raw.map((k) => ({
    name: k?.name || '',
    relationship: k?.relationship || '',
    phone: k?.phone || '',
    email: k?.email || '',
  }));
  return list.length ? list : [blankKin('Spouse')];
}

// The family section of the admission form, in the shape the server reads back.
// One blank row for a child so the fieldset never looks broken — the server drops
// empty names, so an untouched row imports as "no children on file".
function familyFrom(value) {
  const source = value && typeof value === 'object' ? value : {};
  const children = Array.isArray(source.children) ? source.children.filter((c) => c !== '') : [];
  return {
    spouseName: source.spouseName || '',
    children: children.length ? children : [''],
    fatherName: source.fatherName || '',
    motherName: source.motherName || '',
    fatherInLawName: source.fatherInLawName || '',
    motherInLawName: source.motherInLawName || '',
  };
}

// The three office bearers on the form's "for official use only" block. Always all
// three rows, in the order the paper prints them, so an unsigned admission is
// visibly incomplete rather than silently absent.
const APPROVAL_ROLES = [
  { role: 'chairperson', label: 'Chairperson' },
  { role: 'secretary', label: 'Secretary' },
  { role: 'treasurer', label: 'Treasurer' },
];

function approvalsFrom(value) {
  const list = Array.isArray(value) ? value : [];
  return APPROVAL_ROLES.map(({ role, label }) => {
    const match = list.find((entry) => entry?.role === role);
    return { role, label, name: match?.name || '', signedAt: toDateInput(match?.signedAt) };
  });
}

// Whether anything in the family block has actually been filled in. The blank child
// row the form always shows does not count.
function hasFamilyContent(input) {
  const source = input && typeof input === 'object' ? input : {};
  const children = Array.isArray(source.children)
    ? source.children.filter((child) => String(child || '').trim())
    : [];
  return Boolean(
    String(source.spouseName || '').trim() ||
      String(source.fatherName || '').trim() ||
      String(source.motherName || '').trim() ||
      String(source.fatherInLawName || '').trim() ||
      String(source.motherInLawName || '').trim() ||
      children.length
  );
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
    nextOfKin: kinFrom(initial?.nextOfKin),
    // The rest of the admission form. All optional — most of the register was
    // entered from a name and a phone number long before the form existed.
    dateOfBirth: toDateInput(initial?.dateOfBirth),
    nationalId: initial?.nationalId || '',
    physicalAddress: initial?.physicalAddress || '',
    family: familyFrom(initial?.family),
    commitment: {
      agreed: Boolean(initial?.commitment?.agreed),
      // Dated from the moment it is ticked, but the office can back-date it to the
      // day the paper form was actually signed.
      agreedAt: toDateInput(initial?.commitment?.agreedAt) || todayISO(),
      signedBy: initial?.commitment?.signedBy || '',
    },
    approvals: approvalsFrom(initial?.approvals),
  });
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const photoInputRef = useRef(null);
  const containerRef = useModal(true, onCancel);

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  // One contact in the list, by position. The whole list is sent on save, so the
  // server never has to guess which entry changed.
  const setKin = (index, field) => (e) =>
    setForm((prev) => ({
      ...prev,
      nextOfKin: prev.nextOfKin.map((kin, i) =>
        i === index ? { ...kin, [field]: e.target.value } : kin
      ),
    }));

  const addKin = (relationship = '') =>
    setForm((prev) => ({ ...prev, nextOfKin: [...prev.nextOfKin, blankKin(relationship)] }));

  const removeKin = (index) =>
    setForm((prev) => ({
      ...prev,
      // Never leave the list empty: an empty fieldset reads as broken, and one
      // blank row is exactly what "no contacts" looks like on save.
      nextOfKin: prev.nextOfKin.length === 1
        ? [blankKin('Spouse')]
        : prev.nextOfKin.filter((_, i) => i !== index),
    }));

  const setFamily = (field) => (e) =>
    setForm((prev) => ({ ...prev, family: { ...prev.family, [field]: e.target.value } }));

  const setChild = (index) => (e) =>
    setForm((prev) => ({
      ...prev,
      family: {
        ...prev.family,
        children: prev.family.children.map((child, i) => (i === index ? e.target.value : child)),
      },
    }));

  const addChild = () =>
    setForm((prev) => ({ ...prev, family: { ...prev.family, children: [...prev.family.children, ''] } }));

  const removeChild = (index) =>
    setForm((prev) => ({
      ...prev,
      family: {
        ...prev.family,
        // Same reasoning as the contacts list: one blank row is what "no children"
        // looks like, so never leave the fieldset empty.
        children:
          prev.family.children.length === 1
            ? ['']
            : prev.family.children.filter((_, i) => i !== index),
      },
    }));

  const setCommitment = (field) => (e) =>
    setForm((prev) => ({ ...prev, commitment: { ...prev.commitment, [field]: e.target.value } }));

  // One office bearer's signature, by position — all three rows are sent on save.
  const setApproval = (index, field) => (e) =>
    setForm((prev) => ({
      ...prev,
      approvals: prev.approvals.map((approval, i) =>
        i === index ? { ...approval, [field]: e.target.value } : approval
      ),
    }));

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

  // The two admission blocks start open only for a member whose paperwork is already
  // in: an untouched record keeps the form short, and the office fills it in over
  // weeks as the sheets come back from the desk.
  const familyOnFile = hasFamilyContent(form.family);
  const familyOpen = hasFamilyContent(initial?.family);
  const admissionComplete = form.approvals.every((approval) => approval.name.trim() !== '');
  const admissionOpen = Boolean(initial?.commitment?.agreed) || Boolean(initial?.approvals?.length);

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

        {/* Date of birth, ID and address. Optional: a member is often entered from a
            name and a phone number first, and these filled in as he provides them.
            The profile shows what is still missing. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="m-dob" className="mb-1 block text-sm font-medium">
              Date of birth <span className="font-normal text-muted">(optional)</span>
            </label>
            <input
              id="m-dob"
              type="date"
              max={todayISO()}
              value={form.dateOfBirth}
              onChange={set('dateOfBirth')}
              className="h-12 w-full rounded-xl border border-rule px-3 text-sm"
            />
          </div>

          <div>
            <label htmlFor="m-national-id" className="mb-1 block text-sm font-medium">
              National ID / passport <span className="font-normal text-muted">(optional)</span>
            </label>
            <input
              id="m-national-id"
              type="text"
              value={form.nationalId}
              onChange={set('nationalId')}
              className="amount h-12 w-full rounded-xl border border-rule px-4 text-sm"
            />
          </div>
        </div>

        <div>
          <label htmlFor="m-address" className="mb-1 block text-sm font-medium">
            Physical address <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="m-address"
            type="text"
            placeholder="Estate, town"
            value={form.physicalAddress}
            onChange={set('physicalAddress')}
            className="h-12 w-full rounded-xl border border-rule px-4 text-sm"
          />
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
        {/* Next of kin — the people to call in an emergency. A list, because a
            member names more than one: a spouse, the children, the in-laws. Name
            plus at least one way to reach each of them is what the server checks
            for, entry by entry. */}
        <fieldset className="rounded-xl border border-rule p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-widest text-muted">
            Next of kin
          </legend>

          <p className="text-xs text-muted">
            Add as many as you need — spouse, children, in-laws. Each one needs a name
            and a phone number or an email.
          </p>

          <ul className="mt-2 space-y-3">
            {form.nextOfKin.map((kin, index) => (
              <li
                key={index}
                className="rounded-xl border border-rule bg-page p-3"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                    Contact {index + 1}
                    {kin.relationship ? ` · ${kin.relationship}` : ''}
                  </p>

                  <button
                    type="button"
                    onClick={() => removeKin(index)}
                    className="min-h-9 rounded-lg px-2 text-xs font-medium text-alert"
                  >
                    Remove
                  </button>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label htmlFor={`kin-name-${index}`} className="sr-only">
                      Contact {index + 1} name
                    </label>
                    <input
                      id={`kin-name-${index}`}
                      type="text"
                      placeholder="Name"
                      value={kin.name}
                      onChange={setKin(index, 'name')}
                      className="h-11 w-full rounded-xl border border-rule bg-surface px-3 text-sm"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label htmlFor={`kin-relationship-${index}`} className="sr-only">
                      Contact {index + 1} relationship
                    </label>
                    <input
                      id={`kin-relationship-${index}`}
                      type="text"
                      list="kin-relationship-options"
                      placeholder="Relationship — spouse, daughter, in-law…"
                      value={kin.relationship}
                      onChange={setKin(index, 'relationship')}
                      className="h-11 w-full rounded-xl border border-rule bg-surface px-3 text-sm"
                    />
                  </div>

                  <div>
                    <label htmlFor={`kin-phone-${index}`} className="sr-only">
                      Contact {index + 1} phone
                    </label>
                    <input
                      id={`kin-phone-${index}`}
                      type="tel"
                      inputMode="tel"
                      placeholder="07XX XXX XXX"
                      value={kin.phone}
                      onChange={setKin(index, 'phone')}
                      className="amount h-11 w-full rounded-xl border border-rule bg-surface px-3 text-sm"
                    />
                  </div>

                  <div>
                    <label htmlFor={`kin-email-${index}`} className="sr-only">
                      Contact {index + 1} email
                    </label>
                    <input
                      id={`kin-email-${index}`}
                      type="email"
                      placeholder="Email (optional)"
                      value={kin.email}
                      onChange={setKin(index, 'email')}
                      className="amount h-11 w-full rounded-xl border border-rule bg-surface px-3 text-sm"
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <datalist id="kin-relationship-options">
            {KIN_RELATIONSHIPS.map((relationship) => (
              <option key={relationship} value={relationship} />
            ))}
          </datalist>

          <div className="mt-3 flex flex-wrap gap-2">
            {KIN_QUICK_ADD.map((relationship) => (
              <button
                key={relationship}
                type="button"
                onClick={() => addKin(relationship)}
                className="min-h-11 rounded-lg border border-rule bg-surface px-3 text-xs font-medium text-primary"
              >
                + {relationship}
              </button>
            ))}

            <button
              type="button"
              onClick={() => addKin()}
              className="min-h-11 rounded-lg border border-rule bg-surface px-3 text-xs font-medium"
            >
              + Another contact
            </button>
          </div>
        </fieldset>

        {/* The family block. Collapsed unless there is something in it: on a phone this
            form is already long, and a member can sit in the register for months with
            nothing but a name and a number. */}
        <details className="rounded-xl border border-rule p-3" defaultOpen={familyOpen}>
          <summary className="cursor-pointer px-1 text-xs font-semibold uppercase tracking-widest text-muted">
            Family <span className="font-normal normal-case tracking-normal">
              {familyOnFile ? '(on file)' : '(optional)'}
            </span>
          </summary>

          <p className="mt-2 text-xs text-muted">
            Spouse, children, parents and in-laws — the family the group supports
            and calls on.
          </p>

          <div className="mt-3 space-y-3">
            <div>
              <label htmlFor="m-spouse" className="mb-1 block text-sm font-medium">
                Spouse's name
              </label>
              <input
                id="m-spouse"
                type="text"
                value={form.family.spouseName}
                onChange={setFamily('spouseName')}
                className="h-11 w-full rounded-xl border border-rule px-4 text-sm"
              />
            </div>

            <fieldset>
              <legend className="mb-1 text-sm font-medium">Children</legend>
              <ul className="space-y-2">
                {form.family.children.map((child, index) => (
                  <li key={index} className="flex items-center gap-2">
                    <label htmlFor={`m-child-${index}`} className="sr-only">
                      Child {index + 1}
                    </label>
                    <input
                      id={`m-child-${index}`}
                      type="text"
                      placeholder={`Child ${index + 1}`}
                      value={child}
                      onChange={setChild(index)}
                      className="h-11 min-w-0 flex-1 rounded-xl border border-rule px-3 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => removeChild(index)}
                      className="min-h-11 shrink-0 rounded-lg px-2 text-xs font-medium text-alert"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={addChild}
                className="mt-2 min-h-11 rounded-lg border border-rule bg-surface px-3 text-xs font-medium text-primary"
              >
                + Another child
              </button>
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="m-father" className="mb-1 block text-sm font-medium">
                  Father's name
                </label>
                <input
                  id="m-father"
                  type="text"
                  value={form.family.fatherName}
                  onChange={setFamily('fatherName')}
                  className="h-11 w-full rounded-xl border border-rule px-4 text-sm"
                />
              </div>

              <div>
                <label htmlFor="m-mother" className="mb-1 block text-sm font-medium">
                  Mother's name
                </label>
                <input
                  id="m-mother"
                  type="text"
                  value={form.family.motherName}
                  onChange={setFamily('motherName')}
                  className="h-11 w-full rounded-xl border border-rule px-4 text-sm"
                />
              </div>

              <div>
                <label htmlFor="m-father-in-law" className="mb-1 block text-sm font-medium">
                  Father-in-law's name
                </label>
                <input
                  id="m-father-in-law"
                  type="text"
                  value={form.family.fatherInLawName}
                  onChange={setFamily('fatherInLawName')}
                  className="h-11 w-full rounded-xl border border-rule px-4 text-sm"
                />
              </div>

              <div>
                <label htmlFor="m-mother-in-law" className="mb-1 block text-sm font-medium">
                  Mother-in-law's name
                </label>
                <input
                  id="m-mother-in-law"
                  type="text"
                  value={form.family.motherInLawName}
                  onChange={setFamily('motherInLawName')}
                  className="h-11 w-full rounded-xl border border-rule px-4 text-sm"
                />
              </div>
            </div>
          </div>
        </details>

        {/* The form's declaration and its "for official use only" block: the member's
            acceptance of the constitution, then the three office bearers who admitted
            him. Kept together because they are one act of paperwork. */}
        <details className="rounded-xl border border-rule p-3" defaultOpen={admissionOpen}>
          <summary className="cursor-pointer px-1 text-xs font-semibold uppercase tracking-widest text-muted">
            Declaration &amp; approvals <span className="font-normal normal-case tracking-normal">
              {admissionComplete ? '(complete)' : '(pending)'}
            </span>
          </summary>

          <div className="mt-3 space-y-3">
            <label className="flex items-start gap-2 rounded-xl border border-rule px-3 py-3 text-sm">
              <input
                type="checkbox"
                checked={form.commitment.agreed}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    commitment: {
                      ...prev.commitment,
                      agreed: e.target.checked,
                      // Stamped the first time it is ticked, so the date it happened
                      // survives later edits that never touch the box.
                      agreedAt: prev.commitment.agreedAt || todayISO(),
                    },
                  }))
                }
                className="mt-0.5 h-4 w-4"
              />
              <span>
                Member has read the constitution and accepts the weekly commitment
                <span className="block text-xs text-muted">
                  The group's constitution and by-laws, and the weekly contribution agreed by members.
                </span>
              </span>
            </label>

            {form.commitment.agreed && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="m-signed-by" className="mb-1 block text-sm font-medium">
                    Signed by
                  </label>
                  <input
                    id="m-signed-by"
                    type="text"
                    placeholder="Name as signed"
                    value={form.commitment.signedBy}
                    onChange={setCommitment('signedBy')}
                    className="h-11 w-full rounded-xl border border-rule px-4 text-sm"
                  />
                </div>

                <div>
                  <label htmlFor="m-signed-date" className="mb-1 block text-sm font-medium">
                    Date signed
                  </label>
                  <input
                    id="m-signed-date"
                    type="date"
                    max={todayISO()}
                    value={form.commitment.agreedAt}
                    onChange={setCommitment('agreedAt')}
                    className="h-11 w-full rounded-xl border border-rule px-3 text-sm"
                  />
                </div>
              </div>
            )}

            <fieldset>
              <legend className="text-sm font-medium">
                For official use — membership approved by
              </legend>
              <p className="mt-1 text-xs text-muted">
                Type the names the three office bearers signed with. A name left without a
                date is recorded as today.
              </p>

              <ul className="mt-2 space-y-3">
                {form.approvals.map((approval, index) => (
                  <li key={approval.role} className="rounded-xl border border-rule bg-page p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                      {approval.label}
                    </p>

                    <div className="mt-1 grid gap-2 sm:grid-cols-2">
                      <div>
                        <label htmlFor={`m-approval-name-${approval.role}`} className="sr-only">
                          {approval.label} name
                        </label>
                        <input
                          id={`m-approval-name-${approval.role}`}
                          type="text"
                          placeholder="Name"
                          value={approval.name}
                          onChange={setApproval(index, 'name')}
                          className="h-11 w-full rounded-xl border border-rule px-3 text-sm"
                        />
                      </div>

                      <div>
                        <label htmlFor={`m-approval-date-${approval.role}`} className="sr-only">
                          {approval.label} date signed
                        </label>
                        <input
                          id={`m-approval-date-${approval.role}`}
                          type="date"
                          max={todayISO()}
                          value={approval.signedAt}
                          onChange={setApproval(index, 'signedAt')}
                          className="h-11 w-full rounded-xl border border-rule px-3 text-sm"
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </fieldset>
          </div>
        </details>

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
