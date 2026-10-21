/* The personal DCR assistant, the few pure pieces Portal 2 adds (BLUEPRINT 3.3.10, migration M6). The database
   answers in the old portal's JSON (rpc my_assistant, assistant_op, assistant_office_view), so the pages draw it
   as the old ones did; what is left here:

   * assistantBadge(summary)   the home page's My Assistant badge from rpc my_assistant(p_summary): answers not
                               read yet (red), else what is due today (dim); null for an assistant that is off
   * localStamp(moment)        a moment as the company's "YYYY-MM-DDTHH:MM" (an item's time, as typed)
   * refusalText(err)          the database's sentence for a refusal (the old portal's own words, which the
                               page translates), or "" for a lost connection (the page says "no signal")
   * itemFields(kind, values)  what the office's dialog sends for an item (the old page's shape) */

export const TZ = "America/Los_Angeles";
export const LIMITS = Object.freeze({ CHAT_MESSAGES: 40, TEXT: 1500, ITEM_TEXT: 300, NOTES: 1000, ITEMS: 200, MEMORY: 50, WAITING: 5 });
export const BRIEF_FROM = "12:00";
export const BRIEF_TO = "20:45";

const text = (v) => (v === null || v === undefined ? "" : String(v)).trim();

/** The badge from {enabled, unread, dueToday}: {text, cls} or null. */
export function assistantBadge(summary) {
  const s = summary && typeof summary === "object" ? summary : null;
  if (!s || s.enabled !== true) return null;
  const unread = Number(s.unread) || 0;
  if (unread > 0) return { text: unread + " new", cls: "warn" };
  const due = Number(s.dueToday) || 0;
  return due > 0 ? { text: due + " today", cls: "dim" } : null;
}

let stampFmt = null;
/** A moment as the company's local "YYYY-MM-DDTHH:MM" ("" for no moment). */
export function localStamp(v) {
  const d = v instanceof Date ? v : new Date(v === undefined ? Date.now() : v);
  if (isNaN(d.getTime())) return "";
  if (!stampFmt) {
    stampFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  }
  const p = {};
  stampFmt.formatToParts(d).forEach((x) => { p[x.type] = x.value; });
  return p.year + "-" + p.month + "-" + p.day + "T" + (p.hour === "24" ? "00" : p.hour) + ":" + p.minute;
}

/** The database's sentence for a refusal, or "" when nothing answered (a lost connection). */
export function refusalText(err) {
  if (!err) return "";
  const code = text(err.code);
  const status = Number(err.status) || 0;
  const msg = text(err.message);
  const sqlish = /^[0-9A-Z]{5}$/.test(code) || /^PGRST/.test(code) || /^PT\d{3}$/.test(code);
  if (!sqlish && (!status || code === "NETWORK" || code === "offline" || /failed to fetch|network|load failed/i.test(msg))) return "";
  if (code === "PGRST202" || code === "42883") return "My Assistant is not in the database yet (it comes with Portal 2's phase 6).";
  return msg || "That did not work.";
}

/** The office's dialog values -> the item the database takes (the old page's shape: {kind, text, at, end, due,
    location, notes, remind}); a change leaves the kind out. */
export function itemFields(kind, v, change) {
  const x = v || {};
  const item = change ? {} : { kind };
  item.text = text(x.text);
  if (kind === "todo") { item.due = x.due || ""; item.notes = x.notes || ""; }
  else {
    item.at = x.day + "T" + x.time;
    if (kind === "event") {
      item.end = x.end ? x.day + "T" + x.end : "";
      item.location = x.location || "";
      item.remind = x.remind === "" || x.remind === undefined || x.remind === null ? null : Number(x.remind);
      item.notes = x.notes || "";
    }
  }
  return item;
}
