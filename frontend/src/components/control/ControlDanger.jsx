import { useCallback, useEffect, useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { useToast } from '../shared/Toast';
import { Panel, ConfirmWith, dangerButtonClass } from './controlUi';

// The danger zone: wiping the rehearsal's money before the group goes live.
//
// Deliberately narrow. It clears contributions, expenses and fines — marks them deleted, the way
// the rest of the system "removes" money — and leaves every member, account, setting and opening
// balance alone. It needs maintenance mode, the password and a typed phrase, and writes a safety
// copy first; if that copy cannot be written, nothing is cleared.
export default function ControlDanger({ overview, reload }) {
  const toast = useToast();
  const [counts, setCounts] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const maintenanceOn = overview.controls.maintenance.enabled;

  const loadCounts = useCallback(async () => {
    try {
      const res = await api.get('/api/superadmin/danger/preview');
      setCounts(res.data);
    } catch {
      setCounts(null);
    }
  }, []);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  async function reset({ password, phrase }) {
    try {
      const res = await api.post('/api/superadmin/danger/reset-money', { password, phrase }, { timeout: 120000 });
      toast(
        `Cleared ${res.data.contributions} contributions, ${res.data.expenses} expenses and ${res.data.fines} fines. Safety copy: ${res.data.safetyCopy}`
      );
    } catch (err) {
      throw new Error(apiMessage(err));
    }
    setConfirming(false);
    await loadCounts();
    await reload();
  }

  return (
    <Panel
      id="danger"
      tone="danger"
      title="Danger zone"
      intro="Clear the rehearsal’s money so the books start clean when the group goes live."
    >
      <div className="rounded-lg border border-alert/30 p-3">
        <p className="text-sm font-semibold">Clear all contributions, expenses and fines</p>
        <p className="mt-1 text-xs leading-5 text-muted">
          Members, accounts, settings, funds and opening balances are not touched. The rows are marked
          deleted rather than destroyed, a safety copy is written first, and the audit trail keeps a
          record of the reset.
        </p>
        {counts && (
          <p className="amount mt-2 text-sm">
            Right now: <strong>{counts.contributions}</strong> contributions, <strong>{counts.expenses}</strong>{' '}
            expenses, <strong>{counts.fines}</strong> fines.
          </p>
        )}
        {!maintenanceOn && (
          <p className="mt-2 text-xs leading-5 text-accent">Switch maintenance mode on first (Switches).</p>
        )}
        <button
          type="button"
          disabled={!maintenanceOn}
          onClick={() => setConfirming(true)}
          className={`${dangerButtonClass} mt-3`}
        >
          Clear the rehearsal money…
        </button>
      </div>

      <ConfirmWith
        open={confirming}
        title="Clear all the money on the books?"
        body="Every contribution, expense and fine disappears from the ledger, the reports and members’ passbooks. A safety copy is written first."
        confirmLabel="Clear it"
        danger
        needs={{ phrase: counts?.phrase || 'RESET REHEARSAL DATA', password: true }}
        onCancel={() => setConfirming(false)}
        onConfirm={reset}
      />
    </Panel>
  );
}
