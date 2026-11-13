// ── [PCODE-318 | S15 | v0.1.0] T32.4b Masking of personal data in test results and the test-data vault ──
//    Why:  personal data is masked by its shape and check digits (not every long number), test-data values
//          by their name, and {{data:name}} references are found, filled and cut apart.
import { describe, expect, it } from 'vitest';
import { dataParts, dataRefs, fillTestData, maskPersonal, validIban } from '../src/testdata.js';

describe('masking and test data', () => {
  it('masks emails, IBANs, cards and phone numbers, and leaves other numbers', () => {
    const m = maskPersonal(
      'Mail ada.lovelace@example.org about order 2026101412345, IBAN DE89 3704 0044 0532 0130 00, ' +
        'card 4111 1111 1111 1111, call +49 151 2345678 or (030) 1234-5678. Build 1.4.0, total 1234.56.',
    );
    expect(m.text).toBe(
      'Mail [email] about order 2026101412345, IBAN [iban], card [card], call [phone] or [phone]. Build 1.4.0, total 1234.56.',
    );
    expect(m.count).toBe(5);
    // a number that fails the check digit is no card
    expect(maskPersonal('id 4111 1111 1111 1112').text).toBe('id 4111 1111 1111 1112');
    expect(validIban('DE89370400440532013000')).toBe(true);
    expect(validIban('DE89370400440532013001')).toBe(false);
  });

  it('masks test-data values by name, the longest first', () => {
    const m = maskPersonal('Signed in as qa-admin with Sup3r-secret and qa-admin again', [
      { name: 'admin.user', value: 'qa-admin' },
      { name: 'admin.password', value: 'Sup3r-secret' },
      { name: 'tiny', value: 'a' },
    ]);
    expect(m.text).toBe(
      'Signed in as [test data: admin.user] with [test data: admin.password] and [test data: admin.user] again',
    );
    expect(m.count).toBe(3);
  });

  it('finds, fills and cuts {{data:name}} references', () => {
    const t = 'Sign in as {{data:admin.user}} with {{data:admin.password}}';
    expect(dataRefs(t)).toEqual(['admin.user', 'admin.password']);
    expect(fillTestData(t, new Map([['admin.user', 'qa-admin']]))).toBe(
      'Sign in as qa-admin with {{data:admin.password}}',
    );
    expect(dataParts(t)).toEqual([
      { text: 'Sign in as ' },
      { ref: 'admin.user' },
      { text: ' with ' },
      { ref: 'admin.password' },
    ]);
  });
});
