// ── [PCODE-457 | S15 | v0.1.0] VS Code planning as a conversation: Claude asks, the user answers with text and files, then the plan; replan and description change work; Home tab explains itself ──
// ── [PCODE-79 | S08 | v0.1.0] Add the New project wizard: describe the idea, draft, review and publish the plan visually ──
//    Why:  the wizard's position is derived from the files; these cases pin that order, the
//          description round trip and the gate on the two new messages (critical #12).
import { describe, expect, it } from 'vitest';
import { projectArg } from '../../src/commands/projectCommands';
import type { PlanJson } from '../../src/state/types';
import { homeModel } from '../../src/webviews/home/model';
import {
  descriptionBody,
  descriptionFile,
  wizardModel,
  type WizardInputs,
} from '../../src/webviews/home/wizard';
import { isWebviewMessage } from '../../src/webviews/protocol';

const plan: PlanJson = {
  version: '0.1.0',
  sprints: [
    {
      name: 'Sprint 01 - A page',
      date: '2026-10-03',
      goal: 'Something to show',
      items: [
        {
          title: 'Make a hello page',
          label: 'feature',
          priority: 'high',
          description_md: 'x',
          acceptance: ['shows Hello', 'big letters'],
        },
      ],
    },
  ],
};

const w = (over: Partial<WizardInputs> = {}): WizardInputs => ({
  description: 'written',
  descriptionText: 'A page that says hello',
  plan: 'missing',
  planJson: null,
  errors: [],
  checkError: null,
  published: false,
  ...over,
});

describe('the plan wizard', () => {
  it('walks describe -> draft -> review -> publish from the files alone', () => {
    expect(wizardModel(w({ description: 'missing' }))?.step).toBe('describe');
    expect(wizardModel(w({ description: 'template' }))?.step).toBe('describe');
    expect(wizardModel(w())?.step).toBe('draft');
    expect(wizardModel(w({ plan: 'errors', errors: ['bad date'] }))?.step).toBe('review');
    expect(wizardModel(w({ plan: 'invalid' }))?.step).toBe('review');
    expect(wizardModel(w({ plan: 'valid', planJson: plan }))?.step).toBe('publish');
    expect(wizardModel(w({ plan: 'valid', published: true }))).toBeNull();
  });

  it('summarises the plan as sprints of cards', () => {
    const d = wizardModel(w({ plan: 'valid', planJson: plan }));
    expect(d?.totals).toEqual({ sprints: 1, items: 1 });
    expect(d?.sprints[0]?.items[0]).toEqual({
      title: 'Make a hello page',
      label: 'feature',
      priority: 'high',
      acceptance: 2,
    });
    // [PCODE-457 | S15 | v0.1.0] a folder planning in a terminal: describe, plan, publish
    expect(d?.steps.map((s) => s.state)).toEqual(['done', 'done', 'current']);
  });

  it('writes the description with a heading and reads back only the words', () => {
    const file = descriptionFile('  A shop.\nWith a cart.  ');
    expect(file).toBe('# Project description\n\nA shop.\nWith a cart.\n');
    expect(descriptionBody(file.replace(/\n/g, '\r\n'))).toBe('A shop.\nWith a cart.');
    expect(descriptionBody(null)).toBe('');
  });

  it('shows the wizard only for a project with nothing on its board', () => {
    const base = {
      folderOpen: true,
      trusted: true,
      engineFound: true,
      connected: true,
      link: { identifier: 'HELLO', name: 'Hello' },
      activeRef: null,
      online: true,
      hasRecent: false,
      wizard: wizardModel(w()),
    };
    expect(homeModel({ ...base, sprints: [] }).wizard?.step).toBe('draft');
    const sprint = {
      name: 'S',
      code: 'S01',
      date: '',
      endDate: '',
      goal: '',
      isToday: true,
      items: [],
      source: 'file' as const,
    };
    expect(homeModel({ ...base, sprints: [sprint] }).wizard).toBeNull();
    expect(homeModel({ ...base, connected: false, sprints: [] }).wizard).toBeNull();
  });
});

describe('the wizard messages (critical #12)', () => {
  it('accepts a project only with a plane_init identifier', () => {
    const ok = { type: 'home/createProject', name: 'My shop', identifier: 'SHOP' };
    expect(isWebviewMessage(ok)).toBe(true);
    expect(isWebviewMessage({ ...ok, identifier: 'shop' })).toBe(false);
    expect(isWebviewMessage({ ...ok, identifier: 'TOOLONG' })).toBe(false);
    expect(isWebviewMessage({ ...ok, name: '   ' })).toBe(false);
    expect(isWebviewMessage({ ...ok, name: 'x'.repeat(81) })).toBe(false);
  });

  it('accepts a description of sane size only', () => {
    expect(isWebviewMessage({ type: 'home/saveDescription', text: 'A shop' })).toBe(true);
    expect(isWebviewMessage({ type: 'home/saveDescription', text: ' ' })).toBe(false);
    expect(isWebviewMessage({ type: 'home/saveDescription', text: 'x'.repeat(20001) })).toBe(false);
    expect(isWebviewMessage({ type: 'home/go', action: 'draftPlan' })).toBe(true);
    expect(isWebviewMessage({ type: 'home/go', action: 'publishPlan' })).toBe(true);
  });

  it('New project takes the form values and nothing else', () => {
    expect(projectArg({ name: ' Shop ', identifier: 'shop' })).toEqual({
      name: 'Shop',
      identifier: 'SHOP',
    });
    expect(projectArg(undefined)).toBeUndefined();
    expect(projectArg({ name: '', identifier: 'SHOP' })).toBeUndefined();
    expect(projectArg('SHOP')).toBeUndefined();
  });
});
