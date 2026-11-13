// ── [PCODE-108 | S15 | v0.1.0] Integrate Git hosts: GitHub and Gitea webhooks, commits and PRs on items, live ──
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GitLinks, RepositoriesView, type GitConnection } from '../src/git.js';
import { appRoute } from '../src/core/nav.js';

const conn: GitConnection = {
  id: 'c1',
  provider: 'github',
  repo: 'acme/app',
  webhookPath: '/hooks/git/c1',
  createdAt: '2026-12-14T10:00:00Z',
  lastDeliveryAt: null,
};

describe('repositories', () => {
  it('has its own address under the project', () => {
    expect(appRoute('/projects/11111111-1111-4111-8111-111111111111/git')).toEqual({
      kind: 'project',
      id: '11111111-1111-4111-8111-111111111111',
      view: 'git',
    });
  });

  it('lists connections for everyone and offers connecting only to admins', () => {
    const props = {
      connections: [conn],
      origin: 'https://pe.example.test',
      projectKey: 'APP',
      onConnect: () => Promise.resolve('x'),
      onRemove: () => Promise.resolve(null),
    };
    const member = renderToString(<RepositoriesView {...props} canAdmin={false} />);
    expect(member).toContain('acme/app');
    expect(member).toContain('no delivery yet');
    expect(member).toContain('Workspace admins connect repositories.');
    expect(member).not.toContain('Disconnect');
    const admin = renderToString(<RepositoriesView {...props} canAdmin />);
    expect(admin).toContain('Connect repository');
    expect(admin).toContain('Disconnect');
  });
});

describe('commits and pull requests on an item', () => {
  it('shows nothing without links, and each link with its state', () => {
    expect(renderToString(<GitLinks links={[]} />)).toBe('');
    const html = renderToString(
      <GitLinks
        links={[
          {
            kind: 'pull_request',
            ref: '4',
            title: 'Reprice',
            url: 'https://gitea.test/pr/4',
            author: 'bob',
            state: 'merged',
            at: '2026-12-14T10:00:00Z',
            provider: 'gitea',
            repo: 'team/app',
          },
          {
            kind: 'commit',
            ref: 'abcdef1234567',
            title: 'APP-1 Export',
            url: '',
            author: 'ada',
            state: 'main',
            at: '2026-12-14T09:00:00Z',
            provider: 'github',
            repo: 'acme/app',
          },
        ]}
      />,
    );
    expect(html.replace(/<!-- -->/g, '')).toContain('PR #4 · merged');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('abcdef1');
    expect(html).toContain('APP-1 Export');
  });
});
