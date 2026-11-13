// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-157 | S15 | v0.1.0] D5 preview: Agents, People, Tokens and costs, Activity, Insights, Settings ──
//    Why:  the People section: members of the team and of the clients, roles built from permissions,
//          sign-in rules (SSO, SCIM, MFA) and sessions, and governance: an access review, a checker that
//          answers "why can this person see that", and offboarding that hands over tasks, agents and tokens
//          before an account is suspended.
import { useState, type ReactNode } from 'react';
import { MEMBERS, PERMISSIONS, ROLE_MATRIX } from './data5.js';
import { person } from './data.js';
import { PIcon, type PIconName } from './picons.js';
import { Avatar, Button, Card, Chip, PageHead, Stat } from './ui.js';

function Members(): ReactNode {
  const [q, setQ] = useState('');
  const [who, setWho] = useState<'all' | 'team' | 'clients'>('all');
  const list = MEMBERS.filter((m) =>
    who === 'all' ? true : who === 'clients' ? m.id.startsWith('c-') : !m.id.startsWith('c-'),
  ).filter((m) => !q || person(m.id).name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Card
      flush
      title={'Members · ' + String(list.length)}
      action={
        <span className="pv-page-actions">
          <label className="pv-tree-search">
            <PIcon name="search" size={14} />
            <input
              value={q}
              placeholder="Find a person"
              aria-label="Find a person"
              onChange={(e) => {
                setQ(e.target.value);
              }}
            />
          </label>
          <div className="pv-segmented" role="radiogroup" aria-label="Show">
            {(['all', 'team', 'clients'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={who === k}
                className="pv-seg"
                onClick={() => {
                  setWho(k);
                }}
              >
                {k === 'all' ? 'Everyone' : k === 'team' ? 'Team' : 'Clients'}
              </button>
            ))}
          </div>
          <Button size="sm" kind="primary" icon="plus">
            Invite
          </Button>
        </span>
      }
    >
      <table className="pv-table">
        <thead>
          <tr>
            <th>Person</th>
            <th>Role</th>
            <th>Team</th>
            <th>Projects</th>
            <th>Second factor</th>
            <th>Last active</th>
            <th>Seat</th>
          </tr>
        </thead>
        <tbody>
          {list.map((m) => (
            <tr key={m.id}>
              <td>
                <span className="pv-who">
                  <Avatar id={m.id} size="sm" />
                  <span>
                    <strong>{person(m.id).name}</strong>
                    <span className="pv-muted pv-block pv-small">{person(m.id).title}</span>
                  </span>
                </span>
              </td>
              <td>
                <Chip
                  tone={
                    m.role === 'Owner' || m.role === 'Admin'
                      ? 'primary'
                      : m.role.startsWith('Client')
                        ? 'info'
                        : 'neutral'
                  }
                >
                  {m.role}
                </Chip>
              </td>
              <td>{m.team}</td>
              <td className="pv-mono pv-small">{m.projects}</td>
              <td>
                {m.mfa === 'none' ? (
                  <Chip tone="danger">none</Chip>
                ) : (
                  <Chip tone="success">{m.mfa}</Chip>
                )}
              </td>
              <td className="pv-muted">{m.last}</td>
              <td className="pv-muted pv-small">{m.seat}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Roles(): ReactNode {
  const [matrix, setMatrix] = useState(ROLE_MATRIX);
  const roles = Object.keys(matrix);
  return (
    <Card
      flush
      title="Roles and what they may do"
      action={
        <Button size="sm" icon="plus">
          Custom role
        </Button>
      }
    >
      <div className="pv-grid-scroll">
        <table className="pv-table pv-access">
          <thead>
            <tr>
              <th>Permission</th>
              {roles.map((r) => (
                <th key={r} className="pv-center">
                  {r}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSIONS.map((p, i) => (
              <tr key={p}>
                <td>{p}</td>
                {roles.map((r) => (
                  <td key={r} className="pv-access-cell">
                    <input
                      type="checkbox"
                      aria-label={r + ': ' + p}
                      checked={matrix[r]?.[i] ?? false}
                      disabled={r === 'Owner'}
                      onChange={(e) => {
                        setMatrix((m) => ({
                          ...m,
                          [r]: (m[r] ?? []).map((v, j) => (j === i ? e.target.checked : v)),
                        }));
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="pv-muted pv-small pv-pad">
        A project role overrides the workspace role for that project. Conditions are possible, e.g.
        “Deploy to production only on weekdays 08–18”.
      </p>
    </Card>
  );
}

function SignIn(): ReactNode {
  return (
    <div className="pv-split pv-split--even">
      <Card title="Sign-in">
        <div className="pv-kv pv-kv--wide">
          <span>Single sign-on</span>
          <span>
            <Chip tone="success">OIDC · Microsoft Entra</Chip> for broszio.dev
          </span>
          <span>SAML</span>
          <span>available, not used</span>
          <span>Provisioning (SCIM)</span>
          <span>
            <Chip tone="warning">not set up</Chip> people are added by hand
          </span>
          <span>Second factor</span>
          <span>required for Owner, Admin and anyone who can deploy · 2 people without it</span>
          <span>Break-glass</span>
          <span>1 owner account works without SSO</span>
          <span>Sessions</span>
          <span>idle 12 h · at most 14 days</span>
        </div>
      </Card>
      <Card flush title="Your sessions">
        <ul className="pv-rows">
          {[
            ['Edge on Windows · Hamburg', 'this session', true],
            ['VS Code · Orqiva extension', 'active 2 min ago', false],
            ['Safari on iPhone · installed app', 'active yesterday', false],
          ].map(([d, w, cur]) => (
            <li key={String(d)} className="pv-row pv-row--static">
              <span className="pv-kind pv-kind--review">
                <PIcon name="lock" size={15} />
              </span>
              <span className="pv-row-main">
                <span className="pv-row-title">{d}</span>
                <span className="pv-row-sub">{w}</span>
              </span>
              {cur ? (
                <Chip tone="success">this one</Chip>
              ) : (
                <Button size="sm" kind="ghost">
                  Sign out
                </Button>
              )}
            </li>
          ))}
          <li className="pv-row pv-row--static">
            <Button size="sm">Sign out everywhere else</Button>
          </li>
        </ul>
      </Card>
    </div>
  );
}

function Governance(): ReactNode {
  const [why, setWhy] = useState(false);
  const [step, setStep] = useState(0);
  const steps = ['Choose who leaves', 'Hand over work', 'Revoke access', 'Suspend'];
  return (
    <div className="pv-stack">
      <div className="pv-stats">
        <Stat
          label="Access review Q4"
          value="4 / 14"
          sub="certified · due 15 Oct"
          tone="warning"
          icon="approval"
        />
        <Stat label="Not seen for 30 days" value="1" sub="Paul Richter (client)" icon="clock" />
        <Stat label="Without second factor" value="2" sub="Tim, Nico" tone="danger" icon="lock" />
        <Stat
          label="Agents as members"
          value="6"
          sub="each with an accountable person"
          icon="agents"
        />
      </div>
      <div className="pv-split pv-split--even">
        <Card title="Why can this person see that?">
          <div className="pv-ask">
            <select className="pv-select pv-select--full" defaultValue="c-kai" aria-label="Person">
              <option value="c-kai">Kai Lorenz (Nordwind)</option>
              <option value="tim">Tim Hoffmann</option>
            </select>
            <select className="pv-select pv-select--full" defaultValue="adr" aria-label="Object">
              <option value="adr">ADR-007 Live routing</option>
              <option value="cost">NWL costs</option>
            </select>
            <Button
              kind="primary"
              onClick={() => {
                setWhy(true);
              }}
            >
              Check
            </Button>
          </div>
          {why ? (
            <ol className="pv-why">
              <li>
                <Chip tone="danger">No</Chip> Kai cannot see ADR-007.
              </li>
              <li>
                Kai is a client approver on NWL; clients see only pages in “Shared with Nordwind”.
              </li>
              <li>ADR-007 is in “Architecture”, which is not shared.</li>
              <li className="pv-muted">
                To share it: move or copy the page to the shared folder, or share this page alone.
              </li>
            </ol>
          ) : (
            <p className="pv-muted pv-small">
              Explains every allow or deny from roles, project membership, sharing and conditions.
            </p>
          )}
        </Card>
        <Card title="Offboarding · Tim Hoffmann">
          <ol className="pv-wizard">
            {steps.map((s, i) => (
              <li
                key={s}
                className={
                  i < step ? 'pv-wiz pv-wiz--done' : i === step ? 'pv-wiz pv-wiz--now' : 'pv-wiz'
                }
              >
                <span className="pv-wiz-n">
                  {i < step ? <PIcon name="check" size={12} /> : i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
          {step === 1 ? (
            <ul className="pv-changes">
              <li>4 open tasks → Lea Wagner</li>
              <li>Driver app lead → Nico Brandt</li>
              <li>2 schedules of the Tester agent → Sara Yilmaz</li>
            </ul>
          ) : step === 2 ? (
            <ul className="pv-changes">
              <li>3 personal tokens revoked, 1 runner token rotated</li>
              <li>All sessions signed out on 3 devices</li>
            </ul>
          ) : step === 3 ? (
            <p className="pv-muted pv-small">
              Account suspended, not deleted: history keeps the name. Seat freed for the next
              invoice.
            </p>
          ) : null}
          <div className="pv-page-actions pv-mt">
            <Button
              kind="primary"
              onClick={() => {
                setStep((s) => Math.min(steps.length - 1, s + 1));
              }}
            >
              {step === steps.length - 1 ? 'Done' : 'Next'}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

const VIEWS: { key: string; label: string; icon: PIconName }[] = [
  { key: 'members', label: 'Members', icon: 'people' },
  { key: 'roles', label: 'Roles', icon: 'approval' },
  { key: 'signin', label: 'Sign-in and sessions', icon: 'lock' },
  { key: 'gov', label: 'Governance', icon: 'check' },
];

export function PeoplePage(): ReactNode {
  const [view, setView] = useState('members');
  return (
    <div className="pv-page">
      <PageHead
        title="People"
        sub="11 people · 8 team, 3 client · 14 of 18 seats used"
        icon="people"
      />
      <nav className="pv-subtabs pv-mb" aria-label="People view">
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
      {view === 'members' ? <Members /> : null}
      {view === 'roles' ? <Roles /> : null}
      {view === 'signin' ? <SignIn /> : null}
      {view === 'gov' ? <Governance /> : null}
    </div>
  );
}
