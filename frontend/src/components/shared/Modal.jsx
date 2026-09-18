import { createPortal } from 'react-dom';

// Every dialog in this app is portaled to <body>. Two reasons, both phone-shaped:
//
//   1. The fixed bottom navigation is rendered after <main> in the same stacking
//      context. At an equal z-index the later element wins, so every bottom sheet
//      sat *under* the nav bar and its Cancel/Confirm row was covered by it.
//   2. A dialog rendered inside a page inherits that page's stacking context, which
//      is how a modal ends up underneath a relative/sticky section (AddAdminForm
//      used to need a `z-40` hack for exactly this).
//
// Rendering outside the page removes both classes of bug for every caller, without
// anyone having to reason about z-index again.
export default function Modal({ children, onBackdropClick, className = '', ...rest }) {
  return createPortal(
    <div
      className={className}
      onClick={(event) =>
        event.target === event.currentTarget && onBackdropClick?.()
      }
      {...rest}
    >
      {children}
    </div>,
    document.body
  );
}
