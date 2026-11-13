// ── [PCODE-339 | S15 | v0.1.0] T34.1d Portal magic-link sign-in and passwordless invitations, MFA required per client ──
// ── [PCODE-237 | S15 | v0.1.0] T23.4 Email as a channel: own SMTP sender, password reset, invitations, digests ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-90 | S15 | v0.1.0] Build the web app shell with login and the ported design system ──
// ── [PCODE-150 | S15 | v0.1.0] Add the cloud tenant and harden sign-in, rate limits and headers ──
//    Why:  the three screens of the shell. They receive their data and actions as props and keep only form
//          state, so they render the same in a test (renderToString) as in the browser. Copy follows the
//          design system: sentence-case verbs on buttons, one suggested action in an empty state, errors
//          say what failed and what to do.
import { useState, type SyntheticEvent, type ReactNode } from 'react';

export const PASSWORD_MIN = 10;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface FormOutcome {
  /** a message for the whole form */
  banner?: string;
  /** messages by field name */
  fields?: Record<string, string>;
}

interface FieldProps {
  id: string;
  label: string;
  type?: string;
  value: string;
  autoComplete: string;
  error?: string | undefined;
  onChange: (v: string) => void;
}

function Field({
  id,
  label,
  type = 'text',
  value,
  autoComplete,
  error,
  onChange,
}: FieldProps): ReactNode {
  return (
    <div className="pe-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={id}
        className="pe-input"
        type={type}
        value={value}
        autoComplete={autoComplete}
        aria-invalid={error ? 'true' : 'false'}
        aria-describedby={error ? id + '-error' : undefined}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
      {error ? (
        <div id={id + '-error'} className="pe-field-error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function AuthCard({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children: ReactNode;
}): ReactNode {
  return (
    <main className="pe-auth">
      <div className="pe-card">
        <div className="pe-brand">Orqiva</div>
        <h1>{title}</h1>
        <p className="pe-muted">{lead}</p>
        {children}
      </div>
    </main>
  );
}

interface FormState {
  busy: boolean;
  outcome: FormOutcome;
  onSubmit: (e: SyntheticEvent) => void;
  /** clears a field's error once the person edits it */
  clear: (field: string) => void;
}

/** Local checks first; only a form that passes them goes to the server. */
function useSubmit(
  validate: () => Record<string, string>,
  submit: () => Promise<FormOutcome | null>,
): FormState {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<FormOutcome>({});
  return {
    busy,
    outcome,
    clear: (field) => {
      if (outcome.fields?.[field])
        setOutcome({ ...outcome, fields: { ...outcome.fields, [field]: '' } });
    },
    onSubmit: (e) => {
      e.preventDefault();
      const local = validate();
      if (Object.keys(local).length) {
        setOutcome({ fields: local });
        return;
      }
      setBusy(true);
      void submit().then((r) => {
        setBusy(false);
        setOutcome(r ?? {});
      });
    },
  };
}

export function validateLogin(email: string, password: string): Record<string, string> {
  const f: Record<string, string> = {};
  if (!email.trim()) f['email'] = 'Enter your email address.';
  if (!password) f['password'] = 'Enter your password.';
  return f;
}

export function validateSignup(v: {
  name: string;
  email: string;
  password: string;
  workspaceName: string;
}): Record<string, string> {
  const f: Record<string, string> = {};
  if (!v.name.trim()) f['name'] = 'Enter your name.';
  if (!EMAIL.test(v.email.trim())) f['email'] = 'Enter a valid email address.';
  if (v.password.length < PASSWORD_MIN)
    f['password'] = 'Use at least ' + String(PASSWORD_MIN) + ' characters.';
  if (!v.workspaceName.trim())
    f['workspaceName'] = 'Name your workspace, for example your company or team.';
  return f;
}

export interface LoginProps {
  /** [PCODE-150 | S15 | v0.1.0] code: from the authenticator app, or a recovery code, once the server asked for it */
  onLogin: (email: string, password: string, code?: string) => Promise<FormOutcome | null>;
  onGoSignup: () => void;
  /** a company login is configured on the server */
  sso?: boolean;
  /** [PCODE-237 | S15 | v0.1.0] the way to a new password */
  onGoForgot?: () => void;
  onGoLink?: () => void; // [PCODE-339 | S15 | v0.1.0]
}

export function LoginScreen({
  onLogin,
  onGoSignup,
  sso = false,
  onGoForgot,
  onGoLink,
}: LoginProps): ReactNode {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // [PCODE-150 | S15 | v0.1.0] the second step, shown once the server asks for a code
  const [code, setCode] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const form = useSubmit(
    () => validateLogin(email, password),
    async () => {
      const r = await onLogin(email.trim(), password, needCode ? code.trim() : undefined);
      if (r?.fields?.['code'] !== undefined) setNeedCode(true);
      return r;
    },
  );
  return (
    <AuthCard title="Sign in" lead="Your projects, your team and their agents, live.">
      <form onSubmit={form.onSubmit} noValidate>
        {form.outcome.banner ? (
          <div className="pe-banner" role="alert">
            {form.outcome.banner}
          </div>
        ) : null}
        <Field
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          error={form.outcome.fields?.['email']}
          onChange={(v) => {
            setEmail(v);
            form.clear('email');
          }}
        />
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          error={form.outcome.fields?.['password']}
          onChange={(v) => {
            setPassword(v);
            form.clear('password');
          }}
        />
        {needCode ? (
          <Field
            id="code"
            label="Code from your authenticator app (or a recovery code)"
            type="text"
            autoComplete="one-time-code"
            value={code}
            error={code ? undefined : form.outcome.fields?.['code']}
            onChange={(v) => {
              setCode(v);
              form.clear('code');
            }}
          />
        ) : null}
        <button className="pe-btn pe-btn--primary pe-btn--block" type="submit" disabled={form.busy}>
          {form.busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      {onGoForgot ? (
        <p className="pe-switch">
          <a
            href="/forgot"
            onClick={(e) => {
              e.preventDefault();
              onGoForgot();
            }}
          >
            Forgot your password?
          </a>
        </p>
      ) : null}
      {/* [PCODE-339 | S15 | v0.1.0] the team's clients sign in without a password */}
      {onGoLink ? (
        <p className="pe-switch pe-muted">
          <a
            href="/sign-in/email"
            onClick={(e) => {
              e.preventDefault();
              onGoLink();
            }}
          >
            A client of the team? Email me a sign-in link
          </a>
        </p>
      ) : null}
      {sso ? (
        <p className="pe-switch">
          <a href="/auth/oidc/start">Sign in with your company account</a>
        </p>
      ) : null}
      <p className="pe-switch pe-muted">
        New to Orqiva?{' '}
        <a
          href="/signup"
          onClick={(e) => {
            e.preventDefault();
            onGoSignup();
          }}
        >
          Create an account
        </a>
      </p>
    </AuthCard>
  );
}

export interface SignupValues {
  name: string;
  email: string;
  password: string;
  workspaceName: string;
}

export interface SignupProps {
  onSignup: (v: SignupValues) => Promise<FormOutcome | null>;
  onGoLogin: () => void;
}

export function SignupScreen({ onSignup, onGoLogin }: SignupProps): ReactNode {
  const [v, setV] = useState<SignupValues>({
    name: '',
    email: '',
    password: '',
    workspaceName: '',
  });
  const form = useSubmit(
    () => validateSignup(v),
    () =>
      onSignup({
        name: v.name.trim(),
        email: v.email.trim(),
        password: v.password,
        workspaceName: v.workspaceName.trim(),
      }),
  );
  const set =
    (k: keyof SignupValues) =>
    (value: string): void => {
      setV({ ...v, [k]: value });
      form.clear(k);
    };
  return (
    <AuthCard
      title="Create your account"
      lead="Your workspace holds your projects, your team and its agents."
    >
      <form onSubmit={form.onSubmit} noValidate>
        {form.outcome.banner ? (
          <div className="pe-banner" role="alert">
            {form.outcome.banner}
          </div>
        ) : null}
        <Field
          id="name"
          label="Your name"
          autoComplete="name"
          value={v.name}
          error={form.outcome.fields?.['name']}
          onChange={set('name')}
        />
        <Field
          id="email"
          label="Work email"
          type="email"
          autoComplete="email"
          value={v.email}
          error={form.outcome.fields?.['email']}
          onChange={set('email')}
        />
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          value={v.password}
          error={form.outcome.fields?.['password']}
          onChange={set('password')}
        />
        <Field
          id="workspaceName"
          label="Workspace name"
          autoComplete="organization"
          value={v.workspaceName}
          error={form.outcome.fields?.['workspaceName']}
          onChange={set('workspaceName')}
        />
        <button className="pe-btn pe-btn--primary pe-btn--block" type="submit" disabled={form.busy}>
          {form.busy ? 'Creating…' : 'Create account'}
        </button>
      </form>
      <p className="pe-switch pe-muted">
        Already have an account?{' '}
        <a
          href="/login"
          onClick={(e) => {
            e.preventDefault();
            onGoLogin();
          }}
        >
          Sign in
        </a>
      </p>
    </AuthCard>
  );
}

// ── [PCODE-237 | S15 | v0.1.0] a forgotten password: ask for a link, then choose a new password ──
export function ForgotScreen(props: {
  onAsk: (email: string) => Promise<{ mail: boolean } | FormOutcome>;
  onGoLogin: () => void;
}): ReactNode {
  const [email, setEmail] = useState('');
  const [answer, setAnswer] = useState<{ mail: boolean } | null>(null);
  const form = useSubmit(
    () => (EMAIL.test(email.trim()) ? {} : { email: 'Enter the email address of your account.' }),
    async () => {
      const r = await props.onAsk(email.trim());
      if ('mail' in r) {
        setAnswer(r);
        return null;
      }
      return r;
    },
  );
  return (
    <AuthCard
      title="Choose a new password"
      lead="We send a link to the address of your account. It works once, for an hour."
    >
      {answer ? (
        <div className="pe-notice-ok" role="status">
          {answer.mail
            ? 'If ' +
              email.trim() +
              ' has an account here, a link is on its way. Check your inbox and the spam folder.'
            : 'This server sends no mail. Ask an admin of your workspace for a reset link: Settings, Members, Reset link.'}
        </div>
      ) : (
        <form onSubmit={form.onSubmit} noValidate>
          {form.outcome.banner ? (
            <div className="pe-banner" role="alert">
              {form.outcome.banner}
            </div>
          ) : null}
          <Field
            id="email"
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            error={form.outcome.fields?.['email']}
            onChange={(v) => {
              setEmail(v);
              form.clear('email');
            }}
          />
          <button
            className="pe-btn pe-btn--primary pe-btn--block"
            type="submit"
            disabled={form.busy}
          >
            {form.busy ? 'Sending…' : 'Send me a link'}
          </button>
        </form>
      )}
      <p className="pe-switch pe-muted">
        <a
          href="/login"
          onClick={(e) => {
            e.preventDefault();
            props.onGoLogin();
          }}
        >
          Back to sign in
        </a>
      </p>
    </AuthCard>
  );
}

export function ResetScreen(props: {
  onReset: (password: string) => Promise<FormOutcome | null>;
  onGoLogin: () => void;
}): ReactNode {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [done, setDone] = useState(false);
  const form = useSubmit(
    () => {
      const f: Record<string, string> = {};
      if (password.length < PASSWORD_MIN)
        f['password'] = 'Use at least ' + String(PASSWORD_MIN) + ' characters.';
      else if (password !== again) f['again'] = 'The two passwords differ.';
      return f;
    },
    async () => {
      const r = await props.onReset(password);
      if (!r) setDone(true);
      return r;
    },
  );
  return (
    <AuthCard
      title="Choose a new password"
      lead="Every place where your account is signed in is signed out once you save it."
    >
      {done ? (
        <div className="pe-notice-ok" role="status">
          Your new password is saved. Sign in with it.
        </div>
      ) : (
        <form onSubmit={form.onSubmit} noValidate>
          {form.outcome.banner ? (
            <div className="pe-banner" role="alert">
              {form.outcome.banner}
            </div>
          ) : null}
          <Field
            id="password"
            label="New password"
            type="password"
            autoComplete="new-password"
            value={password}
            error={form.outcome.fields?.['password']}
            onChange={(v) => {
              setPassword(v);
              form.clear('password');
            }}
          />
          <Field
            id="again"
            label="The same once more"
            type="password"
            autoComplete="new-password"
            value={again}
            error={form.outcome.fields?.['again']}
            onChange={(v) => {
              setAgain(v);
              form.clear('again');
            }}
          />
          <button
            className="pe-btn pe-btn--primary pe-btn--block"
            type="submit"
            disabled={form.busy}
          >
            {form.busy ? 'Saving…' : 'Save the new password'}
          </button>
        </form>
      )}
      <p className="pe-switch pe-muted">
        <a
          href="/login"
          onClick={(e) => {
            e.preventDefault();
            props.onGoLogin();
          }}
        >
          Go to sign in
        </a>
      </p>
    </AuthCard>
  );
}
