const dayStart = (d: Date, offset = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset).getTime();

const fmtTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const fmtWeekday = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const fmtShort = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'numeric', year: '2-digit' });
const fmtMonth = new Intl.DateTimeFormat(undefined, { month: 'long' });
const fmtFull = new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeStyle: 'short' });

export const longDate = (ts: number) => fmtFull.format(ts);

/** Section heading in the note list, as in Apple Notes. */
export function groupLabel(ts: number, now = new Date()): string {
  if (ts >= dayStart(now)) return 'Today';
  if (ts >= dayStart(now, -1)) return 'Yesterday';
  if (ts >= dayStart(now, -7)) return 'Previous 7 Days';
  if (ts >= dayStart(now, -30)) return 'Previous 30 Days';
  const d = new Date(ts);
  return d.getFullYear() === now.getFullYear() ? fmtMonth.format(d) : String(d.getFullYear());
}

/** Short date shown on each row of the note list. */
export function listDate(ts: number, now = new Date()): string {
  if (ts >= dayStart(now)) return fmtTime.format(ts);
  if (ts >= dayStart(now, -1)) return 'Yesterday';
  if (ts >= dayStart(now, -6)) return fmtWeekday.format(ts);
  return fmtShort.format(ts);
}

export function relativeDate(ts: number, now = new Date()): string {
  if (ts >= dayStart(now)) return `today at ${fmtTime.format(ts)}`;
  if (ts >= dayStart(now, -1)) return `yesterday at ${fmtTime.format(ts)}`;
  return fmtFull.format(ts);
}
