// ── [PCODE-318 | S15 | v0.1.0] T32.4b Masking of personal data in test results and the test-data vault ──
//    Why:  what testers type and tools report ends up in results, bugs and exports; real people's emails,
//          phone numbers, IBANs and card numbers must not. They are masked before they are kept, and so
//          are the values of the project's test data, which steps name as {{data:name}} instead of writing
//          them out.

export interface Masked {
  text: string;
  /** how many pieces were masked */
  count: number;
}

const luhn = (digits: string): boolean => {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
};

const IBAN_LENGTH: Record<string, number> = {
  DE: 22,
  AT: 20,
  CH: 21,
  NL: 18,
  BE: 16,
  FR: 27,
  ES: 24,
  IT: 27,
  GB: 22,
  PL: 28,
  LU: 20,
  DK: 18,
  SE: 24,
};

/** Whether an IBAN's check digits are right (mod 97). */
export function validIban(raw: string): boolean {
  const s = raw.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const want = IBAN_LENGTH[s.slice(0, 2)];
  if (want && s.length !== want) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rest = 0;
  for (const ch of moved) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of v) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest === 1;
}

/**
 * The text with personal data masked: emails, IBANs, card numbers (by their check digit), phone numbers
 * (an international or long number), and the given test-data values by name.
 */
export function maskPersonal(
  text: string,
  testData: readonly { name: string; value: string }[] = [],
): Masked {
  let count = 0;
  let out = text;
  // the test data first: its values may look like any of the others
  for (const d of [...testData].sort((a, b) => b.value.length - a.value.length)) {
    if (d.value.length < 4) continue;
    const parts = out.split(d.value);
    if (parts.length > 1) {
      count += parts.length - 1;
      out = parts.join('[test data: ' + d.name + ']');
    }
  }
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, () => {
    count++;
    return '[email]';
  });
  out = out.replace(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{2,4}){3,8}\b/g, (m) => {
    if (!validIban(m)) return m;
    count++;
    return '[iban]';
  });
  out = out.replace(/\b\d(?:[ -]?\d){12,18}\b/g, (m) => {
    const digits = m.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19 || !luhn(digits)) return m;
    count++;
    return '[card]';
  });
  // +49 151 2345678, (030) 1234-5678, 0151 23456789: a plus, a bracketed area code, or 10+ digits from 0
  out = out.replace(/(?:\+\d{1,3}[ -]?)?(?:\(\d{2,5}\)[ -]?)?\d(?:[ -]?\d){5,14}/g, (m) => {
    const digits = m.replace(/\D/g, '');
    const looksLikePhone = m.startsWith('+') || m.includes('(') || /^0\d{9,}$/.test(digits);
    if (!looksLikePhone || digits.length < 7 || digits.length > 15) return m;
    count++;
    return '[phone]';
  });
  return { text: out, count };
}

const DATA_REF = /\{\{data:([a-z][a-z0-9_.-]{0,40})\}\}/g;

/** The test-data names a text refers to as {{data:name}}. */
export const dataRefs = (text: string): string[] => [
  ...new Set([...text.matchAll(DATA_REF)].map((m) => m[1] ?? '')),
];

/** The text with the open (not sensitive) test data filled in; sensitive ones stay as references. */
export const fillTestData = (text: string, open: ReadonlyMap<string, string>): string =>
  text.replace(DATA_REF, (all, name: string) => open.get(name) ?? all);

/** A text cut into plain parts and test-data references, for drawing the references as buttons. */
export function dataParts(text: string): ({ text: string } | { ref: string })[] {
  const out: ({ text: string } | { ref: string })[] = [];
  let at = 0;
  for (const m of text.matchAll(DATA_REF)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index) });
    out.push({ ref: m[1] ?? '' });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}
