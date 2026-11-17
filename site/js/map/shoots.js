/* The shoot schedule page's words and small rules (shoots.html; the photographer screen program, P3; DCR Desktop 2
   migration 20261110000100_photo_schedule, the contract DCR Desktop 2 docs/PHOTO-SCHEDULE.md). Pure: no DOM, no network.
   map/photo.js turns the database's rows into shapes and puts the preview into words; this module is what the page
   adds on top of it:

   * the header:        pcHeader (the office computer's state in plain words - only when it is not running);
   * the address:       parseLink / linkFor (?shoot=<photo_shoots.id> - DCR Agents 2's reminders link here -, ?plan=<id>,
                        ?task=<a My Tasks task id: its shoot>, ?view=agenda|job|month, ?month=YYYY-MM, ?mine=1);
   * a shoot's sheet:   dayLine (the day and its grace), historyLines (newest first), doneLine, briefSections (the safe
                        brief fields the mirror has), touches / shootChanges (the changes about one shoot), myOpen,
                        recentMine, lastRefused (the row's "Not done" chip), undoFor (my last applied change within 7
                        days - an admin's: anyone's; never "done"; not once its shoots moved again), undoLabel;
   * the Move sheet:    bounds (the days the database takes), dayStrip (the plan's shoot days are the normal choice, a
                        non-shoot day is allowed but marked), nonShootNote, officeLine, applyLabel, milestoneMove,
                        previewSig (what the person was shown: Apply sends only that), sentText, sentDiffers;
   * the lists:         rowFacts (one line of the Agenda / By job), planFacts (a plan's header), homeBadge (Home's card);
   * the job's place:   toPlace (a projects row read live - never mirrored), placeLine ("0000 Sampleton Avenue · Sampleton,
                        CA 93000"), mapsUrl (Google Maps' search, a new tab) - DCR Desktop 2 docs/PHOTO-SHOOT-EDITS.md §1.4;
   * the files icon:    filesIcon (a shoot's photos and videos in OneDrive, from its folder's rollup - §1.6);
   * the change queue:  finishedText (what a change of mine came to, once the office computer answered, named).

   Every free text is the mirror's (already masked by the database and again by map/photo.js safeText). */

import {
  MILESTONES, MILESTONE_LABEL, PLAN_STATUS_LABEL, MOVE_KINDS, UNDO_DAYS, EXPIRE_DAYS, isDay, dayText, weekdayName, weekdayShort, isShootDay,
  shootDaysText, isOpen, isLate, followsMilestone, pcLine, canUndo, isOpenChange, changeStatusText, changeTitle, refusalText, safeText,
} from "./photo.js";
import { addDays, ymd, dayOfWeek } from "./pacific.js";
import { maskAmounts } from "../money-mask.js";

export const TITLE = "Shoot schedule";
// P5b: the Ready for marketing list is the fourth view (DCR Desktop 2 docs/PHOTO-FILES.md §13.5; its name is ready.view)
export const VIEWS = Object.freeze([["agenda", "Agenda"], ["job", "By job"], ["month", "Month"], ["ready", "Ready for marketing"]]);
export const VIEW_KEYS = Object.freeze(VIEWS.map((v) => v[0]));
export const NO_ACCESS_TEXT = "The shoot schedule is for admins and the photo team. An admin puts people on the photo team " +
  "(Employees & crews → Access, or DCR Desktop 2 → Users).";
export const READ_ONLY_TEXT = "You read the shoot schedule: photographers and admins move shoots.";
export const EDIT_TEXT = "Move a shoot here and the office computer applies it, usually in a minute or two. Every move stays in the shoot's history.";
export const PLACEHOLDER = "Pick a shoot to see its day, its brief and its history.";
export const GONE_TEXT = "That shoot is not on the shoot schedule any more.";
export const TASK_GONE_TEXT = "This task's shoot is not on the shoot schedule (yet).";
export const PLAN_GONE_TEXT = "That job is not on the shoot schedule any more.";
export const CHANGED_TEXT = "Someone changed this job's shoots meanwhile - here is the new preview.";
export const CHANGED_DONE_TEXT = "Someone changed this shoot meanwhile - look at it again, then mark it done.";
// the sheet was closed while its change was on its way, and the database said "changed": nothing was queued
export const NOT_SENT_CHANGED = "Not sent: someone changed this job's shoots meanwhile - open Move… again to see the new preview.";
// a request with no answer (a dropped connection, a gateway's 5xx): it may have reached the database - the same key is
// sent again, so a second press never queues it twice (repo/photo.js attemptKey)
export const NO_ANSWER_TEXT = "No answer - it may not have been sent. Press Apply again: it will not be sent twice.";
// the same, after the sheet was closed while it was on its way: there is no Apply to press (DCR Desktop 2 says the
// same, naming its changes strip)
export const NO_ANSWER_CLOSED_TEXT = "No answer - it may have been sent. The shoot shows it once it arrives; if it is not there in a few minutes, make the change again.";
// the sheet's Cancel while a change is on its way: closing it does not stop the change
export const CLOSE_SENDING = "Close (still sending)";
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

/** ?shoot=, ?plan=, ?task=, ?view=, ?month=, ?mine=1, ?ready= -> {shoot, plan, task, view, month, mine, ready} (null / false
    for what is not there or not one). mine: "Only my jobs" ticked (Home's card links so when its badge counted only my
    jobs). ready: a Ready for marketing card (photo_marketing.id - the push notice and the e-mail link there, §10.7);
    it opens the Ready view. */
export function parseLink(search) {
  let q;
  try { q = new URLSearchParams(str(search)); } catch (e) { q = new URLSearchParams(""); }
  const view = q.get("view");
  const month = q.get("month");
  return { shoot: posInt(q.get("shoot")), plan: posInt(q.get("plan")), task: posInt(q.get("task")),
    view: VIEW_KEYS.indexOf(view) !== -1 ? view : null, month: /^\d{4}-(0[1-9]|1[0-2])$/.test(str(month)) ? month : null,
    mine: q.get("mine") === "1", ready: posInt(q.get("ready")) };
}

/** The page's own address for what is shown: "shoots.html?shoot=12", "shoots.html?plan=3", "shoots.html?view=month". */
export function linkFor(o) {
  const x = o || {};
  const parts = [];
  if (x.view === "ready") return "shoots.html?" + (posInt(x.ready) ? "ready=" + posInt(x.ready) : "view=ready");
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

/** When a finished change finished: its done_at; a "new" one nobody took for 7 days (it reads as expired before the PC's
    purge writes done_at - a dead PC writes nothing) expired 7 days after it was asked. */
export function finishedAt(c) {
  if (!c) return 0;
  if (c.doneAt) return Date.parse(c.doneAt) || 0;
  const at = Date.parse(c.requestedAt || "") || 0;
  return at && (c.state || "") === "expired" ? at + EXPIRE_DAYS * 86400000 : at;
}

/** My changes of this shoot that finished within 7 days (applied, refused, sent to the office, expired, cancelled),
    newest first, at most `max` (3). An untaken change that expired by time shows its "Expired" for the 7 days after. */
export function recentMine(changes, s, me, now, max) {
  const t = now instanceof Date ? now.getTime() : Date.now();
  return shootChanges(changes, s).filter((c) => me && c.requestedBy === me && !isOpenChange(c) && finishedAt(c) >= t - UNDO_DAYS * 86400000)
    .slice(0, max === undefined ? 3 : max);
}

/** My newest finished change that held this shoot (its target, or a job-date change of the date it follows - the
    shoots pendingFor chips), when the office computer refused it within 7 days: the row's "Not done - see why" chip.
    null when there is none, or when a newer change of mine about it finished since. */
export function lastRefused(changes, s, me, now) {
  if (!s || !me) return null;
  const t = now instanceof Date ? now.getTime() : Date.now();
  const holds = (c) => c.targetKey === s.key || (c.kind === "milestone" && followsMilestone(s) && c.args && c.args.milestone === s.anchor);
  const mine = (Array.isArray(changes) ? changes : []).filter((c) => c && c.planId === s.planId && c.requestedBy === me && !isOpenChange(c) && holds(c))
    .sort((a, b) => finishedAt(b) - finishedAt(a) || (b.id || 0) - (a.id || 0));
  const last = mine[0];
  return last && last.state === "refused" && finishedAt(last) >= t - UNDO_DAYS * 86400000 ? last : null;
}

/** Whether the shoots an applied change moved are still where it left them (the undo's own check, §8.6: every moved shoot
    open and on its day; a job date as the change left it). shoots: the plan's shoots; plan: toPlan. Unknown: true. */
export function undoStillFits(c, shoots, plan) {
  if (!c || !c.result) return true;
  if (c.kind === "milestone") {
    const after = c.result.milestone_after && typeof c.result.milestone_after === "object" ? c.result.milestone_after : null;
    const key = c.args && c.args.milestone;
    const day = (after && isDay(after.date) && after.date) || (c.args && isDay(c.args.date) ? c.args.date : null);
    const m = plan && plan.milestones && key ? plan.milestones[key] : null;
    return !m || !day || m.date === day;
  }
  if (!Array.isArray(shoots)) return true;
  const moved = Array.isArray(c.result.moved) ? c.result.moved : [];
  return moved.every((m) => {
    const s = m && shoots.find((x) => x.key === m.key);
    return !s || !isDay(m.to) || (isOpen(s) && s.plannedDate === m.to);
  });
}

/** The change the shoot's Undo offers: the newest applied move or job date about this shoot that `me` may undo now
    (map/photo.js canUndo: within 7 days, mine - an admin: anyone's -, never "done", never a suggestion), with no undo of
    it already waiting, and its shoots still where it left them (ctx: {shoots, plan}; a shoot moved again since is
    refused "changed" - it is moved instead). null when there is none. */
export function undoFor(changes, s, me, access, now, ctx) {
  const all = Array.isArray(changes) ? changes : [];
  const x = ctx || {};
  const waiting = new Set(all.filter((u) => u && u.kind === "undo" && isOpenChange(u) && u.args).map((u) => Number(u.args.change)));
  return shootChanges(all, s).find((c) => MOVE_KINDS.indexOf(c.kind) !== -1 && !waiting.has(Number(c.id)) && canUndo(c, me, access, now).ok &&
    undoStillFits(c, x.shoots, x.plan)) || null;
}

/** The Undo button's words: "Undo my last change…", or "Undo this change…" when it is someone else's (an admin's). */
export function undoLabel(c, me) {
  return c && me && c.requestedBy === me ? "Undo my last change…" : "Undo this change…";
}

/** One change as the sheet shows it: {id, title, status: {state, text, cls, words}, when, asked, answered}. asked (= when):
    the day it was asked; answered: the day the office computer answered it, when that was another day. */
export function changeLine(c, ctx) {
  const x = ctx || {};
  const st = changeStatusText(c, { now: x.now, pc: x.pc });
  const a = dayOfStamp(c.requestedAt);
  const d = dayOfStamp(c.doneAt);
  const asked = a ? dayText(a, x.today) : "";
  const answered = d && d !== a ? dayText(d, x.today) : "";
  return { id: c.id, title: changeTitle(c, { shoots: x.shoots, plan: x.plan, today: x.today }), status: st, when: asked || answered, asked, answered };
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

/** What the page says once a change was sent: {text, kind}. An again: true answer (the same change sent before, §6.1
    step 3 - a retry after a lost answer) says what became of it: still waiting, applied, sent to the office, refused
    with its reason, expired or cancelled (the row's status, result and error, §17). */
export function sentText(answer, pc) {
  const a = answer || {};
  const off = !!pc && !(pc.online && !pc.paused);
  if (a.again) {
    const head = "That change was sent already";
    const st = a.state || a.status;
    if (st === "new") {
      return { text: head + " - " + (a.needsOffice ? "the office computer passes it to the office to approve." : off ? "it waits until the office computer is back on."
        : "it waits for the office computer."), kind: "info" };
    }
    if (st === "taken") return { text: head + " - the office computer is applying it.", kind: "info" };
    if (st === "cancelled") return { text: head + " and then cancelled - nothing changed.", kind: "info" };
    const f = finishedText({ state: st, status: a.status, result: a.result, error: a.error, args: a.args || {}, needsOffice: a.needsOffice });
    return f ? { text: head + ". " + f.text, kind: f.kind } : { text: head + ".", kind: "info" };
  }
  if (a.needsOffice) return { text: "Sent - the office computer passes it to the office to approve.", kind: "ok" };
  if (off) return { text: "Sent - it waits until the office computer is back on.", kind: "info" };
  return { text: "Sent - the office computer applies it in a minute or two.", kind: "ok" };
}

/** What one of my changes came to, once answered (a toast): {text, kind} | null while it waits. ctx: {pc, shoots, plan,
    today}: with the plan (or its shoots) the toast names the change and its job ("Not done - Move Delivery day to Mon Nov
    16 - only this shoot (A000T9 Sample house): That day has passed."), so two changes in flight are told apart. */
export function finishedText(c, ctx) {
  if (!c || isOpenChange(c)) return null;
  const x = ctx || {};
  const st = changeStatusText(c, x);
  const title = x.plan || x.shoots ? changeTitle(c, { shoots: x.shoots, plan: x.plan, today: x.today }) + (x.plan && x.plan.label ? " (" + x.plan.label + ")" : "") : "";
  if (st.state === "applied" && c.result && c.result.outcome === "suggested") {
    return { text: "Sent to the office to approve" + (title ? " - " + title : "") + (st.words ? ": " + st.words : ""), kind: "info" };
  }
  if (st.state === "applied") return { text: "Applied" + (title ? " - " + title + (st.words ? " (" + st.words + ")" : "") : st.words ? " - " + st.words : ""), kind: "ok" };
  if (st.state === "refused") return { text: title ? "Not done - " + title + ": " + st.text.replace(/^Not done: /, "") : st.text, kind: "error" };
  if (st.state === "expired") return { text: title ? "Expired - " + title + ": the office computer did not take it within 7 days" : st.text, kind: "error" };
  return null;
}

/** A preview reduced to what the person was shown (§6.3): every shoot that moves (key, from -> to, its notes), skipped,
    stays and why, the series re-planned, the office's approval, a refusal, a done. Two previews with the same
    signature list the same thing - Apply sends only what the sheet shows. */
export function previewSig(pv) {
  if (!pv || typeof pv !== "object") return "";
  const items = (l, f) => (Array.isArray(l) ? l : []).filter((it) => it && typeof it === "object").map(f).sort();
  return JSON.stringify([str(pv.kind), pv.refused ? str(pv.refused) : null, pv.needs_office === true,
    items(pv.moved, (it) => [str(it.key), str(it.from), str(it.to), (Array.isArray(it.notes) ? it.notes.map(str).sort() : []).join(",")].join("|")),
    items(pv.passed, (it) => [str(it.key), str(it.from), str(it.to)].join("|")),
    items(pv.stays, (it) => [str(it.key), str(it.reason)].join("|")),
    (Array.isArray(pv.replan) ? pv.replan.map(str) : []).sort(),
    pv.done && typeof pv.done === "object" ? str(pv.done.key) : null]);
}

/** The words when a change was queued but the database's own preview of it is not the one the sheet showed (the schedule
    changed in the moment it was sent): {text, kind}. words: previewWords of the queued preview. */
export function sentDiffers(words) {
  const w = words || {};
  return { text: "Sent - but the schedule changed as it was sent, so it is not the preview you saw: " + (w.summary || "look at the shoot") +
    ". If that is not what you want, cancel it on the shoot while it waits.", kind: "error" };
}

/** "Framing start: Thu Nov 19 → Mon Nov 23" - the job date's own move, the first line of "The job date moved"'s preview
    ("Framing start: no date yet → Mon Nov 23"). */
export function milestoneMove(plan, key, to, today) {
  const label = MILESTONE_LABEL[key];
  if (!label || !isDay(to)) return "";
  const m = plan && plan.milestones ? plan.milestones[key] : null;
  return label + ": " + (m && isDay(m.date) ? dayText(m.date, today) : "no date yet") + " → " + dayText(to, today);
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

/** The Home card's badge: the late shoots (red), else today's, else none - counted over the same plans the page's header
    counts (every plan but the archived ones). o.mine: only the plans whose photographer is that profile (a
    photographer's own), when they have any; then `mine` is true and the card opens the page with "Only my jobs" ticked
    (shoots.html?mine=1), so both say the same number. -> {cls, text, title, mine} | null */
export function homeBadge(plans, shoots, today, o) {
  const opt = o || {};
  const listed = (plans || []).filter((p) => p.status !== "archived");
  const mineOnly = !!opt.mine && listed.some((p) => p.photographerProfileId === opt.mine);
  const ids = new Set(listed.filter((p) => !mineOnly || p.photographerProfileId === opt.mine).map((p) => p.id));
  const open = (shoots || []).filter((s) => ids.has(s.planId) && isOpen(s));
  const where = mineOnly ? " on your jobs" : " on every job";
  const late = open.filter((s) => isLate(s, today)).length;
  if (late) return { cls: "warn", text: late + " late", title: plural(late, "shoot") + " past " + (late === 1 ? "its" : "their") + " day and grace" + where, mine: mineOnly };
  const now = open.filter((s) => s.plannedDate === today).length;
  return now ? { cls: "", text: now + " today", title: plural(now, "shoot") + " today" + where, mine: mineOnly } : null;
}

/* ── the job's place and the files icon (DCR Desktop 2 docs/PHOTO-SHOOT-EDITS.md §1.4, §1.5, §1.6) ─────────── */

/** The picture's words (its tooltip and alternative text). */
export const PICTURE_TEXT = "The job's picture";
/** The address link's tooltip on the phone (the address itself is the link). */
export const MAPS_TEXT = "Open in Maps";

// a place's part on one line, an amount typed into it masked (money-mask.js maskAmounts, DCR Agents 2's mask_amounts) -
// never the money-word rule (scrub-money.js): it reads a 3+ digit number before a word like Price, Bid or Budget as an
// amount, so a made-up "0000 Price Street" became "[amount] Street" and its Maps link searched for that (step 1's review,
// round 2; DCR Desktop 2 docs/PHOTO-SHOOT-EDITS.md §1.1)
const oneLine = (v) => maskAmounts(str(v)).replace(/\s+/g, " ").trim();

/** A projects row (repo/projects.js places: read live under the projects RLS, never mirrored) -> the job's place
    {id, address, city, state, zip, pictureId} (null for a row without an id). The address carries no amount; one typed
    into it is still masked, as the page masks every text, and the street is kept as the project holds it. */
export function toPlace(r) {
  const x = r || {};
  const id = posInt(x.id);
  if (!id) return null;
  return { id, address: oneLine(x.address), city: oneLine(x.city), state: oneLine(x.state), zip: oneLine(x.zip), pictureId: posInt(x.thumbnail_file_id) };
}

function townOf(p) {
  return [p.city, [p.state, p.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

/** "0000 Sampleton Avenue · Sampleton, CA 93000" (§1.5); "" without a street address (no address: nothing is said). */
export function placeLine(p) {
  if (!p || !p.address) return "";
  return [p.address, townOf(p)].filter(Boolean).join(" · ");
}

/** Google Maps' search for the place (the project overview's pattern), opened in a new tab; "" without a street. */
export function mapsUrl(p) {
  if (!p || !p.address) return "";
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent([p.address, townOf(p)].filter(Boolean).join(", "));
}

/** A rollup's count as a whole number (SE §1.6 "The rule, final", 1: missing, not a number or below 0 - 0; a
    fraction cut to its whole part; a decimal text read as its number) - DCR Desktop 2's photo_view._count. */
export function wholeCount(v) {
  let x = 0;
  if (typeof v === "number" || typeof v === "boolean") x = Number(v);
  else if (typeof v === "string" && /^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\s*$/i.test(v)) x = Number(v);
  return Number.isFinite(x) && x >= 1 ? Math.floor(x) : 0;
}
/** The states of a rollup whose files are still on their way (DCR Desktop 2's FILES_ON_THE_WAY). */
export const FILES_ON_THE_WAY = Object.freeze(["copying", "waiting"]);
/** The drive_state of a shoot folder gone: moved out of DCR Photo & Video, or deleted in OneDrive (FOLDER_GONE). */
export const FOLDER_GONE = Object.freeze(["missing", "trashed"]);

/** The files icon of one shoot (the owner's 2026-11-16 ask), from its live shoot folder's rollup (repo/photo-files.js
    folderStates: {state: files_state, counted, confirmed, waiting: files_waiting - null for a read without it -,
    problem: files_problem, photos, videos, driveState: drive_state, held, culled}; no such rollup - no folder, or a
    reader who may not read it - nothing). DCR Desktop 2 docs/PHOTO-SHOOT-EDITS.md §1.6 "The rule, final", step by step
    and word for word with DCR Desktop 2's photo_view.files_mark (its parity test runs both on the same rollups):
    1. The counts: photos, videos and files_problem as whole numbers (missing or below 0: 0); waiting is files_waiting,
       a rollup without it (an older read) takes files_counted - files_confirmed - files_problem, at least 0; state is
       files_state, "none" when empty.
    2. Held on the Ready list (held: repo/photo-files.js listHolds - app.photo_help_held_by_list, the database's own
       rule, read only for a folder with a files problem): marketing's culls - Editors delete and move the files in
       OneDrive and the database counts them as missing - are marketing's, never a look here. Marketing's culls after a
       later hand-in (step 1's review, round 4): a hand-in sealed since the list (a second card) lifts the hold, yet the
       culls of the files handed in before stay no problem (app.photo_culled_row) - culled, the shoot's
       photo_drive_status' files.culled, read for such a folder alone (repo/photo-files.js listLifted, culled); then, as
       app.photo_sealed_state does, files_problem less culled (at least 0; waiting taken in step 1, before), and a state
       of problem with none left is waiting when waiting > 0, else confirmed.
    3. Gone: drive_state missing or trashed.
    4. A problem: gone, or (state problem or files_problem > 0 - even while another copy is open; both after step 2's
       culls) and not held.
    5. Arriving: state copying or waiting, no problem, and waiting > 0 (an open copy with nothing counted yet, or one
       given up days ago - abandoned stays copying until someone acts - has nothing waiting: no arrow, the usual tone).
    6. Nothing when photos and videos are 0 and it is not arriving (a problem with nothing in OneDrive too - the Files
       line says it).
    7. What shows: the camera and photos when above 0, then the film and videos when above 0; the up-arrow after them
       while arriving; the glyphs in the warning colour for a problem, else muted (the counts always in the text colour:
       css/shoots.css).
    8. The words (the tooltip and what a screen reader says): "{photos} photos" and "{videos} videos" above 0 ("1 photo",
       "1 video") joined by " · ", then " in OneDrive"; then " - needs a look" for a problem; else, while arriving,
       " - {waiting} files not in OneDrive yet" ("1 file"); with no part, only "{waiting} files not in OneDrive yet".
       Never "still sending": a hand-in that stopped on a computer or stalled is copying or waiting too.
    -> null | {photos, videos, tone: "problem" | "sending" (arriving) | "ok", sending (the up-arrow: arriving), label} */
export function filesIcon(roll) {
  if (!roll || typeof roll !== "object") return null;
  const photos = wholeCount(roll.photos), videos = wholeCount(roll.videos);
  let problems = wholeCount(roll.problem);
  // (a rollup without files_waiting - an older read - counts the counted files neither confirmed nor a problem; the
  // culls are missing files, so this counts them out before they are taken from the problem files below)
  const waiting = roll.waiting !== undefined && roll.waiting !== null ? wholeCount(roll.waiting)
    : Math.max(0, wholeCount(roll.counted) - wholeCount(roll.confirmed) - problems);
  let state = str(roll.state) || "none";
  // step 1's review, round 4: marketing's culls of the files handed in before the list (culled: read for a folder on the
  // list whose hold a later hand-in lifted) taken out as the database does (app.photo_sealed_state)
  const culled = wholeCount(roll.culled);
  if (culled) {
    problems = Math.max(0, problems - culled);
    if (state === "problem" && !problems) state = waiting > 0 ? "waiting" : "confirmed";
  }
  const held = roll.held === true;
  const gone = FOLDER_GONE.indexOf(str(roll.driveState)) !== -1;
  const problem = gone || ((state === "problem" || problems > 0) && !held);
  const arriving = FILES_ON_THE_WAY.indexOf(state) !== -1 && !problem && waiting > 0;
  if (!photos && !videos && !arriving) return null;
  const parts = [];
  if (photos) parts.push(plural(photos, "photo"));
  if (videos) parts.push(plural(videos, "video"));
  let label = parts.length ? parts.join(" · ") + " in OneDrive" : "";
  if (problem) label += " - needs a look";
  else if (arriving) label = label ? label + " - " + plural(waiting, "file") + " not in OneDrive yet" : plural(waiting, "file") + " not in OneDrive yet";
  return { photos, videos, tone: problem ? "problem" : arriving ? "sending" : "ok", sending: arriving, label };
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
