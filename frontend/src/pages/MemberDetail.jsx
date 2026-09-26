import { useCallback, useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import api, { apiMessage } from '../services/api';
import { useToast } from '../components/shared/Toast';
import { money, shortDate } from '../utils/format';
import MemberForm from '../components/members/MemberForm';
import LedgerRows from '../components/contributions/LedgerRows';
import EditContributionModal from '../components/contributions/EditContributionModal';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import BackLink from '../components/shared/BackLink';
import ErrorState from '../components/shared/ErrorState';
import ResignDialog from '../components/members/ResignDialog';
import IssueFineForm from '../components/members/IssueFineForm';
import SettleFineForm from '../components/members/SettleFineForm';
import MessageMemberPanel from '../components/members/MessageMemberPanel';
import FinesPanel from '../components/shared/FinesPanel';
import WeeklyScheduleTable from '../components/shared/WeeklyScheduleTable';
import Loader from '../components/shared/Loader';
import MemberAvatar from '../components/members/MemberAvatar';
import StatementPeriodPicker, { useStatementPeriod } from '../components/shared/StatementPeriodPicker';
import { takeWarmJson } from '../services/prefetch';

// One label/value pair in the profile's admission blocks. Renders nothing when
// there is no value, so a half-filled record shows only what is actually known
// rather than a column of blanks.
function Detail({ label, value }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-widest text-muted">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

export default function MemberDetail() {
  const { id } = useParams();
  const toast = useToast();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingContribution, setEditingContribution] = useState(null);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [deletingContribution, setDeletingContribution] = useState(null);
  const [confirmingResign, setConfirmingResign] = useState(false);
  const [issuingFine, setIssuingFine] = useState(false);
  const [voidingFine, setVoidingFine] = useState(null);
  const [settlingFine, setSettlingFine] = useState(null);
  const [busy, setBusy] = useState(false);
  // The period the two statement buttons download. Whole book by default, so the buttons behave
  // exactly as they always have until somebody chooses otherwise.
  const statementPeriod = useStatementPeriod();
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const photoInputRef = useRef(null);

  const load = useCallback(async () => {
    setLoadError('');
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
      // A dropped connection is not a missing member. Saying "not found" for a
      // timed-out request sends the office looking for a record that is there.
      const notFound = err.response?.status === 404;
      if (notFound) setNotFound(true);
      else setLoadError(apiMessage(err, 'Could not load this member'));
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
      const res = await api.get(`/api/members/${id}/statement${statementPeriod.query}`, {
        responseType: 'blob',
      });
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
    const res = await api.get(`/api/members/${id}/statement/excel${statementPeriod.query}`, {
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
    if (loadError) {
      return (
        <ErrorState
          title="Could not load this member"
          message={loadError}
          onRetry={() => {
            setLoading(true);
            load();
          }}
        />
      );
    }
    return (
      <p className="py-10 text-center text-sm text-muted">
        {notFound ? 'Member not found.' : 'That member could not be loaded.'}{' '}
        <Link to="/admin/members" className="text-primary underline">
          Back to members
        </Link>
      </p>
    );
  }

  const { member, contributions, totalContributed, byType, fines, weeklySchedules, ledger, constitution } = data;

  // The contacts as a list, whichever shape this member's record holds — records
  // created before the list existed still carry a single object.
  const kin = Array.isArray(member.nextOfKin)
    ? member.nextOfKin
    : member.nextOfKin && (member.nextOfKin.name || member.nextOfKin.phone)
      ? [member.nextOfKin]
      : [];
  const hasKin = kin.length > 0;

  // The member's own details, as the server normalises them: the family block is
  // always the same shape, and `admission` says which of the three office bearers
  // have signed.
  const family = member.family || {};
  const children = Array.isArray(family.children)
    ? family.children.filter((child) => String(child || '').trim())
    : [];
  const hasFamily =
    Boolean(family.spouseName || family.fatherName || family.motherName || family.fatherInLawName || family.motherInLawName) ||
    children.length > 0;
  const hasPersonal = Boolean(member.dateOfBirth || member.nationalId || member.physicalAddress);
  const approvals = Array.isArray(member.approvals) ? member.approvals : [];
  const admission = member.admission || { complete: false, missing: [] };
  const declaration = member.commitment?.agreed
    ? `${member.commitment.signedBy || 'Signed'} · ${shortDate(member.commitment.agreedAt)}`
    : 'Not recorded yet';
  const constitutionDecided = constitution?.decided || 0;
  const constitutionTotal = constitution?.total || 0;
  const approvedPct = constitutionTotal ? (constitution.approved / constitutionTotal) * 100 : 0;
  const rejectedPct = constitutionTotal ? (constitution.rejected / constitutionTotal) * 100 : 0;

  return (
    <div className="space-y-4">
      <BackLink to="/admin/members">Members</BackLink>

      <section className="rounded-xl border border-rule bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-3">
          <div className="flex min-w-0 items-center gap-3">
            <MemberAvatar name={member.name} photoUrl={member.photoUrl} size="lg" />
            <div className="min-w-0">
              <h1 className="text-xl font-bold">
                {member.name}
                {!member.active && (
                  <span className="ml-2 align-middle text-[11px] font-semibold uppercase tracking-widest text-alert">
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
          {/* Full width under the name on a phone, beside it once there is room: the
              lines this block carries are sentences, and a sentence in a narrow column
              is what pushes a header past the screen edge. */}
          <div className="w-full min-w-0 text-right sm:w-auto sm:shrink-0">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
              Money held by member
            </p>
            <p className="amount text-xl font-bold text-accent">
              {money(ledger ? ledger.money : totalContributed)}
            </p>
            <p className="mt-0.5 text-[11px] leading-4 text-muted">
              (carried in + paid in − tea)
            </p>
            {ledger && (
              <p className="amount mt-1 text-xs text-muted">
                {money(ledger.openingBalance)} carried in at week {ledger.cycleStartWeek} ·{' '}
                {money(ledger.paid)} paid in since
              </p>
            )}
            {ledger && (ledger.chasedArrears ?? ledger.arrears) > 0 && (
              <p className="amount mt-1 text-xs font-semibold text-alert">
                {money(ledger.chasedArrears ?? ledger.arrears)} owed
                {(ledger.chasedWeeksBehind ?? ledger.weeksBehind) > 0
                  ? ` (${ledger.chasedWeeksBehind ?? ledger.weeksBehind} week${
                      (ledger.chasedWeeksBehind ?? ledger.weeksBehind) === 1 ? '' : 's'
                    } behind)`
                  : ''}
              </p>
            )}
            {/* Above the group's line: the money is still uncollected, but nothing is asked of him —
                said in the calm tone rather than the red one (utils/reminderLimit). */}
            {ledger && (ledger.chasedArrears ?? ledger.arrears) === 0 && ledger.arrears > 0 && (
              <p className="amount mt-1 text-xs font-semibold text-muted">
                Ahead of the cycle — {money(ledger.arrears)} of a closed week not collected
                {ledger.moneyLimit > 0 ? ` (he holds more than ${money(ledger.moneyLimit)})` : ''}
              </p>
            )}
          </div>
        </div>
        <dl className="mt-3 grid gap-3 border-t border-rule pt-3 sm:grid-cols-2">
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-widest text-muted">
              Member since
            </dt>
            <dd className="text-xs text-muted">
              {shortDate(member.joinDate || member.createdAt)}
            </dd>
          </div>

          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-widest text-muted">
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
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
            Next of kin {hasKin ? `(${kin.length})` : ''}
          </p>
          {hasKin ? (
            <ul className="mt-1 space-y-1.5">
              {kin.map((person, index) => (
                <li key={index} className="text-sm">
                  <span className="font-medium">{person.name}</span>
                  {person.relationship ? ` (${person.relationship})` : ''}
                  {person.phone && (
                    <span className="amount block text-xs text-muted sm:inline"> · {person.phone}</span>
                  )}
                  {person.email && (
                    <span className="block break-words text-xs text-muted sm:inline">
                      {' '}
                      · {person.email}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-muted">
              Not recorded yet — add a spouse, the children or the in-laws via Edit.
            </p>
          )}
        </div>

        {/* The member's own details beyond the name and the number, each block only as
            long as what is known: a member entered from a name and a number shows the
            prompt to fill him in, not a column of blanks. */}
        <div className="mt-3 border-t border-rule pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
            Personal details
          </p>
          {hasPersonal ? (
            <dl className="mt-1 grid gap-2 sm:grid-cols-3">
              <Detail label="Date of birth" value={member.dateOfBirth ? shortDate(member.dateOfBirth) : ''} />
              <Detail label="National ID / passport" value={member.nationalId} />
              <Detail label="Physical address" value={member.physicalAddress} />
            </dl>
          ) : (
            <p className="mt-1 text-xs text-muted">
              Date of birth, ID number and address not recorded — add them via Edit.
            </p>
          )}
        </div>

        <div className="mt-3 border-t border-rule pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">Family</p>
          {hasFamily ? (
            <dl className="mt-1 grid gap-2 sm:grid-cols-2">
              <Detail label="Spouse" value={family.spouseName} />
              <Detail label="Children" value={children.join(', ')} />
              <Detail label="Father" value={family.fatherName} />
              <Detail label="Mother" value={family.motherName} />
              <Detail label="Father-in-law" value={family.fatherInLawName} />
              <Detail label="Mother-in-law" value={family.motherInLawName} />
            </dl>
          ) : (
            <p className="mt-1 text-xs text-muted">
              No family recorded — add a spouse, the children or the parents via Edit.
            </p>
          )}
        </div>

        <div className="mt-3 border-t border-rule pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
            Admission
          </p>
          <dl className="mt-1 grid gap-2 sm:grid-cols-2">
            <Detail label="Declaration" value={declaration} />
            <Detail
              label="Approved by"
              value={
                approvals.length > 0
                  ? approvals
                      .map((approval) => `${approval.name} (${approval.role})`)
                      .join(', ')
                  : ''
              }
            />
          </dl>
          {approvals.length > 0 && (
            <ul className="mt-1 space-y-1">
              {approvals.map((approval) => (
                <li key={approval.role} className="text-xs text-muted">
                  <span className="font-medium capitalize">{approval.role}</span> · {approval.name} ·{' '}
                  {shortDate(approval.signedAt)}
                </li>
              ))}
            </ul>
          )}
          {!admission.complete && (
            <p className="mt-1 text-xs text-muted">
              Pending{admission.missing?.length ? ` — waiting on the ${admission.missing.join(', ')}` : ''}.
              {' '}Record the signatures via Edit.
            </p>
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

        {/* Two per row on a phone. Four buttons across a 300px card left each one
            about 76px wide with no padding, so "Resign member" wrapped onto two
            lines and the label touched the border. */}
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="min-h-11 rounded-lg border border-rule px-3 text-sm font-medium"
          >
            Edit
          </button>

          <button
            type="button"
            onClick={exportStatement}
            className="min-h-11 rounded-lg border border-rule px-3 text-sm font-medium"
          >
            Statement PDF
          </button>

          <button
            type="button"
            onClick={exportStatementExcel}
            className="min-h-11 rounded-lg border border-rule px-3 text-sm font-medium"
          >
            Statement Excel
          </button>

          {/* Both statement buttons download whatever period is chosen here. The picker sits in the
              action row rather than under the figures because it is an argument to those two
              buttons, not a fact about the member. */}
          <StatementPeriodPicker
            className="min-w-[13rem]"
            idPrefix="office-period"
            preset={statementPeriod.preset}
            from={statementPeriod.from}
            to={statementPeriod.to}
            onChange={({ preset, from, to }) => {
              if (preset !== undefined) statementPeriod.setPreset(preset);
              if (from !== undefined) statementPeriod.setFrom(from);
              if (to !== undefined) statementPeriod.setTo(to);
            }}
          />

          {member.active && (
            <button
              type="button"
              onClick={() => setConfirmingResign(true)}
              className="min-h-11 rounded-lg border border-rule px-3 text-sm font-medium text-alert"
            >
              Resign member
            </button>
          )}
        </div>
      </section>


      <div className="md:grid md:grid-cols-[320px_1fr] md:items-start md:gap-6">
        <section className="space-y-4">
          {/* What he has paid into, by type. This was the pledge editor — an amount
              the office set per fund. Pledges are gone: the member's page shows
              what actually moved, which is what the books can back. */}
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">
              Paid by contribution type
            </h2>
            {byType.length === 0 ? (
              <p className="rounded-xl border border-dashed border-rule px-5 py-6 text-center text-sm text-muted">
                No contribution types set up yet.
              </p>
            ) : (
              <ul className="overflow-hidden rounded-xl border border-rule bg-surface">
                {byType.map((entry) => (
                  <li
                    key={entry.typeId}
                    className="flex items-baseline justify-between gap-3 border-b border-rule px-4 py-3 last:border-b-0"
                  >
                    <span className="min-w-0 truncate text-sm">
                      {entry.name}
                      {entry.isGroupFund && (
                        <span className="ml-1 text-[11px] uppercase tracking-wide text-muted">
                          group fund
                        </span>
                      )}
                    </span>
                    <span className="amount shrink-0 text-sm font-semibold">
                      {money(entry.contributed)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">Fines</h2>
              {!issuingFine && (
                <button
                  type="button"
                  onClick={() => setIssuingFine(true)}
                  className="-mr-2 -my-1 inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-medium text-primary"
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
            ) : settlingFine ? (
              // Settling inline, the same way a fine is issued: the money was paid
              // here and now, and the balance he still owes is the one thing the
              // treasurer needs in front of him while typing.
              <SettleFineForm
                fine={settlingFine}
                onSettled={() => {
                  setSettlingFine(null);
                  load();
                }}
                onCancel={() => setSettlingFine(null)}
              />
            ) : (
              <FinesPanel fines={fines} onVoid={setVoidingFine} onSettle={setSettlingFine} />
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

      {/* What he decided on each chapter of the constitution — the same record
          his own reading page shows him. Nothing here is editable: a decision is
          recorded once and cannot be changed, by him or by the office. */}
      {constitution && (
        <section className="rounded-xl border border-rule bg-surface p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
              Constitution review
            </h2>
            <p className="amount text-xs text-muted">
              {constitutionDecided} of {constitutionTotal} chapters decided
            </p>
          </div>

          {constitutionTotal > 0 && (
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-canvas">
              <div className="flex h-full w-full">
                <span className="h-full bg-accent" style={{ width: `${approvedPct}%` }} />
                <span className="h-full bg-alert" style={{ width: `${rejectedPct}%` }} />
              </div>
            </div>
          )}

          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            <span className="font-semibold text-accent">
              {constitution.approved} approved
            </span>
            <span className="font-semibold text-alert">
              {constitution.rejected} rejected
            </span>
            <span className="text-muted">{constitution.pending} pending</span>
          </p>

          {constitution.decisions.length === 0 ? (
            <p className="mt-3 text-xs text-muted">
              No chapter decided yet. He records his decisions from the constitution
              page on his own phone.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-rule border-t border-rule">
              {constitution.decisions.map((d) => (
                <li
                  key={d.chapterNumber}
                  className="flex items-start justify-between gap-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm leading-5">
                      <span className="amount font-semibold">
                        {String(d.chapterNumber).padStart(2, '0')}
                      </span>{' '}
                      <span className="break-words">{d.chapterTitle}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-muted">{shortDate(d.decidedAt)}</p>
                    {d.reason && (
                      <p className="mt-1 break-words text-xs leading-5 text-muted">
                        “{d.reason}”
                      </p>
                    )}
                  </div>

                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                      d.decision === 'approved'
                        ? 'bg-accent/15 text-accent'
                        : 'bg-alert/10 text-alert'
                    }`}
                  >
                    {d.decision === 'approved' ? 'Approved' : 'Rejected'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

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
