// ── [PCODE-153 | S15 | v0.1.0] D1 preview: design system v2, shell, Cmd-K, Home, Inbox, project overview ──
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { INBOX, PROJECTS, type Role } from '../src/preview/data.js';
import { HomePage } from '../src/preview/home.js';
import { InboxPage } from '../src/preview/inbox.js';
import { isPreview, previewRoute } from '../src/preview/index.js';
import { ProjectPage, ProjectsPage } from '../src/preview/projects.js';
import { inboxFor, Sidebar } from '../src/preview/shell.js';

const go = (): void => undefined;

describe('the design preview', () => {
  it('lives at /preview and reads sections, projects, tabs and items from the path', () => {
    expect(isPreview('/preview')).toBe(true);
    expect(isPreview('/preview/inbox')).toBe(true);
    expect(isPreview('/previews')).toBe(false);
    expect(previewRoute('/preview')).toMatchObject({ section: '', projectKey: null });
    expect(previewRoute('/preview/projects/hel/canvas')).toMatchObject({
      section: 'projects',
      projectKey: 'HEL',
      tab: 'canvas',
    });
    expect(previewRoute('/preview/inbox?item=i3')).toMatchObject({ section: 'inbox', item: 'i3' });
  });

  it('shows each role its own home', () => {
    const html = (role: Role): string =>
      renderToString(<HomePage role={role} inbox={inboxFor(role)} go={go} />);
    expect(html('developer')).toContain('My work');
    expect(html('lead')).toContain('Team and agents this sprint');
    expect(html('admin')).toContain('Workspace health');
    expect(html('tester')).toContain('Runs in progress');
    const client = html('client');
    expect(client).toContain('Waiting for you');
    // a client never sees agent spend or other clients
    expect(client).not.toContain('AI spend');
    expect(client).not.toContain('Nordwind');
  });

  it('keeps the client to their projects and away from team sections', () => {
    const nav = renderToString(
      <Sidebar
        section=""
        projectKey={null}
        role="client"
        inboxCount={1}
        collapsed={false}
        onCollapse={go}
        go={go}
      />,
    );
    expect(nav).toContain('Patient app');
    expect(nav).not.toContain('Fleet portal');
    expect(nav).not.toContain('Tokens and costs');
    expect(renderToString(<ProjectsPage role="client" go={go} />)).not.toContain('Payments API');
  });

  it('gives every inbox kind its own actions, and hides what is done', () => {
    const page = (selected: string, done = new Set<string>()): string =>
      renderToString(
        <InboxPage
          items={INBOX}
          done={done}
          snoozed={new Set()}
          selected={selected}
          onSelect={go}
          onDone={go}
          onSnooze={go}
          onUndo={go}
        />,
      );
    expect(page('i1')).toContain('Approve');
    expect(page('i3')).toContain('Start review');
    expect(page('i6')).toContain('Send quote');
    expect(page('i2')).toContain('Accept line by line');
    expect(page('i1', new Set(['i1']))).not.toContain('Coder wants to run the migration');
  });

  it('draws the overview and a page for every project tab', () => {
    for (const p of PROJECTS) {
      const html = renderToString(<ProjectPage pkey={p.key} tab="overview" role="lead" go={go} />);
      expect(html).toContain(p.name);
      expect(html).toContain('People and agents');
    }
  });
});
