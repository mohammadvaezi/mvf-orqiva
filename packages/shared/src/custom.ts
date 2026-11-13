// ── [PCODE-257 | S15 | v0.1.0] T26.6 Hierarchy: initiatives, custom item types, custom fields ──
//    Why:  a project's own fields, checked the same way on the server that keeps them and in the web app
//          that edits them: text, a number, one of the choices, a day, or a person of the workspace.

export const FIELD_TYPES = ['text', 'number', 'choice', 'date', 'person'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options: string[];
}

/** What is wrong with a value for the field, or null; null as a value clears the field. */
export function fieldProblem(def: FieldDef, value: unknown): string | null {
  if (value === null) return null;
  switch (def.type) {
    case 'text':
      return typeof value === 'string' && value.length <= 2000
        ? null
        : def.label + ' is a text of at most 2000 characters';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? null
        : def.label + ' is a number';
    case 'choice':
      return typeof value === 'string' && def.options.includes(value)
        ? null
        : def.label + ' is one of ' + def.options.join(', ');
    case 'date':
      return typeof value === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        !Number.isNaN(Date.parse(value))
        ? null
        : def.label + ' is a day, YYYY-MM-DD';
    case 'person':
      return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value)
        ? null
        : def.label + ' is a person of the workspace';
  }
}

/** A field's value as people read it. */
export function fieldText(
  def: FieldDef,
  value: unknown,
  nameOf: (id: string) => string = (x) => x,
): string {
  if (value === null || value === undefined || value === '') return '';
  if (def.type === 'person' && typeof value === 'string') return nameOf(value);
  return typeof value === 'number' ? String(value) : typeof value === 'string' ? value : '';
}
