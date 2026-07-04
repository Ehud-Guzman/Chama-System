import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api, { apiMessage } from '../services/api';
import { useToast } from '../components/shared/Toast';
import { money, shortDate } from '../utils/format';
import MemberForm from '../components/members/MemberForm';
import PledgeEditor from '../components/members/PledgeEditor';
import LedgerRows from '../components/contributions/LedgerRows';
import EditContributionModal from '../components/contributions/EditContributionModal';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import Loader from '../components/shared/Loader';

export default function MemberDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editingContribution, setEditingContribution] = useState(null);
  const [deletingContribution, setDeletingContribution] = useState(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
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

  async function removeMember() {
    setBusy(true);
    try {
      await api.delete(`/api/members/${id}`);
      toast('Member removed');
      navigate('/admin/members');
    } catch (err) {
      toast(apiMessage(err), 'error');
      setBusy(false);
      setConfirmingRemove(false);
    }
  }

  async function saveContribution(form) {
    setBusy(true);
    try {
      await api.patch(`/api/contributions/${editingContribution._id}`, form);
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

  const { member, contributions, totalContributed, totalPledged, byType } = data;

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
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Total</p>
            <p className="amount text-xl font-bold text-accent">{money(totalContributed)}</p>
            {totalPledged > 0 && (
              <p className="amount mt-1 text-xs text-muted">of {money(totalPledged)} pledged</p>
            )}
          </div>
        </div>
        <p className="mt-3 border-t border-rule pt-3 text-xs text-muted">
          Member since {shortDate(member.createdAt)}
        </p>
        <div className="mt-3 flex gap-3">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="min-h-11 flex-1 rounded-lg border border-rule text-sm font-medium"
          >
            Edit
          </button>
          {member.active && (
            <button
              type="button"
              onClick={() => setConfirmingRemove(true)}
              className="min-h-11 flex-1 rounded-lg border border-rule text-sm font-medium text-alert"
            >
              Remove member
            </button>
          )}
        </div>
      </section>

      <div className="md:grid md:grid-cols-[320px_1fr] md:items-start md:gap-6">
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">
            Pledges
          </h2>
          <PledgeEditor memberId={member._id} byType={byType} onSaved={load} />
        </section>

        <section className="mt-5 md:mt-0">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">
            Contributions ({contributions.length})
          </h2>
          <LedgerRows
            contributions={contributions}
            onEdit={setEditingContribution}
            onDelete={setDeletingContribution}
          />
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
      <ConfirmDialog
        open={confirmingRemove}
        title="Remove this member?"
        body="The member is marked inactive and hidden from public lookup. Their contribution history is kept."
        confirmLabel="Remove"
        danger
        busy={busy}
        onConfirm={removeMember}
        onCancel={() => setConfirmingRemove(false)}
      />
    </div>
  );
}
