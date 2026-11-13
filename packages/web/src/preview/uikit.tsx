// ── [PCODE-155 | S15 | v0.1.0] D3 preview: Documents, UI kit and Test ──
//    Why:  the UI kit tab: brand, design tokens and components in one place with their status in the code,
//          mockups reviewed with pinned comments and approved per version (by the client too), assets with
//          their usage rights, and checks that keep the code on the kit: contrast, and colours or sizes that
//          are not tokens. Tokens go to the code as a pull request; agents must build UI from the kit.
import { useState, type ReactNode } from 'react';
import { ASSETS, COMPONENTS, CONTRAST, HARDCODED, MOCKUPS, PINS, TOKENS } from './data3.js';
import { person } from './data.js';
import { PIcon, type PIconName } from './picons.js';
import { Avatar, Bar, Button, Card, Chip, Stat } from './ui.js';

const isColour = (v: string): boolean => /^#[0-9a-f]{6}$/i.test(v);

function Swatch(props: { value: string; size?: number }): ReactNode {
  const s = props.size ?? 22;
  return (
    <svg width={s} height={s} viewBox="0 0 22 22" aria-hidden="true" className="pv-swatch-svg">
      <rect
        x="0.5"
        y="0.5"
        width="21"
        height="21"
        rx="5"
        fill={props.value}
        className="pv-swatch-rect"
      />
    </svg>
  );
}

function Brand(): ReactNode {
  return (
    <div className="pv-stack">
      <div className="pv-brand-hero">
        <svg width="72" height="72" viewBox="0 0 32 32" aria-label="Nordwind mark">
          <rect x="1" y="1" width="30" height="30" rx="8" fill="#0F4C81" />
          <path
            d="M9 22V10l14 12V10"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div>
          <h3 className="pv-brand-name">Nordwind Fleet portal</h3>
          <p className="pv-muted">
            Calm, precise, built for dispatchers who look at it all day. Version 2.3 of the kit ·
            Figma file “NWL Design system”.
          </p>
          <div className="pv-page-actions">
            <Chip tone="success" icon="check">
              Figma synced 10 min ago
            </Chip>
            <Chip tone="warning">2 changes waiting to sync</Chip>
            <Chip tone="agent" icon="agents">
              Agents must use these tokens and components
            </Chip>
          </div>
        </div>
      </div>
      <div className="pv-split pv-split--even">
        <Card title="Colour">
          <div className="pv-palette-row">
            {TOKENS.filter((t) => t.group === 'Colour').map((t) => (
              <div key={t.name} className="pv-palette-chip">
                <Swatch value={t.light} size={44} />
                <span className="pv-mono pv-small">{t.name.replace('color.', '')}</span>
                <span className="pv-muted pv-small">{t.light}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Voice and type">
          <p className="pv-type-sample pv-type-sample--title">Re-route a tour</p>
          <p className="pv-type-sample">
            Drag a stop to change the order. Drivers see the new route within 10 seconds.
          </p>
          <ul className="pv-dodont">
            <li className="pv-do">Do: “Tour T-4411 is 12 minutes late.”</li>
            <li className="pv-dont">Don’t: “Oops! Something went wrong with your tour!!”</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Tokens(): ReactNode {
  const [target, setTarget] = useState('CSS variables');
  const [pr, setPr] = useState(false);
  return (
    <div className="pv-stack">
      <Card
        flush
        title="Design tokens (W3C format)"
        action={
          <span className="pv-page-actions">
            <select
              className="pv-select"
              value={target}
              aria-label="Export format"
              onChange={(e) => {
                setTarget(e.target.value);
              }}
            >
              {[
                'CSS variables',
                'Tailwind config',
                'TypeScript',
                'iOS (Swift)',
                'Android (XML)',
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            {pr ? (
              <Chip tone="success" icon="git">
                Pull request #322 opened: tokens.css, 3 changes
              </Chip>
            ) : (
              <Button
                size="sm"
                kind="primary"
                icon="git"
                onClick={() => {
                  setPr(true);
                }}
              >
                Export as pull request
              </Button>
            )}
          </span>
        }
      >
        <table className="pv-table">
          <thead>
            <tr>
              <th>Token</th>
              <th>Light</th>
              <th>Dark</th>
              <th>Used for</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {TOKENS.map((t, i) => (
              <tr key={t.name}>
                <td className="pv-mono">{t.name}</td>
                <td>
                  <span className="pv-who">
                    {isColour(t.light) ? <Swatch value={t.light} /> : null}
                    <span className="pv-mono pv-small">{t.light}</span>
                  </span>
                </td>
                <td>
                  <span className="pv-who">
                    {isColour(t.dark) ? <Swatch value={t.dark} /> : null}
                    <span className="pv-mono pv-small">{t.dark}</span>
                  </span>
                </td>
                <td className="pv-cell-grow pv-muted">{t.use}</td>
                <td>{i === 1 || i === 6 ? <Chip tone="warning">changed in Figma</Chip> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="Waiting to sync from Figma">
        <div className="pv-diff">
          <div className="pv-del">color.accent #16C79A</div>
          <div className="pv-ins">color.accent #12B48A · better contrast on white</div>
          <div className="pv-del">color.warning #F59E0B</div>
          <div className="pv-ins">color.warning #D97706 · chip text now passes AA</div>
        </div>
        <div className="pv-page-actions pv-mt">
          <Button kind="primary" icon="check">
            Take both changes
          </Button>
          <Button kind="ghost">Review in Figma</Button>
        </div>
      </Card>
    </div>
  );
}

function Components(): ReactNode {
  const [sel, setSel] = useState('Button');
  const c = COMPONENTS.find((x) => x.name === sel) ?? COMPONENTS[0];
  if (!c) return null;
  return (
    <div className="pv-split">
      <Card flush title={'Components · ' + String(COMPONENTS.length)}>
        <table className="pv-table">
          <thead>
            <tr>
              <th>Component</th>
              <th>Status</th>
              <th className="pv-num">Used</th>
              <th>Figma</th>
              <th>Accessibility</th>
            </tr>
          </thead>
          <tbody>
            {COMPONENTS.map((x) => (
              <tr
                key={x.name}
                className={'pv-click-row' + (x.name === sel ? ' pv-row-sel' : '')}
                onClick={() => {
                  setSel(x.name);
                }}
              >
                <td>
                  <strong>{x.name}</strong>
                  <span className="pv-muted pv-block pv-small pv-mono">{x.path}</span>
                </td>
                <td>
                  <Chip
                    tone={
                      x.status === 'in code'
                        ? 'success'
                        : x.status === 'deprecated'
                          ? 'danger'
                          : 'warning'
                    }
                  >
                    {x.status}
                  </Chip>
                </td>
                <td className="pv-num">{x.usage}</td>
                <td>{x.figma ? <Chip tone="success">linked</Chip> : <Chip>not linked</Chip>}</td>
                <td className="pv-cell-bar">
                  {x.a11y ? (
                    <>
                      <Bar
                        value={x.a11y}
                        max={100}
                        tone={x.a11y >= 90 ? 'success' : x.a11y >= 75 ? 'warning' : 'danger'}
                      />
                      <span className="pv-small pv-muted">{x.a11y} / 100</span>
                    </>
                  ) : (
                    <span className="pv-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title={c.name}>
        <div className="pv-component-stage">
          {c.name === 'Button' ? (
            <div className="pv-page-actions">
              <Button kind="primary">Primary</Button>
              <Button>Secondary</Button>
              <Button kind="ghost">Ghost</Button>
              <Button kind="danger">Danger</Button>
            </div>
          ) : c.name === 'Chip' ? (
            <div className="pv-page-actions">
              <Chip>neutral</Chip>
              <Chip tone="primary">primary</Chip>
              <Chip tone="success">success</Chip>
              <Chip tone="warning">warning</Chip>
              <Chip tone="danger">danger</Chip>
              <Chip tone="agent">agent</Chip>
            </div>
          ) : (
            <p className="pv-muted">Live preview from Storybook, light and dark side by side.</p>
          )}
        </div>
        <div className="pv-kv pv-mt">
          <span>Variants</span>
          <span>{c.variants}</span>
          <span>Code</span>
          <span className="pv-mono">{c.path}</span>
          <span>Used in</span>
          <span>{c.usage} places across 4 screens</span>
          <span>Changelog</span>
          <span>2.3 added the danger variant · 2.1 focus ring 2 px</span>
        </div>
        <table className="pv-table pv-table--compact">
          <thead>
            <tr>
              <th>Prop</th>
              <th>Type</th>
              <th>Default</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="pv-mono">kind</td>
              <td className="pv-mono pv-small">primary | secondary | ghost | danger</td>
              <td className="pv-mono">secondary</td>
            </tr>
            <tr>
              <td className="pv-mono">size</td>
              <td className="pv-mono pv-small">sm | md</td>
              <td className="pv-mono">md</td>
            </tr>
            <tr>
              <td className="pv-mono">icon</td>
              <td className="pv-mono pv-small">IconName</td>
              <td className="pv-mono">—</td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Wireframe(props: {
  version: 'v3' | 'v4';
  pins: boolean;
  onPin?: (i: number) => void;
  active?: number | null;
}): ReactNode {
  return (
    <svg
      className="pv-wire"
      viewBox="0 0 100 62"
      role="img"
      aria-label={'Mockup Re-route a tour ' + props.version}
    >
      <rect className="pv-wire-frame" x="0.5" y="0.5" width="99" height="61" rx="2" />
      <rect className="pv-wire-bar" x="0.5" y="0.5" width="99" height="6" rx="2" />
      <rect className="pv-wire-panel" x="2" y="9" width="26" height="50" rx="1.5" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect
          key={i}
          className="pv-wire-line"
          x="4"
          y={12 + i * 7.5}
          width={i === 2 ? 20 : 22}
          height="5"
          rx="1"
        />
      ))}
      <rect className="pv-wire-map" x="30" y="9" width="68" height="50" rx="1.5" />
      <path className="pv-wire-route" d="M38 50 L48 36 L60 40 L72 22 L88 30" />
      {[
        [38, 50],
        [48, 36],
        [60, 40],
        [72, 22],
        [88, 30],
      ].map(([x, y]) => (
        <circle key={String(x)} className="pv-wire-stop" cx={x} cy={y} r="1.6" />
      ))}
      <rect
        className={props.version === 'v4' ? 'pv-wire-eta pv-wire-eta--big' : 'pv-wire-eta'}
        x={props.version === 'v4' ? 64 : 70}
        y="11"
        width={props.version === 'v4' ? 32 : 26}
        height={props.version === 'v4' ? 10 : 7}
        rx="1.5"
      />
      <text
        className="pv-wire-text"
        x={props.version === 'v4' ? 66 : 72}
        y={props.version === 'v4' ? 18 : 16}
      >
        ETA 14:20
      </text>
      {props.version === 'v4' ? (
        <rect className="pv-wire-undo" x="84" y="52" width="12" height="5" rx="1" />
      ) : null}
      {props.pins
        ? PINS.map((p, i) => (
            <g key={i} className="pv-pin" onClick={() => props.onPin?.(i)}>
              <circle
                className={
                  'pv-pin-dot' +
                  (p.resolved ? ' pv-pin-dot--done' : '') +
                  (props.active === i ? ' pv-pin-dot--active' : '')
                }
                cx={p.x}
                cy={p.y * 0.62}
                r="2.6"
              />
              <text className="pv-pin-num" x={p.x} y={p.y * 0.62 + 1} textAnchor="middle">
                {i + 1}
              </text>
            </g>
          ))
        : null}
    </svg>
  );
}

function Mockups(): ReactNode {
  const [sel, setSel] = useState('m1');
  const [pin, setPin] = useState<number | null>(0);
  const [compare, setCompare] = useState(false);
  const [approved, setApproved] = useState(false);
  const m = MOCKUPS.find((x) => x.id === sel) ?? MOCKUPS[0];
  if (!m) return null;
  const p = pin !== null ? PINS[pin] : undefined;
  return (
    <div className="pv-mock">
      <aside className="pv-stack">
        {MOCKUPS.map((x) => (
          <button
            key={x.id}
            type="button"
            className="pv-mock-thumb"
            aria-current={x.id === sel ? 'true' : undefined}
            onClick={() => {
              setSel(x.id);
            }}
          >
            <Wireframe version="v3" pins={false} />
            <span className="pv-idea-top">
              <strong>{x.name}</strong>
              <Chip
                tone={
                  x.state === 'approved'
                    ? 'success'
                    : x.state === 'in review'
                      ? 'warning'
                      : 'neutral'
                }
              >
                {x.state}
              </Chip>
            </span>
            <span className="pv-muted pv-small">
              {x.version} · {x.task}
              {x.changedAfterDev ? ' · changed after work started' : ''}
            </span>
          </button>
        ))}
      </aside>
      <div className="pv-stack">
        {m.changedAfterDev ? (
          <div className="pv-callout pv-callout--warn">
            <PIcon name="incident" size={16} />
            <div>
              <strong>Design changed after work started.</strong> v3 arrived after Lea began{' '}
              {m.task}. The task shows the difference and asks Lea to confirm.
            </div>
          </div>
        ) : null}
        <Card
          title={m.name + ' · ' + m.version}
          action={
            <span className="pv-page-actions">
              <label className="pv-switch">
                <input
                  type="checkbox"
                  checked={compare}
                  onChange={(e) => {
                    setCompare(e.target.checked);
                  }}
                />
                <span>Compare with v3</span>
              </label>
              <Button size="sm" kind="ghost" icon="external">
                Open in Figma
              </Button>
            </span>
          }
        >
          {compare ? (
            <div className="pv-compare">
              <figure>
                <Wireframe version="v3" pins={false} />
                <figcaption>v3</figcaption>
              </figure>
              <figure>
                <Wireframe version="v4" pins={false} />
                <figcaption>v4 · larger ETA, undo button</figcaption>
              </figure>
            </div>
          ) : (
            <Wireframe version="v4" pins onPin={setPin} active={pin} />
          )}
        </Card>
      </div>
      <aside className="pv-stack">
        <Card title="Pinned comments">
          {p ? (
            <div className="pv-thread">
              <div className="pv-thread-head">
                <Avatar id={p.who} size="xs" />
                <strong>{person(p.who).name}</strong>
                {p.resolved ? <Chip tone="success">resolved</Chip> : null}
              </div>
              <p>{p.text}</p>
              <span className="pv-muted pv-small">Click the numbers on the mockup to switch.</span>
            </div>
          ) : null}
        </Card>
        <Card title="Approval">
          <ul className="pv-signers">
            <li>
              <Avatar id="mara" size="sm" />
              <span className="pv-row-main">
                <strong>Mara Schulz</strong>
                <span className="pv-muted pv-small">Lead</span>
              </span>
              <Chip tone="success" icon="check">
                approved
              </Chip>
            </li>
            <li>
              <Avatar id="c-kai" size="sm" />
              <span className="pv-row-main">
                <strong>Kai Lorenz</strong>
                <span className="pv-muted pv-small">Nordwind, in the client portal</span>
              </span>
              {approved ? (
                <Chip tone="success" icon="check">
                  approved
                </Chip>
              ) : (
                <Button
                  size="sm"
                  kind="primary"
                  onClick={() => {
                    setApproved(true);
                  }}
                >
                  Approve as Kai
                </Button>
              )}
            </li>
          </ul>
        </Card>
        <Card title="Handoff">
          <div className="pv-kv">
            <span>Tokens used</span>
            <span>7, all from the kit</span>
            <span>Components</span>
            <span>Dispatch drawer, Tour map pin, Button</span>
            <span>States</span>
            <span>loading, empty, error, 400+ stops</span>
            <span>Breakpoints</span>
            <span>1280, 1600, wall display 2560</span>
          </div>
        </Card>
      </aside>
    </div>
  );
}

function Assets(): ReactNode {
  return (
    <Card
      flush
      title="Assets"
      action={
        <Button size="sm" icon="plus">
          Upload
        </Button>
      }
    >
      <table className="pv-table">
        <thead>
          <tr>
            <th>Asset</th>
            <th>Kind</th>
            <th>Formats</th>
            <th>Rights</th>
            <th>Expires</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {ASSETS.map((a) => (
            <tr key={a.name}>
              <td className="pv-cell-strong">{a.name}</td>
              <td>
                <Chip>{a.kind}</Chip>
              </td>
              <td className="pv-muted pv-small">{a.formats}</td>
              <td>
                <Chip tone={a.tone as 'success'}>{a.rights}</Chip>
              </td>
              <td className={a.tone === 'warning' ? 'pv-text-warning' : 'pv-muted'}>{a.expires}</td>
              <td>
                <Button size="sm" kind="ghost">
                  Download
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Checks(): ReactNode {
  return (
    <div className="pv-stack">
      <div className="pv-stats">
        <Stat
          label="Contrast pairs passing AA"
          value="3 / 4"
          sub="1 chip text fails"
          tone="warning"
          icon="check"
        />
        <Stat
          label="Values that are not tokens"
          value="3"
          sub="in 3 files"
          tone="warning"
          icon="ide"
        />
        <Stat label="Visual changes" value="2" sub="Storybook vs Figma" icon="review" />
        <Stat
          label="Images without alt text"
          value="0"
          sub="all screens"
          tone="success"
          icon="uikit"
        />
      </div>
      <div className="pv-split pv-split--even">
        <Card flush title="Contrast (WCAG 2.2)">
          <table className="pv-table">
            <tbody>
              {CONTRAST.map((c) => (
                <tr key={c.pair}>
                  <td className="pv-cell-grow">{c.pair}</td>
                  <td className="pv-num">{c.ratio.toFixed(1)} : 1</td>
                  <td>
                    <Chip tone={c.aa ? 'success' : 'danger'}>AA {c.aa ? 'pass' : 'fail'}</Chip>
                  </td>
                  <td>
                    <Chip tone={c.aaa ? 'success' : 'neutral'}>AAA {c.aaa ? 'pass' : 'no'}</Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card flush title="In the code but not in the kit">
          <table className="pv-table">
            <tbody>
              {HARDCODED.map((h) => (
                <tr key={h.file}>
                  <td className="pv-mono pv-small">
                    {h.file}:{h.line}
                  </td>
                  <td className="pv-mono">{h.value}</td>
                  <td className="pv-muted pv-small">use {h.suggest}</td>
                  <td>
                    <Button size="sm" kind="ghost" icon="agents">
                      Fix with Coder
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

const VIEWS: { key: string; label: string; icon: PIconName }[] = [
  { key: 'brand', label: 'Brand', icon: 'uikit' },
  { key: 'tokens', label: 'Tokens', icon: 'codemap' },
  { key: 'components', label: 'Components', icon: 'overview' },
  { key: 'mockups', label: 'Mockups', icon: 'review' },
  { key: 'assets', label: 'Assets', icon: 'documents' },
  { key: 'checks', label: 'Checks', icon: 'check' },
];

export function UiKitTab(): ReactNode {
  const [view, setView] = useState('mockups');
  return (
    <div className="pv-stack">
      <nav className="pv-subtabs" aria-label="UI kit view">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            className="pv-subtab"
            aria-pressed={view === v.key}
            onClick={() => {
              setView(v.key);
            }}
          >
            <PIcon name={v.icon} size={14} />
            {v.label}
          </button>
        ))}
      </nav>
      {view === 'brand' ? <Brand /> : null}
      {view === 'tokens' ? <Tokens /> : null}
      {view === 'components' ? <Components /> : null}
      {view === 'mockups' ? <Mockups /> : null}
      {view === 'assets' ? <Assets /> : null}
      {view === 'checks' ? <Checks /> : null}
    </div>
  );
}
