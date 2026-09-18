import { createContext, useCallback, useContext, useRef, useState } from 'react';

const ToastContext = createContext(null);

const SUCCESS_MS = 3500;
// Errors do not time out. A message that erases itself after three seconds has not
// been read by somebody on a slow link — he may still be looking at the button he
// pressed. It stays until dismissed, and it can carry a way back (see `action`).
const ERROR_MS = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // toast(message, 'error', { action: { label, onClick }, duration })
  // The third argument is optional and the second may be the options object
  // instead, so every existing toast(message) / toast(message, 'error') call site
  // keeps working unchanged.
  const toast = useCallback(
    (message, type = 'success', options = {}) => {
      const optionsObject = type && typeof type === 'object' ? type : options;
      const kind = type && typeof type === 'object' ? optionsObject.type || 'success' : type;
      const id = ++idRef.current;

      setToasts((prev) => [
        ...prev,
        { id, message, type: kind, action: optionsObject.action || null },
      ]);

      const duration =
        optionsObject.duration !== undefined
          ? optionsObject.duration
          : kind === 'error'
            ? ERROR_MS
            : SUCCESS_MS;

      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration)
        );
      }
      return id;
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {/* Sits above the bottom nav on mobile — and above a dialog, so a failure
          raised from inside a sheet is still readable. */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[70] flex flex-col items-center gap-2 px-4 md:bottom-6"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            // Errors are announced as they appear; a confirmation can wait for a pause.
            role={t.type === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg ${
              t.type === 'error' ? 'bg-alert' : 'bg-ink'
            }`}
          >
            <p className="min-w-0 flex-1 break-words">{t.message}</p>

            {t.action && (
              <button
                type="button"
                onClick={() => {
                  dismiss(t.id);
                  t.action.onClick?.();
                }}
                className="min-h-11 shrink-0 rounded-lg bg-white/15 px-3 text-sm font-semibold text-white"
              >
                {t.action.label}
              </button>
            )}

            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss message"
              className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-lg leading-none text-white/80"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
