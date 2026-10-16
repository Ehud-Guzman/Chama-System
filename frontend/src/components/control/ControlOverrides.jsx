import { useEffect, useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { useToast } from '../shared/Toast';
import { money } from '../../utils/format';
import { Panel, Pill, Field, ConfirmWith, inputClass, primaryButtonClass, buttonClass } from './controlUi';
import MemberPicker from './MemberPicker';

// Putting things right when the ordinary rules would stop you — with the reason kept.
//
// Two tools. Closing the books is the rule: once a period is agreed, money dated in it cannot be
// touched by the office. Merging two records is the repair for the duplicate that every register
// built from paper ends up with. Both leave the trail the audit screen reads.

function yesterday() {
  const d = new Date(Date.now() - 86400000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function CloseTheBooks({ overview, reload }) {
  const toast = useToast();
  const lock = overview.controls.lock;
  const [date, setDate] = useState(lock.lockedThrough || '');
  const [reason, setReason] = useState(lock.reason || '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDate(lock.lockedThrough || '');
    setReason(lock.reason || '');
  }, [lock.lockedThrough, lock.reason]);

  async function save(next) {
    setBusy(true);
    try {
      await api.put('/api/superadmin/lock', next);
      toast(next.lockedThrough ? `Books closed through ${next.lockedThrough}` : 'The books are open again');
      await reload();
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      id="overrides"
      title="Close the books"
      intro="Once a period is agreed, nobody in the office can add, change or remove money dated in it — not the treasurer, not an admin. You can still go through it, but only by giving a reason, and the reason goes in the audit trail beside the change."
      right={lock.lockedThrough ? <Pill tone="warn">Closed through {lock.lockedThrough}</Pill> : <Pill tone="quiet">Open</Pill>}
    >
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <Field label="Closed through (the last day)" htmlFor="lock-date" hint="Yesterday at the latest.">
          <input
            id="lock-date"
            type="date"
            max={yesterday()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Why" htmlFor="lock-reason" hint="Shown to anyone who is stopped by it.">
          <input
            id="lock-reason"
            value={reason}
            maxLength={300}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Q3 accounts agreed at the October meeting"
            className={inputClass}
          />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !date || reason.trim().length < 3}
          onClick={() => save({ lockedThrough: date, reason })}
          className={primaryButtonClass}
        >
          {busy ? 'Saving…' : lock.lockedThrough ? 'Move the closing date' : 'Close the books'}
        </button>
        {lock.lockedThrough && (
          <button type="button" disabled={busy} onClick={() => save({ lockedThrough: null })} className={buttonClass}>
            Open them again
          </button>
        )}
      </div>
    </Panel>
  );
}

function MergeMembers({ reload }) {
  const toast = useToast();
  const [source, setSource] = useState(null);
  const [target, setTarget] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    setPreview(null);
    setError('');
    if (!source || !target) return undefined;
    let current = true;
    api
      .post('/api/superadmin/members/merge/preview', { sourceId: source._id, targetId: target._id })
      .then((res) => current && setPreview(res.data))
      .catch((err) => current && setError(apiMessage(err)));
    return () => {
      current = false;
    };
  }, [source, target]);

  async function merge({ reason, password }) {
    try {
      await api.post('/api/superadmin/members/merge', {
        sourceId: source._id,
        targetId: target._id,
        reason,
        password,
      });
    } catch (err) {
      throw new Error(apiMessage(err));
    }
    toast(`${source.name} was merged into ${target.name}`);
    setConfirming(false);
    setSource(null);
    setTarget(null);
    reload();
  }

  const moves = preview?.moves;

  return (
    <Panel
      title="Merge two records of one member"
      intro="The same person entered twice — once from the sheet, once typed by hand. Everything the duplicate holds and owes moves onto the record you keep, and the duplicate is retired with a note saying where it went. Nothing is deleted."
    >
      <div className="grid gap-3 md:grid-cols-2">
        <MemberPicker id="merge-target" label="The record to KEEP" value={target} onPick={setTarget} exclude={source?._id} />
        <MemberPicker id="merge-source" label="The duplicate to retire" value={source} onPick={setSource} exclude={target?._id} />
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-alert/40 bg-alert/5 px-3 py-2 text-sm text-alert">
          {error}
        </p>
      )}

      {preview && (
        <div className="mt-4 rounded-lg border border-rule bg-canvas p-3">
          <p className="text-sm font-semibold">
            What moves from {preview.source.name} to {preview.target.name}
          </p>
          <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
            <li>
              Contributions: <strong>{moves.contributions.count}</strong> ({money(moves.contributions.total)})
            </li>
            <li>
              Fines: <strong>{moves.fines.count}</strong> ({money(moves.fines.stillOwed)} still owed)
            </li>
            <li>
              Opening balance: <strong>{money(moves.openingBalance)}</strong> is added
            </li>
            <li>
              Payments out of his balance: <strong>{moves.balanceDebits}</strong>
            </li>
            <li>
              Constitution verdicts: <strong>{moves.constitutionVerdicts}</strong>
            </li>
          </ul>
          {preview.warnings.map((warning) => (
            <p key={warning} className="mt-2 text-xs leading-5 text-accent">
              {warning}
            </p>
          ))}
          <button type="button" onClick={() => setConfirming(true)} className={`${primaryButtonClass} mt-3`}>
            Merge them…
          </button>
        </div>
      )}

      <ConfirmWith
        open={confirming}
        title={`Merge ${source?.name || ''} into ${target?.name || ''}?`}
        body="This rewrites whose money is whose. It is recorded against both members in the audit trail, with your reason."
        confirmLabel="Merge"
        danger
        needs={{ reason: true, reasonLabel: 'Why are these the same person?', minReason: 5, password: true }}
        onCancel={() => setConfirming(false)}
        onConfirm={merge}
      />
    </Panel>
  );
}

function ReinstateMember({ reload }) {
  const toast = useToast();
  const [member, setMember] = useState(null);
  const [confirming, setConfirming] = useState(false);

  async function reinstate({ reason, password }) {
    try {
      await api.post(`/api/superadmin/members/${member._id}/reinstate`, { reason, password });
    } catch (err) {
      throw new Error(apiMessage(err));
    }
    toast(`${member.name} is a current member again`);
    setConfirming(false);
    setMember(null);
    reload();
  }

  return (
    <Panel
      title="Bring back a member who left"
      intro="For a resignation made by mistake, or a member who has come back. The register can switch a member off but has no way to switch him on again, which is how duplicate records get made. This clears the resignation and writes your reason on his record."
    >
      <MemberPicker id="reinstate-member" label="The member" value={member} onPick={setMember} />
      {member && member.active !== false && (
        <p className="mt-3 text-sm text-muted">{member.name} is a current member already.</p>
      )}
      {member && member.active === false && (
        <div className="mt-3 rounded-lg border border-rule bg-canvas p-3">
          <p className="text-sm leading-6">
            {member.resignationReason ? (
              <>
                He left: <strong>{member.resignationReason}</strong>.
              </>
            ) : (
              'He is marked inactive.'
            )}{' '}
            <span className="text-muted">
              His weeks while he was away are not forgiven: counted from his join date, the gap shows as
              weeks to settle on his own record.
            </span>
          </p>
          <button type="button" onClick={() => setConfirming(true)} className={`${primaryButtonClass} mt-3`}>
            Reinstate him…
          </button>
        </div>
      )}
      <ConfirmWith
        open={confirming}
        title={`Reinstate ${member?.name || ''}?`}
        body="He becomes a current member again. What his record said about leaving is kept in the audit trail."
        confirmLabel="Reinstate"
        needs={{ reason: true, reasonLabel: 'Why is he being brought back?', minReason: 5, password: true }}
        onCancel={() => setConfirming(false)}
        onConfirm={reinstate}
      />
    </Panel>
  );
}

export default function ControlOverrides({ overview, reload }) {
  return (
    <div className="space-y-4">
      <CloseTheBooks overview={overview} reload={reload} />
      <ReinstateMember reload={reload} />
      <MergeMembers reload={reload} />
      <Panel
        title="Undo and correct, with a reason"
        intro="Nothing else needs a separate tool. Wherever a screen refuses something because of a rule, you are asked for a reason and let through."
      >
        <ul className="list-disc space-y-1.5 pl-5 text-sm leading-6 text-muted">
          <li>
            <strong className="text-ink">A closed period:</strong> edit or remove the entry as usual; you are
            asked why.
          </li>
          <li>
            <strong className="text-ink">A fine voided or a payment undone:</strong> Fines → the row. Both
            stay on the entry as history.
          </li>
          <li>
            <strong className="text-ink">Anything you are unsure of:</strong> open it in the audit trail and
            read the entry exactly as stored.
          </li>
        </ul>
      </Panel>
    </div>
  );
}
