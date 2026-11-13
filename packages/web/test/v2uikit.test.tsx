// ── [PCODE-172 | S15 | v0.1.0] B3.5 UI kit live in the web app: tokens with export, components, mockups with pins and approval, assets, contrast checks ──
//    Why:  swatches only for real colours, pins drawn in SVG at their share of the image (no inline
//          styles), grades coloured as WCAG reads them, and a UI kit tab for the team.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProjectTabsV2 } from '../src/v2/projecttabs.js';
import { gradeTone, isColour, PinnedImage, Swatch } from '../src/v2/uikit.js';

describe('ui kit', () => {
  it('shows a swatch only for a colour', () => {
    expect(isColour('#4f46e5')).toBe(true);
    expect(isColour('oklch(0.6 0.2 260)')).toBe(true);
    expect(isColour('var(--x)')).toBe(false);
    expect(renderToString(<Swatch value="#4f46e5" />)).toContain('fill="#4f46e5"');
    expect(renderToString(<Swatch value="16px" />)).toContain('v2-swatch-none');
  });

  it('draws pins in SVG at their share of the image, with no inline style', () => {
    const html = renderToString(
      <PinnedImage
        url="/f/1"
        label="Version 2"
        draft={{ x: 0.25, y: 0.5 }}
        onPlace={null}
        pins={[{ id: 'p', x: 0.5, y: 0.1, resolved: true }]}
      />,
    );
    expect(html).toContain('viewBox="0 0 1600 1000"');
    expect(html).toContain('cx="800" cy="100"');
    expect(html).toContain('v2-pin v2-pin--done');
    expect(html).toContain('cx="400" cy="500"');
    expect(html).not.toContain('style=');
  });

  it('colours the WCAG grades', () => {
    expect([gradeTone('AAA'), gradeTone('AA'), gradeTone('AA large'), gradeTone('fail')]).toEqual([
      'success',
      'success',
      'warning',
      'danger',
    ]);
  });

  it('has a UI kit tab for the team, not for clients', () => {
    const id = '0b1f6a52-3c1e-4d7a-9a51-2f0f6c1d2e3a';
    expect(
      renderToString(
        <ProjectTabsV2
          projectId={id}
          view="uikit"
          portal={false}
          role="designer"
          go={() => undefined}
        />,
      ),
    ).toMatch(/aria-current="page"[^>]*>.*?UI kit<\/a>/);
    expect(
      renderToString(
        <ProjectTabsV2 projectId={id} view="overview" portal role="guest" go={() => undefined} />,
      ),
    ).not.toContain('UI kit');
  });
});
