/* Company time (America/Los_Angeles) without a date library (BLUEPRINT 2.1 principle 6):
   every "today", "this week" and Log History window is the Pacific day, whatever the
   phone's own time zone, and a local midnight is never sent through toISOString().

   * pacificParts(date)       {y, m, d, h, mi, s, dow} as a wall clock in Los Angeles;
   * ymd(date)                "2026-10-19" (the Pacific day of that instant);
   * pacificToUtc(y,m,d,h,mi) the UTC instant of that Pacific wall-clock time (DST-correct);
   * addDays(ymdText, n)      calendar arithmetic on "YYYY-MM-DD";
   * saturdayOfYmd(ymdText)   the company week starts on Saturday (Sat..Fri);
   * logWindow(filter, now)   [fromISO, toISO) for Log History's chips.

   Pure module (node tests import it). */

export const TZ = "America/Los_Angeles";

let _fmt = null;
function fmt() {
  if (!_fmt) {
    _fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
    });
  }
  return _fmt;
}
const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function pacificParts(date) {
  const d = date instanceof Date ? date : new Date(date == null ? Date.now() : date);
  const out = {};
  fmt().formatToParts(d).forEach(function (p) { out[p.type] = p.value; });
  return {
    y: Number(out.year), m: Number(out.month), d: Number(out.day),
    h: Number(out.hour) % 24, mi: Number(out.minute), s: Number(out.second), dow: DOW[out.weekday],
  };
}

function pad(n) { return String(n).padStart(2, "0"); }

export function ymd(date) {
  const p = pacificParts(date);
  return p.y + "-" + pad(p.m) + "-" + pad(p.d);
}

/** The UTC Date of a Pacific wall-clock moment (an ambiguous / skipped hour resolves forward). */
export function pacificToUtc(y, m, d, h, mi) {
  const want = Date.UTC(y, m - 1, d, h || 0, mi || 0, 0);
  let guess = want + 8 * 3600 * 1000;          // PST first
  for (let i = 0; i < 3; i++) {
    const p = pacificParts(new Date(guess));
    const seen = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
    const diff = want - seen;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

function parseYmd(t) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(t || ""));
  if (!m) throw new Error("not a date: " + t);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function addDays(ymdText, n) {
  const a = parseYmd(ymdText);
  const dt = new Date(Date.UTC(a[0], a[1] - 1, a[2] + n));
  return dt.getUTCFullYear() + "-" + pad(dt.getUTCMonth() + 1) + "-" + pad(dt.getUTCDate());
}

export function dayOfWeek(ymdText) {
  const a = parseYmd(ymdText);
  return new Date(Date.UTC(a[0], a[1] - 1, a[2])).getUTCDay();
}

export function saturdayOfYmd(ymdText) {
  const dow = dayOfWeek(ymdText);
  return addDays(ymdText, -(dow === 6 ? 0 : dow + 1));
}

export function midnightUtc(ymdText) {
  const a = parseYmd(ymdText);
  return pacificToUtc(a[0], a[1], a[2], 0, 0);
}

export const LOG_FILTERS = Object.freeze([
  ["today", "Today"], ["morning", "Morning"], ["afternoon", "Afternoon"],
  ["yesterday", "Yesterday"], ["week", "This week"], ["lastweek", "Last week"], ["month", "This month"],
]);

/** [fromISO, toISO) of a Log History chip, in Pacific time. */
export function logWindow(filter, now) {
  const today = ymd(now == null ? new Date() : now);
  const tomorrow = addDays(today, 1);
  const a = parseYmd(today);
  let from, to;
  switch (filter) {
    case "morning": from = midnightUtc(today); to = pacificToUtc(a[0], a[1], a[2], 12, 0); break;
    case "afternoon": from = pacificToUtc(a[0], a[1], a[2], 12, 0); to = midnightUtc(tomorrow); break;
    case "yesterday": from = midnightUtc(addDays(today, -1)); to = midnightUtc(today); break;
    case "week": from = midnightUtc(saturdayOfYmd(today)); to = midnightUtc(tomorrow); break;
    case "lastweek": {
      const sat = saturdayOfYmd(today);
      from = midnightUtc(addDays(sat, -7)); to = midnightUtc(sat); break;
    }
    case "month": from = midnightUtc(a[0] + "-" + pad(a[1]) + "-01"); to = midnightUtc(tomorrow); break;
    default: from = midnightUtc(today); to = midnightUtc(tomorrow);
  }
  return [from.toISOString(), to.toISOString()];
}

/** "Mon, Oct 19 · 2:05 PM" for an instant (Pacific); a date-only value shows the day alone. */
export function fmtWhen(v) {
  if (!v) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return fmtDay(v);
  const d = new Date(v);
  if (isNaN(d)) return String(v);
  return d.toLocaleDateString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" }) +
    " · " + d.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
}

/** "Oct 19, 2026" for a date ("YYYY-MM-DD", taken as written) or an instant (its Pacific day). */
export function fmtDay(v) {
  if (!v) return "—";
  const s = String(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)) : new Date(s);
  if (isNaN(d)) return s;
  return d.toLocaleDateString("en-US", { timeZone: m ? "UTC" : TZ, month: "short", day: "numeric", year: "numeric" });
}

/** "Oct-19" (the Board card's short date). */
export function fmtShort(v) {
  if (!v) return "";
  const s = String(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)) : new Date(s);
  if (isNaN(d)) return "";
  const parts = {};
  new Intl.DateTimeFormat("en-US", { timeZone: m ? "UTC" : TZ, month: "short", day: "2-digit" })
    .formatToParts(d).forEach(function (p) { parts[p.type] = p.value; });
  return parts.month + "-" + parts.day;
}

/** "Monday, October 19, 2026" for "YYYY-MM-DD". */
export function longDay(ymdText) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymdText || ""));
  if (!m) return String(ymdText || "");
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)).toLocaleDateString("en-US",
    { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

/** "2026-10-19 14.30.12" — the old capture naming (sorts as text exactly as in time), Pacific. */
export function stamp(date) {
  const p = pacificParts(date == null ? new Date() : date);
  return p.y + "-" + pad(p.m) + "-" + pad(p.d) + " " + pad(p.h) + "." + pad(p.mi) + "." + pad(p.s);
}

/** Months before a "YYYY-MM-DD" (the Board's "completed in the last N months"). */
export function monthsBefore(ymdText, months) {
  const a = parseYmd(ymdText);
  const dt = new Date(Date.UTC(a[0], a[1] - 1 - months, a[2]));
  return dt.getUTCFullYear() + "-" + pad(dt.getUTCMonth() + 1) + "-" + pad(dt.getUTCDate());
}
