// ── [PCODE-358 | S15 | v0.1.0] T35.6 Accessibility to WCAG 2.2 AA ──
//    Why:  a dialog takes the focus when it opens, keeps Tab inside, closes on Escape and gives the focus
//          back to where it was (WCAG 2.1.2, 2.4.3).
import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The elements Tab reaches inside a dialog, in order. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (e) => e.getClientRects().length > 0,
  );
}

/** Puts the ref on the dialog's outer element. */
export function useDialog<T extends HTMLElement>(onClose: () => void): RefObject<T | null> {
  const ref = useRef<T>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = focusables(el)[0];
    if (first) first.focus();
    else {
      el.tabIndex = -1;
      el.focus();
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = focusables(el);
      const head = list[0];
      const tail = list[list.length - 1];
      if (!head || !tail) return;
      if (e.shiftKey && document.activeElement === head) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && document.activeElement === tail) {
        e.preventDefault();
        head.focus();
      }
    };
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('keydown', onKey);
      if (before?.isConnected) before.focus();
    };
  }, []);
  return ref;
}
