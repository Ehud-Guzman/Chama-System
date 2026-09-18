import { useOnlineStatus } from '../../hooks/useOnlineStatus';

// A thin band at the top of whatever is on screen. It sits in the normal flow
// rather than floating over it, so it can never cover the page it is warning about,
// and it scrolls away with the rest of the page once it has been read.
export default function OfflineBanner() {
  const online = useOnlineStatus();

  if (online) return null;

  return (
    <p
      role="status"
      aria-live="polite"
      className="bg-alert px-4 py-2 text-center text-sm font-medium text-white"
    >
      You are offline. Anything you send now will not be saved.
    </p>
  );
}
