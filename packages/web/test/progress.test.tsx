// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-127 | S15 | v0.1.0] Show measured progress on every card from acceptance criteria and subtasks ──
import { describe as sentence, type ActivityEvent } from '@orqiva/shared';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CardProgress, ProgressBar, ProgressMap, sum } from '../src/progress.js';

const text = (html: string): string => html.replace(/<!-- -->/g, '');

describe('progress on cards', () => {
  it('counts criteria and subtasks together', () => {
    expect(sum({ criteria: { done: 1, total: 3 }, subtasks: { done: 2, total: 2 } })).toEqual({
      done: 3,
      total: 5,
    });
  });

  it('draws a bar with "done of total", and nothing when there is nothing to count', () => {
    expect(renderToString(<ProgressBar done={0} total={0} label="x" />)).toBe('');
    const html = text(renderToString(<ProgressBar done={2} total={5} label="Progress" />));
    expect(html).toContain('2 of 5');
    expect(html).toContain('width="40"');
    expect(text(renderToString(<ProgressBar done={3} total={3} label="p" />))).toContain(
      'pe-card-progress--done',
    );
  });

  it('reads a card’s progress from the project', () => {
    const map = new Map([
      ['i1', { itemId: 'i1', criteria: { done: 1, total: 2 }, subtasks: { done: 0, total: 1 } }],
    ]);
    const html = text(
      renderToString(
        <ProgressMap.Provider value={map}>
          <CardProgress itemId="i1" />
          <CardProgress itemId="i2" />
        </ProgressMap.Provider>,
      ),
    );
    expect(html).toContain('Progress: 1 of 2 criteria, 0 of 1 subtasks');
    expect(html.match(/pe-card-progress"/g)).toHaveLength(1);
  });

  it('reads a tick in the feed', () => {
    const e = {
      type: 'orqiva.item.progressed',
      data: {
        actor: { kind: 'user', id: 'u', name: 'Ada' },
        verb: 'progressed',
        object: { type: 'item', id: 'i1', label: 'APP-1 Export' },
        progress: { done: 2, total: 3, unit: 'criteria' },
        changes: { criteria: { from: 'open', to: 'done' } },
      },
    } as unknown as ActivityEvent;
    expect(sentence(e)).toBe('Ada ticked a criterion on APP-1 Export (2 of 3)');
  });
});
