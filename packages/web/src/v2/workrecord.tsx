// ── [PCODE-467 | S15 | v0.1.0] A project is planned for a client, and every task traces back to the client request it serves ──
// ── [PCODE-466 | S15 | v0.1.0] Every task shows its work record: AI, model, tokens, price, time and version, in VS Code and the portal ──
//    Why:  on the task's page, what the work took: the time, the version it was built on, which AI did it
//          (Claude Code in VS Code or an agent here), with which model, how many tokens and at what price.
//          The figures are the ones the project is analysed with afterwards; they follow the runs live.
import type { ActivityEvent } from '@orqiva/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import type { EventHub } from '../core/hub.js';

interface Work {
  // [PCODE-467 | S15 | v0.1.0] for whom
  client: string | null;
  internal: boolean;
  requests: { ref: string; title: string }[];
  versions: string[];
  time: { minutes: number; running: boolean; sessions: { by: string }[] };
  ai: {
    runs: { agent: string; source: string; model: string }[];
    tokensIn: number;
    tokensOut: number;
    cacheRead: number;
    cacheWrite: number;
    costUsd: number;
    costEur: number;
    models: string[];
  };
}

const isRunEvent = (e: ActivityEvent): boolean =>
  e.type === 'orqiva.workspace.resync' ||
  e.data.object.type === 'agent_run' ||
  e.data.object.type === 'item';

const tokens = (n: number): string =>
  n >= 1e6
    ? (n / 1e6).toFixed(1) + 'M'
    : n >= 1e4
      ? String(Math.round(n / 1000)) + 'k'
      : n.toLocaleString();
const hours = (m: number): string =>
  m < 60 ? String(m) + ' min' : String(Math.floor(m / 60)) + ' h ' + String(m % 60) + ' min';

export function ItemWork(props: { workspaceId: string; itemId: string; hub: EventHub }): ReactNode {
  const [w, setW] = useState<Work | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async (): Promise<void> => {
      const r = await api<Work>(
        'GET',
        '/api/workspaces/' + props.workspaceId + '/items/' + props.itemId + '/work',
      );
      if (alive && r.ok) setW(r.data);
    };
    void load();
    const off = props.hub.on((e) => {
      if (isRunEvent(e)) void load();
    });
    return () => {
      alive = false;
      off();
    };
  }, [props.workspaceId, props.itemId, props.hub]);
  if (!w) return null;
  const who = [...new Set(w.time.sessions.map((s) => s.by))].join(', ');
  const ai = [
    ...new Set(w.ai.runs.map((r) => (r.source === 'local' ? 'Claude Code in VS Code' : r.agent))),
  ].join(', ');
  return (
    <section aria-label="Work record" className="pe-panel">
      <div className="pe-panel-head">
        <h2 className="pe-panel-title">Work record</h2>
      </div>
      <dl className="pe-facts">
        <dt>For</dt>
        <dd>
          {w.internal
            ? 'An internal project (no client)'
            : !w.client
              ? 'No client yet'
              : w.requests.length
                ? w.client + ' · ' + w.requests.map((r) => r.ref + ' ' + r.title).join(', ')
                : w.client + ' · not requested by the client'}
        </dd>
        <dt>Time</dt>
        <dd>
          {hours(w.time.minutes) + (w.time.running ? ' (running)' : '') + (who ? ' · ' + who : '')}
        </dd>
        <dt>Version</dt>
        <dd>{w.versions.length ? w.versions.map((v) => 'v' + v).join(', ') : '—'}</dd>
        <dt>AI</dt>
        <dd>{ai || 'No AI work recorded yet'}</dd>
        {w.ai.runs.length ? (
          <>
            <dt>Model</dt>
            <dd translate="no">{w.ai.models.join(', ')}</dd>
            <dt>Tokens</dt>
            <dd>
              {tokens(w.ai.tokensIn) +
                ' in · ' +
                tokens(w.ai.tokensOut) +
                ' out · ' +
                tokens(w.ai.cacheRead) +
                ' from cache · ' +
                tokens(w.ai.cacheWrite) +
                ' to cache'}
            </dd>
            <dt>Price</dt>
            <dd>
              {w.ai.costEur.toFixed(2) +
                ' € ($' +
                w.ai.costUsd.toFixed(w.ai.costUsd < 1 ? 3 : 2) +
                ')'}
            </dd>
          </>
        ) : null}
      </dl>
    </section>
  );
}
