// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-250 | S15 | v0.1.0] T25.5 Profiles, GDPR export and erasure, version check on task edits ──
// ── [PCODE-248 | S15 | v0.1.0] T25.3 Custom roles, role conditions and project roles enforced ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-182 | S15 | v0.1.0] B5.3 People live: members, teams, roles, sign-in rules and sessions, access reviews, access checker, offboarding ──
//    Why:  the People section of the approved design on the server. Members of the team and of the
//          clients with role, teams, projects, second factor, last activity and seat; teams; what each role
//          may do and custom roles; the sign-in rules and your own sessions; governance: an access review,
//          who has not been seen or has no second factor, a checker that explains "why can this person see
//          that", and offboarding that hands over work before the membership is suspended.
import { conditionText, ROLE_TEXT } from '@orqiva/shared';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { PIcon, type PIconName } from '../preview/picons.js';
import { Button, Card, Chip, PageHead, Stat } from '../preview/ui.js';
import { ago } from './inbox.js';
import { LiveAvatar } from './shell.js';
import { dateText } from './versions.js';
import { PersonPanel } from './profile.js'; // [PCODE-250 | S15 | v0.1.0]

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;
type Tone = 'success' | 'danger' | 'warning' | 'neutral' | 'info' | 'primary';

export interface PersonRow {
  userId: string;
  name: string;
  email: string;
  role: string;
  customRoleId: string | null;
  customRoleName: string | null;
  teams: string[];
  projects: number;
  clientName: string | null;
  isService: boolean;
  secondFactor: boolean;
  lastActiveAt: string | null;
  stale: boolean;
  suspendedAt: string | null;
  takesSeat: boolean;
  joinedAt: string;
}
interface PeopleData {
  people: PersonRow[];
  seats: { used: number; total: number };
  invitations: { id: string; email: string; role: string; expiresAt: string }[];
}

const roleText = (r: string): string => (ROLE_TEXT as Record<string, string | undefined>)[r] ?? r;
export const roleTone = (p: Pick<PersonRow, 'role' | 'clientName'>): Tone =>
  p.role === 'owner' || p.role === 'admin' ? 'primary' : p.clientName ? 'info' : 'neutral';

/** Which people a filter shows: everyone active, the team, client contacts, service accounts, suspended. */
export function peopleIn(list: readonly PersonRow[], who: string, q: string): PersonRow[] {
  const t = q.trim().toLowerCase();
  return list
    .filter((p) =>
      who === 'suspended'
        ? Boolean(p.suspendedAt)
        : !p.suspendedAt &&
          (who === 'all' ||
            (who === 'team'
              ? !p.clientName && !p.isService
              : who === 'clients'
                ? Boolean(p.clientName)
                : p.isService)),
    )
    .filter((p) => !t || p.name.toLowerCase().includes(t) || p.email.toLowerCase().includes(t));
}

type View = 'members' | 'roles' | 'signin' | 'gov';

export function PeopleHub(props: {
  workspaceId: string;
  role: string;
  meId: string;
  go: (p: string) => void;
}): ReactNode {
  const isAdmin = props.role === 'admin' || props.role === 'owner';
  const [view, setView] = useState<View>('members');
  const [data, setData] = useState<PeopleData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<PeopleData>('GET', W(props.workspaceId, '/people'));
    if (r.ok) setData(r.data);
    else setError(r.error.message);
  }, [props.workspaceId]);
  useEffect(() => {
    void load();
  }, [load]);
  const views: { key: View; label: string; icon: PIconName }[] = [
    { key: 'members', label: 'Members', icon: 'people' },
    { key: 'roles', label: 'Roles', icon: 'approval' },
    { key: 'signin', label: 'Sign-in and sessions', icon: 'lock' },
    ...(isAdmin ? [{ key: 'gov' as View, label: 'Governance', icon: 'check' as PIconName }] : []),
  ];
  const active = data?.people.filter((p) => !p.suspendedAt) ?? [];
  return (
    <div className="pv-page">
      <PageHead
        title="People"
        sub={
          data
            ? String(active.filter((p) => !p.isService).length) +
              ' people · ' +
              String(active.filter((p) => !p.clientName && !p.isService).length) +
              ' team, ' +
              String(active.filter((p) => p.clientName).length) +
              ' client · ' +
              String(data.seats.used) +
              ' of ' +
              String(data.seats.total) +
              ' seats used'
            : 'Loading…'
        }
        icon="people"
      />
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      <nav className="pv-subtabs pv-mb" aria-label="People view">
        {views.map((v) => (
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
      {view === 'members' && data ? (
        <Members
          workspaceId={props.workspaceId}
          isAdmin={isAdmin}
          isOwner={props.role === 'owner'} // [PCODE-250 | S15 | v0.1.0]
          data={data}
          onChange={() => void load()}
        />
      ) : null}
      {view === 'roles' && data ? (
        <Roles
          workspaceId={props.workspaceId}
          isAdmin={isAdmin}
          people={active}
          onChange={() => void load()}
        />
      ) : null}
      {view === 'signin' ? <SignIn workspaceId={props.workspaceId} isAdmin={isAdmin} /> : null}
      {view === 'gov' && isAdmin && data ? (
        <Governance
          workspaceId={props.workspaceId}
          meId={props.meId}
          people={data.people}
          onChange={() => void load()}
        />
      ) : null}
    </div>
  );
}

// ── members ──

function Members(props: {
  workspaceId: string;
  isAdmin: boolean;
  isOwner?: boolean; // [PCODE-250 | S15 | v0.1.0]
  data: PeopleData;
  onChange: () => void;
}): ReactNode {
  const [q, setQ] = useState('');
  const [who, setWho] = useState('all');
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [link, setLink] = useState<string | null>(null);
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null); // [PCODE-250 | S15 | v0.1.0] the person whose panel is open
  const list = peopleIn(props.data.people, who, q);
  const openPerson = props.data.people.find((p) => p.userId === open);
  const invite = async (): Promise<void> => {
    const r = await api<{ token: string }>('POST', W(props.workspaceId, '/invitations'), {
      email: email.trim(),
      role,
    });
    if (!r.ok) setError(r.error.message);
    else {
      setLink(window.location.origin + '/invite/' + r.data.token);
      setEmail('');
      props.onChange();
    }
  };
  const changeRole = async (p: PersonRow, r: string): Promise<void> => {
    const res = await api('PATCH', W(props.workspaceId, '/members/' + p.userId), { role: r });
    if (!res.ok) setError(res.error.message);
    props.onChange();
  };
  return (
    <div className="pv-stack">
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      {inviting ? (
        <Card title="Invite someone">
          <form
            className="v2-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (email.trim()) void invite();
            }}
          >
            <input
              className="v2-input"
              type="email"
              aria-label="Email"
              placeholder="name@company.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
            />
            <select
              className="v2-input"
              aria-label="Role"
              value={role}
              onChange={(e) => {
                setRole(e.target.value);
              }}
            >
              {['admin', 'member', 'tester', 'designer', 'billing', 'auditor', 'guest'].map((r) => (
                <option key={r} value={r}>
                  {roleText(r)}
                </option>
              ))}
            </select>
            <button type="submit" className="pv-btn pv-btn--primary pv-btn--sm">
              Make invitation link
            </button>
            <Button
              size="sm"
              kind="ghost"
              onClick={() => {
                setInviting(false);
                setLink(null);
              }}
            >
              Close
            </Button>
          </form>
          {link ? (
            <p className="pv-small">
              Send this link; it works once, for 14 days: <span className="pv-mono">{link}</span>
            </p>
          ) : null}
        </Card>
      ) : null}
      {teamsOpen ? (
        <Teams
          workspaceId={props.workspaceId}
          people={props.data.people.filter((p) => !p.suspendedAt && !p.isService)}
          onClose={() => {
            setTeamsOpen(false);
            props.onChange();
          }}
        />
      ) : null}
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
              {(
                [
                  ['all', 'Everyone'],
                  ['team', 'Team'],
                  ['clients', 'Clients'],
                  ['service', 'Service'],
                  ['suspended', 'Suspended'],
                ] as const
              ).map(([k, l]) => (
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
                  {l}
                </button>
              ))}
            </div>
            {props.isAdmin ? (
              <>
                <Button
                  size="sm"
                  kind="ghost"
                  onClick={() => {
                    setTeamsOpen(true);
                  }}
                >
                  Teams
                </Button>
                <Button
                  size="sm"
                  kind="primary"
                  icon="plus"
                  onClick={() => {
                    setInviting(true);
                  }}
                >
                  Invite
                </Button>
              </>
            ) : null}
          </span>
        }
      >
        <div className="pv-grid-scroll">
          <table className="pv-table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Role</th>
                <th>Team</th>
                <th className="pv-num">Projects</th>
                <th>Second factor</th>
                <th>Last active</th>
                <th>Seat</th>
                {props.isAdmin ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.userId} className={p.suspendedAt ? 'v2-row-off' : undefined}>
                  <td>
                    <span className="pv-who">
                      <LiveAvatar id={p.userId} name={p.name} size="sm" agent={p.isService} />
                      <span>
                        <strong>{p.name}</strong>
                        <span className="pv-muted pv-block pv-small">
                          {p.isService
                            ? 'service account'
                            : p.clientName
                              ? p.clientName + ' · ' + p.email
                              : p.email}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td>
                    {props.isAdmin &&
                    p.role !== 'owner' &&
                    !p.suspendedAt &&
                    !p.customRoleId &&
                    !p.clientName ? (
                      <select
                        className="v2-input v2-input--sm"
                        aria-label={'Role of ' + p.name}
                        value={p.role}
                        onChange={(e) => void changeRole(p, e.target.value)}
                      >
                        {[
                          'admin',
                          'member',
                          'tester',
                          'designer',
                          'billing',
                          'auditor',
                          'guest',
                        ].map((r) => (
                          <option key={r} value={r}>
                            {roleText(r)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Chip tone={roleTone(p)}>{p.customRoleName ?? roleText(p.role)}</Chip>
                    )}
                  </td>
                  <td>{p.teams.join(', ') || <span className="pv-muted">—</span>}</td>
                  <td className="pv-num">{p.projects}</td>
                  <td>
                    {p.isService ? (
                      <span className="pv-muted">—</span>
                    ) : p.secondFactor ? (
                      <Chip tone="success">on</Chip>
                    ) : (
                      <Chip tone="danger">none</Chip>
                    )}
                  </td>
                  <td className={p.stale ? 'pv-text-warning' : 'pv-muted'}>
                    {p.lastActiveAt ? ago(p.lastActiveAt) + ' ago' : 'never'}
                  </td>
                  <td className="pv-muted pv-small">
                    {p.suspendedAt
                      ? 'suspended ' + dateText(p.suspendedAt)
                      : p.takesSeat
                        ? 'team seat'
                        : p.clientName
                          ? 'portal, free'
                          : 'no seat'}
                  </td>
                  {/* [PCODE-250 | S15 | v0.1.0] profile, data and erasure */}
                  {props.isAdmin ? (
                    <td>
                      {p.isService ? null : (
                        <Button
                          size="sm"
                          kind="ghost"
                          onClick={() => {
                            setOpen(open === p.userId ? null : p.userId);
                          }}
                        >
                          {p.suspendedAt ? 'Data' : 'Profile'}
                        </Button>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {openPerson ? (
          <div className="v2-pad">
            <PersonPanel
              key={openPerson.userId}
              workspaceId={props.workspaceId}
              person={openPerson}
              people={props.data.people.filter((x) => !x.suspendedAt && !x.isService)}
              isOwner={Boolean(props.isOwner)}
              onClose={() => {
                setOpen(null);
              }}
              onChange={props.onChange}
            />
          </div>
        ) : null}
        {props.data.invitations.length ? (
          <p className="pv-muted pv-small v2-pad">
            Invited, not joined yet:{' '}
            {props.data.invitations.map((i) => i.email + ' (' + roleText(i.role) + ')').join(', ')}
          </p>
        ) : null}
      </Card>
    </div>
  );
}

interface Team {
  id: string;
  name: string;
  parentId: string | null;
  members: { userId: string; name: string; lead: boolean }[];
}

function Teams(props: {
  workspaceId: string;
  people: PersonRow[];
  onClose: () => void;
}): ReactNode {
  const [teams, setTeams] = useState<Team[]>([]);
  const [edit, setEdit] = useState<{
    id?: string;
    name: string;
    members: string[];
    leads: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api<Team[]>('GET', W(props.workspaceId, '/teams')).then((r) => {
      if (r.ok) setTeams(r.data);
    });
  }, [props.workspaceId]);
  const save = async (): Promise<void> => {
    if (!edit) return;
    const r = await api<Team[]>('PUT', W(props.workspaceId, '/teams'), {
      ...(edit.id ? { id: edit.id } : {}),
      name: edit.name.trim(),
      memberIds: edit.members,
      leadIds: edit.leads,
    });
    if (!r.ok) setError(r.error.message);
    else {
      setTeams(r.data);
      setEdit(null);
    }
  };
  const remove = async (t: Team): Promise<void> => {
    const r = await api<Team[]>('DELETE', W(props.workspaceId, '/teams/' + t.id));
    if (r.ok) setTeams(r.data);
  };
  return (
    <Card
      title="Teams"
      action={
        <Button size="sm" kind="ghost" onClick={props.onClose}>
          Close
        </Button>
      }
    >
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="pv-rows">
        {teams.map((t) => (
          <li key={t.id} className="pv-row pv-row--static">
            <span className="pv-row-main">
              <span className="pv-row-title">{t.name}</span>
              <span className="pv-row-sub">
                {t.members.map((m) => m.name + (m.lead ? ' (lead)' : '')).join(', ') ||
                  'nobody yet'}
              </span>
            </span>
            <Button
              size="sm"
              kind="ghost"
              onClick={() => {
                setEdit({
                  id: t.id,
                  name: t.name,
                  members: t.members.map((m) => m.userId),
                  leads: t.members.filter((m) => m.lead).map((m) => m.userId),
                });
              }}
            >
              Change
            </Button>
            <button
              type="button"
              className="pv-mini-btn"
              aria-label={'Remove team ' + t.name}
              onClick={() => void remove(t)}
            >
              <PIcon name="x" size={12} />
            </button>
          </li>
        ))}
      </ul>
      {edit ? (
        <div className="pv-stack pv-mt">
          <input
            className="v2-input"
            aria-label="Team name"
            placeholder="Team name"
            value={edit.name}
            onChange={(e) => {
              setEdit({ ...edit, name: e.target.value });
            }}
          />
          <div className="v2-switches">
            {props.people.map((p) => (
              <span key={p.userId} className="v2-inline">
                <label className="v2-switch">
                  <input
                    type="checkbox"
                    checked={edit.members.includes(p.userId)}
                    onChange={(e) => {
                      setEdit({
                        ...edit,
                        members: e.target.checked
                          ? [...edit.members, p.userId]
                          : edit.members.filter((x) => x !== p.userId),
                        leads: edit.leads.filter((x) => x !== p.userId || e.target.checked),
                      });
                    }}
                  />
                  <span>{p.name}</span>
                </label>
                {edit.members.includes(p.userId) ? (
                  <label className="v2-switch">
                    <input
                      type="checkbox"
                      checked={edit.leads.includes(p.userId)}
                      onChange={(e) => {
                        setEdit({
                          ...edit,
                          leads: e.target.checked
                            ? [...edit.leads, p.userId]
                            : edit.leads.filter((x) => x !== p.userId),
                        });
                      }}
                    />
                    <span className="pv-muted pv-small">lead</span>
                  </label>
                ) : null}
              </span>
            ))}
          </div>
          <div className="pv-page-actions">
            <Button size="sm" kind="primary" onClick={() => void save()}>
              Save team
            </Button>
            <Button
              size="sm"
              kind="ghost"
              onClick={() => {
                setEdit(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          icon="plus"
          onClick={() => {
            setEdit({ name: '', members: [], leads: [] });
          }}
        >
          New team
        </Button>
      )}
    </Card>
  );
}

// ── roles ──

interface RolesData {
  builtIn: { key: string; label: string; roles: string[] }[];
  custom: {
    id: string;
    name: string;
    baseRole: string;
    permissions: string[];
    members: number;
    // [PCODE-248 | S15 | v0.1.0] when a permission holds
    conditions: Record<string, { weekdays?: number[]; hours?: [number, number] }>;
  }[];
}
const MATRIX_ROLES = [
  'owner',
  'admin',
  'member',
  'tester',
  'designer',
  'billing',
  'auditor',
  'guest',
];

function Roles(props: {
  workspaceId: string;
  isAdmin: boolean;
  people: PersonRow[];
  onChange: () => void;
}): ReactNode {
  const [d, setD] = useState<RolesData | null>(null);
  const [form, setForm] = useState<{ name: string; base: string; perms: string[] } | null>(null);
  const [assign, setAssign] = useState({ user: '', role: '' });
  const [when, setWhen] = useState<When | null>(null); // [PCODE-248 | S15 | v0.1.0]
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<RolesData>('GET', W(props.workspaceId, '/roles'));
    if (r.ok) setD(r.data);
  }, [props.workspaceId]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!d)
    return (
      <p className="pv-muted" role="status">
        Loading roles…
      </p>
    );
  const baseHas = (base: string, key: string): boolean =>
    d.builtIn.find((p) => p.key === key)?.roles.includes(base) ?? false;
  const add = async (): Promise<void> => {
    if (!form) return;
    const r = await api<RolesData['custom']>('POST', W(props.workspaceId, '/roles'), {
      name: form.name.trim(),
      baseRole: form.base,
      permissions: form.perms,
    });
    if (!r.ok) setError(r.error.message);
    else {
      setForm(null);
      void load();
    }
  };
  const give = async (): Promise<void> => {
    const r = await api('PUT', W(props.workspaceId, '/members/' + assign.user + '/custom-role'), {
      roleId: assign.role || null,
    });
    if (!r.ok) setError(r.error.message);
    else {
      props.onChange();
      void load();
    }
  };
  // [PCODE-248 | S15 | v0.1.0] a role's conditions, saved whole
  const saveWhen = async (
    roleId: string,
    conditions: Record<string, { weekdays?: number[]; hours?: [number, number] }>,
  ): Promise<void> => {
    const r = await api('PATCH', W(props.workspaceId, '/roles/' + roleId), { conditions });
    if (!r.ok) setError(r.error.message);
    else {
      setError(null);
      setWhen(null);
      void load();
    }
  };
  const remove = async (id: string): Promise<void> => {
    await api('DELETE', W(props.workspaceId, '/roles/' + id));
    void load();
    props.onChange();
  };
  return (
    <div className="pv-stack">
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      <Card flush title="Roles and what they may do">
        <div className="pv-grid-scroll">
          <table className="pv-table pv-access">
            <thead>
              <tr>
                <th>Permission</th>
                {MATRIX_ROLES.map((r) => (
                  <th key={r} className="pv-center">
                    {roleText(r)}
                  </th>
                ))}
                {d.custom.map((c) => (
                  <th key={c.id} className="pv-center">
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.builtIn.map((p) => (
                <tr key={p.key}>
                  <td>{p.label}</td>
                  {MATRIX_ROLES.map((r) => (
                    <td key={r} className="pv-access-cell pv-center">
                      {p.roles.includes(r) ? (
                        <PIcon name="check" size={14} />
                      ) : (
                        <span className="pv-muted">—</span>
                      )}
                    </td>
                  ))}
                  {d.custom.map((c) => (
                    <td key={c.id} className="pv-access-cell pv-center">
                      {c.permissions.includes(p.key) ? (
                        <PIcon name="check" size={14} />
                      ) : (
                        <span className="pv-muted">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="pv-muted pv-small v2-pad">
          This is what the server enforces. A custom role starts from a base role and can only keep
          or narrow it; its people get the base role.
        </p>
      </Card>
      {props.isAdmin ? (
        <div className="pv-split pv-split--even">
          <Card
            title="Custom roles"
            action={
              form ? null : (
                <Button
                  size="sm"
                  icon="plus"
                  onClick={() => {
                    setForm({
                      name: '',
                      base: 'member',
                      perms: d.builtIn.filter((p) => p.roles.includes('member')).map((p) => p.key),
                    });
                  }}
                >
                  Custom role
                </Button>
              )
            }
          >
            {d.custom.length ? (
              <ul className="pv-rows">
                {d.custom.map((c) => (
                  <li key={c.id} className="pv-row pv-row--static">
                    <span className="pv-row-main">
                      <span className="pv-row-title">{c.name}</span>
                      <span className="pv-row-sub">
                        on {roleText(c.baseRole)} · {c.members}{' '}
                        {c.members === 1 ? 'person' : 'people'}
                        {/* [PCODE-248 | S15 | v0.1.0] */}
                        {Object.entries(c.conditions).map(([k, v]) => (
                          <span key={k}>
                            {' · '}
                            {d.builtIn.find((p) => p.key === k)?.label ?? k} only {conditionText(v)}
                          </span>
                        ))}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      kind="ghost"
                      onClick={() => {
                        // the condition the role has, or weekdays 8 to 18 for its first writing permission
                        const [k, v] = Object.entries(c.conditions)[0] ?? [
                          c.permissions.find((p) => p !== 'read') ?? c.permissions[0] ?? 'write',
                          { weekdays: [1, 2, 3, 4, 5], hours: [8, 18] as [number, number] },
                        ];
                        setWhen({
                          roleId: c.id,
                          permission: k,
                          days: v.weekdays ?? [1, 2, 3, 4, 5, 6, 7],
                          from: String(v.hours?.[0] ?? 0),
                          to: String(v.hours?.[1] ?? 24),
                        });
                      }}
                    >
                      When
                    </Button>
                    <button
                      type="button"
                      className="pv-mini-btn"
                      aria-label={'Remove role ' + c.name}
                      onClick={() => void remove(c.id)}
                    >
                      <PIcon name="x" size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="pv-muted pv-small">No custom roles yet.</p>
            )}
            {when ? (
              <ConditionForm
                role={d.custom.find((c) => c.id === when.roleId)}
                labels={d.builtIn}
                value={when}
                onChange={setWhen}
                onSave={(conditions) => void saveWhen(when.roleId, conditions)}
                onCancel={() => {
                  setWhen(null);
                }}
              />
            ) : null}
            {form ? (
              <div className="pv-stack pv-mt">
                <div className="v2-form">
                  <input
                    className="v2-input"
                    aria-label="Role name"
                    placeholder="e.g. Reviewer"
                    value={form.name}
                    onChange={(e) => {
                      setForm({ ...form, name: e.target.value });
                    }}
                  />
                  <select
                    className="v2-input"
                    aria-label="Base role"
                    value={form.base}
                    onChange={(e) => {
                      const base = e.target.value;
                      setForm({
                        ...form,
                        base,
                        perms: d.builtIn.filter((p) => p.roles.includes(base)).map((p) => p.key),
                      });
                    }}
                  >
                    {MATRIX_ROLES.filter((r) => r !== 'owner').map((r) => (
                      <option key={r} value={r}>
                        on {roleText(r)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="v2-switches">
                  {d.builtIn
                    .filter((p) => baseHas(form.base, p.key))
                    .map((p) => (
                      <label key={p.key} className="v2-switch">
                        <input
                          type="checkbox"
                          checked={form.perms.includes(p.key)}
                          onChange={(e) => {
                            setForm({
                              ...form,
                              perms: e.target.checked
                                ? [...form.perms, p.key]
                                : form.perms.filter((x) => x !== p.key),
                            });
                          }}
                        />
                        <span>{p.label}</span>
                      </label>
                    ))}
                </div>
                <div className="pv-page-actions">
                  <Button size="sm" kind="primary" onClick={() => void add()}>
                    Add role
                  </Button>
                  <Button
                    size="sm"
                    kind="ghost"
                    onClick={() => {
                      setForm(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
          </Card>
          <Card title="Give someone a custom role">
            <div className="v2-form">
              <select
                className="v2-input"
                aria-label="Person"
                value={assign.user}
                onChange={(e) => {
                  setAssign({ ...assign, user: e.target.value });
                }}
              >
                <option value="">Pick a person…</option>
                {props.people
                  .filter((p) => p.role !== 'owner' && !p.isService)
                  .map((p) => (
                    <option key={p.userId} value={p.userId}>
                      {p.name} ({p.customRoleName ?? roleText(p.role)})
                    </option>
                  ))}
              </select>
              <select
                className="v2-input"
                aria-label="Custom role"
                value={assign.role}
                onChange={(e) => {
                  setAssign({ ...assign, role: e.target.value });
                }}
              >
                <option value="">No custom role</option>
                {d.custom.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <Button size="sm" kind="primary" disabled={!assign.user} onClick={() => void give()}>
                Apply
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

// ── [PCODE-248 | S15 | v0.1.0] when a custom role's permission holds ──

interface When {
  roleId: string;
  permission: string;
  days: number[];
  from: string;
  to: string;
}
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function ConditionForm(props: {
  role: RolesData['custom'][number] | undefined;
  labels: RolesData['builtIn'];
  value: When;
  onChange: (w: When) => void;
  onSave: (conditions: RolesData['custom'][number]['conditions']) => void;
  onCancel: () => void;
}): ReactNode {
  const r = props.role;
  if (!r) return null;
  const w = props.value;
  const others = Object.fromEntries(
    Object.entries(r.conditions).filter(([k]) => k !== w.permission),
  );
  return (
    <div className="pv-stack pv-mt" aria-label={'When ' + r.name + ' may act'}>
      <strong className="pv-small">When {r.name} may</strong>
      <select
        className="v2-input"
        aria-label="Permission"
        value={w.permission}
        onChange={(e) => {
          props.onChange({ ...w, permission: e.target.value });
        }}
      >
        {r.permissions.map((k) => (
          <option key={k} value={k}>
            {props.labels.find((p) => p.key === k)?.label ?? k}
          </option>
        ))}
      </select>
      <div className="v2-switches">
        {WEEKDAYS.map((d, i) => (
          <label key={d} className="v2-switch">
            <input
              type="checkbox"
              checked={w.days.includes(i + 1)}
              onChange={(e) => {
                props.onChange({
                  ...w,
                  days: e.target.checked
                    ? [...w.days, i + 1].sort((a, b) => a - b)
                    : w.days.filter((x) => x !== i + 1),
                });
              }}
            />
            <span>{d}</span>
          </label>
        ))}
      </div>
      <div className="v2-inline">
        <span className="pv-small">from</span>
        <input
          className="v2-input v2-input--sm"
          aria-label="From hour"
          size={3}
          value={w.from}
          onChange={(e) => {
            props.onChange({ ...w, from: e.target.value });
          }}
        />
        <span className="pv-small">to</span>
        <input
          className="v2-input v2-input--sm"
          aria-label="To hour"
          size={3}
          value={w.to}
          onChange={(e) => {
            props.onChange({ ...w, to: e.target.value });
          }}
        />
        <span className="pv-muted pv-small">o’clock, in the workspace’s time zone</span>
      </div>
      <div className="pv-page-actions">
        <Button
          size="sm"
          kind="primary"
          onClick={() => {
            props.onSave({
              ...others,
              [w.permission]: {
                weekdays: w.days,
                hours: [Number(w.from), Number(w.to)],
              },
            });
          }}
        >
          Save
        </Button>
        {r.conditions[w.permission] ? (
          <Button
            size="sm"
            kind="ghost"
            onClick={() => {
              props.onSave(others);
            }}
          >
            Always
          </Button>
        ) : null}
        <Button size="sm" kind="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ── sign-in and sessions ──

interface Rules {
  mfaRoles: string[];
  sessionIdleHours: number | null;
  sessionMaxDays: number | null;
  oidc: boolean;
}
interface Session {
  id: string;
  device: string;
  ip: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

function SignIn(props: { workspaceId: string; isAdmin: boolean }): ReactNode {
  const [rules, setRules] = useState<Rules | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadSessions = useCallback(async () => {
    const r = await api<Session[]>('GET', '/auth/sessions');
    if (r.ok) setSessions(r.data);
  }, []);
  useEffect(() => {
    void api<Rules>('GET', W(props.workspaceId, '/sign-in-rules')).then((r) => {
      if (r.ok) setRules(r.data);
    });
    void loadSessions();
  }, [props.workspaceId, loadSessions]);
  const save = async (): Promise<void> => {
    if (!rules) return;
    const r = await api<Rules>('PUT', W(props.workspaceId, '/sign-in-rules'), {
      mfaRoles: rules.mfaRoles,
      sessionIdleHours: rules.sessionIdleHours,
      sessionMaxDays: rules.sessionMaxDays,
    });
    if (!r.ok) setError(r.error.message);
    else {
      setRules(r.data);
      setSaved(true);
      setError(null);
    }
  };
  const end = async (id: string | null): Promise<void> => {
    await api(id ? 'DELETE' : 'POST', id ? '/auth/sessions/' + id : '/auth/sessions/end-others');
    void loadSessions();
  };
  const num = (v: string): number | null => (v.trim() ? Math.max(1, Number(v) || 1) : null);
  return (
    <div className="pv-split pv-split--even">
      <Card title="Sign-in">
        {error ? (
          <p className="v2-error" role="alert">
            {error}
          </p>
        ) : null}
        {rules ? (
          <div className="pv-stack">
            <div className="pv-kv pv-kv--wide">
              <span>Single sign-on</span>
              <span>
                {rules.oidc ? (
                  <Chip tone="success">OIDC is set up for this server</Chip>
                ) : (
                  <Chip>not set up (server setting)</Chip>
                )}
              </span>
              <span>Provisioning (SCIM)</span>
              <span>
                <Chip tone="warning">not available yet</Chip> people are invited by hand
              </span>
            </div>
            <h3 className="v2-h3">Second factor required for</h3>
            <div className="v2-switches">
              {MATRIX_ROLES.map((r) => (
                <label key={r} className="v2-switch">
                  <input
                    type="checkbox"
                    disabled={!props.isAdmin}
                    checked={rules.mfaRoles.includes(r)}
                    onChange={(e) => {
                      setRules({
                        ...rules,
                        mfaRoles: e.target.checked
                          ? [...rules.mfaRoles, r]
                          : rules.mfaRoles.filter((x) => x !== r),
                      });
                      setSaved(false);
                    }}
                  />
                  <span>{roleText(r)}</span>
                </label>
              ))}
            </div>
            <div className="pv-form-grid">
              <label className="pv-field">
                <span>Sign in again after being idle (hours)</span>
                <input
                  className="v2-input"
                  type="number"
                  min={1}
                  max={720}
                  disabled={!props.isAdmin}
                  placeholder="no limit"
                  value={rules.sessionIdleHours ?? ''}
                  onChange={(e) => {
                    setRules({ ...rules, sessionIdleHours: num(e.target.value) });
                    setSaved(false);
                  }}
                />
              </label>
              <label className="pv-field">
                <span>Sign in again at least every (days)</span>
                <input
                  className="v2-input"
                  type="number"
                  min={1}
                  max={365}
                  disabled={!props.isAdmin}
                  placeholder="30 (server)"
                  value={rules.sessionMaxDays ?? ''}
                  onChange={(e) => {
                    setRules({ ...rules, sessionMaxDays: num(e.target.value) });
                    setSaved(false);
                  }}
                />
              </label>
            </div>
            {props.isAdmin ? (
              <div className="pv-page-actions">
                <Button kind="primary" onClick={() => void save()}>
                  Save sign-in rules
                </Button>
                {saved ? (
                  <Chip tone="success" icon="check">
                    saved
                  </Chip>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="pv-muted" role="status">
            Loading…
          </p>
        )}
      </Card>
      <Card flush title="Your sessions">
        <ul className="pv-rows">
          {sessions.slice(0, 10).map((s) => (
            <li key={s.id} className="pv-row pv-row--static">
              <span className="pv-kind pv-kind--review">
                <PIcon name="lock" size={15} />
              </span>
              <span className="pv-row-main">
                <span className="pv-row-title">
                  {s.device}
                  {s.ip ? <span className="pv-muted pv-small"> · {s.ip}</span> : null}
                </span>
                <span className="pv-row-sub">
                  {s.current ? 'this session' : 'active ' + ago(s.lastSeenAt) + ' ago'} · signed in{' '}
                  {dateText(s.createdAt)}
                </span>
              </span>
              {s.current ? (
                <Chip tone="success">this one</Chip>
              ) : (
                <Button size="sm" kind="ghost" onClick={() => void end(s.id)}>
                  Sign out
                </Button>
              )}
            </li>
          ))}
          {sessions.length > 10 ? (
            <li className="pv-row pv-row--static pv-muted pv-small">
              and {sessions.length - 10} more sessions
            </li>
          ) : null}
          {sessions.length > 1 ? (
            <li className="pv-row pv-row--static">
              <Button size="sm" onClick={() => void end(null)}>
                Sign out everywhere else
              </Button>
            </li>
          ) : null}
        </ul>
      </Card>
    </div>
  );
}

// ── governance ──

interface Review {
  id: string;
  title: string;
  dueOn: string | null;
  createdAt: string;
  closedAt: string | null;
  items: {
    userId: string;
    name: string;
    role: string;
    decision: string | null;
    note: string;
    decidedBy: string | null;
  }[];
}

function Governance(props: {
  workspaceId: string;
  meId: string;
  people: PersonRow[];
  onChange: () => void;
}): ReactNode {
  const active = props.people.filter((p) => !p.suspendedAt);
  const stale = active.filter((p) => p.stale);
  const noMfa = active.filter((p) => !p.secondFactor && !p.isService && !p.clientName);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<Review[]>('GET', W(props.workspaceId, '/access-reviews'));
    if (r.ok) setReviews(r.data);
  }, [props.workspaceId]);
  useEffect(() => {
    void load();
  }, [load]);
  const open = reviews.find((r) => !r.closedAt);
  const start = async (): Promise<void> => {
    const now = new Date();
    const r = await api<Review[]>('POST', W(props.workspaceId, '/access-reviews'), {
      title:
        'Access review Q' +
        String(Math.floor(now.getMonth() / 3) + 1) +
        ' ' +
        String(now.getFullYear()),
      dueOn: new Date(now.getTime() + 14 * 86_400_000).toISOString().slice(0, 10),
    });
    if (!r.ok) setError(r.error.message);
    else setReviews(r.data);
  };
  const decide = async (rev: Review, userId: string, decision: string): Promise<void> => {
    const r = await api<Review[]>(
      'POST',
      W(props.workspaceId, '/access-reviews/' + rev.id + '/items/' + userId),
      { decision },
    );
    if (r.ok) setReviews(r.data);
  };
  const done = open ? open.items.filter((i) => i.decision).length : 0;
  return (
    <div className="pv-stack">
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="pv-stats">
        <Stat
          label={open ? open.title : 'Access review'}
          value={
            open ? String(done) + ' / ' + String(open.items.length) : reviews[0] ? 'done' : '—'
          }
          sub={
            open
              ? 'certified' + (open.dueOn ? ' · due ' + dateText(open.dueOn) : '')
              : reviews[0]?.closedAt
                ? 'last one closed ' + dateText(reviews[0].closedAt)
                : 'none yet'
          }
          tone={
            open && open.dueOn && open.dueOn < new Date().toISOString().slice(0, 10)
              ? 'danger'
              : open
                ? 'warning'
                : undefined
          }
          icon="approval"
        />
        <Stat
          label={'Not seen for 30 days'}
          value={String(stale.length)}
          sub={
            stale
              .map((p) => p.name)
              .slice(0, 3)
              .join(', ') || 'everyone was here'
          }
          icon="clock"
        />
        <Stat
          label="Without second factor"
          value={String(noMfa.length)}
          sub={
            noMfa
              .map((p) => p.name)
              .slice(0, 3)
              .join(', ') || 'everyone has one'
          }
          tone={noMfa.length ? 'danger' : 'success'}
          icon="lock"
        />
        <Stat
          label="Service accounts"
          value={String(active.filter((p) => p.isService).length)}
          sub="take no seat"
          icon="agents"
        />
      </div>
      <Card
        flush
        title={open ? open.title : 'Access review'}
        action={
          open ? null : (
            <Button size="sm" kind="primary" onClick={() => void start()}>
              Start an access review
            </Button>
          )
        }
      >
        {open ? (
          <table className="pv-table">
            <tbody>
              {open.items.map((i) => (
                <tr key={i.userId}>
                  <td className="pv-cell-strong">{i.name}</td>
                  <td>
                    <Chip>{roleText(i.role)}</Chip>
                  </td>
                  <td className="pv-cell-grow">
                    {i.decision ? (
                      <Chip
                        tone={
                          i.decision === 'keep'
                            ? 'success'
                            : i.decision === 'remove'
                              ? 'danger'
                              : 'warning'
                        }
                      >
                        {i.decision}
                        {i.decidedBy ? ' · ' + i.decidedBy : ''}
                      </Chip>
                    ) : null}
                  </td>
                  <td>
                    <div
                      className="pv-segmented"
                      role="radiogroup"
                      aria-label={'Decision for ' + i.name}
                    >
                      {(['keep', 'change', 'remove'] as const).map((d) => (
                        <button
                          key={d}
                          type="button"
                          role="radio"
                          aria-checked={i.decision === d}
                          className="pv-seg"
                          onClick={() => void decide(open, i.userId, d)}
                        >
                          {d === 'keep' ? 'Keep' : d === 'change' ? 'Change' : 'Remove'}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="pv-muted pv-small v2-pad">
            An access review asks for each person’s access to be kept, changed or removed. The
            answers are kept for audits.
          </p>
        )}
      </Card>
      <div className="pv-split pv-split--even">
        <AccessCheck workspaceId={props.workspaceId} people={active} />
        <Offboarding
          workspaceId={props.workspaceId}
          meId={props.meId}
          people={active}
          onChange={props.onChange}
        />
      </div>
    </div>
  );
}

function AccessCheck(props: { workspaceId: string; people: PersonRow[] }): ReactNode {
  const [user, setUser] = useState('');
  const [projects, setProjects] = useState<{ id: string; key: string; name: string }[]>([]);
  const [project, setProject] = useState('');
  const [res, setRes] = useState<{
    allowed: boolean;
    steps: { ok: boolean; text: string }[];
    hint: string;
  } | null>(null);
  useEffect(() => {
    void api<{ id: string; key: string; name: string }[]>(
      'GET',
      W(props.workspaceId, '/projects'),
    ).then((r) => {
      if (r.ok) {
        setProjects(r.data);
        setProject((p) => p || (r.data[0]?.id ?? ''));
      }
    });
  }, [props.workspaceId]);
  const check = async (): Promise<void> => {
    const r = await api<NonNullable<typeof res>>(
      'GET',
      W(props.workspaceId, '/access-check?userId=' + user + '&projectId=' + project),
    );
    if (r.ok) setRes(r.data);
  };
  return (
    <Card title="Why can this person see that?">
      <div className="pv-ask">
        <select
          className="pv-select pv-select--full"
          aria-label="Person"
          value={user}
          onChange={(e) => {
            setUser(e.target.value);
            setRes(null);
          }}
        >
          <option value="">Pick a person…</option>
          {props.people.map((p) => (
            <option key={p.userId} value={p.userId}>
              {p.name}
              {p.clientName ? ' (' + p.clientName + ')' : ''}
            </option>
          ))}
        </select>
        <select
          className="pv-select pv-select--full"
          aria-label="Project"
          value={project}
          onChange={(e) => {
            setProject(e.target.value);
            setRes(null);
          }}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.key} {p.name}
            </option>
          ))}
        </select>
        <Button kind="primary" disabled={!user || !project} onClick={() => void check()}>
          Check
        </Button>
      </div>
      {res ? (
        <ol className="pv-why">
          <li>
            <Chip tone={res.allowed ? 'success' : 'danger'}>{res.allowed ? 'Yes' : 'No'}</Chip>
          </li>
          {res.steps.map((s, i) => (
            <li key={i} className={s.ok ? undefined : 'pv-text-danger'}>
              {s.text}
            </li>
          ))}
          {res.hint ? <li className="pv-muted">{res.hint}</li> : null}
        </ol>
      ) : (
        <p className="pv-muted pv-small">
          Explains every allow or deny from role, suspension, guest invitations and the client a
          project belongs to.
        </p>
      )}
    </Card>
  );
}

function Offboarding(props: {
  workspaceId: string;
  meId: string;
  people: PersonRow[];
  onChange: () => void;
}): ReactNode {
  const steps = ['Choose who leaves', 'Hand over work', 'Revoke access', 'Suspend'];
  const [step, setStep] = useState(0);
  const [who, setWho] = useState('');
  const [to, setTo] = useState('');
  const [revoke, setRevoke] = useState(true);
  const [result, setResult] = useState<{ tasks: number; agents: number; tokens: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const person = props.people.find((p) => p.userId === who);
  const run = async (): Promise<void> => {
    const r = await api<{ tasks: number; agents: number; tokens: number }>(
      'POST',
      W(props.workspaceId, '/members/' + who + '/offboard'),
      { handoverTo: to || null, revokeTokens: revoke },
    );
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setResult(r.data);
    setStep(3);
    props.onChange();
  };
  return (
    <Card title={'Offboarding' + (person ? ' · ' + person.name : '')}>
      <ol className="pv-wizard">
        {steps.map((s, i) => (
          <li
            key={s}
            className={
              i < step ? 'pv-wiz pv-wiz--done' : i === step ? 'pv-wiz pv-wiz--now' : 'pv-wiz'
            }
          >
            <span className="pv-wiz-n">{i < step ? <PIcon name="check" size={12} /> : i + 1}</span>
            {s}
          </li>
        ))}
      </ol>
      {error ? (
        <p className="v2-error" role="alert">
          {error}
        </p>
      ) : null}
      {step === 0 ? (
        <select
          className="v2-input"
          aria-label="Who leaves"
          value={who}
          onChange={(e) => {
            setWho(e.target.value);
          }}
        >
          <option value="">Pick a person…</option>
          {props.people
            .filter((p) => p.userId !== props.meId)
            .map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.name}
              </option>
            ))}
        </select>
      ) : null}
      {step === 1 ? (
        <div className="pv-stack">
          <span className="pv-muted pv-small">
            Their open tasks and the agents they are accountable for go to:
          </span>
          <select
            className="v2-input"
            aria-label="Hand over to"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
            }}
          >
            <option value="">Nobody (leave them unassigned)</option>
            {props.people
              .filter((p) => p.userId !== who && p.role !== 'guest' && !p.isService)
              .map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.name}
                </option>
              ))}
          </select>
        </div>
      ) : null}
      {step === 2 ? (
        <label className="v2-switch">
          <input
            type="checkbox"
            checked={revoke}
            onChange={(e) => {
              setRevoke(e.target.checked);
            }}
          />
          <span>Revoke their tokens for this workspace</span>
        </label>
      ) : null}
      {step === 3 && result ? (
        <ul className="pv-changes">
          <li>
            {result.tasks} open {result.tasks === 1 ? 'task' : 'tasks'} and {result.agents}{' '}
            {result.agents === 1 ? 'agent' : 'agents'} handed over
          </li>
          <li>
            {result.tokens} {result.tokens === 1 ? 'token' : 'tokens'} revoked
          </li>
          <li>Membership suspended, not deleted: history keeps the name, the seat is free.</li>
        </ul>
      ) : null}
      <div className="pv-page-actions pv-mt">
        {step < 2 ? (
          <Button
            kind="primary"
            disabled={!who}
            onClick={() => {
              setStep(step + 1);
            }}
          >
            Next
          </Button>
        ) : step === 2 ? (
          <Button kind="danger" onClick={() => void run()}>
            Suspend {person?.name ?? ''}
          </Button>
        ) : (
          <Button
            kind="ghost"
            onClick={() => {
              setStep(0);
              setWho('');
              setTo('');
              setResult(null);
            }}
          >
            Done
          </Button>
        )}
        {step > 0 && step < 3 ? (
          <Button
            kind="ghost"
            onClick={() => {
              setStep(step - 1);
            }}
          >
            Back
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
