// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-151 | S15 | v0.1.0] Make the web app an installable PWA with Web Push ──
// ── [PCODE-113 | S15 | v0.1.0] Rebuild the web app shell: sidebar, top bar, page layout, design refresh ──
// ── [PCODE-118 | S15 | v0.1.0] Show and drive the lifecycle in the web app: stepper, stages, gate checklist and sign-off ──
// ── [PCODE-119 | S15 | v0.1.0] Add workspace lifecycle templates with an editor ──
// ── [PCODE-146 | S15 | v0.1.0] Show compliance, evidence packs and reviews in the web app ──
// ── [PCODE-142 | S15 | v0.1.0] Show security findings in the web app with Security agent triage ──
// ── [PCODE-138 | S15 | v0.1.0] Show tests, coverage and live runs in the web app ──
// ── [PCODE-134 | S15 | v0.1.0] Show environments, secrets and live deploys in the web app ──
// ── [PCODE-126 | S15 | v0.1.0] Show ideas, the interview, proposals and signing in the web app ──
// ── [PCODE-122 | S15 | v0.1.0] Show agents in the web app: agents page, ask from a task, live run view, approvals, card badge ──
//    Why:  the icons of the app, drawn for Orqiva on a 24 px grid with 1.8 px strokes (no icon font,
//          no icon library). They take the text colour (currentColor), so they follow the theme and the
//          state of the control around them; they are decoration, so screen readers skip them.
import type { ReactNode } from 'react';

const PATHS = {
  menu: 'M4 7h16M4 12h16M4 17h16',
  home: 'M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z',
  task: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8 12.5l2.6 2.6L16 9.7',
  folder:
    'M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4.4l2 2H19a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z',
  pulse: 'M3 12h4l2.5-6 4 12 2.5-6H21',
  settings:
    'M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6zM19.4 13.5l1.6 1.2-1.9 3.3-1.9-.7a7 7 0 0 1-2.1 1.2L14.8 20.5h-3.6l-.3-2a7 7 0 0 1-2.1-1.2l-1.9.7-1.9-3.3 1.6-1.2a7 7 0 0 1 0-2.4l-1.6-1.3 1.9-3.3 1.9.8a7 7 0 0 1 2.1-1.2l.3-2h3.6l.3 2a7 7 0 0 1 2.1 1.2l1.9-.8 1.9 3.3-1.6 1.3a7 7 0 0 1 0 2.4z',
  search: 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.3 15.3 20 20',
  help: 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17zM9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.6M12 16.8v.2',
  plus: 'M12 5v14M5 12h14',
  chevronDown: 'M7 10l5 5 5-5',
  chevronUp: 'M7 14l5-5 5 5', // [PCODE-119 | S15 | v0.1.0]
  chevronRight: 'M10 7l5 5-5 5',
  chevronLeft: 'M14 7l-5 5 5 5',
  close: 'M6 6l12 12M18 6 6 18',
  overview: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  // [PCODE-118 | S15 | v0.1.0] the lifecycle: steps joined by a path
  flow: 'M3.5 6.5h5v5h-5zM15.5 12.5h5v5h-5zM8.5 9h4a2 2 0 0 1 2 2v1.5M6 11.5V19h9.5',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.5M4.5 12h.5M4.5 18h.5',
  board: 'M4 4h4.5v16H4zM9.75 4h4.5v10h-4.5zM15.5 4H20v13h-4.5z',
  backlog: 'M4 6h16M4 10h16M4 14h10M4 18h7',
  git: 'M7 4.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM7 15.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM17 7.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM7 8.5v7M17 11.5c0 3-4 2.5-8.6 5',
  users:
    'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.5-3.4 3.2-5.5 6.5-5.5s6 2.1 6.5 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.8c1.9.8 3.2 2.6 3.5 5.2',
  person: 'M12 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5c.7-3.8 3.7-6 7.5-6s6.8 2.2 7.5 6',
  key: 'M8 14.5a4 4 0 1 1 3.4-6.1L20 8v3.5h-2.5V14H15v-2.6h-3.6A4 4 0 0 1 8 14.5zM7 10.5h.01',
  palette:
    'M12 3.5a8.5 8.5 0 0 0 0 17c1 0 1.6-.8 1.3-1.7-.4-1.2.4-2.3 1.7-2.3h2a3.5 3.5 0 0 0 3.5-3.5c0-5.2-3.8-9.5-8.5-9.5zM7.5 12h.01M9.5 8h.01M14.5 8h.01',
  mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
  logout: 'M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 8l-4 4 4 4M6 12h10',
  chart: 'M4 20h16M7 16v-5M12 16V7M17 16v-8',
  bolt: 'M13 3 5 13.5h6l-1 7.5 8-10.5h-6z',
  // [PCODE-146 | S15 | v0.1.0] scales
  scale: 'M12 4v16M7 20h10M5 7h14M5 7l-2.5 6a2.5 2.5 0 0 0 5 0zM19 7l-2.5 6a2.5 2.5 0 0 0 5 0z',
  // [PCODE-142 | S15 | v0.1.0] a shield
  shield: 'M12 3.5 19 6v5.5c0 4.4-3 7.8-7 9-4-1.2-7-4.6-7-9V6zM9 12l2 2 4-4',
  // [PCODE-138 | S15 | v0.1.0] a test flask
  flask:
    'M9.5 3.5h5M10.5 3.5v6L5 18.5a1.5 1.5 0 0 0 1.3 2h11.4a1.5 1.5 0 0 0 1.3-2l-5.5-9v-6M7.5 14.5h9',
  // [PCODE-134 | S15 | v0.1.0] a server
  server: 'M4 4.5h16v6H4zM4 13.5h16v6H4zM7.5 7.5h.01M7.5 16.5h.01M11 7.5h6M11 16.5h6',
  // [PCODE-126 | S15 | v0.1.0] an idea
  idea: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z',
  // [PCODE-122 | S15 | v0.1.0] an agent
  agent:
    'M8 8h8a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3zM12 4.5V8M9.5 13v.5M14.5 13v.5M2.5 12.5v3M21.5 12.5v3',
  dot: 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  archive: 'M4 5h16v4H4zM5.5 9v10h13V9M10 13h4',
  sun: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
  moon: 'M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z',
  monitor: 'M3.5 5h17v11h-17zM9 20h6M12 16v4',
  // [PCODE-151 | S15 | v0.1.0]
  // [PCODE-224 | S15 | v0.1.0]
  phone: 'M7.5 3h9a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon(props: { name: IconName; size?: number; className?: string }): ReactNode {
  const size = props.size ?? 20;
  return (
    <svg
      className={'pe-icon' + (props.className ? ' ' + props.className : '')}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[props.name]} />
    </svg>
  );
}

/** The Orqiva mark: a P on a tile with a live dot; colours come from the stylesheet (theme). */
export function Logo(props: { size?: number }): ReactNode {
  const size = props.size ?? 28;
  return (
    <svg
      className="pe-logo"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <rect className="pe-logo-tile" x="1" y="1" width="30" height="30" rx="8" />
      <path
        d="M10 22V10h6.5a4.5 4.5 0 0 1 0 9H10"
        className="pe-logo-mark"
        fill="none"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle className="pe-logo-dot" cx="22.5" cy="22.5" r="2.6" />
    </svg>
  );
}
