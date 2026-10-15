import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { idleStage } from '../../utils/idleTimeout';
import Modal from '../shared/Modal';

// Signs an unattended session out, with a minute's warning.
//
// "Activity" is any tap, key press or scroll, and it is remembered in the browser's storage rather
// than in this component, so a second tab of the app that is being used keeps the first one alive
// instead of signing it out from under somebody. Anything unsent in the offline outbox stays where
// it is: signing out removes the session, not the queue, and it is sent at the next sign-in.
const KEY = 'cm_last_active';
const EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart'];

function readLast() {
  try {
    return Number(localStorage.getItem(KEY));
  } catch {
    return NaN;
  }
}

function writeLast(now) {
  try {
    localStorage.setItem(KEY, String(now));
  } catch {
    // No storage: the in-memory copy below still ends an idle session in this tab.
  }
}

export default function IdleGuard() {
  const { logout } = useAuth();
  const memory = useRef(Date.now());
  const lastWrite = useRef(0);
  const [warning, setWarning] = useState(null);

  const touch = useCallback(() => {
    const now = Date.now();
    memory.current = now;
    // Writing storage on every scroll event would be a write per frame; once a few seconds is as
    // good as the limit is thirty minutes.
    if (now - lastWrite.current > 5000) {
      lastWrite.current = now;
      writeLast(now);
    }
  }, []);

  useEffect(() => {
    touch();
    for (const name of EVENTS) window.addEventListener(name, touch, { passive: true });

    function check() {
      // The later of this tab's own activity and whatever another tab recorded.
      const last = Math.max(memory.current, readLast() || 0);
      const { stage, secondsLeft } = idleStage({ lastActive: last });
      if (stage === 'expired') {
        setWarning(null);
        logout();
      } else if (stage === 'warning') {
        setWarning(secondsLeft);
      } else {
        setWarning(null);
      }
    }

    const timer = setInterval(check, 5000);
    // A tab that was in the background has had its timers throttled; look the moment it returns.
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      for (const name of EVENTS) window.removeEventListener(name, touch);
    };
  }, [touch, logout]);

  if (warning === null) return null;

  return (
    <Modal
      className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/40 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:items-center"
      role="alertdialog"
      aria-modal="true"
      aria-label="Still there?"
    >
      <div className="w-full max-w-sm rounded-xl bg-surface p-5 shadow-xl">
        <h2 className="text-base font-semibold">Still there?</h2>
        <p className="mt-2 text-sm text-muted">
          You have not touched the screen for a while. For the books' sake you will be signed out in{' '}
          <span className="amount font-semibold text-ink">{warning}</span> {warning === 1 ? 'second' : 'seconds'}.
          Anything not yet sent stays saved on this device.
        </p>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={() => {
              touch();
              setWarning(null);
            }}
            className="min-h-11 flex-1 rounded-lg bg-primary px-4 text-sm font-semibold text-white"
          >
            Stay signed in
          </button>
          <button
            type="button"
            onClick={logout}
            className="min-h-11 flex-1 rounded-lg border border-rule bg-surface px-4 text-sm font-medium"
          >
            Sign out
          </button>
        </div>
      </div>
    </Modal>
  );
}
