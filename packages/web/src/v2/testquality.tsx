// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-315 | S15 | v0.1.0] T32.3a Cypress and Allure import, defects in the trace, leakage and burndown ──
//    Why:  reports of the common test tools come in from the browser (Allure as its many result files at
//          once), and the Quality view says how well each release was tested: the bugs its runs caught
//          against those found after it shipped, and its planned cases burned down day by day.
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Card, Chip } from '../preview/ui.js';

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;

export type ReportFormat = 'playwright' | 'cypress' | 'allure';

const FORMATS: { key: ReportFormat; label: string; hint: string }[] = [
  { key: 'playwright', label: 'Playwright', hint: 'The JSON reporter’s file (--reporter=json).' },
  {
    key: 'cypress',
    label: 'Cypress',
    hint: 'The mochawesome JSON report (merged with mochawesome-merge for several specs).',
  },
  {
    key: 'allure',
    label: 'Allure',
    hint: 'The -result.json files of the allure-results folder; pick them all at once.',
  },
];

/** The body the import route takes for the files read; or what is wrong with them. */
export function importBody(
  format: ReportFormat,
  files: readonly { name: string; text: string }[],
): { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  const parsed: unknown[] = [];
  for (const f of files) {
    try {
      parsed.push(JSON.parse(f.text));
    } catch {
      return { ok: false, error: f.name + ' is not JSON' };
    }
  }
  const first = files[0];
  if (!first) return { ok: false, error: 'Pick a file' };
  if (format === 'allure') {
    const results = parsed.flatMap((p): unknown[] => (Array.isArray(p) ? (p as unknown[]) : [p]));
    return {
      ok: true,
      body: { format, name: 'Allure ' + String(results.length) + ' results', report: { results } },
    };
  }
  if (files.length > 1) return { ok: false, error: 'One report file at a time' };
  return {
    ok: true,
    body: { format, name: first.name.replace(/\.json$/i, ''), report: parsed[0] },
  };
}

/** A test report into a finished run. */
export function ImportReport(props: {
  workspaceId: string;
  projectId: string;
  onDone: () => void;
}): ReactNode {
  const [format, setFormat] = useState<ReportFormat>('playwright');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const read = async (list: FileList): Promise<void> => {
    setBusy(true);
    setError(null);
    const files = await Promise.all(
      [...list].map(async (f) => ({ name: f.name, text: await f.text() })),
    );
    const b = importBody(format, files);
    if (!b.ok) {
      setError(b.error);
      setBusy(false);
      return;
    }
    const r = await api(
      'POST',
      W(props.workspaceId, '/projects/' + props.projectId + '/test-runs/import'),
      b.body,
    );
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    else props.onDone();
  };
  const f = FORMATS.find((x) => x.key === format) ?? FORMATS[0];
  return (
    <Card title="Import a test report">
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="v2-inline">
        <select
          className="v2-input v2-input--sm"
          aria-label="Report format"
          value={format}
          onChange={(e) => {
            setFormat(e.target.value as ReportFormat);
          }}
        >
          {FORMATS.map((x) => (
            <option key={x.key} value={x.key}>
              {x.label}
            </option>
          ))}
        </select>
        <input
          type="file"
          accept="application/json,.json"
          multiple={format === 'allure'}
          aria-label="Test report"
          disabled={busy}
          onChange={(e) => {
            if (e.target.files?.length) void read(e.target.files);
          }}
        />
      </div>
      <p className="pv-muted pv-small">
        {f?.hint} The report becomes a finished run; tests the repository does not know yet become
        automated cases in their suite.
      </p>
    </Card>
  );
}

interface ReleaseQuality {
  id: string;
  version: string;
  component: string | null;
  state: string;
  releasedAt: string | null;
  runs: number;
  caught: number;
  escaped: number;
  leakage: number | null;
}
interface Burndown {
  version: string;
  planned: number;
  days: { day: string; remaining: number; passed: number; failed: number }[];
}

/** Points of a line through the values, in a box of the size given, the top being the maximum. */
export function linePoints(values: readonly number[], max: number, w: number, h: number): string {
  if (!values.length) return '';
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  return values
    .map(
      (v, i) =>
        String(Math.round(i * step * 10) / 10) +
        ',' +
        String(Math.round((h - (max ? (v / max) * h : 0)) * 10) / 10),
    )
    .join(' ');
}

function BurndownChart(props: { b: Burndown }): ReactNode {
  const w = 560;
  const h = 140;
  const max = Math.max(1, props.b.planned);
  // a line needs two points: one day of testing starts from all the planned cases
  const days =
    props.b.days.length === 1
      ? [{ day: '', remaining: props.b.planned, passed: 0, failed: 0 }, ...props.b.days]
      : props.b.days;
  return (
    <figure className="v2-tq-chart">
      <svg
        viewBox={'-8 -8 ' + String(w + 16) + ' ' + String(h + 16)}
        role="img"
        aria-label={'Burndown of ' + props.b.version}
      >
        <line className="v2-tq-axis" x1={0} y1={h} x2={w} y2={h} />
        <polyline
          className="v2-tq-ideal"
          points={linePoints(
            days.map((_, i) => max - (max * i) / Math.max(1, days.length - 1)),
            max,
            w,
            h,
          )}
        />
        <polyline
          className="v2-tq-left"
          points={linePoints(
            days.map((d) => d.remaining),
            max,
            w,
            h,
          )}
        />
        <polyline
          className="v2-tq-failed"
          points={linePoints(
            days.map((d) => d.failed),
            max,
            w,
            h,
          )}
        />
      </svg>
      <figcaption className="pv-small pv-muted">
        <span className="v2-tq-key v2-tq-key--left" /> still to run ·{' '}
        <span className="v2-tq-key v2-tq-key--failed" /> failing ·{' '}
        <span className="v2-tq-key v2-tq-key--ideal" /> an even pace · {props.b.days[0]?.day ?? ''}{' '}
        to {props.b.days.at(-1)?.day ?? ''}
      </figcaption>
    </figure>
  );
}

/** How well each release was tested. */
export function TestQuality(props: { workspaceId: string; projectId: string }): ReactNode {
  const [releases, setReleases] = useState<ReleaseQuality[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [burn, setBurn] = useState<Burndown | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api<{ releases: ReleaseQuality[] }>(
      'GET',
      W(props.workspaceId, '/projects/' + props.projectId + '/test-quality'),
    ).then((r) => {
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      setReleases(r.data.releases);
      setOpen((o) => o ?? r.data.releases.find((x) => x.runs)?.id ?? null);
    });
  }, [props.workspaceId, props.projectId]);
  useEffect(() => {
    setBurn(null);
    if (!open) return;
    void api<Burndown>('GET', W(props.workspaceId, '/releases/' + open + '/test-burndown')).then(
      (r) => {
        if (r.ok) setBurn(r.data);
      },
    );
  }, [props.workspaceId, open]);
  if (!releases) return <p className="pv-muted">{error ?? 'Loading…'}</p>;
  return (
    <div className="pv-stack">
      <Card flush title="Defect leakage by release">
        {releases.length ? (
          <table className="pv-table">
            <thead>
              <tr>
                <th>Release</th>
                <th className="pv-num">Test runs</th>
                <th className="pv-num">Bugs caught</th>
                <th className="pv-num">Found after shipping</th>
                <th className="pv-num">Leakage</th>
              </tr>
            </thead>
            <tbody>
              {releases.map((r) => (
                <tr key={r.id} aria-selected={open === r.id}>
                  <td>
                    <button
                      type="button"
                      className="pv-link-btn"
                      onClick={() => {
                        setOpen(r.id);
                      }}
                    >
                      {r.component ? r.component + ' ' : ''}
                      {r.version}
                    </button>{' '}
                    <Chip tone={r.state === 'released' ? 'success' : 'neutral'}>{r.state}</Chip>
                  </td>
                  <td className="pv-num">{r.runs}</td>
                  <td className="pv-num">{r.caught}</td>
                  <td className="pv-num">{r.releasedAt ? r.escaped : '—'}</td>
                  <td className="pv-num">
                    {r.leakage === null ? (
                      '—'
                    ) : (
                      <Chip
                        tone={r.leakage > 30 ? 'danger' : r.leakage > 10 ? 'warning' : 'success'}
                      >
                        {String(r.leakage)} %
                      </Chip>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="pv-empty">No releases yet.</p>
        )}
        <p className="pv-small pv-muted v2-tq-note">
          Caught: bugs filed from the release’s test runs. Found after shipping: bugs written after
          it was released and before the next release, that no test had found.
        </p>
      </Card>
      {burn ? (
        <Card
          title={
            'Burndown · ' +
            burn.version +
            ' · ' +
            String(burn.planned) +
            (burn.planned === 1 ? ' planned case' : ' planned cases')
          }
        >
          {burn.days.length ? (
            <BurndownChart b={burn} />
          ) : (
            <p className="pv-empty">No test runs are planned for this release.</p>
          )}
        </Card>
      ) : null}
    </div>
  );
}
