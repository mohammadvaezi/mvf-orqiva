// ── [PCODE-23 | S04 | v0.1.0] Build the New task form creating items via plane new with a description file ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the form's rules and the description file's shape, pure so the webview and the host share them:
//          title 1-80, description >= 40, at least one acceptance line; the file the engine reads carries
//          the acceptance as "- [ ]" lines under "### Acceptance".
import type { NewTaskInputMessage } from '../protocol';

export const TITLE_MAX = 80;
export const DESCRIPTION_MIN = 40;
export const LABELS = ['feature', 'bug', 'chore', 'test', 'hotfix'] as const;
export const PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none'] as const;

export interface FieldErrors {
  title?: string;
  description?: string;
  acceptance?: string;
  label?: string;
  priority?: string;
}

// ── [PCODE-23 | S04 | v0.1.0] validate: one sentence per field, shown under it; empty object = valid ──
export function validate(i: NewTaskInputMessage): FieldErrors {
  const e: FieldErrors = {};
  const title = i.title.trim();
  if (!title) e.title = 'Give the task a title (verb + object).';
  else if (title.length > TITLE_MAX)
    e.title = `Keep the title under ${TITLE_MAX} characters (${title.length} now).`;
  const desc = i.description.trim();
  if (desc.length < DESCRIPTION_MIN)
    e.description = `Describe what, why and how to verify — at least ${DESCRIPTION_MIN} characters (${desc.length} now).`;
  if (!i.acceptance.map((a) => a.trim()).filter(Boolean).length)
    e.acceptance = 'Add at least one acceptance check, one per line.';
  if (!(LABELS as readonly string[]).includes(i.label)) e.label = 'Pick a label.';
  if (!(PRIORITIES as readonly string[]).includes(i.priority)) e.priority = 'Pick a priority.';
  return e;
}

export function isValid(i: NewTaskInputMessage): boolean {
  return Object.keys(validate(i)).length === 0;
}

// ── [PCODE-23 | S04 | v0.1.0] descriptionFile: what plane new --desc-file reads ──
export function descriptionFile(i: NewTaskInputMessage): string {
  const checks = i.acceptance.map((a) => a.trim()).filter(Boolean);
  return `${i.description.trim()}\n\n### Acceptance\n${checks.map((c) => `- [ ] ${c}`).join('\n')}\n`;
}

export function parseAcceptanceLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*]\s*)?(?:\[[ x]\]\s*)?/, '').trim())
    .filter(Boolean);
}
