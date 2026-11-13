// ── [PCODE-228 | S15 | v0.1.0] T22.1 Live map on the phone: projects, health, heat, sprint progress, cards in progress, alerts ──
//    Why:  the shapes the app reads from the server, as the server's routes describe them (OpenAPI):
//          the command center, projects with their states, sprints, tasks, members and alerts.
import type { HeatKey } from '@orqiva/shared';

export interface HeatCell {
  level: 'ok' | 'warn' | 'bad' | 'none';
  note: string;
}

export interface MapCard {
  id: string;
  ref: string;
  title: string;
  state: string;
  assignee: { id: string; name: string } | null;
  agents: { name: string; status: string }[];
  updatedAt: string;
}

export interface MapProject {
  id: string;
  key: string;
  name: string;
  client: string | null;
  phase: string | null;
  gates: { key: string; name: string; status: string }[];
  health: string;
  reasons: string[];
  heat: Record<HeatKey, HeatCell>;
  counts: { open: number; inProgress: number; doneThisWeek: number };
  cards: MapCard[];
}

export interface Alert {
  id: string;
  projectId: string | null;
  projectKey: string | null;
  source: string;
  severity: string;
  title: string;
  count: number;
  firstAt: string;
  lastAt: string;
}

export interface CommandCenter {
  projects: MapProject[];
  alerts: Alert[];
  at: string;
  startedStates: string[];
}

export interface State {
  id: string;
  name: string;
  group: string;
  color: string;
  position: number;
}

export interface ProjectDetail {
  id: string;
  key: string;
  name: string;
  description: string;
  states: State[];
}

export interface Sprint {
  id: string;
  projectId: string;
  number: number;
  name: string;
  goal: string;
  startDate: string | null;
  endDate: string | null;
  status: string;
  itemCount: number;
  doneCount: number;
  estimateTotal: number;
  estimateDone: number;
  goalMet: boolean | null;
  addedCount: number;
}

export interface Item {
  id: string;
  ref: string;
  projectId: string;
  title: string;
  description: string;
  stateId: string;
  assigneeId: string | null;
  estimate: number | null;
  sprintId: string | null;
  version: number;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
  kind: string;
  priority: string;
  dueDate: string | null;
  percentDone: number | null;
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: string;
  service: boolean;
}

export interface Capacity {
  capacity: number;
  committed: number;
  velocity: number | null;
  velocitySprints: number;
}
