// ── [PCODE-193 | S15 | v0.1.0] B8.1 VS Code on the Orqiva server: task panel with comments, inbox and approvals, timer, CodeLens without Plane ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-10 | S02 | v0.1.0] Add .plane readers and types for project, active, queue, plan and published ──
// ── [PCODE-105 | S15 | v0.1.0] Move the VS Code extension to the new API over WebSocket and remove polling ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the shapes of the files the engine owns (architecture.md "Data model"); the extension reads them,
//          never writes them.

/** `.plane/project.json` */
export interface ProjectLink {
  workspace: string;
  project_id: string;
  identifier: string;
  name: string;
  version: string;
  /** Test data inside a real project; the engine and the extension skip it when walking up. */
  fixture?: boolean;
  /** [PCODE-105 | S15 | v0.1.0] set when the folder is linked to an Orqiva server (orq link), not Plane */
  server?: string;
}

/** `.plane/state/active.json`; absent = no active task */
export interface ActiveTask {
  task: string;
  issue_id: string;
  title: string;
  sprint: string;
  sprint_name: string;
  version: string;
  session_id: string;
  host: string;
  started_at: string;
  files: string[];
  url: string;
  pending?: string[];
  last_comment_at?: number;
  last_commit?: string;
  state_hint?: string;
}

/** one line of `.plane/state/queue.jsonl` */
export interface QueueEntry {
  id: string;
  t: number;
  method: string;
  path: string;
  body?: unknown;
}

/** `.plane/state/session.json` */
export interface SessionInfo {
  session_id: string;
  started: string;
  source?: string;
}

/** `.plane/state/published.json` */
export interface PublishedState {
  items: Record<string, string>;
  at?: string;
}

export type Priority = 'urgent' | 'high' | 'medium' | 'low' | 'none';
export type PlanLabel = 'feature' | 'bug' | 'chore' | 'test' | 'hotfix';

export interface PlanItem {
  title: string;
  label: PlanLabel;
  priority: Priority;
  description_md: string;
  acceptance: string[];
  files_hint?: string[];
}

export interface PlanSprint {
  name: string;
  date: string;
  goal: string;
  items: PlanItem[];
}

/** `.plane/plan.json` (written by the planning run) */
export interface PlanJson {
  version: string;
  sprints: PlanSprint[];
}
