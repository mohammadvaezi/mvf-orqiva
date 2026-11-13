// ── [PCODE-162 | S15 | v0.1.0] B1.1 Live shell server: inbox, notification rules, settings inheritance, shell summary ──
//    Why:  quiet hours: no phone notification between, say, 20:00 and 07:30 in the person's own time
//          zone, except for the kinds they keep loud (incidents by default). The inbox still gets everything.

export interface QuietHours {
  from: string;
  to: string;
  except?: string[];
}

const minutes = (hhmm: string): number => {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
};

/** The time of day at `now` in `timeZone`, in minutes after midnight. */
export function minuteOfDay(now: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    return h * 60 + m;
  } catch {
    // an unknown time zone: treat as UTC
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
}

/** Whether a notice of `kind` should wait for the morning. Windows may wrap midnight (20:00–07:30). */
export function isQuiet(
  now: Date,
  timeZone: string,
  q: QuietHours | null | undefined,
  kind: string,
): boolean {
  if (!q?.from || !q.to) return false;
  if (q.except?.includes(kind)) return false;
  const t = minuteOfDay(now, timeZone);
  const a = minutes(q.from);
  const b = minutes(q.to);
  return a <= b ? t >= a && t < b : t >= a || t < b;
}
