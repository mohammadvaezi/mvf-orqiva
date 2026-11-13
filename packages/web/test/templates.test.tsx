// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-119 | S15 | v0.1.0] Add workspace lifecycle templates with an editor ──
import { DEFAULT_LIFECYCLE } from '@orqiva/shared';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { appRoute } from '../src/core/nav.js';
import { TemplateEditor, keyFor } from '../src/templates.js';

const none = (): Promise<null> => Promise.resolve(null);

describe('lifecycle templates', () => {
  it('have their own settings section', () => {
    expect(appRoute('/settings/lifecycle')).toEqual({ kind: 'settings', section: 'lifecycle' });
  });

  it('give new parts keys from their names, never twice', () => {
    expect(keyFor('Owner interview', [])).toBe('owner-interview');
    expect(keyFor('Owner interview', ['owner-interview'])).toBe('owner-interview-2');
    expect(keyFor('2nd review', [])).toBe('x2nd-review');
    expect(keyFor('!!!', [])).toBe('part');
  });

  it('edit every phase, stage and gate, and allow saving a valid definition', () => {
    const html = renderToString(
      <TemplateEditor
        name="Agency"
        definition={DEFAULT_LIFECYCLE}
        onSave={none}
        onCancel={() => undefined}
      />,
    );
    expect(html).toContain('value="Owner interview"');
    expect(html).toContain('value="G1 Go / no-go"');
    expect(html).toContain('<option value="owner" selected="">Signed by an owner</option>');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Save template<\/button>/);
  });

  it('say what is wrong and keep Save off while the definition is broken', () => {
    const broken = { phases: [{ key: 'empty', name: 'Empty', stages: [] }] };
    const html = renderToString(
      <TemplateEditor name="Bad" definition={broken} onSave={none} onCancel={() => undefined} />,
    );
    expect(html).toContain('needs at least one stage');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save template<\/button>/);
  });
});
