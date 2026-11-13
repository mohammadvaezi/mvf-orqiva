// ── [PCODE-202 | S15 | v0.1.0] Fix project pages: duplicated tab bars, visible scrollbars, cut-off sidebar, narrow widths ──
//    Why:  every project page has one tab bar, the project tabs above it; the page header under them names
//          the project and its actions only, never a second row of tabs.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProjectHeader } from '../src/project.js';
import type { Project } from '../src/views.js';

describe('the project page header', () => {
  it('has no tabs of its own', () => {
    const html = renderToString(
      <ProjectHeader
        project={{ id: 'p1', key: 'DEMO', name: 'Demo' } as Project}
        view="overview"
        go={() => undefined}
      />,
    );
    expect(html).toContain('Demo');
    expect(html).not.toContain('pe-tabbar');
    expect(html).not.toContain('Backlog');
  });
});
