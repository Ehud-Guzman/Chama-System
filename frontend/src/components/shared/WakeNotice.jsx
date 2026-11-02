import { useSyncExternalStore } from 'react';
import { slowRequests } from '../../services/slowRequests';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

// Shown only when the server has been slow to answer (services/slowRequests), which in practice is the free host
// waking up after a quiet spell. It sits in the normal flow, like the offline band, so it never covers the page,
// and it says what is happening and how long to expect, because a loading screen that says nothing for half a
// minute reads as a broken site. Offline is the other band's business, not this one's.
export default function WakeNotice() {
  const slow = useSyncExternalStore(slowRequests.subscribe, slowRequests.isSlow, () => false);
  const online = useOnlineStatus();
  if (!slow || !online) return null;

  return (
    <p role="status" aria-live="polite" className="bg-surface px-4 py-2 text-center text-sm font-medium">
      Waking the system up. After a quiet spell this takes about 30 seconds, then it is quick again. Please wait.
    </p>
  );
}
