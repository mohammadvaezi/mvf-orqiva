// ── [PCODE-347 | S15 | v0.1.0] T35.1b Homes for developers and testers with widgets the person chooses ──
//    Why:  a developer starts the day with their tasks, the pull requests waiting for them, their agents'
//          runs and the deploys; a tester with the tests assigned to them, what fails and the bugs to check.
//          Each person can choose and order the widgets of their home.

export const HOME_WIDGETS = {
  'my-tasks': 'My tasks',
  reviews: 'Pull requests to review',
  'my-runs': 'My agent runs',
  deploys: 'Recent deploys',
  'my-tests': 'Tests assigned to me',
  'failing-tests': 'Failing tests',
  'bugs-to-verify': 'Bugs to verify',
  'time-today': 'Time today',
  incidents: 'Open incidents',
} as const;

export type HomeWidget = keyof typeof HOME_WIDGETS;
export type HomePersona = 'developer' | 'tester' | 'lead';

// My tasks is in the team's dashboard below the widgets already; a person can still add it
export const HOME_PRESETS: Record<HomePersona, readonly HomeWidget[]> = {
  developer: ['reviews', 'my-runs', 'deploys', 'time-today'],
  tester: ['my-tests', 'failing-tests', 'bugs-to-verify', 'time-today'],
  lead: ['incidents', 'reviews', 'deploys'],
};

export const isHomeWidget = (w: string): w is HomeWidget => w in HOME_WIDGETS;

/** The widgets to show: the person's own choice (known ones, no repeats, at most 9), else the preset. */
export function homeLayout(saved: unknown, persona: HomePersona): HomeWidget[] {
  const own = Array.isArray(saved)
    ? [...new Set(saved.filter((x): x is string => typeof x === 'string'))].filter(isHomeWidget)
    : [];
  return own.length ? own.slice(0, 9) : [...HOME_PRESETS[persona]];
}

/** Moves a widget one place up (-1) or down (+1); out of range leaves the list as it is. */
export function moveWidget(list: readonly HomeWidget[], w: HomeWidget, by: -1 | 1): HomeWidget[] {
  const i = list.indexOf(w);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return [...list];
  const out = [...list];
  [out[i], out[j]] = [out[j] as HomeWidget, out[i] as HomeWidget];
  return out;
}
