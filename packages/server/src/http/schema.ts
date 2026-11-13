// ── [PCODE-162 | S15 | v0.1.0] B1.1 Live shell server: inbox, notification rules, settings inheritance, shell summary ──
// ── [PCODE-86 | S15 | v0.1.0] Write the HTTP server on Node built-ins: router, validation, error model, OpenAPI ──
//    Why:  one declaration per value gives three things: the TypeScript type (Infer<>), the runtime check
//          with a field path for every problem, and the JSON Schema the OpenAPI document is built from.
//          Our own, because the ownership rule allows no validation library in the backend.

export interface Issue {
  /** "body.items[2].title" */
  path: string;
  message: string;
}

export interface Schema<T> {
  /** phantom: carries the type for Infer<>; never set at run time */
  readonly _type?: T;
  readonly optional: boolean;
  check(value: unknown, path: string, issues: Issue[]): void;
  json(): Record<string, unknown>;
}

export type Infer<S> = S extends Schema<infer T> ? T : never;

function make<T>(
  check: (value: unknown, path: string, issues: Issue[]) => void,
  json: () => Record<string, unknown>,
  optional = false,
): Schema<T> {
  return { optional, check, json };
}

const kind = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const at = (path: string, key: string): string => (path ? path + '.' + key : key);

export interface StringOptions {
  min?: number;
  max?: number;
  format?: 'uuid' | 'email' | 'date-time';
  pattern?: RegExp;
}

const FORMATS: Record<NonNullable<StringOptions['format']>, RegExp> = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  'date-time': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
};

export const s = {
  string(opts: StringOptions = {}): Schema<string> {
    return make(
      (v, path, issues) => {
        if (typeof v !== 'string') {
          issues.push({ path, message: 'must be a string, got ' + kind(v) });
          return;
        }
        if (opts.min !== undefined && v.length < opts.min) {
          issues.push({ path, message: 'must be at least ' + String(opts.min) + ' characters' });
        }
        if (opts.max !== undefined && v.length > opts.max) {
          issues.push({ path, message: 'must be at most ' + String(opts.max) + ' characters' });
        }
        if (opts.format && !FORMATS[opts.format].test(v)) {
          issues.push({ path, message: 'must be a valid ' + opts.format });
        }
        if (opts.pattern && !opts.pattern.test(v)) {
          issues.push({ path, message: 'must match ' + opts.pattern.source });
        }
      },
      () => ({
        type: 'string',
        ...(opts.min !== undefined ? { minLength: opts.min } : {}),
        ...(opts.max !== undefined ? { maxLength: opts.max } : {}),
        ...(opts.format ? { format: opts.format } : {}),
        ...(opts.pattern ? { pattern: opts.pattern.source } : {}),
      }),
    );
  },

  number(opts: { min?: number; max?: number; integer?: boolean } = {}): Schema<number> {
    return make(
      (v, path, issues) => {
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          issues.push({ path, message: 'must be a number, got ' + kind(v) });
          return;
        }
        if (opts.integer && !Number.isInteger(v))
          issues.push({ path, message: 'must be an integer' });
        if (opts.min !== undefined && v < opts.min)
          issues.push({ path, message: 'must be ≥ ' + String(opts.min) });
        if (opts.max !== undefined && v > opts.max)
          issues.push({ path, message: 'must be ≤ ' + String(opts.max) });
      },
      () => ({
        type: opts.integer ? 'integer' : 'number',
        ...(opts.min !== undefined ? { minimum: opts.min } : {}),
        ...(opts.max !== undefined ? { maximum: opts.max } : {}),
      }),
    );
  },

  boolean(): Schema<boolean> {
    return make(
      (v, path, issues) => {
        if (typeof v !== 'boolean')
          issues.push({ path, message: 'must be true or false, got ' + kind(v) });
      },
      () => ({ type: 'boolean' }),
    );
  },

  // [PCODE-162 | S15 | v0.1.0] any JSON value (setting values); its own rules are checked by the handler
  json(): Schema<unknown> {
    return make(
      (v, path, issues) => {
        if (v === undefined) issues.push({ path, message: 'is required' });
      },
      () => ({}),
    );
  },

  literal<const T extends string | number | boolean>(value: T): Schema<T> {
    return make(
      (v, path, issues) => {
        if (v !== value) issues.push({ path, message: 'must be ' + JSON.stringify(value) });
      },
      () => ({ const: value }),
    );
  },

  enum<const T extends readonly [string, ...string[]]>(values: T): Schema<T[number]> {
    return make(
      (v, path, issues) => {
        if (typeof v !== 'string' || !values.includes(v)) {
          issues.push({ path, message: 'must be one of ' + values.join(', ') });
        }
      },
      () => ({ type: 'string', enum: [...values] }),
    );
  },

  array<T>(item: Schema<T>, opts: { min?: number; max?: number } = {}): Schema<T[]> {
    return make(
      (v, path, issues) => {
        if (!Array.isArray(v)) {
          issues.push({ path, message: 'must be a list, got ' + kind(v) });
          return;
        }
        if (opts.min !== undefined && v.length < opts.min) {
          issues.push({ path, message: 'must have at least ' + String(opts.min) + ' items' });
        }
        if (opts.max !== undefined && v.length > opts.max) {
          issues.push({ path, message: 'must have at most ' + String(opts.max) + ' items' });
        }
        v.forEach((x, i) => {
          item.check(x, path + '[' + String(i) + ']', issues);
        });
      },
      () => ({
        type: 'array',
        items: item.json(),
        ...(opts.min !== undefined ? { minItems: opts.min } : {}),
        ...(opts.max !== undefined ? { maxItems: opts.max } : {}),
      }),
    );
  },

  /** Unknown keys are refused: a typo in a field name is an error, not a silently ignored value. */
  object<const P extends Record<string, Schema<unknown>>>(props: P): Schema<ObjectOf<P>> {
    return make(
      (v, path, issues) => {
        if (typeof v !== 'object' || v === null || Array.isArray(v)) {
          issues.push({ path, message: 'must be an object, got ' + kind(v) });
          return;
        }
        const obj = v as Record<string, unknown>;
        for (const [key, schema] of Object.entries(props)) {
          if (obj[key] === undefined) {
            if (!schema.optional) issues.push({ path: at(path, key), message: 'is required' });
          } else {
            schema.check(obj[key], at(path, key), issues);
          }
        }
        for (const key of Object.keys(obj)) {
          if (!(key in props))
            issues.push({ path: at(path, key), message: 'is not a known field' });
        }
      },
      () => ({
        type: 'object',
        properties: Object.fromEntries(Object.entries(props).map(([k, p]) => [k, p.json()])),
        required: Object.entries(props)
          .filter(([, p]) => !p.optional)
          .map(([k]) => k),
        additionalProperties: false,
      }),
    );
  },

  /** Any JSON object, unchecked inside; for documents whose shape is defined elsewhere (OpenAPI). */
  anyObject(): Schema<Record<string, unknown>> {
    return make(
      (v, path, issues) => {
        if (typeof v !== 'object' || v === null || Array.isArray(v)) {
          issues.push({ path, message: 'must be an object, got ' + kind(v) });
        }
      },
      () => ({ type: 'object' }),
    );
  },

  optional<T>(inner: Schema<T>): Schema<T | undefined> {
    return make<T | undefined>(
      (v, path, issues) => {
        if (v !== undefined) inner.check(v, path, issues);
      },
      () => inner.json(),
      true,
    );
  },

  nullable<T>(inner: Schema<T>): Schema<T | null> {
    return make<T | null>(
      (v, path, issues) => {
        if (v !== null) inner.check(v, path, issues);
      },
      () => ({ anyOf: [inner.json(), { type: 'null' }] }),
      inner.optional,
    );
  },
};

type OptionalKeys<P> = {
  [K in keyof P]: P[K] extends Schema<infer T> ? (undefined extends T ? K : never) : never;
}[keyof P];
type RequiredKeys<P> = Exclude<keyof P, OptionalKeys<P>>;
export type ObjectOf<P extends Record<string, Schema<unknown>>> = {
  [K in RequiredKeys<P>]: Infer<P[K]>;
} & { [K in OptionalKeys<P>]?: Exclude<Infer<P[K]>, undefined> };

/** Runs a schema; returns the typed value or the list of problems. */
export function validate<T>(
  schema: Schema<T>,
  value: unknown,
  root: string,
): { ok: true; value: T } | { ok: false; issues: Issue[] } {
  const issues: Issue[] = [];
  schema.check(value, root, issues);
  return issues.length ? { ok: false, issues } : { ok: true, value: value as T };
}
