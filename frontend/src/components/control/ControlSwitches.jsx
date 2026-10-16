import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { apiMessage } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../shared/Toast';
import { money } from '../../utils/format';
import { Panel, Pill, Toggle, Field, inputClass, primaryButtonClass, buttonClass } from './controlUi';

// The group-wide levers: maintenance mode, and the switches for the parts of the system a
// committee sometimes wants off — without anybody editing an environment variable and redeploying.
//
// Everything here is on the server and is audited: the trail reads "maintenance mode: off → on",
// not a snapshot of the whole settings document.

const SWITCHES = [
  {
    key: 'membersAreaEnabled',
    label: 'Members’ area',
    hint: 'Passbooks, documents, minutes and the constitution. Off while the books are being corrected; the front page still loads and says why.',
  },
  {
    key: 'fineEmailsEnabled',
    label: 'Fine emails',
    hint: 'The email a member gets when a fine is issued and when it is paid.',
  },
  {
    key: 'reminderEmailsEnabled',
    label: 'Reminder emails',
    hint: 'The treasurer’s send button and the weekly sweep. The sweep still reports who is behind; it just sends nothing.',
  },
  {
    key: 'constitutionVotingEnabled',
    label: 'Constitution voting',
    hint: 'Members approving or rejecting a chapter. Off while chapters are being redrafted.',
  },
];

export default function ControlSwitches({ overview, reload }) {
  const toast = useToast();
  const { refreshMe } = useAuth();
  const controls = overview.controls;
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(controls.maintenance.message);

  useEffect(() => {
    setMessage(controls.maintenance.message);
  }, [controls.maintenance.message]);

  async function send(key, request, done) {
    setBusy(key);
    try {
      await request();
      if (done) toast(done);
      await reload();
      // The banner at the top of every screen reads /me.
      await refreshMe();
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy('');
    }
  }

  const maintenanceOn = controls.maintenance.enabled;

  return (
    <div className="space-y-4">
      <Panel
        id="controls"
        title="Maintenance mode"
        intro="Everyone except you can read but not save — for the hour a restore or a correction is being done, so nobody’s payment is lost in the middle of it. Signing in always works."
        right={maintenanceOn ? <Pill tone="warn">On</Pill> : <Pill tone="quiet">Off</Pill>}
      >
        <Field
          label="What to tell people (optional)"
          htmlFor="maintenance-message"
          hint="Shown on every screen and in the refusal a treasurer gets if they try to save."
        >
          <input
            id="maintenance-message"
            value={message}
            maxLength={300}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="e.g. Checking the March figures"
            className={inputClass}
          />
        </Field>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy === 'maintenance'}
            onClick={() =>
              send(
                'maintenance',
                () => api.put('/api/superadmin/maintenance', { enabled: !maintenanceOn, message }),
                maintenanceOn ? 'Maintenance mode is off' : 'Maintenance mode is on'
              )
            }
            className={maintenanceOn ? buttonClass : primaryButtonClass}
          >
            {busy === 'maintenance' ? 'Saving…' : maintenanceOn ? 'Switch maintenance off' : 'Switch maintenance on'}
          </button>
          {maintenanceOn && message !== controls.maintenance.message && (
            <button
              type="button"
              onClick={() =>
                send('maintenance', () => api.put('/api/superadmin/maintenance', { enabled: true, message }), 'Message updated')
              }
              className={buttonClass}
            >
              Update the message
            </button>
          )}
        </div>
      </Panel>

      <Panel
        title="Switches"
        intro="Turn a part of the system off without a redeploy. All are on unless you say otherwise, and each change is in the audit trail."
      >
        <div className="grid gap-2 lg:grid-cols-2">
          {SWITCHES.map((item) => (
            <Toggle
              key={item.key}
              label={item.label}
              hint={item.hint}
              checked={controls.switches[item.key]}
              disabled={busy === item.key}
              onChange={(next) =>
                send(
                  item.key,
                  () => api.put('/api/superadmin/switches', { [item.key]: next }),
                  `${item.label} ${next ? 'on' : 'off'}`
                )
              }
            />
          ))}
        </div>
      </Panel>

      <Panel
        title="The group’s rules"
        intro="Changing the week cycle or anyone’s opening balance moves every balance on the books, so it is done where the change is checked before it is saved — not here. This is where it stands."
        right={
          <Link to="/admin/finance/setup" className={`${buttonClass} flex items-center`}>
            Open Finance → Setup
          </Link>
        }
      >
        <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Weekly contribution', money(controls.cycle.weeklyAmount)],
            ['of which tea', money(controls.cycle.chaiAmount)],
            ['Cycle starts at week', controls.cycle.cycleStartWeek],
            ['Weeks counted from', controls.cycle.weekAnchorDate || '—'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-rule px-3 py-2">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="amount mt-0.5 text-sm font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs leading-5 text-muted">
          Two-factor sign-in is {controls.twoFactorAuthEnabled ? 'on' : 'off'} for the group.{' '}
          <Link to="/admin/settings#security" className="font-semibold text-primary">
            Change it in Settings → Security
          </Link>
          . The members&apos; phone-number check is {controls.passbookPhoneCheck ? 'on' : 'off'}.{' '}
          <Link to="/admin/settings#passbook" className="font-semibold text-primary">
            Change it in Settings → Passbook access
          </Link>
          .
        </p>
      </Panel>
    </div>
  );
}
