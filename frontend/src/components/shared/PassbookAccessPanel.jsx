import { useEffect, useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { useToast } from './Toast';

// What a member needs to open his own passbook: his ID, or his ID and his phone number.
//
// An ID number is on a card and in other people's phones, so on its own it is a weak door to a
// member's balance, fines and payments. With this switched on the passbook, and its two statement
// downloads, also ask for the phone number registered on his record. The group's documents, minutes
// and constitution stay on the ID alone: they are the group's papers, not one member's money.
//
// Off by default, and the super admin's to switch on. It is not safe to switch on blind: a member
// whose number on the register is out of date would be turned away from his own passbook, so check
// the numbers on the Members page first.
export default function PassbookAccessPanel() {
  const toast = useToast();
  const [on, setOn] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get('/api/settings')
      .then((res) => setOn(Boolean(res.data.settings?.passbookPhoneCheck)))
      .catch(() => setOn(false));
  }, []);

  async function toggle() {
    setBusy(true);
    try {
      await api.patch('/api/settings', { passbookPhoneCheck: !on });
      setOn(!on);
      toast(
        !on
          ? 'Members now need their phone number as well as their ID'
          : 'Members open their passbook with their ID alone'
      );
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="min-w-0 rounded-xl border border-rule bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Member passbook access</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
            Anyone who knows a member&apos;s ID number can open his passbook: his balance, his fines and
            what he has paid. Asking for the phone number registered on his record as well stops a
            stranger holding an ID from seeing it.
          </p>
        </div>
        {on !== null && (
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
              on ? 'bg-primary/10 text-primary' : 'border border-rule text-muted'
            }`}
          >
            {on ? 'ID and phone number' : 'ID only'}
          </span>
        )}
      </div>

      <p className="mt-3 rounded-xl border border-rule bg-canvas px-4 py-3 text-sm leading-6 text-muted">
        Before you switch this on, check that the phone numbers on the Members page are right. A member
        whose number is out of date will be turned away from his own passbook until it is corrected.
      </p>

      {on !== null && (
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          className={`mt-4 min-h-12 rounded-xl px-5 text-sm font-semibold disabled:opacity-60 ${
            on ? 'border border-alert text-alert' : 'bg-primary text-white'
          }`}
        >
          {busy ? 'Saving…' : on ? 'Go back to ID only' : 'Ask for the phone number as well'}
        </button>
      )}
    </section>
  );
}
