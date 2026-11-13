// ── [PCODE-436 | S15 | v0.1.0] T37 low: Untangle the three folder import cycles ──
//    Why:  the modal dialog of the old screens, also used by the new ones.
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from './icons.js';

/** A modal dialog: focus moves into it, Escape and the backdrop close it. */
export function Dialog(props: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      before?.focus();
    };
  }, []);
  return (
    <div
      className="pe-overlay pe-overlay--dialog"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        className="pe-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={ref}
      >
        <div className="pe-dialog-head">
          <h2 id={titleId}>{props.title}</h2>
          <button type="button" className="pe-icon-btn" aria-label="Close" onClick={props.onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="pe-dialog-body">{props.children}</div>
        {props.footer ? <div className="pe-dialog-foot">{props.footer}</div> : null}
      </div>
    </div>
  );
}
