// ── [PCODE-300 | S15 | v0.1.0] T31.2a Git history from the webhooks: commits, branches, tags; close on merge; revert detection ──
//    Why:  two things a commit or pull request can say beyond naming a task. "Closes SHOP-12" (and the
//          other words hosts know: close, fixes, resolves …) asks for the task to be done once the work is
//          merged; git's own revert message ("This reverts commit 3f9a…") says earlier work was taken back.
//          Both are read here, the same way for every host.

const CLOSING = '(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)';

/** The task numbers of `key` a text asks to close: "Closes SHOP-12, SHOP-13", "fixes shop-4". */
export function closingNumbers(key: string, text: string): number[] {
  const ref = key + '-(\\d{1,9})(?![A-Za-z0-9])';
  const out = new Set<number>();
  // the keyword, then one or more references joined by commas or "and"
  const re = new RegExp(
    '(?<![A-Za-z0-9])' + CLOSING + ':?\\s+((?:' + key + '-\\d{1,9}(?:\\s*(?:,|and|&)\\s*)?)+)',
    'gi',
  );
  for (const m of text.matchAll(re))
    for (const n of (m[1] ?? '').matchAll(new RegExp(ref, 'gi'))) out.add(Number(n[1]));
  return [...out].sort((a, b) => a - b);
}

/** What a revert says it takes back: the commit (git's message) and the reverted subject. */
export function revertOf(message: string): { sha: string | null; subject: string | null } | null {
  const subject = /^Revert\s+"(.+)"\s*$/m.exec(message.split('\n')[0] ?? '')?.[1] ?? null;
  const sha = /This reverts commit ([0-9a-f]{7,40})/i.exec(message)?.[1]?.toLowerCase() ?? null;
  if (!subject && !sha) return null;
  return { sha, subject };
}

/** The default branch as a host names it: "refs/heads/main" → main. */
export const branchName = (ref: string): string => ref.replace(/^refs\/heads\//, '').trim();
