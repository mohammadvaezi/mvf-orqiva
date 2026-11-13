// ── [PCODE-279 | S15 | v0.1.0] T29.1 Document blocks: callouts, math and Mermaid diagrams rendered by our own code ──
//    Why:  TeX read into MathML as the browser needs it, mistakes reported; flowcharts and sequence
//          diagrams read from Mermaid text and laid out without overlaps.
import { describe, expect, it } from 'vitest';
import { layoutDiagram, readDiagram, type Flowchart, type Sequence } from '../src/mermaid.js';
import { mathXml, texToMath, TexError } from '../src/texmath.js';

describe('TeX to MathML', () => {
  it('reads fractions, scripts, roots, Greek letters and operators', () => {
    expect(mathXml(texToMath('x^2 + y_i = \\frac{a}{b}'))).toBe(
      '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo>' +
        '<msub><mi>y</mi><mi>i</mi></msub><mo>=</mo><mfrac><mi>a</mi><mi>b</mi></mfrac></mrow></math>',
    );
    expect(mathXml(texToMath('\\sqrt[3]{\\alpha} \\le \\infty', true))).toBe(
      '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mrow><mroot><mi>α</mi><mn>3</mn></mroot>' +
        '<mo>≤</mo><mo>∞</mo></mrow></math>',
    );
  });

  it('puts the limits of big operators under and over them', () => {
    const x = mathXml(texToMath('\\sum_{i=1}^{n} i'));
    expect(x).toContain(
      '<munderover><mo largeop="true">∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover>',
    );
    expect(mathXml(texToMath('\\lim_{x \\to 0} f'))).toContain('<munder><mi>lim</mi>');
  });

  it('reads text, accents and stretchy brackets', () => {
    const x = mathXml(texToMath('\\left( \\hat{x} \\right) \\text{if } x > 0'));
    expect(x).toContain('<mo stretchy="true">(</mo>');
    expect(x).toContain('<mover accent="true"><mi>x</mi><mo>^</mo></mover>');
    expect(x).toContain('<mtext>if </mtext>');
    expect(x).toContain('<mo>&gt;</mo>');
  });

  it('reports what it cannot read', () => {
    expect(() => texToMath('\\begin{matrix}')).toThrow(TexError);
    expect(() => texToMath('\\frac{a}{b')).toThrow('A { is not closed');
    expect(() => texToMath('a}')).toThrow('A } without its {');
    expect(() => texToMath('\\left( x')).toThrow('\\left without \\right');
  });
});

describe('Mermaid diagrams', () => {
  it('reads a flowchart with shapes, labels, chains and link styles', () => {
    const f = readDiagram(
      [
        'flowchart LR',
        '  A[Order placed] --> B{Paid?}',
        '  B -->|yes| C(Ship) --> D((Done))',
        '  B -. no .-> E>Remind]',
        '  E ==> B',
        '  %% a comment',
      ].join('\n'),
    ) as Flowchart;
    expect(f.dir).toBe('LR');
    expect(f.nodes.map((n) => [n.id, n.label, n.shape])).toEqual([
      ['A', 'Order placed', 'box'],
      ['B', 'Paid?', 'diamond'],
      ['C', 'Ship', 'round'],
      ['D', 'Done', 'circle'],
      ['E', 'Remind', 'flag'],
    ]);
    expect(f.edges.map((e) => [e.from, e.to, e.label, e.style, e.arrow])).toEqual([
      ['A', 'B', '', 'solid', true],
      ['B', 'C', 'yes', 'solid', true],
      ['C', 'D', '', 'solid', true],
      ['B', 'E', 'no', 'dotted', true],
      ['E', 'B', '', 'thick', true],
    ]);
  });

  it('ranks a flowchart top-down without overlaps, a cycle not pushing it further', () => {
    const l = layoutDiagram(readDiagram('graph TD\nA --> B\nA --> C\nB --> D\nC --> D\nD --> A'));
    const y = (id: string) => l.boxes.find((b) => b.id === id)?.y ?? -1;
    expect(y('A')).toBeLessThan(y('B'));
    expect(y('B')).toBe(y('C'));
    expect(y('D')).toBeGreaterThan(y('B'));
    const [b, c] = [l.boxes.find((x) => x.id === 'B'), l.boxes.find((x) => x.id === 'C')];
    expect((b?.x ?? 0) + (b?.w ?? 0)).toBeLessThan(c?.x ?? 0);
    expect(l.lines).toHaveLength(5);
    expect(l.width).toBeGreaterThan(0);
    for (const box of l.boxes) expect(box.x + box.w).toBeLessThanOrEqual(l.width);
  });

  it('reads and lays out a sequence diagram with notes', () => {
    const s = readDiagram(
      [
        'sequenceDiagram',
        '  actor U as User',
        '  participant API',
        '  U->>API: POST /orders',
        '  API-->>U: 201 Created',
        '  Note over U,API: stored once',
        '  API->>API: queue a mail',
      ].join('\n'),
    ) as Sequence;
    expect(s.participants).toEqual([
      { id: 'U', label: 'User', actor: true },
      { id: 'API', label: 'API', actor: false },
    ]);
    expect(s.steps.map((x) => x.kind)).toEqual(['message', 'message', 'note', 'message']);
    expect(s.steps[1]).toMatchObject({ dashed: true, arrow: true, text: '201 Created' });
    const l = layoutDiagram(s);
    expect(l.lifelines).toHaveLength(2);
    const [m1, m2] = l.lines;
    expect((m1?.points[0]?.y ?? 0) < (m2?.points[0]?.y ?? 0)).toBe(true);
    expect(l.boxes.find((b) => b.shape === 'note')?.label).toBe('stored once');
  });

  it('names the diagram types it does not draw', () => {
    expect(() => readDiagram('gantt\n title x')).toThrow('gantt diagrams are not drawn yet');
    expect(() => readDiagram('sequenceDiagram\nA something B')).toThrow('A message is expected');
  });
});
