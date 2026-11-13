// ── [PCODE-341 | S15 | v0.1.0] T34.2b Public status pages per client and environment; incident update templates ──
//    Why:  an incident update in calm, plain words, quickly: the four steps of an incident come as
//          templates, a workspace adds its own, and their placeholders are filled from the incident.

export interface UpdateTemplate {
  name: string;
  audience: 'team' | 'client';
  body: string;
}

export const BUILTIN_UPDATE_TEMPLATES: readonly UpdateTemplate[] = [
  {
    name: 'Investigating',
    audience: 'client',
    body: 'We are looking into a problem with {{product}}: {{title}}. Some of you may be affected. We will update you by {{next}}.',
  },
  {
    name: 'Identified',
    audience: 'client',
    body: 'We found the cause of the problem with {{product}} and are working on a fix. Next update by {{next}}.',
  },
  {
    name: 'Monitoring',
    audience: 'client',
    body: 'A fix is in place for {{product}}. We are watching to make sure it holds. Next update by {{next}}.',
  },
  {
    name: 'Resolved',
    audience: 'client',
    body: '{{product}} is working normally again. Thank you for your patience. A short report of what happened follows.',
  },
];

export interface UpdateVars {
  title: string;
  severity: string;
  state: string;
  /** when the next update comes, already in words: "14:30" */
  next: string;
  /** the project or service as the client knows it */
  product: string;
}

/** The template with its placeholders filled; an unknown one stays as it is. */
export function fillUpdate(body: string, v: UpdateVars): string {
  return body.replace(
    /\{\{\s*(title|severity|state|next|product)\s*\}\}/g,
    (_, k: keyof UpdateVars) => v[k],
  );
}
