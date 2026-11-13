// ── [PCODE-342 | S15 | v0.1.0] T34.2c AI postmortems and runbooks matched to incidents ──
//    Why:  an incident should bring its runbook along: a runbook names the words its alerts carry
//          ("disk full, no space left"), and an incident whose title or alerts contain one of them shows
//          it. And a drafted postmortem's "Actions" list becomes the postmortem's actions.

/** The trigger words of a runbook: split on commas and new lines, trimmed, lower case, no repeats. */
export function triggerWords(pattern: string): string[] {
  return [
    ...new Set(
      pattern
        .split(/[,\n]/)
        .map((w) => w.trim().toLowerCase())
        .filter((w) => w.length >= 2),
    ),
  ];
}

/** True when any trigger word appears in one of the texts (case does not matter). */
export function runbookMatches(pattern: string, texts: readonly string[]): boolean {
  const words = triggerWords(pattern);
  const hay = texts.map((t) => t.toLowerCase());
  return words.some((w) => hay.some((h) => h.includes(w)));
}

/** The bullet points under a "### Actions" heading, up to 30. */
export function postmortemActions(markdown: string): string[] {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => /^#{1,4}\s*actions\b/i.test(l.trim()));
  if (start < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (/^#{1,4}\s/.test(l.trim())) break;
    const m = /^\s*(?:[-*]|\d+\.)\s+(?:\[[ x]\]\s+)?(.+)$/.exec(l);
    if (m?.[1]) out.push(m[1].trim().slice(0, 300));
  }
  return out.slice(0, 30);
}
