// ── [PCODE-297 | S15 | v0.1.0] T30.10 Figma two-way sync: variables and components, tested against recorded Figma answers ──
//    Why:  the pieces under the sync: Figma links and names, colours both ways, equal values that are
//          written differently, the three-way rules, the request for a file without collections (with
//          aliases among new variables), and components found through their variant sets.
import { describe, expect, it } from 'vitest';
import {
  figmaColorToHex,
  figmaComponentLinks,
  figmaFileKey,
  figmaNameToToken,
  figmaPushBody,
  hexToFigmaColor,
  modeRoles,
  normalValue,
  orqivaSide,
  syncPlan,
  type SyncSide,
  type SyncToken,
} from '../src/index.js';

const tok = (light: string, dark = light, type: SyncToken['type'] = 'color'): SyncToken => ({
  type,
  light,
  dark,
  themes: {},
  description: '',
});
const side = (o: Record<string, SyncToken>): SyncSide => new Map(Object.entries(o));

describe('Figma sync pieces', () => {
  it('reads links, names and colours', () => {
    expect(figmaFileKey('https://www.figma.com/design/Ab12Cd34Ef56Gh78Ij90/Kit?node-id=0-1')).toBe(
      'Ab12Cd34Ef56Gh78Ij90',
    );
    expect(figmaFileKey('https://www.figma.com/file/Zz98Yy76Xx54/Old')).toBe('Zz98Yy76Xx54');
    expect(figmaFileKey('https://example.com/design/Ab12Cd34Ef56')).toBeNull();
    expect(figmaNameToToken('Color/Primary 500')).toBe('color.primary-500');
    expect(figmaNameToToken('  Space / 4 ')).toBe('space.4');
    expect(figmaNameToToken('🙂')).toBeNull();
    expect(figmaColorToHex({ r: 0.3098, g: 0.2745, b: 0.898, a: 1 })).toBe('#4f46e5');
    expect(figmaColorToHex({ r: 0, g: 0, b: 0, a: 0.5 })).toBe('#00000080');
    expect(hexToFigmaColor('#4F46E5')).toEqual({ r: 0.3098, g: 0.2745, b: 0.898, a: 1 });
    // equal however written
    expect(normalValue('color', 'rgb(79, 70, 229)')).toBe('#4f46e5');
    expect(normalValue('dimension', '1rem')).toBe('16px');
    expect(normalValue('duration', '0.2s')).toBe('200ms');
    expect(normalValue('color', '{color.primary}')).toBe('{color.primary}');
    expect(
      modeRoles({
        id: 'c',
        name: 'c',
        defaultModeId: 'a',
        modes: [
          { modeId: 'a', name: 'Default' },
          { modeId: 'b', name: 'Dark mode' },
          { modeId: 'c', name: 'Brand B' },
        ],
      }),
    ).toEqual({
      light: 'a',
      dark: 'b',
      themes: { 'brand-b': 'c' },
    });
  });

  it('compares three ways', () => {
    const base = side({
      a: tok('#000000'),
      b: tok('#111111'),
      c: tok('#222222'),
      d: tok('#333333'),
      gone: tok('#444444'),
    });
    const orq = side({
      a: tok('#000000'),
      b: tok('#aaaaaa'),
      c: tok('#222222'),
      d: tok('#cccccc'),
      only: tok('#555555'),
    });
    const fig = side({
      a: tok('#000000'),
      b: tok('#111111'),
      c: tok('#bbbbbb'),
      d: tok('#dddddd'),
      gone: tok('#444444'),
    });
    const plan = syncPlan(base, orq, fig);
    expect(plan.inSync).toBe(1);
    expect(plan.push.map((x) => x.name + ':' + x.kind)).toEqual([
      'b:change',
      'gone:remove',
      'only:add',
    ]);
    expect(plan.pull.map((x) => x.name + ':' + x.kind)).toEqual(['c:change']);
    expect(plan.conflicts.map((x) => x.name)).toEqual(['d']);
    // shadows have no Figma variable: they stay out of the comparison
    expect([
      ...orqivaSide([
        { name: 's', type: 'shadow', valueLight: '0 1px 2px #000', valueDark: '', description: '' },
      ]).keys(),
    ]).toEqual([]);
  });

  it('writes a file without collections, aliases among new variables included', () => {
    const { body, skipped } = figmaPushBody(
      [
        { name: 'color.primary', kind: 'add', from: null, to: tok('#4f46e5', '#818cf8') },
        { name: 'color.brand', kind: 'add', from: null, to: tok('{color.primary}') },
        { name: 'color.link', kind: 'add', from: null, to: tok('{color.missing}') },
      ],
      { ids: {}, collections: [], skipped: [] },
    );
    expect(body.variableCollections).toEqual([
      { action: 'CREATE', id: 'tmp:collection', name: 'Orqiva tokens', initialModeId: 'tmp:light' },
    ]);
    expect(body.variableModes?.map((m) => m.action + ' ' + m.name)).toEqual([
      'UPDATE Light',
      'CREATE Dark',
    ]);
    expect(body.variables?.map((v) => v.id)).toEqual([
      'tmp:color.primary',
      'tmp:color.brand',
      'tmp:color.link',
    ]);
    expect(body.variableModeValues?.find((v) => v.variableId === 'tmp:color.brand')?.value).toEqual(
      {
        type: 'VARIABLE_ALIAS',
        id: 'tmp:color.primary',
      },
    );
    expect(skipped).toEqual([
      { name: 'color.link', reason: 'it points at color.missing, which Figma does not hold' },
    ]);
  });

  it('never wipes a description Figma has with an empty one', () => {
    const index = {
      ids: { 'color.primary': { variableId: 'V:1', collectionId: 'C:1' } },
      collections: [{ id: 'C:1', name: 'Tokens', light: 'm:0', dark: null, themes: {} }],
      skipped: [],
    };
    const figma = { ...tok('#4f46e5'), description: 'Actions and links' };
    const quiet = figmaPushBody(
      [{ name: 'color.primary', kind: 'change', from: figma, to: tok('#4338ca') }],
      index,
    );
    expect(quiet.body.variables).toEqual([]);
    expect(quiet.body.variableModeValues).toEqual([
      { variableId: 'V:1', modeId: 'm:0', value: { r: 0.2627, g: 0.2196, b: 0.7922, a: 1 } },
    ]);
    const said = figmaPushBody(
      [
        {
          name: 'color.primary',
          kind: 'change',
          from: figma,
          to: { ...tok('#4338ca'), description: 'Buttons and links' },
        },
      ],
      index,
    );
    expect(said.body.variables).toEqual([
      { action: 'UPDATE', id: 'V:1', description: 'Buttons and links' },
    ]);
  });

  it('finds components by name, a variant by its set', () => {
    const links = figmaComponentLinks('F1234567890', [
      {
        key: 'k1',
        node_id: '1:2',
        name: 'Size=Large',
        containing_frame: { containingComponentSet: { nodeId: '1:1', name: 'Icon Button' } },
      },
      { key: 'k2', node_id: '3:4', name: 'Card' },
    ]);
    expect(links.get('iconbutton')).toBe('https://www.figma.com/design/F1234567890/?node-id=1-1');
    expect(links.get('card')).toBe('https://www.figma.com/design/F1234567890/?node-id=3-4');
  });
});
