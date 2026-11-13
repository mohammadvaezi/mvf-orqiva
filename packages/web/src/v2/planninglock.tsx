// ── [PCODE-459 | S15 | v0.1.0] Planning in VS Code locks the project in the portal: banner on every tab, conflicting AI planning refused both ways ──
//    Why:  while Claude plans a project in VS Code (or the Planner agent plans it here), every tab of the
//          project says so, with what the AI did last and a link to the live run, so nobody starts the same
//          work twice. It follows the run's events: a step updates the line, the end removes the banner.
//          The server refuses conflicting planning work anyway; this is what people see before they try.
import type { ActivityEvent } from '@orqiva/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import type { EventHub } from '../core/hub.js';
import { Icon } from '../core/icons.js';
import { localTime } from '../core/format.js';

export interface PlanningLock {
  runId: string;
  source: 'local' | 'server';
  computer: string;
  by: string;
  startedAt: string;
  lastAt: string;
  lastStep: string | null;
  message: string;
}

const isRunEvent = (e: ActivityEvent): boolean =>
  e.type === 'orqiva.workspace.resync' || e.data.object.type === 'agent_run';

/** Who plans the project right now; null when nobody does. Reloads on every run event. */
export function usePlanningLock(
  workspaceId: string,
  projectId: string,
  hub: EventHub,
): PlanningLock | null {
  const [lock, setLock] = useState<PlanningLock | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async (): Promise<void> => {
      const r = await api<{ lock: PlanningLock | null }>(
        'GET',
        '/api/workspaces/' + workspaceId + '/projects/' + projectId + '/planning-lock',
      );
      if (alive && r.ok) setLock(r.data.lock);
    };
    void load();
    const off = hub.on((e) => {
      if (isRunEvent(e)) void load();
    });
    // a run that went quiet lets go after a while; look again now and then
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      alive = false;
      off();
      clearInterval(timer);
    };
  }, [workspaceId, projectId, hub]);
  return lock;
}

// ── [PCODE-459 | S15 | v0.1.0] the banner: where it is planned, by whom, what happens right now ──
export function PlanningLockBanner(props: {
  workspaceId: string;
  projectId: string;
  hub: EventHub;
  go: (path: string) => void;
}): ReactNode {
  const lock = usePlanningLock(props.workspaceId, props.projectId, props.hub);
  if (!lock) return null;
  return (
    <div className="pv-callout pv-callout--agent v2-planning-lock" role="status" aria-live="polite">
      <span className="pv-pulse" aria-hidden="true" />
      <div>
        <strong>
          {lock.source === 'local'
            ? 'Claude is planning this project in VS Code on ' + lock.computer
            : 'The Planner agent is planning this project'}
        </strong>
        <div className="pv-muted">
          {'Started by ' + lock.by + ' at ' + localTime(lock.startedAt)}
        </div>
        {lock.lastStep ? (
          <div className="pv-muted">
            Last step: <span translate="no">{lock.lastStep}</span>
          </div>
        ) : null}
        <div className="pv-muted">
          Planning tasks and documents waits until it is done, so nothing is planned twice.
        </div>
      </div>
      <button
        type="button"
        className="pv-btn pv-btn--ghost"
        onClick={() => {
          props.go('/runs/' + lock.runId);
        }}
      >
        <Icon name="agent" size={14} /> Watch it live
      </button>
    </div>
  );
}
