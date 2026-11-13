// ── [PCODE-357 | S15 | v0.1.0] T35.5b German texts for the whole app ──
// ── [PCODE-356 | S15 | v0.1.0] T35.5a Translation layer for a German UI, language choice, text extraction ──
//    Why:  known texts are shown in German with their spaces kept; texts with numbers and names follow
//          their rule, and a known name inside a rule is translated too; unknown texts, numbers alone and
//          empty texts stay; the language follows the person, then the workspace, the client, the last
//          visit and the browser.
import { describe, expect, it } from 'vitest';
import { chooseLanguage } from '../src/i18n/language.js';
import { patternsOf, translator } from '../src/i18n/translate.js';

const dict = {
  Save: 'Speichern',
  'Go to': 'Gehe zu',
  Projects: 'Projekte',
  '{n} events match': '{n} Ereignisse passen',
  'Go to {x}': 'Gehe zu {x}',
  '{x} wrote to you': '{x} hat Ihnen geschrieben',
  'Budget at {x} %: {x2}': 'Budget bei {x} %: {x2}',
};

describe('the translator', () => {
  const t = translator(dict);
  it('shows known texts in German, keeping the spaces around them', () => {
    expect(t('Save')).toBe('Speichern');
    expect(t('  Go to ')).toBe('  Gehe zu ');
    expect(t('Save\n   ')).toBe('Speichern\n   ');
  });
  it('follows the rules for texts with numbers and names', () => {
    expect(t('555 events match')).toBe('555 Ereignisse passen');
    expect(t('Go to Projects')).toBe('Gehe zu Projekte');
    expect(t('Ada Lovelace wrote to you')).toBe('Ada Lovelace hat Ihnen geschrieben');
    expect(t('Budget at 82 %: the workspace')).toBe('Budget bei 82 %: the workspace');
  });
  // [PCODE-357 | S15 | v0.1.0]
  it('translates the parts of a text joined with a middle dot', () => {
    expect(t('Dev Workspace · Projects')).toBe('Dev Workspace · Projekte');
    expect(t('Dev Workspace · Owner Team')).toBeNull();
  });
  it('leaves unknown texts, numbers and empty texts alone', () => {
    expect(t('Something new')).toBeNull();
    expect(t('12,50 €')).toBeNull();
    expect(t('   ')).toBeNull();
  });
  it('makes a rule of each text with a placeholder, the longest first', () => {
    const p = patternsOf(dict);
    expect(p).toHaveLength(4);
    expect(p[0]?.names).toEqual(['{x}', '{x2}']);
  });
});

describe('the language', () => {
  it('follows the person, the workspace, the client, the last visit, the browser', () => {
    expect(chooseLanguage({ user: 'de', workspace: 'en' })).toBe('de');
    expect(chooseLanguage({ workspace: 'de', client: 'en' })).toBe('de');
    expect(chooseLanguage({ client: 'de', stored: 'en' })).toBe('de');
    expect(chooseLanguage({ stored: 'de', browser: 'en-US' })).toBe('de');
    expect(chooseLanguage({ browser: 'de-AT' })).toBe('de');
    expect(chooseLanguage({ browser: 'fr-FR' })).toBe('en');
    expect(chooseLanguage({})).toBe('en');
  });
});

// [PCODE-357 | S15 | v0.1.0] a number before or after a known text
describe('numbers next to known texts', () => {
  const t = translator({
    'waiting for a decision': 'warten auf eine Entscheidung',
    queued: 'in der Warteschlange',
    'Alerts without an incident': 'Alarme ohne Störung',
  });
  it('keeps the number and translates the text', () => {
    expect(t('6 waiting for a decision · 0 queued')).toBe(
      '6 warten auf eine Entscheidung · 0 in der Warteschlange',
    );
    expect(t('Alerts without an incident · 1')).toBe('Alarme ohne Störung · 1');
    expect(t('Alerts without an incident 3')).toBe('Alarme ohne Störung 3');
  });
});

// [PCODE-422 | S15 | v0.1.0]
describe('rules inside rules and parts', () => {
  const t = translator({
    '{n} d': '{n} T.',
    'last seen {x} ago': 'zuletzt gesehen vor {x}',
    '{n} agents': '{n} Agenten',
    '{n} running, {n2} waiting': '{n} laufen, {n2} warten',
  });
  it('translates a rule’s name by the rules too, and each part of a joined text', () => {
    expect(t('last seen 3 d ago')).toBe('zuletzt gesehen vor 3 T.');
    expect(t('13 agents · 0 running, 2 waiting')).toBe('13 Agenten · 0 laufen, 2 warten');
  });
});
