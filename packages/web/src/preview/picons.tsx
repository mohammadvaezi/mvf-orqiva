// ── [PCODE-153 | S15 | v0.1.0] D1 preview: design system v2, shell, Cmd-K, Home, Inbox, project overview ──
//    Why:  the icon set of the preview: one 24-unit grid, 1.75 stroke, round caps, drawn here so nothing
//          ships from an icon library. Every section of the map and every inbox kind has its own glyph.
import type { ReactNode } from 'react';

const P = {
  home: 'M4 11 12 4l8 7v8.5a.5.5 0 0 1-.5.5H15v-6H9v6H4.5a.5.5 0 0 1-.5-.5z',
  // [PCODE-235 | S15 | v0.1.0] conversations
  chat: 'M4 5.5h16v10.5H10l-4.5 3.5V16H4zM8 9.5h8M8 12.5h5',
  inbox: 'M3.5 13.5 6 5h12l2.5 8.5M3.5 13.5V19h17v-5.5M3.5 13.5h5l1.5 2.5h4l1.5-2.5h5',
  projects: 'M3.5 6.5h6l2 2h9v10h-17zM3.5 6.5v-1h6',
  agents:
    'M8 8h8a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3zM12 4.5V8M9.5 13v.5M14.5 13v.5',
  activity: 'M3 12h4l2.5-6 5 12 2.5-6h4',
  people:
    'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.5-3.5 3.2-5.5 6.5-5.5s6 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 6.5M18.5 14.5c1.8.7 2.8 2.6 3 5.5',
  tokens:
    'M12 3.5c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6.5v5c0 1.7 3.6 3 8 3s8-1.3 8-3v-5M4 11.5v5c0 1.7 3.6 3 8 3s8-1.3 8-3v-5',
  releases:
    'M5 19c1-4 3-6 6-7l-3-3c-2 1-4 0-4 0s0-4 4-5c3 3 6 3 9 3 1 3 1 6-2 9 0 0 1 2 0 4l-3-3c-1 3-3 5-7 6zM14.5 9.5h.01',
  insights: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  clients: 'M4 8h16v11H4zM9 8V5.5h6V8M4 13h16',
  incidents: 'M12 4 21 19.5H3zM12 10v4M12 17v.01',
  time: 'M12 21a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 8v4.5l3 2',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13.5l1.6 1.2-2 3.4-1.9-.8a7 7 0 0 1-2 1.2L14.8 21h-4l-.3-2.5a7 7 0 0 1-2-1.2l-2 .8-2-3.4 1.6-1.2a7 7 0 0 1 0-2.4L4.5 9.9l2-3.4 2 .8a7 7 0 0 1 2-1.2L10.8 3.5h4l.3 2.6a7 7 0 0 1 2 1.2l1.9-.8 2 3.4-1.6 1.2a7 7 0 0 1 0 2.4z',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5 20.5 20.5',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12.5 10 17.5 19.5 7',
  x: 'M6 6l12 12M18 6 6 18',
  clock: 'M12 21a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 8v4.5l3 2',
  chevronDown: 'M6 9.5 12 15.5 18 9.5',
  chevronRight: 'M9.5 6 15.5 12 9.5 18',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  ide: 'M8 8 4 12l4 4M16 8l4 4-4 4M13.5 5 10.5 19',
  git: 'M6 4v10M6 14a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 8c0 5-6 4-12 6',
  review:
    'M3.5 12s3-6.5 8.5-6.5 8.5 6.5 8.5 6.5-3 6.5-8.5 6.5S3.5 12 3.5 12zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  approval: 'M12 3.5 19.5 6v5.5c0 4.5-3.2 8-7.5 9-4.3-1-7.5-4.5-7.5-9V6zM8.5 12l2.5 2.5 4.5-5',
  mention: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1',
  question:
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17v.01',
  signoff: 'M4 19.5h16M6 15.5l9.5-9.5 3 3L9 18.5H6zM13.5 8l3 3',
  request: 'M5 4.5h14v12H9.5L5 20.5zM9 9h6M9 12.5h4',
  test: 'M9.5 3.5h5M10.5 3.5v6L5 19a1 1 0 0 0 .9 1.5h12.2A1 1 0 0 0 19 19l-5.5-9.5v-6M7.5 14.5h9',
  incident: 'M12 4 21 19.5H3zM12 10v4M12 17v.01',
  snooze: 'M12 21a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM9.5 9.5h5l-5 5h5',
  sun: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
  moon: 'M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z',
  euro: 'M17.5 6.5A7 7 0 1 0 17.5 17.5M4 10.5h9M4 13.5h9',
  sparkle:
    'M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
  ideation:
    'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z',
  planning: 'M4 5.5h16v14H4zM4 9.5h16M8.5 3.5v4M15.5 3.5v4M8 13h3M8 16h6',
  canvas: 'M4 6h7M7 10.5h9M10 15h10M4 19.5h16M4 4v16',
  documents: 'M6.5 3.5h7l4 4V20.5h-11zM13.5 3.5v4h4M9 12h6M9 15.5h6',
  uikit:
    'M12 3.5a8.5 8.5 0 1 0 0 17c1.1 0 1.5-.8 1.5-1.5 0-1.6-1.3-1.7-1.3-3 0-1 .8-1.5 1.8-1.5H17a3.5 3.5 0 0 0 3.5-3.5c0-4.3-3.8-7.5-8.5-7.5zM7.5 11.5h.01M10 7.5h.01M15 7.5h.01',
  versions:
    'M6 4v10M6 14a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 8c0 5-6 4-12 6',
  security: 'M12 3.5 19.5 6v5.5c0 4.5-3.2 8-7.5 9-4.3-1-7.5-4.5-7.5-9V6z',
  codemap: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  overview: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  external: 'M13.5 4.5h6v6M19.5 4.5l-8 8M17 14v5.5H4.5V7H10',
  filter: 'M4 5h16l-6 7.5V19l-4 1.5v-8z',
  more: 'M5.5 12h.01M12 12h.01M18.5 12h.01',
  play: 'M7 4.5v15l12-7.5z',
  pause: 'M8 5v14M16 5v14',
  stop: 'M6 6h12v12H6z',
  flag: 'M5 21V4M5 4.5h12l-2 4 2 4H5',
  live: 'M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM7 7a7 7 0 0 0 0 10M17 7a7 7 0 0 1 0 10M4.2 4.2a11 11 0 0 0 0 15.6M19.8 4.2a11 11 0 0 1 0 15.6',
  keyboard: 'M3 6.5h18v11H3zM7 10h.01M11 10h.01M15 10h.01M7.5 14h9',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5c.6-4 3.6-6.5 7.5-6.5s6.9 2.5 7.5 6.5',
  lock: 'M6 10.5h12v10H6zM8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5',
} as const;

export type PIconName = keyof typeof P;

export function PIcon(props: { name: PIconName; size?: number; className?: string }): ReactNode {
  const size = props.size ?? 18;
  return (
    <svg
      className={'pv-icon' + (props.className ? ' ' + props.className : '')}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={P[props.name]} />
    </svg>
  );
}
