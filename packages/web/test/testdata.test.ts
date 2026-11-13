// ── [PCODE-318 | S15 | v0.1.0] T32.4b Masking of personal data in test results and the test-data vault ──
//    Why:  the vault takes the names steps can write as {{data:name}}, and nothing else.
import { describe, expect, it } from 'vitest';
import { dataName } from '../src/v2/testdata.js';

describe('test data in the web app', () => {
  it('takes only names a step can refer to', () => {
    expect(dataName(' admin.user ')).toBe('admin.user');
    expect(dataName('card_visa-ok')).toBe('card_visa-ok');
    expect(dataName('Admin')).toBeNull();
    expect(dataName('1st')).toBeNull();
    expect(dataName('with space')).toBeNull();
  });
});
