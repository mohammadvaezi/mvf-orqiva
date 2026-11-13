// ── [PCODE-276 | S15 | v0.1.0] T28.5 Idea estimates: size, confidence range from estimate vs actual, basis from similar past tasks ──
// ── [PCODE-275 | S15 | v0.1.0] T28.4 PRD: templates per idea kind, citations per statement, version diff, MD, PDF and Word export ──
//    Why:  the PRD page's new parts: each statement's citations as chips that show the requirement and the
//          exact passage it rests on, how many statements are cited, the template's sections, two versions
//          compared part by part, and the exports (Markdown, Word, Gherkin; PDF printed from the page).
import {
  citeParts,
  proposalDiff,
  type PartDiff,
  type PrdRef,
  type ProposalContent,
  type ProposalSection,
  type Scenario,
  type TemplateSection,
} from '@orqiva/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from './core/api.js';

const W = (workspaceId: string, path: string): string => '/api/workspaces/' + workspaceId + path;

export interface PrdInfo {
  version: number;
  kind: string;
  template: TemplateSection[];
  refs: PrdRef[];
  report: { total: number; cited: number; uncited: { path: string; part: string; text: string }[] };
  stories: { code: string; text: string; persona: string; scenarios: Scenario[] }[];
}

/** What a version rests on; reloaded when the version shown changes. */
export function usePrd(
  workspaceId: string,
  ideaId: string,
  version: number | null,
): PrdInfo | null {
  const [info, setInfo] = useState<PrdInfo | null>(null);
  useEffect(() => {
    if (version === null) return;
    void api<PrdInfo>(
      'GET',
      W(workspaceId, '/ideas/' + ideaId + '/prd?version=' + String(version)),
    ).then((r) => {
      setInfo(r.ok ? r.data : null);
    });
  }, [workspaceId, ideaId, version]);
  return info;
}

/** The tooltip of a citation: the requirement, and the passage of the source it rests on. */
export const citeTitle = (ref: PrdRef | undefined, code: string): string =>
  ref
    ? code +
      ': ' +
      ref.text +
      (ref.passage ? '\n' + (ref.source ? ref.source + ': ' : '') + '“' + ref.passage + '”' : '')
    : code + ': not found in this idea';

/** A statement with its [R-3] citations drawn as chips. */
export function CitedText(props: { text: string; refs: readonly PrdRef[] | undefined }): ReactNode {
  return (
    <>
      {citeParts(props.text).map((p, i) =>
        'text' in p ? (
          <span key={i}>{p.text}</span>
        ) : (
          <span key={i} className="pe-cites">
            {p.codes.map((code) => {
              const ref = props.refs?.find((r) => r.code === code);
              return (
                <span
                  key={code}
                  className={'pe-cite' + (ref ? '' : ' pe-cite--missing')}
                  title={citeTitle(ref, code)}
                  tabIndex={0}
                >
                  {code}
                </span>
              );
            })}
          </span>
        ),
      )}
    </>
  );
}

export function CitationLine(props: { report: PrdInfo['report'] }): ReactNode {
  const [open, setOpen] = useState(false);
  const r = props.report;
  if (!r.total) return null;
  return (
    <div className="pe-cite-report">
      <span className={r.cited === r.total ? 'pe-cite-ok' : ''}>
        {r.cited} of {r.total} statements cite a requirement or source
      </span>
      {r.uncited.length ? (
        <>
          {' · '}
          <button
            type="button"
            className="pe-btn pe-btn--text pe-btn--sm"
            aria-expanded={open}
            onClick={() => {
              setOpen((x) => !x);
            }}
          >
            {open ? 'Hide' : 'Show'} the {r.uncited.length} without
          </button>
          {open ? (
            <ul className="pe-bullets pe-small">
              {r.uncited.map((s) => (
                <li key={s.path}>
                  <span className="pe-muted">{s.part}:</span> {s.text}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function SectionsView(props: {
  sections: readonly ProposalSection[] | undefined;
  refs: readonly PrdRef[] | undefined;
}): ReactNode {
  if (!props.sections?.length) return null;
  return (
    <>
      {props.sections.map((s) => (
        <div key={s.key}>
          <h3 className="pe-subhead">{s.title}</h3>
          <p className="pe-pre-wrap">
            <CitedText text={s.body} refs={props.refs} />
          </p>
        </div>
      ))}
    </>
  );
}

/** The template's sections in the editor: one text field each, kept when not empty. */
export function SectionFields(props: {
  template: readonly TemplateSection[];
  value: Record<string, string>;
  onChange: (key: string, body: string) => void;
}): ReactNode {
  return (
    <>
      {props.template.map((t) => (
        <div key={t.key} className="pe-field">
          <label htmlFor={'p-sec-' + t.key}>{t.title}</label>
          <textarea
            id={'p-sec-' + t.key}
            className="pe-input pe-textarea"
            rows={3}
            placeholder={t.hint}
            value={props.value[t.key] ?? ''}
            onChange={(e) => {
              props.onChange(t.key, e.target.value);
            }}
          />
        </div>
      ))}
    </>
  );
}

/** The sections to save: the template's, in its order, then any older ones it does not name. */
export function sectionsFrom(
  template: readonly TemplateSection[],
  value: Record<string, string>,
  before: readonly ProposalSection[] | undefined,
): ProposalSection[] {
  const known = template
    .map((t) => ({ key: t.key, title: t.title, body: (value[t.key] ?? '').trim() }))
    .filter((s) => s.body);
  const other = (before ?? []).filter((s) => !template.some((t) => t.key === s.key));
  return [...known, ...other];
}

function DiffPart(props: { d: PartDiff }): ReactNode {
  const d = props.d;
  return (
    <div className="pe-diff-part">
      <h3 className="pe-subhead">{d.part}</h3>
      {d.kind === 'text' ? (
        <p className="pe-pre-wrap">
          {d.ops.map((o, i) =>
            o.op === 'same' ? (
              <span key={i}>{o.text}</span>
            ) : o.op === 'add' ? (
              <ins key={i}>{o.text}</ins>
            ) : (
              <del key={i}>{o.text}</del>
            ),
          )}
        </p>
      ) : (
        <ul className="pe-diff-list">
          {d.ops.map((o, i) => (
            <li key={i} className={'pe-diff-' + o.op}>
              <span aria-hidden="true">{o.op === 'add' ? '+' : o.op === 'remove' ? '−' : ' '}</span>
              {o.op === 'add' ? (
                <ins>{o.text}</ins>
              ) : o.op === 'remove' ? (
                <del>{o.text}</del>
              ) : (
                o.text
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Two versions part by part; parts without changes are named, not shown. */
export function PrdDiff(props: {
  from: { version: number; content: ProposalContent };
  to: { version: number; content: ProposalContent };
}): ReactNode {
  const parts = proposalDiff(props.from.content, props.to.content);
  const changed = parts.filter((p) => p.changed);
  const same = parts.filter((p) => !p.changed && (p.kind === 'text' ? p.ops.length : p.ops.length));
  return (
    <div className="pe-diff" aria-label={'Changes from version ' + String(props.from.version)}>
      <p className="pe-small pe-muted">
        Version {props.from.version} → {props.to.version}:{' '}
        {changed.length === 1
          ? '1 part changed'
          : changed.length
            ? String(changed.length) + ' parts changed'
            : 'no changes'}
        {same.length ? ' · unchanged: ' + same.map((p) => p.part).join(', ') : ''}
      </p>
      {changed.map((d) => (
        <DiffPart key={d.part} d={d} />
      ))}
    </div>
  );
}

/** Downloads of a version, and the PDF printed from the page. */
export function PrdExports(props: {
  workspaceId: string;
  ideaId: string;
  version: number;
}): ReactNode {
  const href = (format: string): string =>
    W(
      props.workspaceId,
      '/ideas/' +
        props.ideaId +
        '/prd/export?version=' +
        String(props.version) +
        '&format=' +
        format,
    );
  return (
    <div className="pe-prd-exports" role="group" aria-label="Export this version">
      <span className="pe-small pe-muted">Export</span>
      <a className="pe-btn pe-btn--text pe-btn--sm" href={href('md')} download>
        Markdown
      </a>
      <a className="pe-btn pe-btn--text pe-btn--sm" href={href('docx')} download>
        Word
      </a>
      <button
        type="button"
        className="pe-btn pe-btn--text pe-btn--sm"
        title="Print this version, or save it as PDF from the print dialog"
        onClick={() => {
          document.body.classList.add('pe-print-prd');
          const done = (): void => {
            document.body.classList.remove('pe-print-prd');
            window.removeEventListener('afterprint', done);
          };
          window.addEventListener('afterprint', done);
          window.print();
        }}
      >
        PDF
      </button>
      <a className="pe-btn pe-btn--text pe-btn--sm" href={href('feature')} download>
        Gherkin
      </a>
    </div>
  );
}

// ── [PCODE-276 | S15 | v0.1.0] the estimate of a version: size, range, confidence, the basis of each task ──
export interface IdeaEstimate {
  version: number;
  range: {
    points: number;
    size: string;
    low: number;
    likely: number;
    high: number;
    lowDays: number;
    likelyDays: number;
    highDays: number;
    confidence: string;
    basis: string;
    history: number;
  };
  text: string;
  unit: string;
  tasks: {
    title: string;
    estimate: number;
    suggested: number | null;
    basis: string;
    off: boolean;
    similar: {
      ref: string;
      title: string;
      estimate: number | null;
      hours: number;
      score: number;
    }[];
  }[];
}

export function useEstimate(
  workspaceId: string,
  ideaId: string,
  version: number | null,
): IdeaEstimate | null {
  const [e, setE] = useState<IdeaEstimate | null>(null);
  useEffect(() => {
    if (version === null) return;
    void api<IdeaEstimate>(
      'GET',
      W(workspaceId, '/ideas/' + ideaId + '/estimate?version=' + String(version)),
    ).then((r) => {
      setE(r.ok ? r.data : null);
    });
  }, [workspaceId, ideaId, version]);
  return e;
}

/** Where low, likely and high sit on a bar from zero to a little past high, in percent. */
export function rangeBar(r: { low: number; likely: number; high: number }): {
  left: number;
  width: number;
  mark: number;
} {
  const end = r.high * 1.15 || 1;
  const pc = (x: number): number => Math.round((x / end) * 1000) / 10;
  return { left: pc(r.low), width: pc(r.high) - pc(r.low), mark: pc(r.likely) };
}

export function EstimatePanel(props: { estimate: IdeaEstimate }): ReactNode {
  const { range: r, tasks } = props.estimate;
  const [open, setOpen] = useState(false);
  const bar = rangeBar(r);
  const off = tasks.filter((t) => t.off).length;
  return (
    <div className="pe-estimate">
      <div className="pe-estimate-head">
        <span className="pe-size" title="The size of the whole idea by its points">
          {r.size}
        </span>
        <div className="pe-estimate-range">
          <div className="pe-small">
            Likely <strong>{r.likelyDays}</strong> working days, between {r.lowDays} and{' '}
            {r.highDays} ({r.low}–{r.high} points)
          </div>
          <div
            className="pe-range-bar"
            role="img"
            aria-label={
              'From ' +
              String(r.lowDays) +
              ' to ' +
              String(r.highDays) +
              ' days, likely ' +
              String(r.likelyDays)
            }
          >
            <span
              className="pe-range-fill"
              style={{ left: String(bar.left) + '%', width: String(bar.width) + '%' }}
            />
            <span className="pe-range-mark" style={{ left: String(bar.mark) + '%' }} />
          </div>
          <div className="pe-small pe-muted">
            <span className={'pe-conf pe-conf--' + r.confidence}>{r.confidence} confidence</span>{' '}
            {r.basis === 'history'
              ? '· from how ' +
                String(r.history) +
                ' finished tasks of the project came out against their estimates'
              : '· standard spread: the project has too few finished tasks with logged time'}
          </div>
        </div>
      </div>
      {tasks.some((t) => t.similar.length) ? (
        <p className="pe-small">
          <button
            type="button"
            className="pe-btn pe-btn--text pe-btn--sm"
            aria-expanded={open}
            onClick={() => {
              setOpen((x) => !x);
            }}
          >
            {open ? 'Hide' : 'Show'} the basis per task
          </button>
          {off ? (
            <span className="pe-muted">
              {' '}
              · {off} {off === 1 ? 'task is' : 'tasks are'} far from what similar tasks took
            </span>
          ) : null}
        </p>
      ) : null}
      {open ? (
        <table className="pe-grid-table" aria-label="Basis per task">
          <thead>
            <tr>
              <th scope="col">Task</th>
              <th scope="col">Points</th>
              <th scope="col">Similar finished tasks</th>
              <th scope="col">They suggest</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t, i) => (
              <tr key={i} className={t.off ? 'pe-estimate-off' : undefined}>
                <td>{t.title}</td>
                <td>{t.estimate}</td>
                <td>
                  {t.similar.length
                    ? t.similar.map((x) => (
                        <div key={x.ref} className="pe-small">
                          <span className="pe-mono pe-muted">{x.ref}</span> {x.title} ·{' '}
                          {x.estimate === null ? 'no estimate' : String(x.estimate) + ' pt'}
                          {x.hours ? ', took ' + String(x.hours) + ' h' : ''}
                        </div>
                      ))
                    : '—'}
                </td>
                <td>{t.suggested === null ? '—' : String(t.suggested) + ' pt'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
