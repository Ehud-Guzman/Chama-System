import { useCallback, useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import api, { apiMessage } from '../services/api';
import { useToast } from '../components/shared/Toast';
import { money, shortDate } from '../utils/format';
import MemberForm from '../components/members/MemberForm';
import EditContributionModal from '../components/contributions/EditContributionModal';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import BackLink from '../components/shared/BackLink';
import ErrorState from '../components/shared/ErrorState';
import ResignDialog from '../components/members/ResignDialog';
import PayFinesModal from '../components/fines/PayFinesModal';
import LedgerWalk from '../components/shared/LedgerWalk';
import Loader from '../components/shared/Loader';
import { useStatementPeriod } from '../components/shared/StatementPeriodPicker';
import { takeWarmJson } from '../services/prefetch';
import MemberSummaryCard from './memberDetail/MemberSummaryCard';
import MemberMoneyColumns from './memberDetail/MemberMoneyColumns';
import ConstitutionReviewCard from './memberDetail/ConstitutionReviewCard';

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

  async function resignMember(reason, settlement, payout) {
    setBusy(true);
    try {
      await api.post(`/api/members/${id}/resign`, { reason, settlement, payout });
      toast('Member resigned');
      setConfirmingResign(false);
      load();
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  const [emailing, setEmailing] = useState(false);
  async function emailStatement() {
    setEmailing(true);
    try {
      const res = await api.post(`/api/members/${id}/statement/email${statementPeriod.query}`, {}, { timeout: 60000 });
      toast(`Statement sent to ${res.data.to}`);
    } catch (err) {
      toast(apiMessage(err, 'Could not send the statement'), 'error');
    } finally {
      setEmailing(false);
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
      const res = await api.delete(`/api/fines/${voidingFine._id}`);
      const back = Number(res.data?.returnedToBalance) || 0;
      toast(back > 0 ? `Fine voided — ${money(back)} went back to his balance` : 'Fine voided');
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

      <MemberSummaryCard
        admission={admission}
        approvals={approvals}
        busy={busy}
        children={children}
        declaration={declaration}
        emailStatement={emailStatement}
        emailing={emailing}
        exportStatement={exportStatement}
        exportStatementExcel={exportStatementExcel}
        family={family}
        hasFamily={hasFamily}
        hasKin={hasKin}
        hasPersonal={hasPersonal}
        kin={kin}
        ledger={ledger}
        member={member}
        onPhotoPicked={onPhotoPicked}
        photoError={photoError}
        photoInputRef={photoInputRef}
        photoUploading={photoUploading}
        removePhoto={removePhoto}
        setConfirmingResign={setConfirmingResign}
        setEditing={setEditing}
        statementPeriod={statementPeriod}
        toggleEmailNotifications={toggleEmailNotifications}
        totalContributed={totalContributed}
        uploadStatus={uploadStatus}
      />


      {/* =====================================================
          HOW THE FIGURE ABOVE WAS ARRIVED AT — every movement
          since the books opened, in the order it happened, closed
          to a single line until somebody asks for it. The office
          needs it most often when a member is standing at the
          desk asking exactly this question.
      ====================================================== */}
      <LedgerWalk walk={data.walk} />

      {/* The rail and the ledger, side by side once there is room for both. Two things
          this line has to get right, because getting either wrong scrolls the whole page
          sideways:
            * `minmax(0, 1fr)` and not a bare `1fr`. A `1fr` track keeps an `auto`
              minimum, so it stretches to the widest thing inside it — and the ledger
              rows carry a bank note that does not wrap (`truncate`), which measures
              over 800px. The column was being sized for the note instead of for the
              page. With a zero minimum the note truncates against the column edge, as
              it was always meant to. Every other two-column screen here does the same.
            * `lg` and not `md`. The sidebar takes 14rem from the width at md, and this
              page's rail is a fixed 20rem, so on a tablet the ledger would be left a
              couple of hundred pixels — narrow enough to cut the amounts and the row
              buttons off. Below lg the two simply stack. */}
      <MemberMoneyColumns
        byType={byType}
        contributions={contributions}
        fines={fines}
        issuingFine={issuingFine}
        load={load}
        member={member}
        setDeletingContribution={setDeletingContribution}
        setEditingContribution={setEditingContribution}
        setIssuingFine={setIssuingFine}
        setSettlingFine={setSettlingFine}
        setVoidingFine={setVoidingFine}
        weeklySchedules={weeklySchedules}
      />

      {/* What he decided on each chapter of the constitution — the same record
          his own reading page shows him. Nothing here is editable: a decision is
          recorded once and cannot be changed, by him or by the office. */}
      {constitution && (
        <ConstitutionReviewCard
          approvedPct={approvedPct}
          constitution={constitution}
          constitutionDecided={constitutionDecided}
          constitutionTotal={constitutionTotal}
          rejectedPct={rejectedPct}
        />
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
        held={ledger ? Math.max(0, Number(ledger.money) || 0) : 0}
        owed={Number(fines?.totalOwed) || 0}
        busy={busy}
        onConfirm={resignMember}
        onCancel={() => setConfirmingResign(false)}
      />
      {/* Pay opens the same dialog as the fines desk, over this page. It clears every fine he owes,
          and asks how the money was paid (out of his balance, or handed over separately), which is
          what decides whether his balance moves. */}
      {settlingFine && (
        <PayFinesModal
          memberId={member._id}
          onClose={() => setSettlingFine(null)}
          onPaid={load}
        />
      )}
      <ConfirmDialog
        open={!!voidingFine}
        title="Void this fine?"
        body={
          voidingFine
            ? `${money(voidingFine.remaining)} outstanding will no longer be owed. If any of it was taken from his balance, it goes back to him.`
            : ''
        }
        confirmLabel="Void"
        danger
        busy={busy}
        onConfirm={voidFine}
        onCancel={() => setVoidingFine(null)}
      />
    </div>
  );
}
