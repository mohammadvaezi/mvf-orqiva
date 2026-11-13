// ── [PCODE-322 | S15 | v0.1.0] T32.7a EPSS and known-exploited feeds, CVE alerts against shipped versions ──
//    Why:  the recorded CISA catalog and EPSS answer read into facts (entries without a CVE id left out),
//          EPSS is asked in batches of a hundred real CVE ids, and the alert says where the CVE shipped.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { epssUrls, exposureText, parseEpss, parseKev } from '../src/vulnfeeds.js';

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL('../../server/test/fixtures/feeds/' + name, import.meta.url), 'utf8'),
  ) as unknown;

describe('vulnerability feeds', () => {
  it('reads the known-exploited catalog', () => {
    const kev = parseKev(fixture('kev.json'));
    expect([...kev.keys()]).toEqual(['CVE-2021-44228', 'CVE-2023-4863']);
    expect(kev.get('CVE-2021-44228')).toEqual({
      cve: 'CVE-2021-44228',
      added: '2021-12-10',
      due: '2021-12-24',
      ransomware: true,
    });
    expect(kev.get('CVE-2023-4863')?.ransomware).toBe(false);
  });

  it('reads EPSS scores and asks for them in batches', () => {
    expect(parseEpss(fixture('epss.json'))).toEqual([
      { cve: 'CVE-2021-44228', epss: 0.94401, percentile: 0.99988 },
      { cve: 'CVE-2021-23337', epss: 0.01137, percentile: 0.77602 },
    ]);
    const many = Array.from({ length: 150 }, (_, i) => 'CVE-2024-' + String(10000 + i));
    const urls = epssUrls('https://api.first.org/data/v1/epss', [
      ...many,
      'cve-2024-10000',
      'GHSA-35jh-r3h4-6jhm',
    ]);
    expect(urls).toHaveLength(2);
    expect(urls[0]?.startsWith('https://api.first.org/data/v1/epss?cve=CVE-2024-10000,')).toBe(
      true,
    );
    expect(urls[1]?.split(',').length).toBe(50);
  });

  it('says where a CVE shipped', () => {
    expect(
      exposureText(
        'CVE-2021-23337',
        'lodash',
        '4.17.20',
        [{ version: '1.4.0', environment: 'Production' }],
        false,
      ),
    ).toBe('lodash 4.17.20 with CVE-2021-23337 is in the shipped version 1.4.0 (Production).');
    expect(
      exposureText(
        'CVE-2021-23337',
        'lodash',
        '4.17.20',
        ['1.0', '1.1', '1.2', '1.3', '1.4'].map((v) => ({ version: v, environment: null })),
        true,
      ),
    ).toBe(
      'CVE-2021-23337 is now known to be exploited. lodash 4.17.20 with CVE-2021-23337 is in the shipped versions 1.0, 1.1, 1.2, 1.3 and 1 more.',
    );
  });
});
