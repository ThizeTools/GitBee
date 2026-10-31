// Date cell text for the graph. Pure except `formatAbsoluteDate`, which only
// depends on the runtime locale. `nowMs` is a parameter so tests can pin "now"
// and GraphCanvas can tick it once a minute without re-deriving the rows.

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
// Past this age the relative form stops being useful ("412 d ago") and the
// cell shows the calendar date instead.
const RELATIVE_LIMIT_DAYS = 30;

// English month names on purpose: the cell is a compact fixed-width label and
// a locale-dependent month would make the string differ between machines.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// `tsSeconds` is git's commit timestamp (seconds since the epoch). A timestamp
// in the future (clock skew between machines) reads as "just now".
export function formatRelativeDate(tsSeconds: number, nowMs: number): string {
  const diff = nowMs - tsSeconds * 1000;
  if (diff < MINUTE_MS) return "just now";
  if (diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)} min ago`;
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)} h ago`;
  if (diff < RELATIVE_LIMIT_DAYS * DAY_MS) return `${Math.floor(diff / DAY_MS)} d ago`;
  return formatCalendarDate(tsSeconds, nowMs);
}

// "Mar 4" in the current year, "Mar 4, 2025" otherwise. Local time, matching
// the title tooltip, so the cell and the tooltip never disagree on the day.
function formatCalendarDate(tsSeconds: number, nowMs: number): string {
  const d = new Date(tsSeconds * 1000);
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === new Date(nowMs).getFullYear()
    ? base
    : `${base}, ${d.getFullYear()}`;
}

// Tooltip text: the full local date and time, shown on hover of the date cell.
export function formatAbsoluteDate(tsSeconds: number): string {
  return new Date(tsSeconds * 1000).toLocaleString();
}
