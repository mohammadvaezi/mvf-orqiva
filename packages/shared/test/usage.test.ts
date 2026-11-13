// ── [PCODE-327 | S15 | v0.1.0] T33.1a Cache and reasoning tokens priced, the daily ECB rate, spend in euro by day ──
//    Why:  a call is priced with its cache reads and writes at the table's prices or the usual shares of
//          the input price, and the ECB's daily file gives the day and euro per dollar.
import { describe, expect, it } from 'vitest';
import { cacheShare, parseEcbDaily, usageCost } from '../src/usage.js';

describe('usage cost', () => {
  it('prices input and output per million tokens', () => {
    expect(
      usageCost({ input: 1_000_000, output: 500_000 }, { in: 3_000_000, out: 15_000_000 }),
    ).toBe(10_500_000);
  });

  it('prices the cache at the usual shares of the input price when the table has none', () => {
    // 1M read at 10% of $3 = $0.30; 1M written at 125% = $3.75
    expect(
      usageCost(
        { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 1_000_000 },
        { in: 3_000_000, out: 0, cacheRead: 0, cacheWrite: null },
      ),
    ).toBe(300_000 + 3_750_000);
  });

  it('uses the table cache prices and leaves reasoning to the output', () => {
    expect(
      usageCost(
        { input: 0, output: 1000, reasoning: 800, cacheRead: 2000 },
        { in: 1_000_000, out: 2_000_000, cacheRead: 250_000 },
      ),
    ).toBe(2000 + 500);
  });

  it('says how much input came from the cache', () => {
    expect(cacheShare(0, 0)).toBe(0);
    expect(cacheShare(250, 750)).toBe(0.75);
  });
});

describe('ECB daily rates', () => {
  const xml = `<gesmes:Envelope><Cube><Cube time='2026-10-14'>
    <Cube currency='USD' rate='1.0870'/><Cube currency='JPY' rate='161.4'/></Cube></Cube></gesmes:Envelope>`;

  it('reads the day and turns dollars per euro into euro per dollar', () => {
    expect(parseEcbDaily(xml)).toEqual({ day: '2026-10-14', usdEur: 0.919963 });
  });

  it('refuses a file without a day or a dollar rate', () => {
    expect(parseEcbDaily('<html>maintenance</html>')).toBeNull();
    expect(parseEcbDaily(xml.replace("'USD'", "'GBP'"))).toBeNull();
    expect(parseEcbDaily(xml.replace("rate='1.0870'", "rate='0'"))).toBeNull();
  });
});
