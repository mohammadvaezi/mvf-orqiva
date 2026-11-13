// ── [PCODE-164 | S15 | v0.1.0] B1.3 The v2 shell live in the web app: Home per role, Inbox, Clients, portal mode, settings ──
//    Why:  the sidebar already shows the whole approved map; a section that a later step of phase B makes
//          live says which step brings it and opens its approved design in the preview meanwhile.
import type { ReactNode } from 'react';
import type { LaterSection } from '../core/nav.js';
import { PIcon, type PIconName } from '../preview/picons.js';
import { Card, PageHead } from '../preview/ui.js';

export const LATER: Record<
  LaterSection,
  { title: string; icon: PIconName; step: string; what: string }
> = {
  releases: {
    title: 'Releases',
    icon: 'releases',
    step: 'B4',
    what: 'release trains, versions, changelogs and the deploy calendar',
  },
  incidents: {
    title: 'Incidents',
    icon: 'incidents',
    step: 'B7',
    what: 'on-call, severity, timelines and post-mortems',
  },
  time: {
    title: 'Time',
    icon: 'time',
    step: 'B7',
    what: 'time tracked per task and client, timesheets and approvals',
  },
  insights: {
    title: 'Insights',
    icon: 'insights',
    step: 'B6',
    what: 'delivery metrics, DORA, agent and team throughput',
  },
  tokens: {
    title: 'Tokens and costs',
    icon: 'tokens',
    step: 'B5',
    what: 'AI spend in euro per project, model and agent, budgets and access tokens',
  },
  people: {
    title: 'People',
    icon: 'people',
    step: 'B5',
    what: 'roles, teams, capacity and skills',
  },
};

export function LaterPage(props: { section: LaterSection; go: (p: string) => void }): ReactNode {
  const l = LATER[props.section];
  const preview = '/preview/' + props.section;
  return (
    <div className="pv-page">
      <PageHead title={l.title} sub={'Live with step ' + l.step + ' of phase B'} icon={l.icon} />
      <Card>
        <div className="pv-empty">
          <PIcon name={l.icon} size={28} />
          <strong>
            {l.title} comes with step {l.step}.
          </strong>
          <span>It brings {l.what}. The approved design is in the preview, with sample data.</span>
          <a
            href={preview}
            className="pv-btn pv-btn--secondary"
            onClick={(e) => {
              e.preventDefault();
              props.go(preview);
            }}
          >
            <PIcon name="external" size={16} /> Open the design in the preview
          </a>
        </div>
      </Card>
    </div>
  );
}
