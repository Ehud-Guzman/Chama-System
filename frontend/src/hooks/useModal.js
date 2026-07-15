import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Shared modal/dialog behavior: focuses the panel on open, traps Tab/Shift+Tab
// inside it, closes on Escape, locks background scroll while open, and
// restores focus to whatever had it once closed. Attach `containerRef` to
// the dialog's outer panel element. Pass `initialFocusRef` to focus a
// specific element (e.g. the primary action) instead of the first
// focusable one.
export function useModal(open, onClose, initialFocusRef) {
  const containerRef = useRef(null);
  const previouslyFocused = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    previouslyFocused.current = document.activeElement;

    const getFocusable = () =>
      containerRef.current
        ? Array.from(containerRef.current.querySelectorAll(FOCUSABLE_SELECTOR))
        : [];
    const target = initialFocusRef?.current || getFocusable()[0];
    (target || containerRef.current)?.focus();

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        onClose?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = getFocusable();
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  return containerRef;
}
