// ── [PCODE-156 | S15 | v0.1.0] D4 preview: Versions, Security, Code map and Releases ──
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CodeMapTab, treemap } from '../src/preview/codemap.js';
import { previewRoute } from '../src/preview/index.js';
import { ProjectPage } from '../src/preview/projects.js';
import { SecurityTab } from '../src/preview/security.js';
import { ReleasesPage, VersionsTab } from '../src/preview/versions.js';

const go = (): void => undefined;
const text = (html: string): string => html.replace(/<!-- -->/g, '');

describe('D4: Versions, Security, Code map and Releases', () => {
  it('lists pull requests with checks, reviews, risk and a warning when no task is linked', () => {
    const html = text(renderToString(<VersionsTab />));
    expect(html).toContain('#318');
    expect(html).toContain('checks failed');
    expect(html).toContain('no task linked');
  });

  it('orders findings by one risk score and explains it', () => {
    const html = text(renderToString(<SecurityTab />));
    expect(html.indexOf('F-81')).toBeLessThan(html.indexOf('F-77'));
    expect(html).toContain('Known exploited (KEV)');
    expect(html).toContain('Fix with Sentinel');
    expect(html).toContain('Introduced by');
  });

  it('lays a treemap out without gaps or overlaps', () => {
    const rects = treemap([4, 3, 2, 1], 0, 0, 100, 50);
    expect(rects).toHaveLength(4);
    const area = rects.reduce((s, r) => s + r.w * r.h, 0);
    expect(Math.round(area)).toBe(5000);
    const big = rects.find((r) => r.i === 0);
    expect(Math.round((big?.w ?? 0) * (big?.h ?? 0))).toBe(2000);
  });

  it('draws the code map from fingerprints and the Releases page', () => {
    expect(text(renderToString(<CodeMapTab />))).toContain('Code by feature (from fingerprints)');
    expect(text(renderToString(<ReleasesPage />))).toContain('Next releases');
    expect(previewRoute('/preview/releases').section).toBe('releases');
  });

  it('leaves no project tab undesigned', () => {
    for (const tab of ['versions', 'security', 'codemap'])
      expect(
        renderToString(<ProjectPage pkey="AUR" tab={tab} role="lead" go={go} />),
      ).not.toContain('Designed in step');
  });
});
