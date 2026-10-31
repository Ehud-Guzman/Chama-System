import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Whether an element can take focus right now: not `hidden`, not display:none or visibility:hidden, not an
// `<input type=hidden>`, and not inside something marked aria-hidden.
function isFocusable(el) {
  if (el.hidden || el.getAttribute('aria-hidden') === 'true' || el.type === 'hidden') return false;
  if (el.closest('[hidden], [aria-hidden="true"]')) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  return el.getClientRects().length > 0;
}

// Shared modal/dialog behavior: focuses the panel on open, traps Tab/Shift+Tab
// inside it, closes on Escape, locks background scroll while open, and
// restores focus to whatever had it once closed. Attach `containerRef` to
// the dialog's outer panel element. Pass `initialFocusRef` to focus a
// specific element (e.g. the primary action) instead of the first
// focusable one.
export function useModal(open, onClose, initialFocusRef) {
  const containerRef = useRef(null);
  const previouslyFocused = useRef(null);
  // The latest close handler, read when Escape is pressed. Held in a ref so that a parent which passes a new
  // arrow function on every render (`onCancel={() => setShow(false)}`) does not make this effect run again: every
  // run gave focus back to the button that opened the dialog and then took it again.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    previouslyFocused.current = document.activeElement;

    // Only what can actually take focus right now. A `hidden` file input is the first match in a form with a photo
    // picker: focusing it silently does nothing, so focus never moved into the dialog, and Shift+Tab from the real
    // first field did not wrap, so it could leave the dialog.
    const getFocusable = () =>
      containerRef.current
        ? Array.from(containerRef.current.querySelectorAll(FOCUSABLE_SELECTOR)).filter(isFocusable)
        : [];
    const target = initialFocusRef?.current || getFocusable()[0];
    (target || containerRef.current)?.focus();

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        onCloseRef.current?.();
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
  }, [open]);

  return containerRef;
}
