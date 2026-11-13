// ── [PCODE-115 | S15 | v0.1.0] Add settings and user management: profile, password, tokens, members, invitations, project settings ──
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CopyField, ProfileSection } from '../src/account.js';
import { inviteToken } from '../src/invite.js';
import { screenOf } from '../src/core/nav.js';
import { ProjectSettings } from '../src/project.js';

const me = {
  user: { id: 'u1', email: 'ada@example.test', name: 'Ada Lovelace' },
  workspaces: [{ id: 'w', slug: 'w', name: 'Acme', role: 'owner' }],
};
const project = {
  id: 'p',
  key: 'APP',
  name: 'The App',
  description: '',
  archived: false,
  version: '0.3.0',
  loopRules: { reviewBeforeDone: true, autoTestState: false, unguardedPaths: ['docs/'] },
};
const save = (): Promise<null> => Promise.resolve(null);

describe('invitation links', () => {
  it('open their own screen, and only with a whole token', () => {
    expect(screenOf('/invite/' + 'a'.repeat(43))).toBe('invite');
    expect(inviteToken('/invite/' + 'a'.repeat(43))).toBe('a'.repeat(43));
    expect(inviteToken('/invite/short')).toBeNull();
    // [PCODE-219 | S15 | v0.1.0] the public purchase pages
    expect(screenOf('/buy')).toBe('buy');
    expect(screenOf('/buy/done')).toBe('buy');
    expect(screenOf('/buying')).toBe('home');
  });
});

describe('settings', () => {
  it('profile: the name is editable, the email is not, and the password form asks for the current one', () => {
    const html = renderToString(<ProfileSection me={me} onChanged={() => undefined} />);
    expect(html).toContain('value="Ada Lovelace"');
    expect(html).toMatch(/id="pf-email"[^>]*readOnly|id="pf-email"[^>]*readonly/i);
    expect(html).toMatch(/autoComplete="current-password"/i);
    expect(html).toContain('>Change password</button>');
  });

  it('a secret is shown with a copy button', () => {
    const html = renderToString(<CopyField label="Your new token" value="pe_secret" />);
    expect(html).toContain('value="pe_secret"');
    expect(html).toContain('>Copy</button>');
  });

  it('project settings: members edit name and description; admins also version, loop rules and archive', () => {
    const member = renderToString(
      <ProjectSettings project={project} canEdit canAdmin={false} onSave={save} />,
    );
    expect(member).toContain('value="The App"');
    expect(member).not.toContain('Review before done');
    expect(member).not.toContain('Archive');
    const admin = renderToString(
      <ProjectSettings project={project} canEdit canAdmin onSave={save} />,
    );
    expect(admin).toContain('value="0.3.0"');
    expect(admin).toContain('Review before done');
    expect(admin).toContain('>docs/</textarea>');
    expect(admin).toContain('>Archive</button>');
  });
});
