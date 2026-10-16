import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api, { apiMessage } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { startPreview } from '../../services/preview';
import { useToast } from '../shared/Toast';
import ErrorState from '../shared/ErrorState';
import Loader from '../shared/Loader';
import { shortDateTime } from '../../utils/format';
import { timeAgo } from '../../utils/timeAgo';
import { roleHome } from '../../utils/roleHome';
import { Panel, Pill, Field, ConfirmWith, buttonClass, inputClass, dangerButtonClass } from './controlUi';

// Who can sign in, how they are using it, and what the super admin can do about it.
//
// The ordinary Accounts card in Settings creates accounts and resets passwords, and stays the
// place for that. This is the layer above: when did each account last sign in and from where, is
// somebody guessing at one, end its sessions, freeze it with a reason the person is shown, change
// its role, or look at the whole app as that role sees it.

const ROLE_LABEL = {
  super_admin: 'Super admin',
  admin: 'Admin',
  treasurer: 'Treasurer',
  secretary: 'Secretary',
  disciplinary: 'Disciplinary',
};
const PREVIEW_ROLES = ['admin', 'treasurer', 'secretary', 'disciplinary'];

function Presence({ account }) {
  if (!account.active) return <Pill tone="quiet">Deactivated</Pill>;
  if (account.frozen) return <Pill tone="bad">Frozen</Pill>;
  if (account.online) return <Pill tone="good">Here now</Pill>;
  if (account.lastActiveAt) return <Pill tone="quiet">Seen {timeAgo(account.lastActiveAt)}</Pill>;
  return <Pill tone="warn">Never signed in</Pill>;
}

export default function ControlAccounts({ onChanged }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { user, applyMe } = useAuth();
  const [accounts, setAccounts] = useState(null);
  const [roles, setRoles] = useState([]);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null); // { kind: 'freeze'|'role'|'signout-all', account? }
  const [newRole, setNewRole] = useState('');
  const [previewing, setPreviewing] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/superadmin/accounts');
      setAccounts(res.data.accounts);
      setRoles(res.data.roles);
      setError('');
    } catch (err) {
      setError(apiMessage(err, 'Could not load the accounts'));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function run(promise, done) {
    try {
      await promise;
      if (done) toast(done);
      await load();
      onChanged?.();
    } catch (err) {
      toast(apiMessage(err), 'error');
    }
  }

  // Throws a plain Error carrying the server's words, which ConfirmWith shows in place.
  async function viaDialog(request, done) {
    try {
      await request();
    } catch (err) {
      throw new Error(apiMessage(err));
    }
    toast(done);
    setDialog(null);
    await load();
    onChanged?.();
  }

  async function preview(role) {
    setPreviewing(role);
    try {
      await startPreview(role, applyMe);
      navigate(roleHome(role));
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setPreviewing('');
    }
  }

  if (error && !accounts) {
    return <ErrorState title="Could not load the accounts" message={error} onRetry={load} />;
  }
  if (!accounts) return <Loader />;

  return (
    <Panel
      id="accounts"
      title="Accounts and sessions"
      intro="How each account is being used, and the things only you can do about it. Creating accounts and resetting passwords stays in Settings → Accounts."
      right={
        <Link to="/admin/settings#accounts" className={`${buttonClass} flex items-center`}>
          Add or reset an account
        </Link>
      }
    >
      <div className="mb-4 rounded-lg border border-rule bg-canvas p-3">
        <p className="text-sm font-medium">See the app as someone else does</p>
        <p className="mt-0.5 text-xs leading-5 text-muted">
          Read-only, for 30 minutes. You get exactly that role&apos;s menu and screens, and nothing you tap
          can change anything. The fastest way to answer &ldquo;why can&apos;t the secretary find it?&rdquo;
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {PREVIEW_ROLES.map((role) => (
            <button
              key={role}
              type="button"
              onClick={() => preview(role)}
              disabled={Boolean(previewing)}
              className={buttonClass}
            >
              {previewing === role ? 'Opening…' : `As ${ROLE_LABEL[role].toLowerCase()}`}
            </button>
          ))}
        </div>
      </div>

      <ul className="divide-y divide-rule rounded-lg border border-rule">
        {accounts.map((account) => {
          const self = account.id === user.id;
          return (
            <li key={account.id} className="px-3 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <p className="min-w-0 text-sm font-semibold">
                  {account.name}
                  {self && <span className="ml-2 text-xs font-normal text-muted">(you)</span>}
                </p>
                <Pill tone={account.role === 'super_admin' ? 'info' : 'quiet'}>{ROLE_LABEL[account.role]}</Pill>
                <Presence account={account} />
                {account.twoFactorEnabled && <Pill tone="good">2FA</Pill>}
                {account.failedLoginCount >= 3 && (
                  <Pill tone="bad">{account.failedLoginCount} wrong passwords</Pill>
                )}
              </div>
              <p className="mt-0.5 truncate text-xs text-muted">{account.email}</p>
              <p className="mt-1 text-xs leading-5 text-muted">
                {account.lastLoginAt
                  ? `Signed in ${shortDateTime(account.lastLoginAt)}${account.lastLoginIp ? ` from ${account.lastLoginIp}` : ''}.`
                  : 'Has never signed in.'}
                {account.frozen && account.frozenReason ? ` Frozen: ${account.frozenReason}.` : ''}
              </p>

              {!self && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Link to={`/admin/audit?by=${account.id}`} className={`${buttonClass} flex items-center`}>
                    What they did
                  </Link>
                  <button
                    type="button"
                    onClick={() => run(api.post(`/api/superadmin/accounts/${account.id}/sign-out`, {}), `${account.name} was signed out`)}
                    className={buttonClass}
                  >
                    Sign out
                  </button>
                  {account.frozen ? (
                    <button
                      type="button"
                      onClick={() => run(api.post(`/api/superadmin/accounts/${account.id}/unfreeze`, {}), `${account.name} can sign in again`)}
                      className={buttonClass}
                    >
                      Unfreeze
                    </button>
                  ) : (
                    <button type="button" onClick={() => setDialog({ kind: 'freeze', account })} className={buttonClass}>
                      Freeze
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setNewRole(account.role);
                      setDialog({ kind: 'role', account });
                    }}
                    className={buttonClass}
                  >
                    Change role
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex flex-col gap-3 border-t border-rule pt-4 sm:flex-row sm:items-center">
        <button type="button" onClick={() => setDialog({ kind: 'signout-all' })} className={`${dangerButtonClass} sm:shrink-0`}>
          Sign everyone else out
        </button>
        <p className="min-w-0 flex-1 text-xs leading-5 text-muted">
          For &ldquo;I think somebody has a copy of a password&rdquo;, or after a restore. Everyone signs in
          again; you stay in.
        </p>
      </div>

      <ConfirmWith
        open={dialog?.kind === 'freeze'}
        title={`Freeze ${dialog?.account?.name || ''}?`}
        body="They are signed out at once and cannot sign in until you unfreeze them. They are shown the reason you write."
        confirmLabel="Freeze account"
        danger
        needs={{ reason: true, reasonLabel: 'Reason (the person will see this)' }}
        onCancel={() => setDialog(null)}
        onConfirm={({ reason }) =>
          viaDialog(
            () => api.post(`/api/superadmin/accounts/${dialog.account.id}/freeze`, { reason }),
            `${dialog.account.name} is frozen`
          )
        }
      />

      <ConfirmWith
        open={dialog?.kind === 'signout-all'}
        title="Sign everyone else out?"
        body="Every other account is signed out now and must enter its password again. Nothing is lost."
        confirmLabel="Sign them out"
        danger
        needs={{}}
        onCancel={() => setDialog(null)}
        onConfirm={() =>
          viaDialog(() => api.post('/api/superadmin/accounts/sign-out-all', {}), 'Everyone else has been signed out')
        }
      />

      <ConfirmWith
        open={dialog?.kind === 'role'}
        title={`Change ${dialog?.account?.name || ''}'s role`}
        body={
          <>
            <Field label="New role" htmlFor="new-role">
              <select
                id="new-role"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className={inputClass}
              >
                {roles.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABEL[role]}
                  </option>
                ))}
              </select>
            </Field>
            <p className="mt-2">
              They are signed out and come back with the new role. The change is written to the audit
              trail. Type your password to confirm.
            </p>
          </>
        }
        confirmLabel="Change role"
        needs={{ password: true }}
        onCancel={() => setDialog(null)}
        onConfirm={({ password }) =>
          viaDialog(
            () => api.patch(`/api/superadmin/accounts/${dialog.account.id}/role`, { role: newRole, password }),
            `${dialog.account.name} is now ${ROLE_LABEL[newRole].toLowerCase()}`
          )
        }
      />
    </Panel>
  );
}
