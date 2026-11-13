// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-297 | S15 | v0.1.0] T30.10 Figma two-way sync: variables and components, tested against recorded Figma answers ──
//    Why:  above the tokens, the project's Figma file: link it (admins), check it, and decide what moves
//          which way. Changes made only in Figma wait to be taken, changes made only here wait to be
//          sent, and a token changed on both sides waits for a person to pick a side.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { Button, Card, Chip } from '../preview/ui.js';

interface SyncToken {
  type: string;
  light: string;
  dark: string;
  themes: Record<string, string>;
}
interface Change {
  name: string;
  kind: 'add' | 'change' | 'remove';
  from: SyncToken | null;
  to: SyncToken | null;
}
interface Conflict {
  name: string;
  orqiva: SyncToken | null;
  figma: SyncToken | null;
}
interface Plan {
  pull: Change[];
  push: Change[];
  conflicts: Conflict[];
  inSync: number;
}
interface Link {
  fileKey: string;
  fileUrl: string;
  hasToken: boolean;
  componentsLinked: number;
  checkedAt: string | null;
  pulledAt: string | null;
  pushedAt: string | null;
}

/** A token's values in one line: light, dark when it differs, themes. */
export function tokenText(t: SyncToken | null): string {
  if (!t) return 'not there';
  const parts = [t.light];
  if (t.dark !== t.light) parts.push('dark ' + t.dark);
  for (const [k, v] of Object.entries(t.themes)) if (v !== t.light) parts.push(k + ' ' + v);
  return parts.join(' · ');
}

/** What the decisions send to the server: conflicts go where their side was picked. */
export function decisions(
  plan: Plan,
  take: ReadonlySet<string>,
  send: ReadonlySet<string>,
  sides: Readonly<Record<string, 'figma' | 'orqiva' | ''>>,
): { take: string[]; send: string[] } {
  return {
    take: [
      ...plan.pull.filter((c) => take.has(c.name)).map((c) => c.name),
      ...plan.conflicts.filter((c) => sides[c.name] === 'figma').map((c) => c.name),
    ],
    send: [
      ...plan.push.filter((c) => send.has(c.name)).map((c) => c.name),
      ...plan.conflicts.filter((c) => sides[c.name] === 'orqiva').map((c) => c.name),
    ],
  };
}

const when = (iso: string | null): string => (iso ? iso.slice(0, 16).replace('T', ' ') : 'never');

export function FigmaSync(props: {
  workspaceId: string;
  projectId: string;
  canEdit: boolean;
  onChanged: () => void;
}): ReactNode {
  const F = '/api/workspaces/' + props.workspaceId + '/projects/' + props.projectId + '/figma';
  const [link, setLink] = useState<Link | null | undefined>(undefined);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [skipped, setSkipped] = useState<{ name: string; reason: string }[]>([]);
  const [take, setTake] = useState<Set<string>>(new Set());
  const [send, setSend] = useState<Set<string>>(new Set());
  const [sides, setSides] = useState<Record<string, 'figma' | 'orqiva' | ''>>({});
  const [form, setForm] = useState({ file: '', token: '' });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const showPlan = (p: Plan | null): void => {
    setPlan(p);
    setTake(new Set(p?.pull.map((c) => c.name) ?? []));
    setSend(new Set(p?.push.map((c) => c.name) ?? []));
    setSides({});
  };
  const load = useCallback(async () => {
    const r = await api<{
      link: Link | null;
      plan: Plan | null;
      skipped: { name: string; reason: string }[];
    }>('GET', F);
    if (!r.ok) return;
    setLink(r.data.link);
    showPlan(r.data.plan);
    setSkipped(r.data.skipped);
  }, [F]);
  useEffect(() => {
    void load();
  }, [load]);
  const run = async <T,>(
    label: string,
    method: 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T | null> => {
    setBusy(label);
    setError('');
    setNote('');
    const r = await api<T>(method, F + path, body);
    setBusy('');
    if (!r.ok) {
      setError(r.error.message);
      return null;
    }
    return r.data;
  };
  if (link === undefined) return null;

  if (!link)
    return props.canEdit ? (
      <Card title="Figma">
        <p className="pv-small pv-muted">
          Link the Figma file of this kit to compare its variables with these tokens, take what
          designers change and send what developers change. Admins link it; the token is kept sealed
          and never shown again.
        </p>
        <form
          className="v2-inline v2-mt"
          onSubmit={(e) => {
            e.preventDefault();
            void run<Link>('link', 'PUT', '', {
              file: form.file.trim(),
              token: form.token.trim(),
            }).then(async (x) => {
              if (x) {
                setForm({ file: '', token: '' });
                await load();
              }
            });
          }}
        >
          <input
            className="v2-input v2-grow"
            aria-label="Figma file link"
            placeholder="https://www.figma.com/design/…"
            value={form.file}
            onChange={(e) => {
              setForm({ ...form, file: e.target.value });
            }}
          />
          <input
            className="v2-input"
            type="password"
            autoComplete="off"
            aria-label="Figma access token"
            placeholder="Access token"
            value={form.token}
            onChange={(e) => {
              setForm({ ...form, token: e.target.value });
            }}
          />
          <button
            type="submit"
            className="pv-btn pv-btn--primary pv-btn--sm"
            disabled={!form.file.trim() || !form.token.trim() || Boolean(busy)}
          >
            Link
          </button>
        </form>
        {error ? (
          <p className="v2-error pv-small" role="alert">
            {error}
          </p>
        ) : null}
      </Card>
    ) : null;

  const open = plan ? plan.pull.length + plan.push.length + plan.conflicts.length : 0;
  const chosen = plan ? decisions(plan, take, send, sides) : { take: [], send: [] };
  const toggle = (set: Set<string>, name: string, on: boolean): Set<string> => {
    const next = new Set(set);
    if (on) next.add(name);
    else next.delete(name);
    return next;
  };
  return (
    <Card
      title="Figma"
      action={
        <span className="pv-page-actions">
          <a
            className="pv-link pv-small"
            href={link.fileUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            Open the file
          </a>
          {props.canEdit ? (
            <Button
              size="sm"
              kind="ghost"
              disabled={Boolean(busy)}
              onClick={() =>
                void run<{ plan: Plan; skipped: { name: string; reason: string }[]; link: Link }>(
                  'check',
                  'POST',
                  '/check',
                  {},
                ).then((x) => {
                  if (!x) return;
                  setLink(x.link);
                  showPlan(x.plan);
                  setSkipped(x.skipped);
                  props.onChanged();
                })
              }
            >
              {busy === 'check' ? 'Checking…' : 'Check Figma'}
            </Button>
          ) : null}
        </span>
      }
    >
      <div className="v2-inline">
        {!link.checkedAt ? (
          <Chip>not checked yet</Chip>
        ) : open ? (
          <Chip tone="warning">{String(open) + ' to decide'}</Chip>
        ) : (
          <Chip tone="success" icon="check">
            in sync
          </Chip>
        )}
        <span className="pv-small pv-muted">
          Checked {when(link.checkedAt)} · taken {when(link.pulledAt)} · sent {when(link.pushedAt)}
          {plan ? ' · ' + String(plan.inSync) + ' tokens the same on both sides' : ''}
          {link.componentsLinked
            ? ' · ' + String(link.componentsLinked) + ' components linked'
            : ''}
        </span>
      </div>
      {error ? (
        <p className="v2-error pv-small" role="alert">
          {error}
        </p>
      ) : null}
      {note ? <p className="pv-small">{note}</p> : null}
      {plan?.pull.length ? (
        <section className="v2-mt">
          <h4 className="v2-handoff-h">Waiting from Figma</h4>
          {plan.pull.map((c) => (
            <label key={c.name} className="v2-figma-row">
              <input
                type="checkbox"
                disabled={!props.canEdit}
                checked={take.has(c.name)}
                onChange={(e) => {
                  setTake(toggle(take, c.name, e.target.checked));
                }}
              />
              <span className="v2-mono">{c.name}</span>
              <span className="pv-diff v2-figma-diff">
                {c.from ? <span className="pv-del">{tokenText(c.from)}</span> : null}
                {c.to ? (
                  <span className="pv-ins">{tokenText(c.to)}</span>
                ) : (
                  <span className="pv-del">removed in Figma</span>
                )}
              </span>
            </label>
          ))}
        </section>
      ) : null}
      {plan?.push.length ? (
        <section className="v2-mt">
          <h4 className="v2-handoff-h">To send to Figma</h4>
          {plan.push.map((c) => (
            <label key={c.name} className="v2-figma-row">
              <input
                type="checkbox"
                disabled={!props.canEdit}
                checked={send.has(c.name)}
                onChange={(e) => {
                  setSend(toggle(send, c.name, e.target.checked));
                }}
              />
              <span className="v2-mono">{c.name}</span>
              <span className="pv-diff v2-figma-diff">
                {c.from ? <span className="pv-del">{tokenText(c.from)}</span> : null}
                {c.to ? (
                  <span className="pv-ins">{tokenText(c.to)}</span>
                ) : (
                  <span className="pv-del">removed here</span>
                )}
              </span>
            </label>
          ))}
        </section>
      ) : null}
      {plan?.conflicts.length ? (
        <section className="v2-mt">
          <h4 className="v2-handoff-h">Changed on both sides</h4>
          {plan.conflicts.map((c) => (
            <div
              key={c.name}
              className="v2-figma-row"
              role="radiogroup"
              aria-label={'Which ' + c.name + ' wins'}
            >
              <span className="v2-mono">{c.name}</span>
              {(['figma', 'orqiva', ''] as const).map((side) => (
                <label key={side} className="pv-small v2-figma-side">
                  <input
                    type="radio"
                    name={'side-' + c.name}
                    disabled={!props.canEdit}
                    checked={(sides[c.name] ?? '') === side}
                    onChange={() => {
                      setSides({ ...sides, [c.name]: side });
                    }}
                  />{' '}
                  {side === 'figma'
                    ? 'Figma: ' + tokenText(c.figma)
                    : side === 'orqiva'
                      ? 'Here: ' + tokenText(c.orqiva)
                      : 'Later'}
                </label>
              ))}
            </div>
          ))}
        </section>
      ) : null}
      {props.canEdit && plan && open ? (
        <div className="v2-inline v2-mt">
          <Button
            size="sm"
            kind="primary"
            icon="check"
            disabled={Boolean(busy) || (!chosen.take.length && !chosen.send.length)}
            onClick={() =>
              void run<{
                taken: number;
                sent: number;
                notSent: { name: string; reason: string }[];
                plan: Plan;
              }>('apply', 'POST', '/apply', chosen).then((x) => {
                if (!x) return;
                showPlan(x.plan);
                void load(); // [PCODE-297 | S15 | v0.1.0] when it was taken or sent
                setNote(
                  'Took ' +
                    String(x.taken) +
                    ', sent ' +
                    String(x.sent) +
                    '.' +
                    (x.notSent.length
                      ? ' Not sent: ' +
                        x.notSent.map((n) => n.name + ' (' + n.reason + ')').join('; ')
                      : ''),
                );
                props.onChanged();
              })
            }
          >
            {busy === 'apply'
              ? 'Working…'
              : 'Take ' + String(chosen.take.length) + ', send ' + String(chosen.send.length)}
          </Button>
          <span className="pv-small pv-muted">Sending writes the variables of the Figma file.</span>
        </div>
      ) : null}
      {skipped.length ? (
        <details className="v2-mt">
          <summary className="pv-small pv-muted">
            {skipped.length} Figma variables are not synced
          </summary>
          <ul className="v2-handoff-list v2-mt">
            {skipped.map((x) => (
              <li key={x.name} className="pv-small">
                <span className="v2-mono">{x.name}</span>: {x.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {props.canEdit ? (
        <button
          type="button"
          className="pv-link-btn pv-small v2-mt"
          onClick={() =>
            void run('unlink', 'DELETE', '').then(async () => {
              await load();
            })
          }
        >
          Unlink the file (admins)
        </button>
      ) : null}
    </Card>
  );
}
