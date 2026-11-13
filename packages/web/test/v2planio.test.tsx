// ── [PCODE-263 | S15 | v0.1.0] T27.5 Plan files: MS Project XML and CSV export and import, iCal of the plan ──
//    Why:  the Canvas offers the three files to download, recognises an MS Project or CSV file, and shows the
//          import card before anything is made.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ImportCard, formatOf } from '../src/v2/planio.js';

describe('plan files in the canvas', () => {
  it('knows MS Project XML and CSV by name or by content', () => {
    expect(formatOf('plan.xml', '')).toBe('msproject');
    expect(formatOf('export', '<?xml version="1.0"?><Project>')).toBe('msproject');
    expect(formatOf('Plan.CSV', 'Name;Dauer')).toBe('csv');
    expect(formatOf('plan.mpp', '\u0000\u0001')).toBeNull();
  });

  it('asks for a file and says what it reads', () => {
    const html = renderToString(
      <ImportCard
        workspaceId="w"
        projectId="p"
        onDone={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(html).toContain('aria-label="Plan file"');
    expect(html).toContain('MS Project XML');
    expect(html).toContain('Name column');
  });
});
