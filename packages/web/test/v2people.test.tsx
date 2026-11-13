// ── [PCODE-182 | S15 | v0.1.0] B5.3 People live: members, teams, roles, sign-in rules and sessions, access reviews, access checker, offboarding ──
//    Why:  the member filters decide who an admin sees (suspended people only under Suspended, service
//          accounts apart), roles are coloured by weight, and the page renders without inline styles.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { peopleIn, PeopleHub, roleTone, type PersonRow } from '../src/v2/peoplepage.js';

const p = (name: string, extra: Partial<PersonRow> = {}): PersonRow => ({
  userId: name,
  name,
  email: name.toLowerCase() + '@x.test',
  role: 'member',
  customRoleId: null,
  customRoleName: null,
  teams: [],
  projects: 1,
  clientName: null,
  isService: false,
  secondFactor: false,
  lastActiveAt: null,
  stale: false,
  suspendedAt: null,
  takesSeat: true,
  joinedAt: '2026-10-01T00:00:00Z',
  ...extra,
});

describe('people page', () => {
  const list = [
    p('Ada', { role: 'owner' }),
    p('Kai', { clientName: 'Nordwind', role: 'guest' }),
    p('CI', { isService: true }),
    p('Tim', { suspendedAt: '2026-10-04T00:00:00Z' }),
  ];

  it('filters people the way the tabs say', () => {
    expect(peopleIn(list, 'all', '').map((x) => x.name)).toEqual(['Ada', 'Kai', 'CI']);
    expect(peopleIn(list, 'team', '').map((x) => x.name)).toEqual(['Ada']);
    expect(peopleIn(list, 'clients', '').map((x) => x.name)).toEqual(['Kai']);
    expect(peopleIn(list, 'service', '').map((x) => x.name)).toEqual(['CI']);
    expect(peopleIn(list, 'suspended', '').map((x) => x.name)).toEqual(['Tim']);
    expect(peopleIn(list, 'all', 'nord').map((x) => x.name)).toEqual([]);
    expect(peopleIn(list, 'all', 'kai@').map((x) => x.name)).toEqual(['Kai']);
  });

  it('colours roles by weight', () => {
    expect([roleTone(list[0] ?? p('x')), roleTone(list[1] ?? p('x')), roleTone(p('Mo'))]).toEqual([
      'primary',
      'info',
      'neutral',
    ]);
  });

  it('renders without inline styles', () => {
    const html = renderToString(
      <PeopleHub workspaceId="w" role="admin" meId="me" go={() => undefined} />,
    );
    expect(html).toContain('People');
    expect(html).not.toContain('style=');
  });
});
