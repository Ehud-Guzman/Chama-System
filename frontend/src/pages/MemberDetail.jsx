import { useCallback, useEffect, useState } from 'react';
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

export default function MemberDetail() {
  const { id } = useParams();
  const toast = useToast();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editingContribution, setEditingContribution] = useState(null);
  const [deletingContribution, setDeletingContribution] = useState(null);
  const [confirmingResign, setConfirmingResign] = useState(false);
  const [issuingFine, setIssuingFine] = useState(false);
  const [voidingFine, setVoidingFine] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
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

  return (
    <div className="space-y-4">
      <Link to="/admin/members" className="text-sm font-medium text-primary">
        ← Members
      </Link>

      <section className="rounded-xl border border-rule bg-surface p-5">
        <div className="flex items-start justify-between gap-3">
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
            {member.regNumber && (
              <p className="amount text-xs uppercase tracking-widest text-muted">
                № {member.regNumber}
              </p>
            )}
            {member.notes && <p className="mt-2 text-sm text-muted">{member.notes}</p>}
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
        <p className="mt-3 border-t border-rule pt-3 text-xs text-muted">
          Member since {shortDate(member.joinDate || member.createdAt)}
        </p>
        {member.resignedAt && (
          <p className="mt-1 text-xs text-alert">
            Resigned {shortDate(member.resignedAt)}
            {member.resignationReason ? ` — ${member.resignationReason}` : ''}
          </p>
        )}
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
            Export statement
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
