// ── [PCODE-12 | S02 | v0.1.0] Add a read-only Plane REST client with SecretStorage key and 20 req/min throttle ──
//    Why:  the subset of Plane REST v1 fields the engine and the extension use (architecture.md "Data model").
export interface State {
  id: string;
  name: string;
  /** backlog | unstarted | started | completed | cancelled */
  group: string;
  color: string;
  default?: boolean;
}

export interface Label {
  id: string;
  name: string;
  color: string;
}

export interface Cycle {
  id: string;
  name: string;
  description: string;
  start_date: string | null;
  end_date: string | null;
}

export interface Issue {
  id: string;
  sequence_id: number;
  name: string;
  description_html?: string;
  state: string;
  priority: 'urgent' | 'high' | 'medium' | 'low' | 'none' | null;
  labels: string[];
  target_date?: string | null;
  completed_at?: string | null;
  updated_at?: string;
}

export interface Comment {
  id: string;
  comment_html: string;
  created_at: string;
  actor_detail?: { display_name?: string };
}

export interface Project {
  id: string;
  identifier: string;
  name: string;
}

export interface CycleIssue {
  id: string;
  issue?: string;
  issue_detail?: { id: string };
}
