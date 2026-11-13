// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-292 | S15 | v0.1.0] T30.6 Handoff specs per mockup: tokens, components, states, breakpoints, measures, export areas ──
//    Why:  the handoff of a mockup version next to its review: measures and export areas drawn on the image
//          (a measure shows its pixels and the spacing token it matches), the tokens, components, states
//          and breakpoints to build it with, and the spec as Markdown or JSON to hand over.
import {
  EXPORT_FORMATS,
  areaPx,
  emptyHandoff,
  exportFileNames,
  measurePx,
  tokenForDistance,
  type DesignToken,
  type ExportFormat,
  type HandoffSpec,
} from '@orqiva/shared';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { PIcon } from '../preview/picons.js';
import { Button, Card, Chip } from '../preview/ui.js';
import { assetsFromAreas } from './assetsizes.js'; // [PCODE-293 | S15 | v0.1.0]

interface HandoffData {
  version: number;
  specVersion: number | null;
  carried: boolean;
  spec: HandoffSpec;
  problems: string[];
  components: { id: string; name: string; codePath: string; status: string }[];
  updatedBy: string | null;
  updatedAt: string | null;
}

type Tool = 'measure' | 'area' | null;
type Point = { x: number; y: number };

/** Two clicks make a measure; it snaps to across or down, whichever is longer. */
export function snapMeasure(a: Point, b: Point, w: number, h: number): Point {
  return Math.abs(b.x - a.x) * w >= Math.abs(b.y - a.y) * h
    ? { x: b.x, y: a.y }
    : { x: a.x, y: b.y };
}

/** Two clicks make an export area, whatever corners they are. */
export function areaFrom(a: Point, b: Point): { x: number; y: number; w: number; h: number } {
  const r = (n: number): number => Math.round(n * 10000) / 10000;
  return {
    x: r(Math.min(a.x, b.x)),
    y: r(Math.min(a.y, b.y)),
    w: r(Math.abs(b.x - a.x)),
    h: r(Math.abs(b.y - a.y)),
  };
}

export function exportUrl(
  workspaceId: string,
  mockupId: string,
  version: number,
  format: 'md' | 'json',
): string {
  return (
    '/api/workspaces/' +
    workspaceId +
    '/mockups/' +
    mockupId +
    '/handoff/export?version=' +
    String(version) +
    '&format=' +
    format
  );
}

export function Handoff(props: {
  workspaceId: string;
  projectId: string;
  mockupId: string;
  version: number;
  imageUrl: string;
  canEdit: boolean;
  onError: (m: string) => void;
  header?: ReactNode;
  title?: string; // [PCODE-293 | S15 | v0.1.0] named in the rights of the assets cut from it
}): ReactNode {
  const H = '/api/workspaces/' + props.workspaceId + '/mockups/' + props.mockupId + '/handoff';
  const [data, setData] = useState<HandoffData | null>(null);
  const [spec, setSpec] = useState<HandoffSpec>(emptyHandoff());
  const [dirty, setDirty] = useState(false);
  const [tokens, setTokens] = useState<DesignToken[]>([]);
  const [tool, setTool] = useState<Tool>(null);
  const [cutting, setCutting] = useState(''); // [PCODE-293 | S15 | v0.1.0]
  const [cutDone, setCutDone] = useState('');
  const [size, setSize] = useState({ w: 1600, h: 1000 });
  const load = useCallback(async () => {
    const r = await api<HandoffData>('GET', H + '?version=' + String(props.version));
    if (r.ok) {
      setData(r.data);
      setSpec(r.data.spec);
      setDirty(false);
    }
  }, [H, props.version]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void api<{ tokens: DesignToken[] }>(
      'GET',
      '/api/workspaces/' + props.workspaceId + '/projects/' + props.projectId + '/tokens',
    ).then((r) => {
      if (r.ok) setTokens(r.data.tokens);
    });
  }, [props.workspaceId, props.projectId]);
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth && img.naturalHeight)
        setSize({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.src = props.imageUrl;
  }, [props.imageUrl]);

  const change = (next: Partial<HandoffSpec>): void => {
    setSpec((s) => ({ ...s, ...next }));
    setDirty(true);
  };
  const save = async (): Promise<void> => {
    const r = await api<HandoffData>('PUT', H, {
      version: props.version,
      spec: { ...spec, imageWidth: size.w, imageHeight: size.h },
    });
    if (!r.ok) props.onError(r.error.message);
    else {
      setData(r.data);
      setSpec(r.data.spec);
      setDirty(false);
    }
  };
  if (!data)
    return (
      <p className="pv-muted" role="status">
        Loading…
      </p>
    );
  // measures are drawn on the image as it is now; pixels are of that image
  const w = size.w;
  const h = size.h;
  const edit = props.canEdit;
  const tokenNames = new Set(tokens.map((t) => t.name));

  return (
    <>
      <div className="pv-stack">
        {props.header}
        {data.carried ? (
          <div className="pv-callout pv-callout--decision">
            <PIcon name="question" size={16} />
            <div>
              Carried over from version {data.specVersion}. Saving makes it the spec of version{' '}
              {props.version}.
            </div>
          </div>
        ) : null}
        {data.problems.length ? (
          <div className="pv-callout pv-callout--warn">
            <PIcon name="incident" size={16} />
            <div>
              <strong>The kit changed under this spec.</strong> {data.problems.join('. ')}.
            </div>
          </div>
        ) : null}
        <Card
          title={'Handoff · v' + String(props.version)}
          action={
            <span className="pv-page-actions">
              {edit ? (
                <>
                  <button
                    type="button"
                    className="pv-subtab"
                    aria-pressed={tool === 'measure'}
                    onClick={() => {
                      setTool((t) => (t === 'measure' ? null : 'measure'));
                    }}
                  >
                    Measure
                  </button>
                  <button
                    type="button"
                    className="pv-subtab"
                    aria-pressed={tool === 'area'}
                    onClick={() => {
                      setTool((t) => (t === 'area' ? null : 'area'));
                    }}
                  >
                    Export area
                  </button>
                </>
              ) : null}
              <a
                className="pv-btn pv-btn--ghost pv-btn--sm"
                href={exportUrl(props.workspaceId, props.mockupId, props.version, 'md')}
                download
              >
                Markdown
              </a>
              <a
                className="pv-btn pv-btn--ghost pv-btn--sm"
                href={exportUrl(props.workspaceId, props.mockupId, props.version, 'json')}
                download
              >
                JSON
              </a>
            </span>
          }
        >
          <HandoffImage
            url={props.imageUrl}
            w={w}
            h={h}
            spec={spec}
            tokens={tokens}
            tool={tool}
            onMeasure={(m) => {
              change({ measures: [...spec.measures, { ...m, label: '' }] });
            }}
            onArea={(a) => {
              change({
                exports: [
                  ...spec.exports,
                  {
                    ...a,
                    name: 'asset-' + String(spec.exports.length + 1),
                    formats: ['png'],
                    scales: [1, 2],
                  },
                ],
              });
            }}
          />
          {tool === 'measure' ? (
            <p className="pv-small pv-muted">
              Click two points: the measure runs across or down, whichever is longer.
            </p>
          ) : tool === 'area' ? (
            <p className="pv-small pv-muted">Click two corners of the area to export.</p>
          ) : null}
          {spec.measures.length ? (
            <table className="pv-table v2-mt">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Measure</th>
                  <th>Pixels</th>
                  <th>Token</th>
                  {edit ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {spec.measures.map((m, i) => {
                  const d = measurePx(m, w, h);
                  const along = Math.max(d.dx, d.dy);
                  return (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>
                        {edit ? (
                          <input
                            className="v2-input"
                            aria-label={'Name of measure ' + String(i + 1)}
                            placeholder="e.g. card padding"
                            value={m.label}
                            onChange={(e) => {
                              change({
                                measures: spec.measures.map((x, j) =>
                                  j === i ? { ...x, label: e.target.value } : x,
                                ),
                              });
                            }}
                          />
                        ) : (
                          m.label || '–'
                        )}
                      </td>
                      <td className="v2-mono">{along} px</td>
                      <td className="v2-mono">
                        {tokenForDistance(along, tokens) ?? (
                          <span className="pv-muted">no token</span>
                        )}
                      </td>
                      {edit ? (
                        <td>
                          <button
                            type="button"
                            className="pv-link-btn pv-small"
                            onClick={() => {
                              change({ measures: spec.measures.filter((_x, j) => j !== i) });
                            }}
                          >
                            Remove
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
        </Card>
        {spec.exports.length ? (
          <Card
            title="Assets to export"
            action={
              // [PCODE-293 | S15 | v0.1.0] the areas become assets with their sizes, cut from this version's image
              edit ? (
                <Button
                  size="sm"
                  kind="ghost"
                  icon="uikit"
                  disabled={dirty || Boolean(cutting)}
                  onClick={() => {
                    setCutDone('');
                    void assetsFromAreas({
                      workspaceId: props.workspaceId,
                      projectId: props.projectId,
                      imageUrl: props.imageUrl,
                      mockupTitle: props.title ?? 'mockup',
                      version: props.version,
                      areas: spec.exports,
                      onProgress: setCutting,
                    })
                      .then((r) => {
                        if (r.error) props.onError(r.error);
                        setCutDone(
                          String(r.made) +
                            ' asset' +
                            (r.made === 1 ? '' : 's') +
                            ' added to Assets' +
                            (r.skipped ? ', ' + String(r.skipped) + ' already there' : ''),
                        );
                      })
                      .catch((e: unknown) => {
                        props.onError(
                          e instanceof Error ? e.message : 'The areas could not be cut',
                        );
                      })
                      .finally(() => {
                        setCutting('');
                      });
                  }}
                >
                  {cutting ? 'Cutting ' + cutting + '…' : 'Make assets'}
                </Button>
              ) : null
            }
          >
            {dirty && edit ? (
              <p className="pv-small pv-muted">Save the spec first, then make the assets.</p>
            ) : null}
            {cutDone ? <p className="pv-small">{cutDone}</p> : null}
            <ul className="pv-rows pv-rows--tight">
              {spec.exports.map((e, i) => {
                const a = areaPx(e, w, h);
                const set = (next: Partial<typeof e>): void => {
                  change({
                    exports: spec.exports.map((x, j) => (j === i ? { ...x, ...next } : x)),
                  });
                };
                return (
                  <li key={i} className="pv-row pv-row--static v2-handoff-export">
                    <span className="pv-row-main">
                      {edit ? (
                        <input
                          className="v2-input"
                          aria-label={'Name of export area ' + String(i + 1)}
                          value={e.name}
                          onChange={(ev) => {
                            set({ name: ev.target.value });
                          }}
                        />
                      ) : (
                        <span className="pv-row-title">{e.name}</span>
                      )}
                      <span className="pv-row-sub v2-mono">
                        {a.w} × {a.h} px at {a.x}, {a.y} · {exportFileNames(e).join(', ')}
                      </span>
                    </span>
                    {edit ? (
                      <span className="v2-inline">
                        {EXPORT_FORMATS.map((f) => (
                          <label key={f} className="pv-small">
                            <input
                              type="checkbox"
                              checked={e.formats.includes(f)}
                              onChange={(ev) => {
                                const formats: ExportFormat[] = ev.target.checked
                                  ? [...e.formats, f]
                                  : e.formats.filter((x) => x !== f);
                                if (formats.length) set({ formats });
                              }}
                            />{' '}
                            {f}
                          </label>
                        ))}
                        <input
                          className="v2-input v2-handoff-scales"
                          aria-label={'Scales of ' + e.name}
                          title="Scales, e.g. 1 2 3"
                          defaultValue={e.scales.join(' ')}
                          onBlur={(ev) => {
                            const scales = [
                              ...new Set(
                                ev.target.value
                                  .split(/[\s,x×]+/)
                                  .map(Number)
                                  .filter((n) => n >= 0.5 && n <= 4),
                              ),
                            ].sort((p, q) => p - q);
                            if (scales.length) set({ scales });
                            ev.target.value = (scales.length ? scales : e.scales).join(' ');
                          }}
                        />
                        <button
                          type="button"
                          className="pv-link-btn pv-small"
                          onClick={() => {
                            change({ exports: spec.exports.filter((_x, j) => j !== i) });
                          }}
                        >
                          Remove
                        </button>
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : null}
      </div>
      <aside className="pv-stack">
        <Card title="Build with">
          {edit ? (
            <div className="v2-inline">
              <Button
                size="sm"
                kind="primary"
                icon="check"
                disabled={!dirty}
                onClick={() => void save()}
              >
                Save the spec
              </Button>
              {dirty ? <span className="pv-small pv-muted">Not saved yet</span> : null}
              {!dirty && data.updatedBy ? (
                <span className="pv-small pv-muted">Last saved by {data.updatedBy}</span>
              ) : null}
            </div>
          ) : null}
          <h4 className="v2-handoff-h">Tokens</h4>
          <span className="v2-handoff-chips">
            {spec.tokens.map((t) => (
              <Chip key={t} tone={tokenNames.has(t) ? 'neutral' : 'danger'}>
                <span className="v2-mono">{t}</span>
                {edit ? (
                  <button
                    type="button"
                    className="pv-link-btn"
                    aria-label={'Remove ' + t}
                    onClick={() => {
                      change({ tokens: spec.tokens.filter((x) => x !== t) });
                    }}
                  >
                    ×
                  </button>
                ) : null}
              </Chip>
            ))}
            {!spec.tokens.length ? (
              <span className="pv-small pv-muted">None named yet.</span>
            ) : null}
          </span>
          {edit ? (
            <select
              className="pv-select v2-mt"
              aria-label="Add a token"
              value=""
              onChange={(e) => {
                if (e.target.value) change({ tokens: [...spec.tokens, e.target.value] });
              }}
            >
              <option value="">Add a token…</option>
              {tokens
                .filter((t) => !spec.tokens.includes(t.name))
                .map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
            </select>
          ) : null}
          <h4 className="v2-handoff-h">Components</h4>
          {data.components.length ? (
            <ul className="v2-handoff-list">
              {data.components
                .filter((c) => edit || spec.components.includes(c.id))
                .map((c) => (
                  <li key={c.id}>
                    <label className="pv-small">
                      {edit ? (
                        <input
                          type="checkbox"
                          checked={spec.components.includes(c.id)}
                          onChange={(e) => {
                            change({
                              components: e.target.checked
                                ? [...spec.components, c.id]
                                : spec.components.filter((x) => x !== c.id),
                            });
                          }}
                        />
                      ) : null}{' '}
                      {c.name}{' '}
                      {c.codePath ? <span className="pv-muted v2-mono">{c.codePath}</span> : null}
                    </label>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="pv-small pv-muted">The project has no components in its inventory.</p>
          )}
          <PairList
            title="States"
            items={spec.states.map((s) => ({ a: s.name, b: s.note }))}
            labels={['State, e.g. Loading', 'What changes']}
            edit={edit}
            onChange={(items) => {
              change({ states: items.map((x) => ({ name: x.a, note: x.b })) });
            }}
          />
          <h4 className="v2-handoff-h">Breakpoints</h4>
          <ul className="v2-handoff-list">
            {spec.breakpoints.map((b, i) => {
              const set = (next: Partial<typeof b>): void => {
                change({
                  breakpoints: spec.breakpoints.map((x, j) => (j === i ? { ...x, ...next } : x)),
                });
              };
              return (
                <li key={i} className="v2-handoff-pair">
                  {edit ? (
                    <>
                      <input
                        className="v2-input"
                        aria-label="Breakpoint name"
                        value={b.name}
                        onChange={(e) => {
                          set({ name: e.target.value });
                        }}
                      />
                      <input
                        className="v2-input v2-handoff-num"
                        type="number"
                        min={0}
                        aria-label={'Width from which ' + b.name + ' applies, in px'}
                        value={b.width}
                        onChange={(e) => {
                          set({ width: Math.max(0, Math.round(Number(e.target.value) || 0)) });
                        }}
                      />
                      <input
                        className="v2-input v2-handoff-wide"
                        aria-label={'What changes at ' + b.name}
                        placeholder="What changes"
                        value={b.note}
                        onChange={(e) => {
                          set({ note: e.target.value });
                        }}
                      />
                      <button
                        type="button"
                        className="pv-link-btn pv-small"
                        onClick={() => {
                          change({ breakpoints: spec.breakpoints.filter((_x, j) => j !== i) });
                        }}
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <span className="pv-small">
                      <strong>{b.name}</strong> from {b.width} px{b.note ? ': ' + b.note : ''}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {edit ? (
            <Button
              size="sm"
              kind="ghost"
              icon="plus"
              onClick={() => {
                const next = [
                  { name: 'Phone', width: 0 },
                  { name: 'Tablet', width: 768 },
                  { name: 'Desktop', width: 1200 },
                ].find((x) => !spec.breakpoints.some((b) => b.name === x.name)) ?? {
                  name: 'Wide',
                  width: 1600,
                };
                change({ breakpoints: [...spec.breakpoints, { ...next, note: '' }] });
              }}
            >
              Add a breakpoint
            </Button>
          ) : null}
          <h4 className="v2-handoff-h">Notes</h4>
          {edit ? (
            <textarea
              className="v2-input v2-handoff-notes"
              rows={4}
              aria-label="Notes for the developer"
              placeholder="Anything the image does not show: behaviour, motion, edge cases"
              value={spec.notes}
              onChange={(e) => {
                change({ notes: e.target.value });
              }}
            />
          ) : (
            <p className="pv-small pv-wrap">
              {spec.notes || <span className="pv-muted">No notes.</span>}
            </p>
          )}
        </Card>
      </aside>
    </>
  );
}

function PairList(props: {
  title: string;
  items: { a: string; b: string }[];
  labels: [string, string];
  edit: boolean;
  onChange: (items: { a: string; b: string }[]) => void;
}): ReactNode {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  return (
    <>
      <h4 className="v2-handoff-h">{props.title}</h4>
      <ul className="v2-handoff-list">
        {props.items.map((x, i) => (
          <li key={i} className="pv-small">
            <strong>{x.a}</strong>
            {x.b ? ': ' + x.b : ''}{' '}
            {props.edit ? (
              <button
                type="button"
                className="pv-link-btn"
                onClick={() => {
                  props.onChange(props.items.filter((_y, j) => j !== i));
                }}
              >
                Remove
              </button>
            ) : null}
          </li>
        ))}
        {!props.items.length && !props.edit ? <li className="pv-small pv-muted">None.</li> : null}
      </ul>
      {props.edit ? (
        <form
          className="v2-handoff-pair"
          onSubmit={(e) => {
            e.preventDefault();
            if (!a.trim()) return;
            props.onChange([...props.items, { a: a.trim(), b: b.trim() }]);
            setA('');
            setB('');
          }}
        >
          <input
            className="v2-input"
            aria-label={props.labels[0]}
            placeholder={props.labels[0]}
            value={a}
            onChange={(e) => {
              setA(e.target.value);
            }}
          />
          <input
            className="v2-input"
            aria-label={props.labels[1]}
            placeholder={props.labels[1]}
            value={b}
            onChange={(e) => {
              setB(e.target.value);
            }}
          />
          <button type="submit" className="pv-btn pv-btn--ghost pv-btn--sm" disabled={!a.trim()}>
            Add
          </button>
        </form>
      ) : null}
    </>
  );
}

/** The image with the measures (pixels and token) and the export areas drawn on top. */
function HandoffImage(props: {
  url: string;
  w: number;
  h: number;
  spec: HandoffSpec;
  tokens: readonly DesignToken[];
  tool: Tool;
  onMeasure: (m: { x1: number; y1: number; x2: number; y2: number }) => void;
  onArea: (a: { x: number; y: number; w: number; h: number }) => void;
}): ReactNode {
  const ref = useRef<SVGSVGElement>(null);
  const [first, setFirst] = useState<Point | null>(null);
  useEffect(() => {
    setFirst(null);
  }, [props.tool]);
  const { w, h } = props;
  const stroke = Math.max(2, Math.round(w / 400));
  const font = Math.max(12, Math.round(w / 60));
  return (
    <figure className="v2-pinned">
      <svg
        ref={ref}
        viewBox={'0 0 ' + String(w) + ' ' + String(h)}
        className={'v2-pinned-svg' + (props.tool ? ' v2-pinned-svg--place' : '')}
        role="img"
        aria-label="Mockup with measures and export areas"
        onClick={(e) => {
          if (!props.tool || !ref.current) return;
          const box = ref.current.getBoundingClientRect();
          const p = {
            x:
              Math.round(Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)) * 10000) /
              10000,
            y:
              Math.round(Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)) * 10000) /
              10000,
          };
          if (!first) {
            setFirst(p);
            return;
          }
          if (props.tool === 'measure') {
            const end = snapMeasure(first, p, w, h);
            if (end.x !== first.x || end.y !== first.y)
              props.onMeasure({ x1: first.x, y1: first.y, x2: end.x, y2: end.y });
          } else {
            const a = areaFrom(first, p);
            if (a.w > 0 && a.h > 0) props.onArea(a);
          }
          setFirst(null);
        }}
      >
        <image href={props.url} x="0" y="0" width={w} height={h} />
        {props.spec.exports.map((e, i) => (
          <g key={'e' + String(i)} className="v2-handoff-area">
            <rect x={e.x * w} y={e.y * h} width={e.w * w} height={e.h * h} strokeWidth={stroke} />
            <text x={e.x * w + font / 3} y={e.y * h + font} fontSize={font}>
              {e.name}
            </text>
          </g>
        ))}
        {props.spec.measures.map((m, i) => {
          const d = measurePx(m, w, h);
          const along = Math.max(d.dx, d.dy);
          const token = tokenForDistance(along, props.tokens);
          return (
            <g
              key={'m' + String(i)}
              className={'v2-handoff-measure' + (token ? '' : ' v2-handoff-measure--off')}
            >
              <line x1={m.x1 * w} y1={m.y1 * h} x2={m.x2 * w} y2={m.y2 * h} strokeWidth={stroke} />
              <text
                x={((m.x1 + m.x2) / 2) * w}
                y={((m.y1 + m.y2) / 2) * h - font / 2}
                fontSize={font}
                textAnchor="middle"
              >
                {String(i + 1) + ': ' + String(along) + ' px' + (token ? ' · ' + token : '')}
              </text>
            </g>
          );
        })}
        {first ? (
          <circle className="v2-pin-draft" cx={first.x * w} cy={first.y * h} r={stroke * 4} />
        ) : null}
      </svg>
    </figure>
  );
}
