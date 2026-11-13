// ── [PCODE-411 | S15 | v0.1.0] T36.6 Keyboard-only and screen-reader passes ──
// ── [PCODE-271 | S15 | v0.1.0] Project tabs fixes from the deep UX check: handover double page, service accounts, lifecycle name, extraction duplicates, AI cases picker, webhook events, overdue sprint, tab overflow ──
// ── [PCODE-202 | S15 | v0.1.0] Fix project pages: duplicated tab bars, visible scrollbars, cut-off sidebar, narrow widths ──
// ── [PCODE-200 | S15 | v0.1.0] T16.4 Handover screens: design preview, team Handover tab, portal Handover section with signature ──
// ── [PCODE-172 | S15 | v0.1.0] B3.5 UI kit live in the web app: tokens with export, components, mockups with pins and approval, assets, contrast checks ──
// ── [PCODE-171 | S15 | v0.1.0] B3.4 Documents live in the web app: page tree, Markdown pages with editor, versions and diff, comments, templates, knowledge, health ──
// ── [PCODE-167 | S15 | v0.1.0] B2.3 Canvas live in the web app: Gantt with critical path and dependencies, baselines, scenarios, grid, workload and levelling, calendar ──
// ── [PCODE-166 | S15 | v0.1.0] B2.2 Planning live in the web app: sprint header, board, backlog, Planner draft, capacity, reports, retro ──
//    Why:  the project's tab bar of the approved design above every project page, so each section of a
//          project is one click away again (the v1 sidebar listed them). Tabs that later steps of phase B
//          rebuild open the pages built before until then; a client contact sees the portal's tabs only.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { projectPath, type ProjectViewKind } from '../core/nav.js';
import { PIcon, type PIconName } from '../preview/picons.js';

export const PROJECT_TABS_V2: {
  view: ProjectViewKind;
  label: string;
  icon: PIconName;
  team?: boolean;
  admin?: boolean;
}[] = [
  { view: 'overview', label: 'Overview', icon: 'overview' },
  { view: 'lifecycle', label: 'Lifecycle', icon: 'flag', team: true },
  { view: 'ideas', label: 'Ideation', icon: 'ideation', team: true },
  { view: 'planning', label: 'Planning', icon: 'planning' },
  // [PCODE-167 | S15 | v0.1.0]
  { view: 'canvas', label: 'Canvas', icon: 'canvas' },
  // [PCODE-171 | S15 | v0.1.0]
  { view: 'documents', label: 'Documents', icon: 'documents', team: true },
  // [PCODE-172 | S15 | v0.1.0]
  { view: 'uikit', label: 'UI kit', icon: 'uikit', team: true },
  { view: 'list', label: 'List', icon: 'overview' },
  { view: 'tests', label: 'Test', icon: 'test', team: true },
  // [PCODE-178 | S15 | v0.1.0]
  { view: 'versions', label: 'Versions', icon: 'versions', team: true },
  { view: 'security', label: 'Security', icon: 'security', team: true },
  // [PCODE-179 | S15 | v0.1.0]
  { view: 'codemap', label: 'Code map', icon: 'codemap', team: true },
  { view: 'compliance', label: 'Compliance', icon: 'signoff', team: true },
  // [PCODE-200 | S15 | v0.1.0]
  { view: 'handover', label: 'Handover', icon: 'approval', team: true },
  { view: 'git', label: 'Repositories', icon: 'git', team: true },
  { view: 'environments', label: 'Environments', icon: 'releases', team: true },
  { view: 'settings', label: 'Settings', icon: 'settings', admin: true },
];

/** The tab a view belongs to: board and backlog are part of the list views. */
export const tabOf = (view: ProjectViewKind): ProjectViewKind =>
  view === 'board' || view === 'backlog' ? 'list' : view;

/** [PCODE-411 | S15 | v0.1.0] Views that show the project header, whose title is the page's top heading. */
const HEADED = new Set<ProjectViewKind>([
  'overview',
  'lifecycle',
  'list',
  'board',
  'backlog',
  'git',
  'environments',
  'compliance',
  'settings',
]);

export function ProjectTabsV2(props: {
  projectId: string;
  view: ProjectViewKind;
  portal: boolean;
  role: string;
  go: (p: string) => void;
}): ReactNode {
  const admin = props.role === 'admin' || props.role === 'owner';
  const team = !props.portal && props.role !== 'guest';
  const tabs = PROJECT_TABS_V2.filter((t) => (t.admin ? admin : t.team ? team : true)).filter(
    (t) => !props.portal || t.view === 'overview' || t.view === 'list',
  );
  const here = tabOf(props.view);
  // [PCODE-202 | S15 | v0.1.0] the open tab is always in view, also at the end of a long bar
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    const active = bar.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (bar.current && active) {
      const b = bar.current;
      const left = active.offsetLeft - b.offsetLeft;
      if (left < b.scrollLeft || left + active.offsetWidth > b.scrollLeft + b.clientWidth)
        b.scrollLeft = Math.max(0, left - 24);
    }
  }, [here]);
  // [PCODE-271 | S15 | v0.1.0] fading edges say there are more tabs to the left or right
  const [more, setMore] = useState({ left: false, right: false });
  const measure = (): void => {
    const b = bar.current;
    if (!b) return;
    const left = b.scrollLeft > 4;
    const right = b.scrollLeft + b.clientWidth < b.scrollWidth - 4;
    setMore((m) => (m.left === left && m.right === right ? m : { left, right }));
  };
  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
    };
  }, [here, tabs.length]);
  // [PCODE-411 | S15 | v0.1.0] views without the project header still get a top heading for screen readers
  const heading = HEADED.has(props.view)
    ? null
    : (tabs.find((t) => t.view === here)?.label ?? null);
  return (
    <>
      {heading ? <h1 className="v2-visually-hidden">{heading}</h1> : null}
      <nav
        ref={bar}
        className={
          'pv-tabs v2-project-tabs' +
          (more.left ? ' v2-tabs--more-left' : '') +
          (more.right ? ' v2-tabs--more-right' : '')
        }
        aria-label="Project"
        onScroll={measure}
      >
        {tabs.map((t) => {
          const href = projectPath(props.projectId, t.view);
          return (
            <a
              key={t.view}
              href={href}
              className="pv-tab"
              aria-current={t.view === here ? 'page' : undefined}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey) return;
                e.preventDefault();
                props.go(href);
              }}
            >
              <PIcon name={t.icon} size={15} />
              {t.label}
            </a>
          );
        })}
      </nav>
    </>
  );
}
