// ── [PCODE-85 | S08 | v0.1.0] Build our own licence checker and SBOM generator that fail CI on a denied licence ──
//    Why:  a manifest can be wrong or incomplete; the licence file is what actually binds us. We recognise
//          the common licences by the sentences their texts are built from, and we flag riders such as the
//          Commons Clause that are appended to an otherwise permissive licence.

/** Rider ids: clauses that restrict a licence they are attached to. Never accepted, whatever the base. */
export const RIDERS = ['Commons-Clause', 'NonCommercial'] as const;

interface Rule {
  id: string;
  /** every phrase must occur (case-insensitive, whitespace-normalised) */
  all: string[];
  /** none of these may occur */
  none?: string[];
}

// The GPL family is told apart by gplFamily() below: each of its texts names the others in passing.
const RULES: Rule[] = [
  { id: 'SSPL-1.0', all: ['server side public license'] },
  { id: 'BUSL-1.1', all: ['business source license'] },
  { id: 'Elastic-2.0', all: ['elastic license'] },
  { id: 'MPL-2.0', all: ['mozilla public license'] },
  { id: 'EPL', all: ['eclipse public license'] },
  { id: 'Commons-Clause', all: ['commons clause'] },
  { id: 'NonCommercial', all: ['noncommercial'] },
  { id: 'NonCommercial', all: ['non-commercial use only'] },
  { id: 'Apache-2.0', all: ['apache license', 'version 2.0'] },
  {
    id: 'MIT',
    all: ['permission is hereby granted, free of charge, to any person obtaining a copy'],
  },
  {
    id: 'BSD-3-Clause',
    all: ['redistribution and use in source and binary forms', 'neither the name'],
  },
  {
    id: 'BSD-2-Clause',
    all: ['redistribution and use in source and binary forms'],
    none: ['neither the name'],
  },
  {
    id: 'ISC',
    all: [
      'permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice',
    ],
  },
  {
    id: '0BSD',
    all: [
      'permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted.',
    ],
  },
  {
    id: 'Unlicense',
    all: ['this is free and unencumbered software released into the public domain'],
  },
  { id: 'CC0-1.0', all: ['cc0 1.0 universal'] },
  { id: 'CC-BY-4.0', all: ['attribution 4.0 international'], none: ['noncommercial'] },
  { id: 'OFL-1.1', all: ['sil open font license'] },
  {
    id: 'PostgreSQL',
    all: [
      'permission to use, copy, modify, and distribute this software and its documentation for any purpose, without fee, and without a written agreement',
    ],
  },
  { id: 'BlueOak-1.0.0', all: ['blue oak model license'] },
];

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ');
}

const GPL_TITLES: [string, string][] = [
  ['gnu affero general public license', 'AGPL-3.0'],
  ['gnu lesser general public license', 'LGPL'],
  ['gnu library general public license', 'LGPL'],
  ['gnu general public license', 'GPL'],
];

/** GPL, LGPL or AGPL by the title that comes first: the GPL-3.0 text itself mentions the LGPL. */
function gplFamily(t: string): string | null {
  let best: { at: number; id: string } | null = null;
  for (const [title, id] of GPL_TITLES) {
    const at = t.indexOf(title);
    if (at >= 0 && (best === null || at < best.at)) best = { at, id };
  }
  return best ? best.id : null;
}

/** The licence ids a licence file's text matches; empty when it is not recognised. */
export function detectLicences(text: string): string[] {
  const t = normalise(text);
  const found = new Set<string>();
  const gpl = gplFamily(t);
  if (gpl) found.add(gpl);
  for (const rule of RULES) {
    if (rule.all.every((p) => t.includes(p)) && !(rule.none ?? []).some((p) => t.includes(p))) {
      found.add(rule.id);
    }
  }
  return [...found];
}

/** True for ids of the GPL family as detected from text ("GPL", "LGPL") or declared ("GPL-3.0-only"). */
export function sameFamily(detected: string, declared: string): boolean {
  if (detected === declared) return true;
  const base = declared.replace(/-(only|or-later)$/, '').replace(/\+$/, '');
  if (detected === 'GPL') return /^GPL-/.test(base);
  if (detected === 'LGPL') return /^LGPL-/.test(base);
  if (detected === 'AGPL-3.0') return /^AGPL-3\.0/.test(base);
  if (detected === 'EPL') return /^EPL-/.test(base);
  return base === detected;
}
