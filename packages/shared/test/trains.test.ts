// ── [PCODE-203 | S15 | v0.1.0] T17.1 Release trains on the server: releases of several projects, freeze, go/no-go, ship with deploys, rollback ──
// ── [PCODE-204 | S15 | v0.1.0] T17.2 Promotions with approval, rollback per environment, backports, go/no-go meeting notes ──
//    Why:  a train goes only when every release in it is ready, and its deploys decide where it stands.
import { describe, expect, it } from 'vitest';
import {
  backportVersion,
  compareVersions,
  lineOf,
  notYetOn,
  trainChecks,
  trainProgress,
  trainStateText,
} from '../src/index.js';

describe('release trains', () => {
  it('names what each release still needs', () => {
    expect(
      trainChecks([
        {
          project: 'APP',
          version: '1.4.0',
          items: 5,
          done: 5,
          environment: 'Production',
          violations: [],
        },
        {
          project: 'API',
          version: '2.0.0',
          items: 3,
          done: 2,
          environment: null,
          violations: ['No critical findings: 1 open'],
        },
      ]),
    ).toEqual([
      { project: 'APP', version: '1.4.0', ready: true, missing: [] },
      {
        project: 'API',
        version: '2.0.0',
        ready: false,
        missing: [
          '1 task is not done',
          'No environment to ship to',
          'No critical findings: 1 open',
        ],
      },
    ]);
  });

  it('follows its deploys', () => {
    expect(trainProgress('shipping', ['succeeded', 'running'])).toBe('shipping');
    expect(trainProgress('shipping', ['succeeded', 'succeeded'])).toBe('shipped');
    expect(trainProgress('shipping', ['succeeded', 'failed'])).toBe('partial');
    expect(trainProgress('shipping', ['queued', 'failed'])).toBe('shipping');
    expect(trainProgress('rolling_back', ['succeeded', null])).toBe('rolled_back');
    expect(trainProgress('rolling_back', [null])).toBe('rolled_back');
    expect(trainStateText('partial')).toBe('partly shipped: a deploy failed');
  });
});

// [PCODE-204 | S15 | v0.1.0] lines and what an environment lacks
describe('version lines', () => {
  it('finds the line and its next patch', () => {
    expect(lineOf('1.3.8')).toBe('1.3');
    expect(lineOf('main')).toBeNull();
    expect(backportVersion(['1.3.7', '1.3.8', '1.4.0', '1.3.9-rc.1'], '1.3')).toBe('1.3.9');
    expect(backportVersion(['1.4.0'], '1.3')).toBeNull();
  });

  it('counts what runs ahead but not behind', () => {
    const r = [
      { version: '1.3.8', tasks: 2, fixes: 1 },
      { version: '1.4.0', tasks: 9, fixes: 2 },
      { version: '1.4.1', tasks: 0, fixes: 1 },
      { version: '1.5.0', tasks: 4, fixes: 0 },
    ];
    expect(notYetOn(r, '1.4.1', '1.3.8', compareVersions)).toEqual({
      versions: ['1.4.0', '1.4.1'],
      tasks: 9,
      fixes: 3,
    });
    expect(notYetOn(r, null, '1.3.8', compareVersions).versions).toEqual([]);
  });
});
