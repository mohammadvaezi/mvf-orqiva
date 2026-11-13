// ── [PCODE-250 | S15 | v0.1.0] T25.5 Profiles, GDPR export and erasure, version check on task edits ──
//    Why:  a person's profile in the workspace, where they keep it themselves (title, skills, capacity,
//          focus factor, time zone, working and quiet hours) and an admin sets the manager and the cost rate;
//          the download of their own data; and, for an admin, a member's data export and, once the member is
//          offboarded, the erasure.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button, Card } from '../preview/ui.js';

const W = (ws: string, p: string): string => '/api/workspaces/' + ws + p;
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DAY_TEXT: Record<string, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

export interface Profile {
  userId: string;
  name: string;
  title: string;
  skills: string[];
  capacityHoursWeek: number;
  focusFactor: number;
  timezone: string;
  workingHours: Record<string, [string, string]>;
  quietHours: { from?: string; to?: string; except?: string[] };
  managerId: string | null;
  managerName: string | null;
  costRateCents?: number | null;
  updatedAt: string | null;
}

/** The profile form: the person's own fields, and the admin's when `admin` is set. */
export function ProfileCard(props: {
  workspaceId: string;
  userId: string;
  /** may set the manager and the cost rate */
  admin: boolean;
  people?: { userId: string; name: string }[];
  title?: string;
}): ReactNode {
  const [p, setP] = useState<Profile | null>(null);
  const [form, setForm] = useState({
    title: '',
    skills: '',
    capacity: '40',
    focus: '75',
    timezone: '',
    from: '08:00',
    to: '17:00',
    days: ['mon', 'tue', 'wed', 'thu', 'fri'] as string[],
    quietFrom: '20:00',
    quietTo: '07:30',
    manager: '',
    rate: '',
  });
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const path = W(props.workspaceId, '/members/' + props.userId + '/profile');
  const fill = (x: Profile): void => {
    setP(x);
    const first = Object.values(x.workingHours)[0];
    setForm({
      title: x.title,
      skills: x.skills.join(', '),
      capacity: String(x.capacityHoursWeek),
      focus: String(Math.round(x.focusFactor * 100)),
      timezone: x.timezone,
      from: first?.[0] ?? '08:00',
      to: first?.[1] ?? '17:00',
      days: Object.keys(x.workingHours).length
        ? Object.keys(x.workingHours)
        : ['mon', 'tue', 'wed', 'thu', 'fri'],
      quietFrom: x.quietHours.from ?? '20:00',
      quietTo: x.quietHours.to ?? '07:30',
      manager: x.managerId ?? '',
      rate:
        x.costRateCents === null || x.costRateCents === undefined
          ? ''
          : (x.costRateCents / 100).toFixed(2).replace('.', ','),
    });
  };
  const load = useCallback(async () => {
    const r = await api<Profile>('GET', path);
    if (r.ok) fill(r.data);
  }, [path]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!p) return null;
  const save = async (): Promise<void> => {
    const rate = form.rate.trim() ? Math.round(Number(form.rate.replace(',', '.')) * 100) : null;
    const r = await api<Profile>('PUT', path, {
      title: form.title,
      skills: form.skills
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
      capacityHoursWeek: Number(form.capacity.replace(',', '.')) || 0,
      focusFactor: Math.max(0, Math.min(1, (Number(form.focus) || 0) / 100)),
      timezone: form.timezone.trim(),
      workingHours: Object.fromEntries(form.days.map((d) => [d, [form.from, form.to]])),
      quietHours: { from: form.quietFrom, to: form.quietTo },
      ...(props.admin
        ? {
            managerId: form.manager || null,
            costRateCents: rate !== null && rate >= 0 ? rate : null,
          }
        : {}),
    });
    if (r.ok) {
      fill(r.data);
      setMsg({ ok: 'Saved.' });
    } else setMsg({ error: r.error.message });
  };
  const input = (
    key: keyof typeof form,
    label: string,
    opts: { size?: number; placeholder?: string; hint?: string } = {},
  ): ReactNode => (
    <label className="v2-field">
      <span>{label}</span>
      <input
        className="v2-input"
        size={opts.size}
        placeholder={opts.placeholder}
        value={form[key]}
        onChange={(e) => {
          setForm({ ...form, [key]: e.target.value });
        }}
      />
      {opts.hint ? <span className="pv-muted pv-small">{opts.hint}</span> : null}
    </label>
  );
  return (
    <Card title={props.title ?? 'Work profile'}>
      <div className="pv-form-grid">
        {input('title', 'Title', { placeholder: 'e.g. Backend developer' })}
        {input('skills', 'Skills', {
          placeholder: 'TypeScript, PostgreSQL',
          hint: 'comma separated',
        })}
        {input('capacity', 'Hours a week', { size: 4 })}
        {input('focus', 'Focus factor (%)', {
          size: 4,
          hint: 'how much of the time goes to planned work',
        })}
        {input('timezone', 'Time zone', { placeholder: 'Europe/Berlin' })}
      </div>
      <div className="v2-field pv-mt">
        <span>Working hours</span>
        <div className="v2-inline">
          {DAYS.map((d) => (
            <label key={d} className="v2-switch">
              <input
                type="checkbox"
                checked={form.days.includes(d)}
                onChange={(e) => {
                  setForm({
                    ...form,
                    days: e.target.checked
                      ? DAYS.filter((x) => x === d || form.days.includes(x))
                      : form.days.filter((x) => x !== d),
                  });
                }}
              />
              <span>{DAY_TEXT[d]}</span>
            </label>
          ))}
          <input
            className="v2-input v2-input--sm"
            aria-label="Working from"
            size={5}
            value={form.from}
            onChange={(e) => {
              setForm({ ...form, from: e.target.value });
            }}
          />
          <span className="pv-small">to</span>
          <input
            className="v2-input v2-input--sm"
            aria-label="Working to"
            size={5}
            value={form.to}
            onChange={(e) => {
              setForm({ ...form, to: e.target.value });
            }}
          />
        </div>
      </div>
      <div className="v2-field pv-mt">
        <span>Quiet hours (no push, the inbox still fills)</span>
        <div className="v2-inline">
          <input
            className="v2-input v2-input--sm"
            aria-label="Quiet from"
            size={5}
            value={form.quietFrom}
            onChange={(e) => {
              setForm({ ...form, quietFrom: e.target.value });
            }}
          />
          <span className="pv-small">to</span>
          <input
            className="v2-input v2-input--sm"
            aria-label="Quiet to"
            size={5}
            value={form.quietTo}
            onChange={(e) => {
              setForm({ ...form, quietTo: e.target.value });
            }}
          />
        </div>
      </div>
      {props.admin ? (
        <div className="pv-form-grid pv-mt">
          <label className="v2-field">
            <span>Manager</span>
            <select
              className="v2-input"
              value={form.manager}
              onChange={(e) => {
                setForm({ ...form, manager: e.target.value });
              }}
            >
              <option value="">Nobody</option>
              {(props.people ?? [])
                .filter((x) => x.userId !== props.userId)
                .map((x) => (
                  <option key={x.userId} value={x.userId}>
                    {x.name}
                  </option>
                ))}
            </select>
          </label>
          {input('rate', 'Cost rate (€ per hour)', {
            size: 8,
            placeholder: 'not set',
            hint: 'for budgets and margins; only admins and the person see it',
          })}
        </div>
      ) : p.managerName || (p.costRateCents ?? null) !== null ? (
        <p className="pv-muted pv-small pv-mt">
          {p.managerName ? 'Manager: ' + p.managerName + '. ' : ''}
          {p.costRateCents !== undefined && p.costRateCents !== null
            ? 'Cost rate: ' + (p.costRateCents / 100).toFixed(2).replace('.', ',') + ' € an hour. '
            : ''}
          An admin sets these.
        </p>
      ) : null}
      <div className="pv-page-actions pv-mt">
        <Button kind="primary" onClick={() => void save()}>
          Save profile
        </Button>
        {msg.ok ? <span role="status">{msg.ok}</span> : null}
      </div>
      {msg.error ? (
        <p className="v2-error" role="alert">
          {msg.error}
        </p>
      ) : null}
    </Card>
  );
}

/** The person's own data: one ZIP of everything Orqiva keeps about them. */
export function MyDataCard(): ReactNode {
  return (
    <Card title="Your data">
      <p className="pv-small">
        Download everything Orqiva keeps about you, in every workspace: one ZIP of JSON files.
        Passwords and keys are never in it.
      </p>
      <a className="pv-btn" href="/auth/me/export" download>
        Download my data
      </a>
    </Card>
  );
}

/** For an admin: a member's profile, their data, and erasure once they are offboarded. */
export function PersonPanel(props: {
  workspaceId: string;
  person: { userId: string; name: string; suspendedAt: string | null };
  people: { userId: string; name: string }[];
  isOwner: boolean;
  onClose: () => void;
  onChange: () => void;
}): ReactNode {
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const P = W(props.workspaceId, '/members/' + props.person.userId);
  const erase = async (): Promise<void> => {
    const r = await api<{ accountErased: boolean; otherWorkspaces: number }>('POST', P + '/erase', {
      confirm,
    });
    if (!r.ok) setMsg({ error: r.error.message });
    else {
      setMsg({
        ok: r.data.accountErased
          ? 'Erased, with the account. Their work stays under “Erased person”.'
          : 'Erased in this workspace. The account stays: they are in ' +
            String(r.data.otherWorkspaces) +
            ' other workspace(s).',
      });
      props.onChange();
    }
  };
  return (
    <div className="pv-stack">
      <div className="pv-page-actions">
        <strong>{props.person.name}</strong>
        <span className="pv-spacer" />
        <a className="pv-btn" href={P + '/export'} download>
          Download their data
        </a>
        <Button size="sm" kind="ghost" onClick={props.onClose}>
          Close
        </Button>
      </div>
      {props.person.suspendedAt ? null : (
        <ProfileCard
          workspaceId={props.workspaceId}
          userId={props.person.userId}
          admin
          people={props.people}
          title={'Work profile of ' + props.person.name}
        />
      )}
      {props.isOwner && props.person.suspendedAt ? (
        <Card title="Erase their personal data">
          <p className="pv-small">
            {props.person.name} was offboarded. Erasing removes their name, e-mail, sign-ins,
            profile, inbox and direct messages; the tasks, comments and documents they wrote stay,
            under “Erased person”. This cannot be undone.
          </p>
          <div className="v2-inline">
            <input
              className="v2-input"
              aria-label="Type the name to confirm"
              placeholder={'Type ' + props.person.name}
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
              }}
            />
            <Button
              kind="danger"
              disabled={confirm.trim() !== props.person.name}
              onClick={() => void erase()}
            >
              Erase
            </Button>
          </div>
          {msg.ok ? <p role="status">{msg.ok}</p> : null}
          {msg.error ? (
            <p className="v2-error" role="alert">
              {msg.error}
            </p>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
