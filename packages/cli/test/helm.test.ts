// ── [PCODE-214 | S15 | v0.1.0] T19.3 Several server nodes (events, presence and migrations across nodes) and a Helm chart ──
//    Why:  the Helm chart, checked as text (there is no helm binary here): every value a template uses is
//          in values.yaml, blocks open and close, the server gets the environment it reads, the probes ask
//          /health on the port the image exposes, and the pod runs as non-root on a read-only root.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../../', import.meta.url);
const chart = (p: string): string => readFileSync(new URL('deploy/helm/orqiva/' + p, root), 'utf8');
const templates = readdirSync(new URL('deploy/helm/orqiva/templates/', root)).map((f) => ({
  f,
  text: chart('templates/' + f),
}));

/** The dotted key paths of a simple YAML file (maps only, two-space indentation). */
function keyPaths(yaml: string): Set<string> {
  const out = new Set<string>();
  const stack: { indent: number; key: string }[] = [];
  for (const line of yaml.split('\n')) {
    const m = /^(\s*)([A-Za-z][\w-]*):/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    const indent = (m[1] ?? '').length;
    while (stack.length && (stack.at(-1)?.indent ?? 0) >= indent) stack.pop();
    stack.push({ indent, key: m[2] ?? '' });
    out.add(stack.map((s) => s.key).join('.'));
  }
  return out;
}

describe('the Helm chart', () => {
  it('uses only values that exist', () => {
    const keys = keyPaths(chart('values.yaml'));
    const used = new Set(
      templates.flatMap((t) => [...t.text.matchAll(/\.Values\.([\w.]+)/g)].map((m) => m[1] ?? '')),
    );
    expect([...used].filter((k) => !keys.has(k))).toEqual([]);
    expect(used.size).toBeGreaterThan(15);
  });

  it('closes every block it opens', () => {
    for (const t of templates) {
      const opens = (t.text.match(/\{\{-?\s*(if|with|range|define)\b/g) ?? []).length;
      const ends = (t.text.match(/\{\{-?\s*end\s*-?\}\}/g) ?? []).length;
      expect([t.f, ends]).toEqual([t.f, opens]);
    }
  });

  it('gives the server what it reads and checks it the way the image does', () => {
    const d = chart('templates/deployment.yaml');
    const server = readFileSync(new URL('packages/server/src/main.ts', root), 'utf8');
    for (const v of ['ORQIVA_PUBLIC_URL', 'ORQIVA_TRUST_PROXY']) {
      expect(d).toContain('name: ' + v);
      expect(server).toContain("'" + v + "'");
    }
    expect(chart('templates/secret.yaml')).toMatch(/DATABASE_URL:[\s\S]*ORQIVA_SECRET_KEY:/);
    expect(server).toContain("env['DATABASE_URL']");
    const dockerfile = readFileSync(new URL('Dockerfile', root), 'utf8');
    expect(dockerfile).toContain('EXPOSE 8080');
    expect(d).toContain('containerPort: 8080');
    expect(d.match(/path: \/health/g)).toHaveLength(2);
    expect(d).toContain('runAsNonRoot: true');
    expect(d).toContain('readOnlyRootFilesystem: true');
    expect(d).toContain('mountPath: /data');
    expect(dockerfile).toContain('ORQIVA_DATA_DIR=/data');
  });

  it('refuses several replicas on a volume only one node can write', () => {
    expect(chart('templates/pvc.yaml')).toContain(
      'With more than one replica the uploads volume must be ReadWriteMany',
    );
    expect(chart('values.yaml')).toMatch(/replicaCount: 2[\s\S]*accessMode: ReadWriteMany/);
  });
});
