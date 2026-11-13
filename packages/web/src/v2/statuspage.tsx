// ── [PCODE-420 | S15 | v0.1.0] T37 medium: English screens use English number and date formats ──
// ── [PCODE-341 | S15 | v0.1.0] T34.2b Public status pages per client and environment; incident update templates ──
//    Why:  the status page anyone may open at /status/<name>, with its components by environment and the
//          incidents in the client's words; its switch on the client's page; and the template picker that
//          fills an incident update from the incident.
import { fillUpdate } from '@orqiva/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { fmtLocale } from '../core/locale.js'; // [PCODE-420 | S15 | v0.1.0]

/** "/status/helio" → "helio". */
export const statusSlug = (path: string): string | null =>
  /^\/status\/([a-z0-9][a-z0-9-]{1,40})\/?$/.exec(path)?.[1] ?? null;

interface Component {
  id: string;
  name: string;
  environment: string | null;
  state: 'working' | 'slow' | 'down' | 'unknown';
  uptimePct: number | null;
  days: { day: string; state: string }[];
}
interface PublicPage {
  name: string;
  components: Component[];
  incidents: {
    id: string;
    title: string;
    state: string;
    update: string;
    updatedAt: string;
    openFor: string;
  }[];
}

const STATE_TEXT = { working: 'working', slow: 'slow', down: 'down', unknown: 'not known' };

/** The page's headline: all working, or the worst state there is. */
export function overall(cs: readonly { state: Component['state'] }[]): string {
  if (cs.some((c) => c.state === 'down')) return 'Some services are down';
  if (cs.some((c) => c.state === 'slow')) return 'Some services are slow';
  if (cs.length && cs.every((c) => c.state === 'working')) return 'All services are working';
  return 'Status not known right now';
}

/** The headline's colour: the worst state, or grey while nothing is known. */
export function level(
  cs: readonly { state: Component['state'] }[],
): 'down' | 'slow' | 'ok' | 'unknown' {
  if (cs.some((c) => c.state === 'down')) return 'down';
  if (cs.some((c) => c.state === 'slow')) return 'slow';
  return cs.length && cs.every((c) => c.state === 'working') ? 'ok' : 'unknown';
}

export function PublicStatusPage(props: { slug: string }): ReactNode {
  const env =
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('environment');
  const [d, setD] = useState<PublicPage | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const load = async (): Promise<void> => {
      const r = await api<PublicPage>(
        'GET',
        '/api/public/status/' + props.slug + (env ? '?environment=' + encodeURIComponent(env) : ''),
      );
      if (r.ok) setD(r.data);
      else setError(r.error.message);
    };
    void load();
    const t = window.setInterval(() => void load(), 60_000);
    return () => {
      window.clearInterval(t);
    };
  }, [props.slug, env]);
  if (error)
    return (
      <main className="pe-auth">
        <p className="pe-muted">{error}</p>
      </main>
    );
  if (!d) return <main className="pe-auth pe-muted">Loading…</main>;
  const groups = [...new Set(d.components.map((c) => c.environment ?? ''))];
  return (
    <main className="pe-spage">
      <h1>{d.name} · status</h1>
      <p className={'pe-spage-head pe-spage-head--' + level(d.components)}>
        {overall(d.components)}
      </p>
      {d.incidents.map((i) => (
        <section key={i.id} className="pe-spage-incident">
          <strong>{i.title}</strong>
          <p>{i.update}</p>
          <p className="pe-small pe-muted">
            {i.state} · open for {i.openFor} · updated{' '}
            {new Date(i.updatedAt).toLocaleString(fmtLocale())}
          </p>
        </section>
      ))}
      {groups.map((g) => (
        <section key={g} className="pe-spage-group">
          {g ? <h2>{g}</h2> : null}
          {d.components
            .filter((c) => (c.environment ?? '') === g)
            .map((c) => (
              <div key={c.id} className="pe-spage-row">
                <span className="pe-spage-name">{c.name}</span>
                <span className={'pe-spage-dot pe-spage-dot--' + c.state}>
                  {STATE_TEXT[c.state]}
                </span>
                <span
                  className="pe-spage-days"
                  aria-label={'30 days, ' + String(c.uptimePct ?? '—') + ' % up'}
                >
                  {c.days.map((x) => (
                    <i
                      key={x.day}
                      className={'pe-spage-day pe-spage-day--' + x.state}
                      title={x.day}
                    />
                  ))}
                </span>
                <span className="pe-small pe-muted">
                  {c.uptimePct === null ? '' : String(c.uptimePct).replace('.', ',') + ' %'}
                </span>
              </div>
            ))}
        </section>
      ))}
      <p className="pe-small pe-muted">Updated every minute.</p>
    </main>
  );
}

/** On the team's client page: open the page to everyone at a short name, or close it. */
export function StatusPageSettings(props: {
  base: string;
  clientId: string;
  isPublic: boolean;
  slug: string | null;
  onError: (m: string) => void;
}): ReactNode {
  const [on, setOn] = useState(props.isPublic);
  const [slug, setSlug] = useState(props.slug ?? '');
  const save = async (next: boolean): Promise<void> => {
    const r = await api<{ public: boolean; slug: string | null }>(
      'PUT',
      props.base + '/clients/' + props.clientId + '/status-page',
      { public: next, ...(slug.trim() ? { slug: slug.trim() } : {}) },
    );
    if (r.ok) setOn(r.data.public);
    else props.onError(r.error.message);
  };
  return (
    <div className="v2-inline pv-mt">
      <input
        className="v2-input v2-input--sm"
        aria-label="Short name of the public page"
        placeholder="short name, e.g. helio"
        value={slug}
        onChange={(e) => {
          setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
        }}
      />
      <label className="v2-check">
        <input type="checkbox" checked={on} onChange={(e) => void save(e.target.checked)} />
        Everyone may see the page
      </label>
      {on && slug ? (
        <a className="pv-small" href={'/status/' + slug} target="_blank" rel="noreferrer">
          /status/{slug}
        </a>
      ) : null}
    </div>
  );
}

interface Template {
  id: string | null;
  name: string;
  audience: 'team' | 'client';
  body: string;
}

/** The time of the next update in words, "14:30", from minutes ahead. */
export const nextAt = (minutes: string, now = new Date()): string =>
  minutes
    ? new Date(now.getTime() + Number(minutes) * 60_000).toLocaleTimeString(fmtLocale(), {
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'the next update';

export function TemplatePicker(props: {
  workspaceId: string;
  incident: {
    title: string;
    severityText: string;
    state: string;
    projectKey: string | null;
    environmentName: string | null;
  };
  next: string;
  onPick: (body: string, audience: 'team' | 'client') => void;
}): ReactNode {
  const [list, setList] = useState<Template[]>([]);
  useEffect(() => {
    void api<Template[]>(
      'GET',
      '/api/workspaces/' + props.workspaceId + '/incident-templates',
    ).then((r) => {
      if (r.ok) setList(r.data);
    });
  }, [props.workspaceId]);
  if (!list.length) return null;
  return (
    <select
      className="v2-input v2-input--sm"
      aria-label="Start from a template"
      value=""
      onChange={(e) => {
        const t = list.find((x) => x.name === e.target.value);
        if (!t) return;
        const i = props.incident;
        props.onPick(
          fillUpdate(t.body, {
            title: i.title,
            severity: i.severityText,
            state: i.state,
            next: nextAt(props.next),
            product: [i.projectKey, i.environmentName].filter(Boolean).join(' ') || 'the service',
          }),
          t.audience,
        );
      }}
    >
      <option value="">Start from a template…</option>
      {list.map((t) => (
        <option key={t.name} value={t.name}>
          {t.name}
        </option>
      ))}
    </select>
  );
}
