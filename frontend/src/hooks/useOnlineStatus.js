import { useEffect, useState } from 'react';

// Whether the browser thinks it is online, kept live through the two events that
// actually fire on a phone: `online` as the radio comes back, `offline` as it drops.
// It is not proof of reachability (a captive portal lies, so does a cell with no
// data left) but it is the one signal that separates "the app is broken" from
// "my bundle is finished", which is the difference a member feels.
export function useOnlineStatus() {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
