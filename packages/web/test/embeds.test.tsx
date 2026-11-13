// ── [PCODE-281 | S15 | v0.1.0] T29.3 Document embeds: live task lists, designs, Gantt, repo code; README import ──
//    Why:  bars sit where their dates are; outside a project an embed shows its line; a bad embed says why;
//          the insert menu offers the four embeds.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BLOCK_KINDS } from '../src/v2/blockedit.js';
import { barGeometry } from '../src/v2/embeds.js';
import { Markdown } from '../src/v2/markdown.js';

describe('page embeds', () => {
  it('places plan bars by their dates', () => {
    expect(
      barGeometry({ start: '2026-10-01', finish: '2026-10-10' }, '2026-10-01', '2026-10-10', 500),
    ).toEqual({ x: 0, w: 500 });
    expect(
      barGeometry({ start: '2026-10-06', finish: '2026-10-06' }, '2026-10-01', '2026-10-10', 500),
    ).toEqual({ x: 250, w: 50 });
  });

  it('shows the embed line outside a project, and why an embed cannot be read', () => {
    const outside = renderToString(<Markdown text={'```embed\ntasks: state:open\n```'} />);
    expect(outside).toContain('shown live in the project');
    const bad = renderToString(<Markdown text={'```embed\nvideo: x\n```'} />);
    expect(bad).toContain('video is not something a page embeds');
  });

  it('offers the embeds in the insert menu', () => {
    expect(BLOCK_KINDS.filter((k) => k.template.startsWith('```embed')).map((k) => k.key)).toEqual([
      'etasks',
      'edesign',
      'egantt',
      'ecode',
    ]);
  });
});
