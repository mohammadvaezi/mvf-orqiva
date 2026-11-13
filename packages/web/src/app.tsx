// ── [PCODE-362 | S15 | v0.1.0] T35.7d SAML single logout ──
// ── [PCODE-354 | S15 | v0.1.0] T35.4b Offline beyond tasks: comments, messages and time written offline; reads kept for offline ──
// ── [PCODE-341 | S15 | v0.1.0] T34.2b Public status pages per client and environment; incident update templates ──
// ── [PCODE-339 | S15 | v0.1.0] T34.1d Portal magic-link sign-in and passwordless invitations, MFA required per client ──
// ── [PCODE-264 | S15 | v0.1.0] T27.6 Canvas pictures and sharing: PNG and PDF with page fitting, read-only share link with iCal subscription ──
// ── [PCODE-237 | S15 | v0.1.0] T23.4 Email as a channel: own SMTP sender, password reset, invitations, digests ──
// ── [PCODE-153 | S15 | v0.1.0] D1 preview: design system v2, shell, Cmd-K, Home, Inbox, project overview ──
// ── [PCODE-90 | S15 | v0.1.0] Build the web app shell with login and the ported design system ──
// ── [PCODE-115 | S15 | v0.1.0] Add settings and user management: profile, password, tokens, members, invitations, project settings ──
// ── [PCODE-150 | S15 | v0.1.0] Add the cloud tenant and harden sign-in, rate limits and headers ──
//    Why:  the shell asks the server who is signed in, then shows sign-in, sign-up or home. Server answers
//          become form outcomes: field errors under their fields, anything else as one banner.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, fieldErrors, type ApiError, type Me } from './core/api.js';
import { navigate, screenOf, usePath } from './core/nav.js';
import {
  LoginScreen,
  SignupScreen,
  type FormOutcome,
  type SignupValues,
  ForgotScreen,
  ResetScreen,
} from './screens.js';
import { applyTheme, storedTheme, type ThemeChoice } from './core/theme.js';
import { appTitle } from './title.js';
import { InviteScreen, inviteToken } from './invite.js';
import { LinkAskScreen, LinkSignInScreen } from './magiclink.js'; // [PCODE-339 | S15 | v0.1.0]
import { BuyScreen } from './buy.js'; // [PCODE-219 | S15 | v0.1.0]
import { WorkspaceApp } from './workspace.js';
import { Preview, isPreview } from './preview/index.js';
import { SharedPlanPage, shareToken } from './v2/sharing.js'; // [PCODE-264 | S15 | v0.1.0]
import { PublicStatusPage, statusSlug } from './v2/statuspage.js'; // [PCODE-341 | S15 | v0.1.0]
import { forgetOfflineData } from './pwa.js'; // [PCODE-354 | S15 | v0.1.0]

function outcomeOf(error: ApiError): FormOutcome {
  const fields = fieldErrors(error);
  if (Object.keys(fields).length) return { fields };
  if (error.status === 401)
    return {
      // [PCODE-150 | S15 | v0.1.0] a wrong code says so, not that the password is wrong
      banner: /code/i.test(error.message)
        ? error.message
        : 'Email or password is wrong. Check both and try again.',
    };
  if (error.status === 429)
    return { banner: 'Too many attempts. Wait a few minutes, then try again.' };
  if (error.status === 409)
    return { fields: { email: 'An account with this email exists. Sign in instead.' } };
  return { banner: error.message };
}

// [PCODE-153 | S15 | v0.1.0] /preview is the design preview with sample data: no sign-in, no server
export function App(): ReactNode {
  const path = usePath();
  if (isPreview(path)) return <Preview path={path + window.location.search} />;
  // [PCODE-264 | S15 | v0.1.0] a shared plan needs no account
  const planToken = shareToken(path);
  if (planToken) return <SharedPlanPage token={planToken} />;
  // [PCODE-341 | S15 | v0.1.0] a client's public status page needs no account
  const slug = statusSlug(path);
  if (slug) return <PublicStatusPage slug={slug} />;
  return <SignedApp path={path} />;
}

function SignedApp(props: { path: string }): ReactNode {
  const path = props.path;
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [sso, setSso] = useState(false);
  const [theme, setTheme] = useState<ThemeChoice>(() => storedTheme());

  const refresh = useCallback(async (): Promise<void> => {
    const r = await api<Me>('GET', '/auth/me');
    setMe(r.ok ? r.data : null);
  }, []);

  useEffect(() => {
    document.title = appTitle();
    void refresh();
    void api<{ oidc: boolean }>('GET', '/auth/providers').then((r) => {
      setSso(r.ok && r.data.oidc);
    });
  }, [refresh]);

  // signed in: everything is home; signed out: sign-in unless sign-up was asked for
  const screen = screenOf(path);
  useEffect(() => {
    // [PCODE-115 | S15 | v0.1.0] an invitation link stays open, signed in or not
    // [PCODE-237 | S15 | v0.1.0] a reset link opens signed in or not; it signs everyone out anyway
    if (
      me &&
      screen !== 'home' &&
      screen !== 'invite' &&
      screen !== 'buy' &&
      screen !== 'reset' &&
      screen !== 'link' // [PCODE-339 | S15 | v0.1.0]
    )
      navigate('/');
    if (me === null && screen === 'home') navigate('/login');
  }, [me, screen]);

  if (me === undefined) return <main className="pe-auth pe-muted">Loading…</main>;

  // [PCODE-219 | S15 | v0.1.0] buying needs no account
  if (screen === 'buy') return <BuyScreen path={path} search={window.location.search} />;

  const token = screen === 'invite' ? inviteToken(path) : null;
  if (screen === 'invite')
    return token ? (
      <InviteScreen token={token} me={me} onJoined={refresh} go={navigate} />
    ) : (
      <main className="pe-auth pe-muted">
        This invitation link is not complete. Copy the whole link.
      </main>
    );

  // [PCODE-237 | S15 | v0.1.0] a new password, with the link from the mail or from an admin
  if (screen === 'reset')
    return (
      <ResetScreen
        onGoLogin={() => {
          void api('POST', '/auth/logout').then(() => {
            forgetOfflineData(); // [PCODE-354 | S15 | v0.1.0]
            setMe(null);
            navigate('/login');
          });
        }}
        onReset={async (password) => {
          const token = path.slice('/reset/'.length);
          const r = await api('POST', '/auth/password/reset', { token, password });
          if (!r.ok) return outcomeOf(r.error);
          setMe(null);
          return null;
        }}
      />
    );

  // [PCODE-339 | S15 | v0.1.0] an emailed sign-in link opens signed out or in
  if (screen === 'link')
    return (
      <LinkSignInScreen
        token={new URLSearchParams(window.location.search).get('token') ?? ''}
        onSignedIn={async () => {
          await refresh();
          navigate('/');
        }}
      />
    );

  if (me) {
    return (
      // [PCODE-97 | S15 | v0.1.0] the signed-in app: projects, items and their live updates
      <WorkspaceApp
        me={me}
        theme={theme}
        onMeChanged={() => {
          void refresh();
        }}
        onTheme={(t) => {
          applyTheme(t);
          setTheme(t);
        }}
        onLogout={() => {
          void api<{ redirect?: string }>('POST', '/auth/logout').then((r) => {
            forgetOfflineData(); // [PCODE-354 | S15 | v0.1.0]
            // [PCODE-362 | S15 | v0.1.0] after SAML, the identity provider signs out too
            if (r.ok && r.data.redirect) window.location.assign(r.data.redirect);
            else setMe(null);
          });
        }}
      />
    );
  }

  if (screen === 'signup') {
    return (
      <SignupScreen
        onGoLogin={() => {
          navigate('/login');
        }}
        onSignup={async (v: SignupValues) => {
          const r = await api('POST', '/auth/signup', v);
          if (!r.ok) return outcomeOf(r.error);
          await refresh();
          return null;
        }}
      />
    );
  }

  if (screen === 'linkask')
    return (
      <LinkAskScreen
        onGoLogin={() => {
          navigate('/login');
        }}
      />
    );

  if (screen === 'forgot')
    return (
      <ForgotScreen
        onGoLogin={() => {
          navigate('/login');
        }}
        onAsk={async (email) => {
          const r = await api<{ mail: boolean }>('POST', '/auth/password/forgot', { email });
          return r.ok ? r.data : outcomeOf(r.error);
        }}
      />
    );

  return (
    <LoginScreen
      sso={sso}
      onGoForgot={() => {
        navigate('/forgot');
      }}
      onGoLink={() => {
        navigate('/sign-in/email');
      }}
      onGoSignup={() => {
        navigate('/signup');
      }}
      onLogin={async (email, password, code) => {
        // [PCODE-150 | S15 | v0.1.0] a recovery code has a dash; a code from the app is six digits
        const second = code ? (code.includes('-') ? { recoveryCode: code } : { code }) : {};
        const r = await api('POST', '/auth/login', { email, password, ...second });
        if (!r.ok) return outcomeOf(r.error);
        await refresh();
        return null;
      }}
    />
  );
}
