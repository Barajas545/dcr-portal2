/* The shoot schedule page's words and small rules (shoots.html; the photographer screen program, P3; DCR Desktop 2
   migration 20261110000100_photo_schedule, the contract DCR Desktop 2 docs/PHOTO-SCHEDULE.md). Pure: no DOM, no network.
   map/photo.js turns the database's rows into shapes and puts the preview into words; this module is what the page
   adds on top of it:

   * the header:        pcHeader (the office computer's state in plain words - only when it is not running);
   * the address:       parseLink / linkFor (?shoot=<photo_shoots.id> - DCR Agents 2's reminders link here -, ?plan=<id>,
                        ?task=<a My Tasks task id: its shoot>, ?view=agenda|job|month, ?month=YYYY-MM);
   * a shoot's sheet:   dayLine (the day and its grace), historyLines (newest first), doneLine, briefSections (the safe
                        brief fields the mirror has), touches / shootChanges (the changes about one shoot), myOpen,
                        recentMine, undoFor (my last applied change within 7 days - an admin's: anyone's; never "done");
   * the Move sheet:    bounds (the days the database takes), dayStrip (the plan's shoot days are the normal choice, a
                        non-shoot day is allowed but marked), nonShootNote, officeLine, applyLabel, sentText;
   * the lists:         rowFacts (one line of the Agenda / By job), planFacts (a plan's header), homeBadge (Home's card);
   * the change queue:  finishedText (what a change of mine came to, once the office computer answered).

   Every free text is the mirror's (already masked by the database and again by map/photo.js safeText). */

import {
  MILESTONES, MILESTONE_LABEL, PLAN_STATUS_LABEL, MOVE_KINDS, UNDO_DAYS, isDay, dayText, weekdayName, weekdayShort, isShootDay,
  shootDaysText, isOpen, isLate, followsMilestone, pcLine, canUndo, isOpenChange, changeStatusText, changeTitle, refusalText, safeText,
} from "./photo.js";
import { addDays, ymd, dayOfWeek } from "./pacific.js";

export const TITLE = "Shoot schedule";
export const VIEWS = Object.freeze([["agenda", "Agenda"], ["job", "By job"], ["month", "Month"]]);
export const VIEW_KEYS = Object.freeze(VIEWS.map((v) => v[0]));
export const NO_ACCESS_TEXT = "The shoot schedule is for admins and the photo team. An admin puts people on the photo team " +
  "(Employees & crews → Access, or DCR Desktop 2 → Users).";
export const READ_ONLY_TEXT = "You read the shoot schedule: photographers and admins move shoots.";
export const EDIT_TEXT = "Move a shoot here and the office computer applies it, usually in a minute or two. Every move stays in the shoot's history.";
export const PLACEHOLDER = "Pick a shoot to see its day, its brief and its history.";
export const GONE_TEXT = "That shoot is not on the shoot schedule any more.";
export const TASK_GONE_TEXT = "This task's shoot is not on the shoot schedule (yet).";
export const PLAN_GONE_TEXT = "That job is not on the shoot schedule any more.";
export const CHANGED_TEXT = "Someone changed this plan meanwhile - here is the new preview.";
export const MOVE_MAX_DAYS = 365;      // §7.3 too_far: a shoot at most a year ahead
export const MILESTONE_BACK_DAYS = 60; // §7.3 too_far: a job date at most 60 days back
export const STRIP_DAYS = 14;

const SOURCE_WORDS = Object.freeze({ "shoot page": "on the shoot schedule", admin: "in the office", "my tasks": "from My Tasks",
  suggestion: "through a suggestion the office approved", schedule: "by the schedule", agent: "by DCR Agents 2" });

const str = (v) => (v === null || v === undefined ? "" : String(v));
const plural = (n, one, many) => n + " " + (n === 1 ? one : many || one + "s");
const posInt = (v) => (/^[1-9][0-9]{0,15}$/.test(str(v).trim()) ? Number(str(v).trim()) : null);

/* ── the header ───────────────────────────────────────────────────────── */

/** The office computer's line for the header, only when it is not running: null while it is on (or nothing is known);
    {state: paused | off, text, cls} otherwise ("The office computer is off - changes wait until it is back on (last seen
    2 h ago)", "DCR Agents 2 is paused on the office computer - changes wait until it runs again"). */
export function pcHeader(st) {
  if (!st) return null;
  const l = pcLine(st);
  return l.state === "on" || l.state === "unknown" ? null : l;
}

/* ── the address ──────────────────────────────────────────────────────── */

/** ?shoot=, ?plan=, ?task=, ?view=, ?month= -> {shoot, plan, task, view, month} (null for what is not there or not one). */
export function parseLink(search) {
  let q;
  try { q = new URLSearchParams(str(search)); } catch (e) { q = new URLSearchParams(""); }
  const view = q.get("view");
  const month = q.get("month");
  return { shoot: posInt(q.get("shoot")), plan: posInt(q.get("plan")), task: posInt(q.get("task")),
    view: VIEW_KEYS.indexOf(view) !== -1 ? view : null, month: /^\d{4}-(0[1-9]|1[0-2])$/.test(str(month)) ? month : null };
}

/** The page's own address for what is shown: "shoots.html?shoot=12", "shoots.html?plan=3", "shoots.html?view=month". */
export function linkFor(o) {
  const x = o || {};
  const parts = [];
  if (posInt(x.shoot)) parts.push("shoot=" + posInt(x.shoot));
  else if (posInt(x.plan)) parts.push("plan=" + posInt(x.plan));
  if (x.view && x.view !== "agenda" && VIEW_KEYS.indexOf(x.view) !== -1) parts.push("view=" + x.view);
  if (x.view === "month" && /^\d{4}-\d{2}$/.test(str(x.month))) parts.push("month=" + x.month);
  return "shoots.html" + (parts.length ? "?" + parts.join("&") : "");
}

/* ── a shoot's sheet ──────────────────────────────────────────────────── */

/** The day and its grace: {day, window, late}. day "Thu Nov 19" or "No date yet" (with what it waits for); window
    "On the day" (no grace) or "Up to 2 days later - until Sat Nov 21". */
export function dayLine(s, plan, today) {
  if (!s) return { day: "", window: "", late: false };
  if (!isDay(s.plannedDate)) {
    const ms = followsMilestone(s) ? MILESTONE_LABEL[s.anchor] : null;
    return { day: "No date yet", window: ms ? "It waits for " + ms + " to get a date" : "", late: false };
  }
  const n = Number(s.windowDays) || 0;
  const until = addDays(s.plannedDate, n);
  return { day: dayText(s.plannedDate, today), late: isLate(s, today),
    window: n ? "Up to " + plural(n, "day") + " later - until " + dayText(until, today) : "On the day" };
}

function dayOfStamp(at) {
  const t = Date.parse(str(at));
  return Number.isFinite(t) ? ymd(new Date(t)) : null;
}

/** The shoot's history, newest first: [{when, text, meta, reason, change}]. "Moved Thu Nov 12 → Fri Nov 13", "by Jordan
    on the shoot schedule", the reason as the mirror has it. */
export function historyLines(s, today) {
  const list = s && Array.isArray(s.history) ? s.history.slice() : [];
  return list.reverse().map((h) => {
    const when = dayOfStamp(h.at);
    let text;
    if (isDay(h.from) && isDay(h.to)) text = "Moved " + dayText(h.from, today) + " → " + dayText(h.to, today);
    else if (isDay(h.to)) text = "Got its day: " + dayText(h.to, today);
    else if (isDay(h.from)) text = "Took off " + dayText(h.from, today);
    else text = "Changed";
    const meta = [h.by ? "by " + h.by : "", SOURCE_WORDS[h.source] || (h.source ? str(h.source) : "")].filter(Boolean).join(" ");
    return { when: when ? dayText(when, today) : "", text, meta, reason: safeText(h.reason), change: h.change || null };
  });
}

/** A closed shoot in words: "Done Mon Nov 9 on the shoot schedule - Walked the lot" / "Skipped - its day had passed" ... */
export function doneLine(s, today) {
  if (!s || isOpen(s)) return "";
  const d = dayOfStamp(s.doneAt);
  const src = SOURCE_WORDS[s.doneSource] || (s.doneSource ? str(s.doneSource) : "");
  const head = s.status === "done" ? "Done" : s.status === "missed" ? "Missed" : s.autoSkipped ? "Skipped - its day had passed" : "Skipped";
  return [head + (d ? " " + dayText(d, today) : "") + (src && s.status === "done" ? " " + src : ""), s.doneNote ? safeText(s.doneNote) : ""]
    .filter(Boolean).join(" - ");
}

const KIND_WORDS = { photo: "photo", video: "video", drone: "drone", timelapse: "time-lapse" };

/** The brief's safe fields (§9.4) as sections: [{key, title, items: [text], lines?: [{title, text, tags}]}]; empty ones
    are left out. */
export function briefSections(b) {
  const x = b || {};
  const out = [];
  if (x.purpose) out.push({ key: "purpose", title: "What it is for", items: [x.purpose] });
  if (x.timeOfDay) out.push({ key: "time", title: "Best time", items: [x.timeOfDay] });
  const shots = Array.isArray(x.shots) ? x.shots.filter((s) => s && (s.title || s.description)) : [];
  if (shots.length) {
    out.push({ key: "shots", title: "Shot list", items: shots.map((s) => [s.title, s.description].filter(Boolean).join(" - ")),
      lines: shots.map((s) => ({ title: s.title || "", text: s.description || "",
        tags: [KIND_WORDS[s.kind] || "", s.priority === "must" ? "must have" : s.priority === "nice" ? "nice to have" : ""].filter(Boolean) })) });
  }
  if (x.sampleShot) out.push({ key: "sample", title: "A sample shot", items: [x.sampleShot] });
  for (const [k, t] of [["tips", "Tips"], ["equipment", "Equipment"], ["safety", "Safety"], ["captionIdeas", "Caption ideas"]]) {
    if (Array.isArray(x[k]) && x[k].length) out.push({ key: k, title: t, items: x[k].slice() });
  }
  if (x.drone && (x.drone.needed || x.drone.notes)) {
    out.push({ key: "drone", title: "Drone", items: [(x.drone.needed ? "A drone is needed" : "No drone needed") + (x.drone.notes ? " - " + x.drone.notes : "")] });
  }
  return out;
}

/** Whether a change is about this shoot: its target, a shoot it moved (or would move), or the job date the shoot follows. */
export function touches(c, s) {
  if (!c || !s || c.planId !== s.planId) return false;
  const a = c.args || {};
  if (c.targetKey === s.key || a.shoot === s.key) return true;
  const inList = (l) => Array.isArray(l) && l.some((m) => m && m.key === s.key);
  if (c.result && (inList(c.result.moved) || inList(c.result.passed))) return true;
  if (c.preview && (inList(c.preview.moved) || inList(c.preview.passed))) return true;
  return c.kind === "milestone" && followsMilestone(s) && a.milestone === s.anchor;
}

const when = (c) => Date.parse(c.doneAt || c.requestedAt || "") || 0;

/** The changes about one shoot, newest first. */
export function shootChanges(changes, s) {
  return (Array.isArray(changes) ? changes : []).filter((c) => touches(c, s)).sort((a, b) => when(b) - when(a) || (b.id || 0) - (a.id || 0));
}

/** My changes of this shoot still waiting (new or taken), newest first. */
export function myOpen(changes, s, me) {
  return shootChanges(changes, s).filter((c) => me && c.requestedBy === me && isOpenChange(c));
}

/** My changes of this shoot that finished within 7 days (applied, refused, sent to the office, expired, cancelled),
    newest first, at most `max` (3). */
export function recentMine(changes, s, me, now, max) {
  const t = now instanceof Date ? now.getTime() : Date.now();
  return shootChanges(changes, s).filter((c) => me && c.requestedBy === me && !isOpenChange(c) && when(c) >= t - UNDO_DAYS * 86400000)
    .slice(0, max === undefined ? 3 : max);
}

/** The change the shoot's Undo offers: the newest applied move or job date about this shoot that `me` may undo now
    (map/photo.js canUndo: within 7 days, mine - an admin: anyone's -, never "done", never a suggestion), with no undo of
    it already waiting. null when there is none. */
export function undoFor(changes, s, me, access, now) {
  const all = Array.isArray(changes) ? changes : [];
  const waiting = new Set(all.filter((u) => u && u.kind === "undo" && isOpenChange(u) && u.args).map((u) => Number(u.args.change)));
  return shootChanges(all, s).find((c) => MOVE_KINDS.indexOf(c.kind) !== -1 && !waiting.has(Number(c.id)) && canUndo(c, me, access, now).ok) || null;
}

/** One change as the sheet shows it: {id, title, status: {state, text, cls, words}, when}. */
export function changeLine(c, ctx) {
  const x = ctx || {};
  const st = changeStatusText(c, { now: x.now, pc: x.pc });
  const d = dayOfStamp(c.doneAt || c.requestedAt);
  return { id: c.id, title: changeTitle(c, { shoots: x.shoots, plan: x.plan, today: x.today }), status: st, when: d ? dayText(d, x.today) : "" };
}

/* ── the Move sheet ───────────────────────────────────────────────────── */

/** The days the database takes: a shoot today to a year ahead; a job date 60 days back to a year ahead (§7.3). */
export function bounds(kind, today) {
  if (!isDay(today)) return { min: "", max: "" };
  return kind === "milestone" ? { min: addDays(today, -MILESTONE_BACK_DAYS), max: addDays(today, MOVE_MAX_DAYS) }
    : { min: today, max: addDays(today, MOVE_MAX_DAYS) };
}

/** Whether a day is one the sheet may send (inside bounds). */
export function inBounds(kind, day, today) {
  const b = bounds(kind, today);
  return isDay(day) && !!b.min && day >= b.min && day <= b.max;
}

/** Two weeks of days to pick from around `center` (never before the first day the database takes): [{day, wd, date,
    mon, shootDay, isToday, current, picked}]. The plan's shoot days are the normal choice; the others are marked. */
export function dayStrip(center, o) {
  const x = o || {};
  const today = x.today;
  const b = bounds(x.kind, today);
  let start = isDay(center) ? addDays(center, -3) : today;
  if (b.min && start < b.min) start = b.min;
  if (isDay(x.start)) start = b.min && x.start < b.min ? b.min : x.start;
  const out = [];
  if (!isDay(start)) return out;
  for (let i = 0; i < (x.days || STRIP_DAYS); i++) {
    const d = addDays(start, i);
    if (b.max && d > b.max) break;
    out.push({ day: d, wd: weekdayShort(d), date: Number(d.slice(8, 10)), mon: dayText(d, today).split(" ")[1] || "",
      shootDay: x.kind === "milestone" ? true : isShootDay(d, x.shootDays), isToday: d === today, current: d === x.current, picked: d === x.picked });
  }
  return out;
}

/** "Sunday is not a shoot day - the shoot is kept on the day you pick" (move kinds only; "" for a shoot day). */
export function nonShootNote(kind, day, plan) {
  if (kind === "milestone" || !isDay(day) || !plan) return "";
  return isShootDay(day, plan.shootDays) ? "" : weekdayName(day) + " is not a shoot day (" + shootDaysText(plan.shootDays) +
    ") - the shoot is kept on the day you pick";
}

/** The Firm job date's sentence: "This job date (Framing start) is Firm - your change goes to the office to approve". */
export function officeLine(milestone) {
  const label = MILESTONE_LABEL[milestone] || "the job date";
  return "This job date (" + label + ") is Firm - your change goes to the office to approve";
}

/** Whether the person's job-date change will go to the office (a Firm job date, someone who is not an admin). */
export function needsOffice(plan, milestone, access) {
  const m = plan && plan.milestones ? plan.milestones[milestone] : null;
  return !!(m && m.firm && !(access && access.admin));
}

/** Apply's words: "Send to the office" when the office approves first, else "Apply". */
export function applyLabel(words) {
  return words && words.office && !words.refused ? "Send to the office" : "Apply";
}

/** What the page says once a change was sent: {text, kind}. */
export function sentText(answer, pc) {
  const a = answer || {};
  const off = !!pc && !(pc.online && !pc.paused);
  if (a.again) return { text: "That change was sent already - it is on the shoot now.", kind: "info" };
  if (a.needsOffice) return { text: "Sent - the office computer passes it to the office to approve.", kind: "ok" };
  if (off) return { text: "Sent - it waits until the office computer is back on.", kind: "info" };
  return { text: "Sent - the office computer applies it in a minute or two.", kind: "ok" };
}

/** What one of my changes came to, once answered (a toast): {text, kind} | null while it waits. */
export function finishedText(c, ctx) {
  if (!c || isOpenChange(c)) return null;
  const st = changeStatusText(c, ctx || {});
  const words = st.words ? ": " + st.words : "";
  if (st.state === "applied" && c.result && c.result.outcome === "suggested") return { text: "Sent to the office to approve" + words, kind: "info" };
  if (st.state === "applied") return { text: "Applied" + (st.words ? " - " + st.words : ""), kind: "ok" };
  if (st.state === "refused") return { text: st.text, kind: "error" };
  if (st.state === "expired") return { text: st.text, kind: "error" };
  return null;
}

/* ── the lists ────────────────────────────────────────────────────────── */

/** One line of a list: {day, wd, name, job, city}. */
export function rowFacts(s, plan, today) {
  return { day: isDay(s.plannedDate) ? dayText(s.plannedDate, today) : "No date yet", wd: isDay(s.plannedDate) ? weekdayShort(s.plannedDate) : "",
    date: isDay(s.plannedDate) ? Number(s.plannedDate.slice(8, 10)) : null, name: s.name, job: plan ? plan.label : "", city: plan ? plan.city : "" };
}

const SOURCE_OF_PHOTOGRAPHER = { plan: "", setting: "(the office's setting)", team: "(the photo team's default)", hint: "(the old setting)", none: "" };

/** A plan's header: {label, title, city, status, statusText, photographer, shootDays, suggestions}. */
export function planFacts(plan) {
  const p = plan || {};
  const who = p.photographerName ? p.photographerName + (SOURCE_OF_PHOTOGRAPHER[p.photographerSource] ? " " + SOURCE_OF_PHOTOGRAPHER[p.photographerSource] : "") : "No photographer yet";
  return { label: p.label || "", title: p.title || "", city: p.city || "", status: p.status || "",
    statusText: p.status && p.status !== "active" ? PLAN_STATUS_LABEL[p.status] || str(p.status) : "", photographer: who,
    shootDays: "Shoots " + shootDaysText(p.shootDays), suggestions: p.openSuggestions ? plural(p.openSuggestions, "suggestion") + " waiting for the office" : "" };
}

/** The Home card's badge: the late shoots of the live plans (red), else today's, else none. o.mine: only plans whose
    photographer is that profile (a photographer's own), when they have any. -> {cls, text, title} | null */
export function homeBadge(plans, shoots, today, o) {
  const opt = o || {};
  const live = (plans || []).filter((p) => p.status === "active" || p.status === "paused");
  const mineOnly = opt.mine && live.some((p) => p.photographerProfileId === opt.mine);
  const ids = new Set(live.filter((p) => !mineOnly || p.photographerProfileId === opt.mine).map((p) => p.id));
  const open = (shoots || []).filter((s) => ids.has(s.planId) && isOpen(s));
  const late = open.filter((s) => isLate(s, today)).length;
  if (late) return { cls: "warn", text: late + " late", title: plural(late, "shoot") + " past " + (late === 1 ? "its" : "their") + " day and grace" };
  const now = open.filter((s) => s.plannedDate === today).length;
  return now ? { cls: "", text: now + " today", title: plural(now, "shoot") + " today" } : null;
}

/** The weekday header of the Month grid, Sunday first (the site's calendars). */
export function monthStart(today) { return isDay(today) ? today.slice(0, 7) : ""; }

/** Whether the next / previous month button should move the grid (a year either way). */
export function monthInRange(month, today) {
  if (!/^\d{4}-\d{2}$/.test(str(month)) || !isDay(today)) return false;
  const n = (m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7));
  return Math.abs(n(month) - n(today.slice(0, 7))) <= 13;
}

/** The refusal of a request in the sheet's words ({code, hint, reason, detail}: repo/photo.js PhotoError). */
export function requestProblem(err, ctx) {
  const e = err || {};
  if (e.reason === "changed") return CHANGED_TEXT;
  return refusalText(e.reason, Object.assign({ where: "request", retryAfter: e.retryAfter, message: e.message }, ctx || {}));
}

export { MILESTONES, MILESTONE_LABEL, dayOfWeek };
