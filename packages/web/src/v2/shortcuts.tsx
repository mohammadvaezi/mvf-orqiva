// ── [PCODE-346 | S15 | v0.1.0] T35.1a Cmd-K over agents, runs, people and settings; keyboard shortcut sheet ──
//    Why:  the whole app from the keyboard: g and a letter goes to a section, Ctrl+K finds anything, and ?
//          shows every key in one sheet, with the board's keys too.
import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '../preview/ui.js';
import { KEYS } from './plankeys.js';

/** g then a letter: where it goes. */
export const GO_KEYS: [string, string, string][] = [
  ['h', 'Home', '/'],
  ['m', 'My work', '/my-work'],
  ['p', 'Projects', '/projects'],
  ['i', 'Inbox', '/inbox'],
  ['a', 'Agents', '/agents'],
  ['c', 'Clients', '/clients'],
  ['t', 'Time', '/time'],
  ['s', 'Settings', '/settings'],
];

export const GLOBAL_KEYS: [string, string][] = [
  ['Ctrl+K / ⌘K', 'find anything or run a command'],
  ['?', 'show these keys'],
  ...GO_KEYS.map(([k, label]): [string, string] => ['g ' + k, 'go to ' + label]),
];

/** The path a key press goes to after a g pressed within the last second and a half, or null. */
export function goTarget(
  prev: { key: string; at: number } | null,
  key: string,
  now: number,
): string | null {
  if (!prev || prev.key !== 'g' || now - prev.at > 1500) return null;
  return GO_KEYS.find(([k]) => k === key)?.[2] ?? null;
}

export function ShortcutSheet(props: { onClose: () => void }): ReactNode {
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const back = document.activeElement;
    card.current?.focus();
    return () => {
      if (back instanceof HTMLElement) back.focus();
    };
  }, []);
  const table = (rows: [string, string][]): ReactNode => (
    <table className="pv-table">
      <tbody>
        {rows.map(([k, what]) => (
          <tr key={k}>
            <td>
              <kbd className="pk-kbd">{k}</kbd>
            </td>
            <td>{what}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <div
      className="pk-help"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onKeyDown={(e) => {
        if (e.key === 'Escape') props.onClose();
      }}
    >
      <div ref={card} tabIndex={-1} className="pk-help-card pk-help-card--wide">
        <strong>Everywhere</strong>
        {table(GLOBAL_KEYS)}
        <strong>On the board and the backlog</strong>
        {table(KEYS.filter(([k]) => k !== '?'))}
        <Button size="sm" onClick={props.onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
