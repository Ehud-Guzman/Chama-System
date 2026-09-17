import { useCallback, useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import api, { apiMessage } from '../services/api';
import { useToast } from '../components/shared/Toast';
import { money, shortDate } from '../utils/format';
import MemberForm from '../components/members/MemberForm';
import PledgeEditor from '../components/members/PledgeEditor';
import LedgerRows from '../components/contributions/LedgerRows';
import EditContributionModal from '../components/contributions/EditContributionModal';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import ResignDialog from '../components/members/ResignDialog';
import IssueFineForm from '../components/members/IssueFineForm';
import MessageMemberPanel from '../components/members/MessageMemberPanel';
import FinesPanel from '../components/shared/FinesPanel';
import WeeklyScheduleTable from '../components/shared/WeeklyScheduleTable';
import Loader from '../components/shared/Loader';
import MemberAvatar from '../components/members/MemberAvatar';
import { takeWarmJson } from '../services/prefetch';

export default function MemberDetail() {
  const { id } = useParams();
  const toast = useToast();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editingContribution, setEditingContribution] = useState(null);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [deletingContribution, setDeletingContribution] = useState(null);
  const [confirmingResign, setConfirmingResign] = useState(false);
  const [issuingFine, setIssuingFine] = useState(false);
  const [voidingFine, setVoidingFine] = useState(null);
  const [busy, setBusy] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const photoInputRef = useRef(null);

  const load = useCallback(async () => {
    // Warmed while the pointer was on this member's card, so the page usually
    // opens with his name and figures already in place; the request below still
    // runs and replaces it with the server's answer.
    const warmed = takeWarmJson(`/api/members/${id}`);
    if (warmed) {
      setData(warmed);
      setLoading(false);
    }
    try {
      const res = await api.get(`/api/members/${id}`);
      setData(res.data);
    } catch (err) {
      toast(apiMessage(err, 'Could not load member'), 'error');
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Cloudinary status — the photo uploader on this page is disabled until the
  // server has the Cloudinary keys configured.
  useEffect(() => {
    api.get('/api/uploads/status')
      .then((res) => setUploadStatus(res.data))
      .catch(() => {});
  }, []);

  async function saveMember(form) {
    setBusy(true);
    try {
      await api.patch(`/api/members/${id}`, form);
      toast('Member updated');
      setEditing(false);
      load();
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function resignMember(reason) {
    setBusy(true);
    try {
      await api.post(`/api/members/${id}/resign`, { reason });
      toast('Member resigned');
      setConfirmingResign(false);
      load();
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function exportStatement() {
    try {
      const res = await api.get(`/api/members/${id}/statement`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `statement-${member.regNumber || member.name}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(apiMessage(err, 'Export failed'), 'error');
    }
  }

  async function voidFine() {
    setBusy(true);
    try {
      await api.delete(`/api/fines/${voidingFine._id}`);
      toast('Fine voided');
      setVoidingFine(null);
      load();
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  // Profile photo upload + removal, proxied through the admin upload endpoint so
  // the Cloudinary credentials never leave the server and the crop settings can't
  // be tampered with from the browser. Replacing a photo deletes the old Cloudinary
  // asset (via its publicId) before saving the new URL.
  async function uploadPhoto(file) {
    if (!file) return;
    setPhotoUploading(true);
    setPhotoError('');
    try {
      const payload = new FormData();
      payload.append('file', file);
      const res = await api.post('/api/uploads/member-photo', payload);
      // Saved straight away rather than waiting on the edit form: these photo
      // controls sit on the member page itself, so there may never be a later
      // save to carry the URL. updateMember destroys the replaced asset.
      await api.patch(`/api/members/${id}`, {
        photoUrl: res.data.url,
        photoPublicId: res.data.publicId,
      });
      toast('Profile photo updated');
      load();
    } catch (err) {
      setPhotoError(apiMessage(err, 'Could not upload that photo'));
    } finally {
      setPhotoUploading(false);
    }
  }

  // A file input keeps its value after a pick, so choosing the same image twice in
  // a row would not fire a change event. Clear it as soon as we have read the file.
  function onPhotoPicked(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (file) uploadPhoto(file);
  }

  async function removePhoto() {
    if (!member.photoPublicId) return;
    setBusy(true);
    try {
      // Best-effort delete on Cloudinary — if it fails the asset just stays
      // orphaned until the next successful upload cleans it up.
      await api.post('/api/uploads/member-photo/remove', {
        publicId: member.photoPublicId,
      }).catch(() => {});
      await api.patch(`/api/members/${id}`, {
        photoUrl: '',
        photoPublicId: '',
      });
      toast('Photo removed');
      load();
    } catch (err) {
      toast(apiMessage(err, 'Could not remove the photo'), 'error');
    } finally {
      setBusy(false);
    }
  }

  // Email notifications are a single boolean on the member — easiest as an inline
  // patch rather than forcing the admin back through the full edit form.
  async function toggleEmailNotifications() {
    if (!member.email) {
      // The toggle is hidden without an email, so this only fires if a phone
      // lookup raced a fresh edit — keeps the guard rather than a broken patch.
      toast('Add an email address first so reminders have somewhere to go');
      return;
    }
    setBusy(true);
    try {
      await api.patch(`/api/members/${id}`, {
        emailNotifications: member.emailNotifications === false ? true : false,
      });
      toast(
        member.emailNotifications === false
          ? 'Email reminders turned on'
          : 'Email reminders turned off',
      );
      load();
    } catch (err) {
      toast(apiMessage(err, 'Could not update reminders'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function saveContribution(form) {
    setBusy(true);
    try {
      await api.patch(`/api/contributions/${editingContribution._id}`, {
        ...form,
        expectedUpdatedAt: editingContribution.updatedAt,
      });
      toast('Contribution updated');
      setEditingContribution(null);
      load();
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

async function exportStatementExcel() {
  try {
    const res = await api.get(`/api/members/${id}/statement/excel`, {
      responseType: 'blob',
    });

    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');

    a.href = url;
    a.download = `statement-${member.regNumber || member.name}.xlsx`;

    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  } catch (err) {
    toast(apiMessage(err, 'Export failed'), 'error');
  }
}

  async function removeContribution() {
    setBusy(true);
    try {
      await api.delete(`/api/contributions/${deletingContribution._id}`);
      toast('Contribution deleted');
      setDeletingContribution(null);
      load();
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loader />;
  if (!data) {
    return (
      <p className="py-10 text-center text-sm text-muted">
        Member not found. <Link to="/admin/members" className="text-primary underline">Back to members</Link>
      </p>
    );
  }

  const { member, contributions, totalContributed, totalPledged, byType, fines, weeklySchedules } = data;
  const kin = member.nextOfKin || {};
  const hasKin = Boolean(kin.name || kin.phone || kin.email);

  return (
    <div className="space-y-4">
      <Link to="/admin/members" className="text-sm font-medium text-primary">
        ← Members
      </Link>

      <section className="rounded-xl border border-rule bg-surface p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <MemberAvatar name={member.name} photoUrl={member.photoUrl} size="lg" />
            <div className="min-w-0">
              <h1 className="text-xl font-bold">
                {member.name}
                {!member.active && (
                  <span className="ml-2 align-middle text-[10px] font-semibold uppercase tracking-widest text-alert">
                    Inactive
                  </span>
                )}
              </h1>
              <p className="amount mt-1 text-sm text-muted">{member.phone}</p>
              {member.email && <p className="mt-0.5 truncate text-sm text-muted">{member.email}</p>}
              {member.regNumber && (
                <p className="amount text-xs uppercase tracking-widest text-muted">
                  № {member.regNumber}
                </p>
              )}
              {member.notes && <p className="mt-2 text-sm text-muted">{member.notes}</p>}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
              Total (all-time)
            </p>
            <p className="amount text-xl font-bold text-accent">{money(totalContributed)}</p>
            {totalPledged > 0 && (
              <p className="amount mt-1 text-xs text-muted">of {money(totalPledged)} pledged</p>
            )}
          </div>
        </div>
        <dl className="mt-3 grid gap-3 border-t border-rule pt-3 sm:grid-cols-2">
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted">
              Member since
            </dt>
            <dd className="text-xs text-muted">
              {shortDate(member.joinDate || member.createdAt)}
            </dd>
          </div>

          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted">
              Email reminders
            </dt>
            <dd className="text-xs text-muted">
              {!member.email
                ? 'No email address on file'
                : member.emailNotifications === false
                  ? 'Switched off for this member'
                  : 'On — late contributions and fines'}
            </dd>
          </div>
        </dl>

        <div className="mt-3 border-t border-rule pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
            Next of kin
          </p>
          {hasKin ? (
            <p className="mt-1 text-sm">
              {kin.name}
              {kin.relationship ? ` (${kin.relationship})` : ''}
              {kin.phone && <span className="amount text-muted"> · {kin.phone}</span>}
              {kin.email && <span className="text-muted"> · {kin.email}</span>}
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted">Not recorded yet — add one via Edit.</p>
          )}
        </div>

        {member.resignedAt && (
          <p className="mt-3 border-t border-rule pt-3 text-xs text-alert">
            Resigned {shortDate(member.resignedAt)}
            {member.resignationReason ? ` — ${member.resignationReason}` : ''}
          </p>
        )}

        {/* Profile photo and the reminder switch. Both write to the server the
            moment they are used rather than routing the admin back through the
            edit form, and the picker stays disabled with an explanation when the
            server has no image-storage keys configured. */}
        <div className="mt-3 space-y-2 border-t border-rule pt-3">
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            onChange={onPhotoPicked}
            className="hidden"
            aria-label="Member profile photo"
          />

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              disabled={photoUploading || uploadStatus?.cloudinaryConfigured === false}
              className="min-h-11 rounded-lg border border-rule px-3 text-xs font-medium disabled:opacity-50"
            >
              {photoUploading ? 'Uploading…' : member.photoUrl ? 'Change photo' : 'Upload photo'}
            </button>

            {member.photoUrl && (
              <button
                type="button"
                onClick={removePhoto}
                disabled={busy || photoUploading}
                className="min-h-11 rounded-lg border border-rule px-3 text-xs font-medium text-alert disabled:opacity-50"
              >
                Remove photo
              </button>
            )}

            {member.email && (
              <button
                type="button"
                onClick={toggleEmailNotifications}
                disabled={busy}
                className="min-h-11 rounded-lg border border-rule px-3 text-xs font-medium disabled:opacity-50"
              >
                {member.emailNotifications === false
                  ? 'Turn email reminders on'
                  : 'Turn email reminders off'}
              </button>
            )}
          </div>

          {uploadStatus?.cloudinaryConfigured === false && (
            <p className="text-xs text-muted">
              Photo storage is not set up on the server yet, so photos are switched off.
            </p>
          )}

          {photoError && (
            <p className="text-xs text-alert" role="alert">
              {photoError}
            </p>
          )}
        </div>

        <div className="mt-3 flex gap-3">
  <button
    type="button"
    onClick={() => setEditing(true)}
    className="min-h-11 flex-1 rounded-lg border border-rule text-sm font-medium"
  >
    Edit
  </button>

  <button
    type="button"
    onClick={exportStatement}
    className="min-h-11 flex-1 rounded-lg border border-rule text-sm font-medium"
  >
    PDF
  </button>

  <button
    type="button"
    onClick={exportStatementExcel}
    className="min-h-11 flex-1 rounded-lg border border-rule text-sm font-medium"
  >
    Excel
  </button>

  {member.active && (
    <button
      type="button"
      onClick={() => setConfirmingResign(true)}
      className="min-h-11 flex-1 rounded-lg border border-rule text-sm font-medium text-alert"
    >
      Resign member
    </button>
  )}
</div>
      </section>


      <div className="md:grid md:grid-cols-[320px_1fr] md:items-start md:gap-6">
        <section className="space-y-4">
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">
              Pledges
            </h2>
            <PledgeEditor memberId={member._id} byType={byType} onSaved={load} />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">Fines</h2>
              {!issuingFine && (
                <button
                  type="button"
                  onClick={() => setIssuingFine(true)}
                  className="text-xs font-medium text-primary"
                >
                  Issue fine
                </button>
              )}
            </div>
            {issuingFine ? (
              <IssueFineForm
                memberId={member._id}
                onIssued={() => {
                  setIssuingFine(false);
                  load();
                }}
                onCancel={() => setIssuingFine(false)}
              />
            ) : (
              <FinesPanel fines={fines} onVoid={setVoidingFine} />
            )}
          </div>

          <MessageMemberPanel member={member} pendingFinesTotal={fines?.totalOwed || 0} />
        </section>

        <section className="mt-5 space-y-4 md:mt-0">
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">
              Contributions ({contributions.length})
            </h2>
            <LedgerRows
              contributions={contributions}
              onEdit={setEditingContribution}
              onDelete={setDeletingContribution}
            />
          </div>

          {weeklySchedules?.length > 0 && (
            <div>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">
                Weekly schedule
              </h2>
              <WeeklyScheduleTable schedules={weeklySchedules} />
            </div>
          )}
        </section>
      </div>

      {editing && (
        <MemberForm
          initial={member}
          busy={busy}
          onSubmit={saveMember}
          onCancel={() => setEditing(false)}
        />
      )}
      {editingContribution && (
        <EditContributionModal
          contribution={editingContribution}
          busy={busy}
          onSubmit={saveContribution}
          onCancel={() => setEditingContribution(null)}
        />
      )}
      <ConfirmDialog
        open={!!deletingContribution}
        title="Delete this contribution?"
        body={
          deletingContribution
            ? `${money(deletingContribution.amount)} on ${shortDate(deletingContribution.date)}. The record is kept in the audit trail.`
            : ''
        }
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={removeContribution}
        onCancel={() => setDeletingContribution(null)}
      />
      <ResignDialog
        open={confirmingResign}
        memberName={member.name}
        busy={busy}
        onConfirm={resignMember}
        onCancel={() => setConfirmingResign(false)}
      />
      <ConfirmDialog
        open={!!voidingFine}
        title="Void this fine?"
        body={voidingFine ? `${money(voidingFine.remaining)} outstanding will no longer be owed.` : ''}
        confirmLabel="Void"
        danger
        busy={busy}
        onConfirm={voidFine}
        onCancel={() => setVoidingFine(null)}
      />
    </div>
  );
}
