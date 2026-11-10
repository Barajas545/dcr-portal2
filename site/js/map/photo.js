/* The shoot schedule's pure rules for Portal 2 (the photographer screen program, P3; DCR Desktop 2 migration
   20261110000100_photo_schedule, docs/DATABASE.md §39; the contract is DCR Desktop 2's docs/PHOTO-SCHEDULE.md). No DOM,
   no network: repo/photo.js reads, this module turns the rows into what the page shows.

   DCR Agents 2 (the office PC) is the ONLY writer of photo plans; the database holds a mirror of them (photo_plans,
   photo_shoots) and a queue of people's changes (photo_changes). THE SHIFT RULE (what a move does to the other shoots)
   is the database's: photo_change_preview answers it and this module only puts that answer into words - it never
   works a date out itself.

   * rows -> shapes:   toPlan, toShoot, toChange, toAccess, toPcStatus, toTeamMember (every free text passed through the
                       site's money masks: safeText);
   * days:             dayText ("Thu Nov 18"), weekdayName, pyWeekday (Mon = 0 ... Sun = 6, the shoot days' numbers),
                       isShootDay; "today" is the company day (map/pacific.js ymd), never the browser's midnight;
   * a shoot:          isOpen, isLate (open, dated, today > planned_date + window_days), lateDays, movedNotTold,
                       anchorText ("2 days after Framing start", "on a fixed day"), planShoots (a plan's order);
   * the Agenda:       agenda(plans, shoots, today, o) -> Late, Today, This week, Next week, Later, No date yet, and Done &
                       closed (folded); the Month grid: monthGrid(month, plans, shoots, today, o);
   * the chips:        shootChips (status, Late, Moved - not told yet, Firm, a change waiting), milestoneChips;
   * changes:          changeState (a new change older than 7 days reads as expired), changeStatusText, changeTitle,
                       pendingFor, refusalText (every code the database, the PC or set_photo_team answers);
   * the Move sheet:   moveChoices (Only this shoot - preselected -, This shoot and the later ones, The job date moved
                       with the job date to pick), moveArgs, previewWords (every shoot that moves from -> to, what stays
                       and why, what will be skipped, the series re-planned, the office's approval);
   * who may act:      shootActions (can_photo may request, marketing reads only, closed shoots never move),
                       canUndo (within 7 days, the requester or an admin, never of "done"), canCancel;
   * the team:         teamSummary, googleEmailProblem (the database's rule, as a hint before sending);
   * the office computer: pcLine ("The office computer is off - changes wait until it is back on (last seen 2 h ago)");
                       the page says "the office computer" (DCR Agents 2 on the DCR server PC: the owner's plain words). */

import { addDays, dayOfWeek } from "./pacific.js";
import { maskAmounts } from "../money-mask.js";
import { scrubMoney } from "../scrub-money.js";

export const MILESTONES = Object.freeze(["framing_start", "delivery", "framing_complete", "house_complete"]);
export const MILESTONE_LABEL = Object.freeze({ framing_start: "Framing start", delivery: "Delivery", framing_complete: "Framing complete",
  house_complete: "House complete" });
export const KINDS = Object.freeze(["move_one", "move_later", "milestone", "done", "undo"]);
export const MOVE_KINDS = Object.freeze(["move_one", "move_later", "milestone"]);
export const OPEN = Object.freeze(["planned", "announced"]);
export const SHOOT_STATUSES = Object.freeze(["planned", "announced", "done", "skipped", "missed"]);
export const PLAN_STATUSES = Object.freeze(["review", "active", "paused", "done", "archived"]);
export const CHANGE_STATUSES = Object.freeze(["new", "taken", "applied", "refused", "expired", "cancelled"]);
export const NOTE_ORDER = Object.freeze(["not_shoot_day", "stops_following", "gets_date", "comes_back", "rolled", "heads_up_sent"]);
export const STAY_REASONS = Object.freeze(["done", "skipped", "missed", "undated", "fixed", "same_day"]);
export const PHASE_LABEL = Object.freeze({ before_framing: "Before framing", delivery: "Delivery", framing_progress: "Framing progress",
  framing_complete: "Framing complete", house_complete: "House complete", special: "Special" });
export const STATUS_LABEL = Object.freeze({ planned: "Planned", announced: "Heads-up sent", done: "Done", skipped: "Skipped", missed: "Missed" });
export const PLAN_STATUS_LABEL = Object.freeze({ review: "In review", active: "Active", paused: "Paused", done: "Done", archived: "Archived" });
export const UNDO_DAYS = 7;          // §8.6: an applied change is undone within 7 days
export const EXPIRE_DAYS = 7;        // §8.4: a new change nobody took for 7 days is expired
export const REASON_MAX = 200;       // §8.1 reason
export const NOTE_MAX = 500;         // §8.1 done note
export const EMAIL_MAX = 254;        // photo_team.google_email
export const EMPTY_TEXT = "No shoot schedule yet - the DCR server publishes it";
export const NOT_READY_TEXT = "The shoot schedule is not in the database yet";
export const GROUPS = Object.freeze([["late", "Late"], ["today", "Today"], ["this_week", "This week"], ["next_week", "Next week"],
  ["later", "Later"], ["undated", "No date yet"], ["closed", "Done & closed"]]);
export const CHOICES = Object.freeze([["move_one", "Only this shoot"], ["move_later", "This shoot and the later ones"],
  ["milestone", "The job date moved"]]);

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const WD_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WD_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MON_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/* ── small things ─────────────────────────────────────────────────────── */

const str =(v) => (v === null || v === undefined ? "" : String(v));
const numOr = (v, d) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? d : Number(v));
const dayOr = (v) => (typeof v === "string" && DAY_RE.test(v.slice(0, 10)) ? v.slice(0, 10) : null);
const plural = (n, one, many) => n + " " + (n === 1 ? one : many || one + "s");

/** Free text as the page shows it: the database scrubbed it already (app.scrub_money); the site's masks go over it
    again (money-mask.js for amounts typed any way, scrub-money.js for "1,200 deposit"), so no amount is ever shown. */
export function safeText(v) {
  const s = str(v);
  return s ? scrubMoney(maskAmounts(s)) : "";
}

/** A day "YYYY-MM-DD", or false. */
export function isDay(v) { return typeof v === "string" && DAY_RE.test(v); }

/** Days from a to b (b - a); null when either is not a day. */
export function daysBetween(a, b) {
  if (!isDay(a) || !isDay(b)) return null;
  const t = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.round((t(b) - t(a)) / 86400000);
}

/** "Thu Nov 18" (", 2027" added when the year is not today's year). */
export function dayText(d, today) {
  if (!isDay(d)) return "";
  let s = WD_SHORT[dayOfWeek(d)] + " " + MON_SHORT[+d.slice(5, 7) - 1] + " " + Number(d.slice(8, 10));
  if (isDay(today) && today.slice(0, 4) !== d.slice(0, 4)) s += ", " + d.slice(0, 4);
  return s;
}

/** "Thursday" */
export function weekdayName(d) { return isDay(d) ? WD_LONG[dayOfWeek(d)] : ""; }
/** "Thu" */
export function weekdayShort(d) { return isDay(d) ? WD_SHORT[dayOfWeek(d)] : ""; }
/** Python's weekday() of a day: Mon = 0 ... Sun = 6 (the plan's shoot days are written so). */
export function pyWeekday(d) { return isDay(d) ? (dayOfWeek(d) + 6) % 7 : null; }
/** Whether a day is one of the plan's shoot days (an empty list means every day). */
export function isShootDay(d, shootDays) {
  const days = Array.isArray(shootDays) ? shootDays : [];
  return !days.length || days.indexOf(pyWeekday(d)) !== -1;
}
/** The shoot days in words: "Monday to Saturday", "every day", "Mon, Wed, Fri". */
export function shootDaysText(shootDays) {
  const days = (Array.isArray(shootDays) ? shootDays : []).map(Number).filter((x) => x >= 0 && x <= 6).sort((a, b) => a - b);
  const names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  if (!days.length || days.length === 7) return "every day";
  const run = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  if (run && days.length >= 3) return names[days[0]] + " to " + names[days[days.length - 1]];
  return days.map((d) => names[d].slice(0, 3)).join(", ");
}

/* ── rows -> shapes ───────────────────────────────────────────────────── */

function toMilestones(m) {
  const src = m && typeof m === "object" ? m : {};
  const out = {};
  for (const k of MILESTONES) {
    const x = src[k] && typeof src[k] === "object" ? src[k] : {};
    const date = dayOr(x.date);
    const confirmed = x.confirmed === true;
    const source = x.source === null || x.source === undefined ? null : safeText(x.source);
    out[k] = { key: k, label: MILESTONE_LABEL[k], date, source, confirmed,
      firm: typeof x.firm === "boolean" ? x.firm && !!date : !!date && confirmed && source === "admin" };
  }
  return out;
}

/** A photo_plans row -> the plan as the page shows it. */
export function toPlan(r) {
  const x = r || {};
  const code = safeText(x.project_code);
  const label = safeText(x.project_label);
  const title = safeText(x.title);
  return {
    id: numOr(x.id, null), rev: numOr(x.rev, null), milestonesRev: numOr(x.milestones_rev, null),
    status: PLAN_STATUSES.indexOf(x.status) !== -1 ? x.status : str(x.status),
    projectId: numOr(x.project_id, null), projectCode: code, projectLabel: label, city: safeText(x.city), title,
    label: label || code || title || "Photo plan",
    photographerName: safeText(x.photographer_name), photographerProfileId: x.photographer_profile_id || null,
    photographerSource: str(x.photographer_source) || "none",
    milestones: toMilestones(x.milestones),
    shootDays: (Array.isArray(x.shoot_days) ? x.shoot_days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
    leadDays: numOr(x.lead_days, 0),
    series: (Array.isArray(x.series) ? x.series : []).filter((s) => s && typeof s === "object" && s.key).map((s) => ({
      key: str(s.key), name: safeText(s.name) || prettyKey(s.key), phase: s.phase || null, anchor: s.anchor || null, every: numOr(s.every, null) })),
    openSuggestions: numOr(x.open_suggestions, 0), activatedAt: x.activated_at || null, mirroredAt: x.mirrored_at || null,
  };
}

function toHistory(list) {
  return (Array.isArray(list) ? list : []).filter((h) => h && typeof h === "object").map((h) => ({
    at: h.at || null, from: dayOr(h.from), to: dayOr(h.to), reason: safeText(h.reason), source: safeText(h.source), manual: h.manual === true,
    by: safeText(h.by), change: numOr(h.change, null) }));
}

function toBrief(b) {
  const x = b && typeof b === "object" ? b : {};
  const lines = (v) => (Array.isArray(v) ? v.map(safeText).filter(Boolean) : []);
  return {
    purpose: safeText(x.purpose), timeOfDay: safeText(x.time_of_day), sampleShot: safeText(x.sample_shot),
    shots: (Array.isArray(x.shots) ? x.shots : []).filter((s) => s && typeof s === "object").map((s) => ({
      title: safeText(s.title), description: safeText(s.description), kind: s.kind || null, priority: s.priority || null })),
    tips: lines(x.tips), equipment: lines(x.equipment), safety: lines(x.safety), captionIdeas: lines(x.caption_ideas),
    drone: x.drone && typeof x.drone === "object" ? { needed: x.drone.needed === true, notes: safeText(x.drone.notes) } : null,
  };
}

/** A photo_shoots row -> the shoot as the page shows it. */
export function toShoot(r) {
  const x = r || {};
  return {
    id: numOr(x.id, null), planId: numOr(x.plan_id, null), key: str(x.key), seq: numOr(x.seq, 0), phase: str(x.phase),
    name: safeText(x.name) || prettyKey(x.key), anchor: str(x.anchor), offsetDays: numOr(x.offset_days, 0),
    fixedDate: dayOr(x.fixed_date), plannedDate: dayOr(x.planned_date), windowDays: numOr(x.window_days, 0),
    status: str(x.status), autoSkipped: x.auto_skipped === true, pinDay: dayOr(x.pin_day), series: x.series ? str(x.series) : null,
    n: numOr(x.n, 0), announcedFor: dayOr(x.announced_for), doneAt: x.done_at || null, doneSource: safeText(x.done_source),
    doneNote: safeText(x.done_note), taskId: numOr(x.task_id, null), brief: toBrief(x.brief), history: toHistory(x.history),
    rev: numOr(x.rev, null),
  };
}

/** A photo_changes row -> the change as the page shows it (state: "new" older than 7 days reads as expired). */
export function toChange(r, now) {
  const x = r || {};
  const c = {
    id: numOr(x.id, null), planId: numOr(x.plan_id, null), kind: str(x.kind), args: x.args && typeof x.args === "object" ? x.args : {},
    targetKey: x.target_key ? str(x.target_key) : null, baseRev: numOr(x.base_rev, null),
    preview: x.preview && typeof x.preview === "object" ? x.preview : null, needsOffice: x.needs_office === true,
    status: str(x.status), requestedBy: x.requested_by || null, requestedAt: x.requested_at || null,
    requesterAdmin: x.requester_admin === true, takenAt: x.taken_at || null, doneAt: x.done_at || null,
    result: x.result && typeof x.result === "object" ? x.result : null, error: x.error && typeof x.error === "object" ? x.error : null,
    undoOf: numOr(x.undo_of, null), undoneBy: numOr(x.undone_by, null),
  };
  c.state = changeState(c, now);
  return c;
}

/** photo_my_access()'s answer -> {admin, photographer, marketing, defaultPhotographer, canEdit, canRead, ready}. A database
    without the photo schedule yet (null): nobody reads or edits it. */
export function toAccess(raw) {
  const x = raw && typeof raw === "object" ? raw : null;
  if (!x) return { admin: false, photographer: false, marketing: false, defaultPhotographer: false, canEdit: false, canRead: false, ready: false };
  return { admin: x.admin === true, photographer: x.photographer === true, marketing: x.marketing === true,
    defaultPhotographer: x.default_photographer === true, canEdit: x.can_edit === true, canRead: x.can_read === true, ready: true };
}

/** photo_pc_status()'s answer -> {lastSeen, minutesAgo, online, paused, mirroredAt} (null: not readable). */
export function toPcStatus(raw) {
  const x = raw && typeof raw === "object" ? raw : null;
  if (!x) return null;
  return { lastSeen: x.lastSeen || null, minutesAgo: numOr(x.minutesAgo, null), online: x.online === true, paused: x.paused === true,
    mirroredAt: x.mirroredAt || null };
}

/** A photo_team row (+ the person's name from profiles) -> the team member. */
export function toTeamMember(r) {
  const x = r || {};
  const p = x.profile && typeof x.profile === "object" ? x.profile : {};
  return { profileId: x.profile_id || null, name: safeText(p.full_name || x.name), role: p.role || x.role || null,
    active: p.active === undefined ? (x.active === undefined ? true : x.active !== false) : p.active !== false,
    photographer: x.photographer === true, marketing: x.marketing === true, defaultPhotographer: x.default_photographer === true,
    googleEmail: x.google_email ? str(x.google_email) : null, version: numOr(x.version, null), updatedAt: x.updated_at || null };
}

/** "progress-2" -> "Progress 2" */
export function prettyKey(k) {
  const s = str(k).replace(/[-_]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}

/* ── a shoot ──────────────────────────────────────────────────────────── */

export function isOpen(s) { return !!s && OPEN.indexOf(s.status) !== -1; }

/** Late: open, dated, and the company day is past its planned day plus its grace (window_days) - §4.2. */
export function isLate(s, today) {
  if (!isOpen(s) || !isDay(s.plannedDate) || !isDay(today)) return false;
  return today > addDays(s.plannedDate, numOr(s.windowDays, 0));
}

/** How many days past its grace a late shoot is (0 when it is not late). */
export function lateDays(s, today) {
  return isLate(s, today) ? daysBetween(addDays(s.plannedDate, numOr(s.windowDays, 0)), today) : 0;
}

/** "Moved - not told yet": the heads-up was sent for another day than the one planned now. */
export function movedNotTold(s) {
  return !!s && s.status === "announced" && isDay(s.announcedFor) && s.announcedFor !== s.plannedDate;
}

/** Whether the shoot follows a milestone (and which), or has a day of its own. */
export function followsMilestone(s) {
  return !!s && MILESTONES.indexOf(s.anchor) !== -1 && !s.fixedDate;
}

/** "2 days after Framing start", "on Delivery", "3 days before Framing complete", "on a fixed day". */
export function anchorText(s, plan) {
  if (!s) return "";
  const ms = MILESTONES.indexOf(s.anchor) !== -1 ? s.anchor : null;
  if (!ms) return "on a fixed day";
  const label = MILESTONE_LABEL[ms];
  if (s.fixedDate) return "on a fixed day (it stopped following " + label + ")";
  const n = numOr(s.offsetDays, 0);
  let t = n === 0 ? "on " + label : plural(Math.abs(n), "day") + (n > 0 ? " after " : " before ") + label;
  const m = plan && plan.milestones ? plan.milestones[ms] : null;
  if (m && !m.date) t += " (" + label + " has no date yet)";
  return t;
}

/** A plan's shoots in its own order: (planned day, no date last; seq; key). */
export function shootOrder(a, b) {
  const da = a.plannedDate, db = b.plannedDate;
  if (da !== db) {
    if (!da) return 1;
    if (!db) return -1;
    return da < db ? -1 : 1;
  }
  if (numOr(a.seq, 0) !== numOr(b.seq, 0)) return numOr(a.seq, 0) - numOr(b.seq, 0);
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** The shoots of one plan, in order. */
export function planShoots(plan, shoots) {
  const id = plan && plan.id;
  return (shoots || []).filter((s) => s.planId === id).slice().sort(shootOrder);
}

/** The plans in the order the page lists them: the next open shoot first (plans with none last), then by label. */
export function plansInOrder(plans, shoots, today) {
  const next = {};
  for (const s of shoots || []) {
    if (!isOpen(s) || !s.plannedDate) continue;
    if (!next[s.planId] || s.plannedDate < next[s.planId]) next[s.planId] = s.plannedDate;
  }
  return (plans || []).slice().sort((a, b) => {
    const x = next[a.id] || "9999-99-99", y = next[b.id] || "9999-99-99";
    if (x !== y) return x < y ? -1 : 1;
    return a.label < b.label ? -1 : a.label > b.label ? 1 : numOr(a.id, 0) - numOr(b.id, 0);
  });
}

/** The plans one may see in a list: archived ones only when asked; "mine" = the plan's photographer is me. */
export function visiblePlans(plans, o) {
  const opt = o || {};
  return (plans || []).filter((p) => (opt.archived || p.status !== "archived") && (!opt.mine || p.photographerProfileId === opt.mine) &&
    (opt.planId === undefined || opt.planId === null || p.id === Number(opt.planId)));
}

/* ── the Agenda and the Month grid ────────────────────────────────────── */

/** The first day of the week `d` is in (weekStart: 0 = Sunday, 1 = Monday ...). */
export function weekStartOf(d, weekStart) {
  const ws = numOr(weekStart, 0);
  return addDays(d, -((dayOfWeek(d) - ws + 7) % 7));
}

/** Which Agenda group a shoot is in on `today`. */
export function groupOf(s, today, o) {
  if (!isOpen(s)) return "closed";
  if (!isDay(s.plannedDate)) return "undated";
  if (isLate(s, today)) return "late";
  if (s.plannedDate <= today) return "today";            // today, or an earlier day still within its grace
  const ws = weekStartOf(today, o && o.weekStart);
  if (s.plannedDate < addDays(ws, 7)) return "this_week";
  if (s.plannedDate < addDays(ws, 14)) return "next_week";
  return "later";
}

function byPlanLabel(plans) {
  const m = {};
  for (const p of plans || []) m[p.id] = p;
  return m;
}

/** agenda(plans, shoots, today, o) -> {groups: [{key, label, folded, count, entries: [{shoot, plan, chips}]}], empty}.
    o: {weekStart (0 = Sunday), mine (a profile id: my plans only), planId, archived, changes (for the waiting chips)}.
    Done & closed is folded. Every group is there (empty ones with count 0), in GROUPS' order. */
export function agenda(plans, shoots, today, o) {
  const opt = o || {};
  const seen = byPlanLabel(visiblePlans(plans, opt));
  const groups = {};
  for (const [k] of GROUPS) groups[k] = [];
  for (const s of shoots || []) {
    const plan = seen[s.planId];
    if (!plan) continue;
    const g = groupOf(s, today, opt);
    groups[g].push({ shoot: s, plan, chips: shootChips(s, plan, today, { pending: pendingFor(opt.changes, s), now: opt.now }) });
  }
  const label = (e) => e.plan.label;
  const datedAsc = (a, b) => (a.shoot.plannedDate < b.shoot.plannedDate ? -1 : a.shoot.plannedDate > b.shoot.plannedDate ? 1 : 0) ||
    (label(a) < label(b) ? -1 : label(a) > label(b) ? 1 : 0) || shootOrder(a.shoot, b.shoot);
  for (const k of ["late", "today", "this_week", "next_week", "later"]) groups[k].sort(datedAsc);
  groups.undated.sort((a, b) => (label(a) < label(b) ? -1 : label(a) > label(b) ? 1 : 0) || shootOrder(a.shoot, b.shoot));
  const closedDay = (e) => (e.shoot.doneAt ? String(e.shoot.doneAt).slice(0, 10) : e.shoot.plannedDate || "");
  groups.closed.sort((a, b) => (closedDay(a) > closedDay(b) ? -1 : closedDay(a) < closedDay(b) ? 1 : 0) || shootOrder(a.shoot, b.shoot));
  const out = GROUPS.map(([key, text]) => ({ key, label: text, folded: key === "closed", count: groups[key].length, entries: groups[key] }));
  return { groups: out, empty: out.every((g) => g.count === 0) };
}

/** monthGrid("2026-11", plans, shoots, today, o) -> {month, label, prev, next, weekdays, weeks: [[{day, inMonth, isToday,
    isPast, entries: [{shoot, plan, late, closed}]}]], undated}. Weeks start on o.weekStart (0 = Sunday). */
export function monthGrid(month, plans, shoots, today, o) {
  const opt = o || {};
  const m = /^(\d{4})-(\d{2})$/.test(str(month)) ? str(month) : (isDay(today) ? today.slice(0, 7) : "1970-01");
  const first = m + "-01";
  const y = +m.slice(0, 4), mo = +m.slice(5, 7);
  const nextFirst = mo === 12 ? (y + 1) + "-01-01" : y + "-" + String(mo + 1).padStart(2, "0") + "-01";
  const prevMonth = mo === 1 ? (y - 1) + "-12" : y + "-" + String(mo - 1).padStart(2, "0");
  const ws = numOr(opt.weekStart, 0);
  const seen = byPlanLabel(visiblePlans(plans, opt));
  const byDay = {};
  const undated = [];
  for (const s of shoots || []) {
    const plan = seen[s.planId];
    if (!plan) continue;
    if (!s.plannedDate) { if (isOpen(s)) undated.push({ shoot: s, plan }); continue; }
    (byDay[s.plannedDate] = byDay[s.plannedDate] || []).push({ shoot: s, plan, late: isLate(s, today), closed: !isOpen(s) });
  }
  const weeks = [];
  let d = weekStartOf(first, ws);
  while (d < nextFirst) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      const entries = (byDay[d] || []).slice().sort((a, b) => (a.plan.label < b.plan.label ? -1 : a.plan.label > b.plan.label ? 1 : 0) || shootOrder(a.shoot, b.shoot));
      week.push({ day: d, date: Number(d.slice(8, 10)), inMonth: d.slice(0, 7) === m, isToday: d === today, isPast: isDay(today) && d < today, entries });
      d = addDays(d, 1);
    }
    weeks.push(week);
  }
  const weekdays = [];
  for (let i = 0; i < 7; i++) weekdays.push(WD_SHORT[(ws + i) % 7]);
  undated.sort((a, b) => (a.plan.label < b.plan.label ? -1 : a.plan.label > b.plan.label ? 1 : 0) || shootOrder(a.shoot, b.shoot));
  return { month: m, label: MON_LONG[mo - 1] + " " + y, prev: prevMonth, next: nextFirst.slice(0, 7), weekdays, weeks, undated };
}

/* ── chips ────────────────────────────────────────────────────────────── */

/** The chips of one shoot: status, Late (or its grace), Moved - not told yet, the Firm job date it follows, a change
    waiting (o.pending: the open change of this shoot, pendingFor), a day picked by hand. Each {key, text, cls}. */
export function shootChips(s, plan, today, o) {
  const opt = o || {};
  const out = [];
  if (!s) return out;
  const st = s.status === "skipped" && s.autoSkipped ? "Skipped - its day had passed" : STATUS_LABEL[s.status] || prettyKey(s.status);
  out.push({ key: "status", text: st, cls: s.status || "planned" });
  if (isLate(s, today)) {
    const n = lateDays(s, today);
    out.push({ key: "late", text: "Late" + (n ? " - " + plural(n, "day") : ""), cls: "late" });
  } else if (isOpen(s) && isDay(s.plannedDate) && isDay(today) && s.plannedDate < today) {
    out.push({ key: "grace", text: "Due - grace until " + dayText(addDays(s.plannedDate, numOr(s.windowDays, 0)), today), cls: "due" });
  } else if (isOpen(s) && s.plannedDate === today) {
    out.push({ key: "today", text: "Today", cls: "due" });
  }
  if (movedNotTold(s)) out.push({ key: "not_told", text: "Moved - not told yet", cls: "warn" });
  const m = plan && plan.milestones && followsMilestone(s) ? plan.milestones[s.anchor] : null;
  if (m && m.firm) out.push({ key: "firm", text: m.label + " is Firm", cls: "firm" });
  if (opt.pending) out.push({ key: "pending", text: pendingText(opt.pending), cls: "pending" });
  if (isOpen(s) && s.pinDay && s.pinDay === s.plannedDate) out.push({ key: "pinned", text: "Day picked by hand", cls: "dim" });
  return out;
}

/** A plan's four job dates as chips: {key, label, date, dateText, firm, text}. */
export function milestoneChips(plan, today) {
  const ms = plan && plan.milestones ? plan.milestones : {};
  return MILESTONES.map((k) => {
    const m = ms[k] || { key: k, label: MILESTONE_LABEL[k], date: null, firm: false };
    const dt = m.date ? dayText(m.date, today) : "";
    return { key: k, label: MILESTONE_LABEL[k], date: m.date || null, dateText: dt, firm: !!m.firm,
      text: MILESTONE_LABEL[k] + (dt ? " " + dt : ": no date yet") + (m.firm ? " · Firm" : m.date ? " · estimate" : "") };
  });
}

/* ── changes ──────────────────────────────────────────────────────────── */

/** A change's status now: a new change older than 7 days is expired even before the PC writes it (§8.4). */
export function changeState(c, now) {
  if (!c) return "";
  const at = Date.parse(c.requestedAt || "");
  const t = now instanceof Date ? now.getTime() : Number.isFinite(Number(now)) && now !== null && now !== undefined ? Number(now) : Date.now();
  if (c.status === "new" && (!Number.isFinite(at) || at <= t - EXPIRE_DAYS * 86400000)) return "expired";
  return c.status;
}

export function isOpenChange(c, now) {
  const st = c && (c.state || changeState(c, now));
  return st === "new" || st === "taken";
}

/** The open change of a shoot (the same shoot, or a job-date change of the date it follows), or null. */
export function pendingFor(changes, s) {
  if (!s || !Array.isArray(changes)) return null;
  return changes.find((c) => c && c.planId === s.planId && isOpenChange(c) &&
    (c.targetKey === s.key || (c.kind === "milestone" && followsMilestone(s) && c.args && c.args.milestone === s.anchor))) || null;
}

function pendingText(c) {
  if (c.needsOffice) return "Waiting for the office to approve";
  return (c.state || c.status) === "taken" ? "Being applied by the office computer" : "Change waiting for the office computer";
}

/** What a change asked for, in words: "Move Delivery day to Mon Nov 16 - only this shoot". ctx: {shoots, plan, today}. */
export function changeTitle(c, ctx) {
  const x = ctx || {};
  const a = c && c.args ? c.args : {};
  const shoot = findShoot(x.shoots, a.shoot || (c && c.targetKey));
  const name = shoot ? shoot.name : prettyKey(a.shoot || (c && c.targetKey)) || "a shoot";
  switch (c && c.kind) {
    case "move_one": return "Move " + name + " to " + dayText(a.to, x.today) + " - only this shoot";
    case "move_later": return "Move " + name + " to " + dayText(a.to, x.today) + " - and the later ones";
    case "milestone": {
      const label = MILESTONE_LABEL[a.milestone] || (shoot && MILESTONE_LABEL[shoot.anchor]) || "The job date";
      const date = a.date || (shoot && a.to ? addDays(a.to, -numOr(shoot.offsetDays, 0)) : null);
      return label + " moved to " + (date ? dayText(date, x.today) : "a new day");
    }
    case "done": return "Mark " + name + " done";
    case "undo": return "Undo change #" + numOr(a.change, "");
    default: return prettyKey(c && c.kind) || "A change";
  }
}

/** {state, text, cls, words} for a change (o: {now, pc: the office computer's status}). words: the PC's own answer, masked. */
export function changeStatusText(c, o) {
  const opt = o || {};
  const st = c ? c.state || changeState(c, opt.now) : "";
  const words = c && c.result && c.result.words ? safeText(c.result.words) : "";
  switch (st) {
    case "new": {
      const pc = opt.pc ? pcLine(opt.pc) : null;
      if (c.needsOffice) return { state: st, text: "Waiting for the office computer - then the office approves", cls: "pending", words: "" };
      return { state: st, text: pc && pc.state !== "on" ? pc.text : "Waiting for the office computer", cls: "pending", words: "" };
    }
    case "taken": return { state: st, text: "The office computer is applying it", cls: "pending", words: "" };
    case "applied": {
      if (c.result && c.result.outcome === "suggested") return { state: st, text: "Sent to the office to approve", cls: "office", words };
      const differs = c.result && c.result.differs_from_preview === true;
      return { state: st, text: "Applied" + (differs ? " - it came out a little differently from the preview" : ""), cls: "ok", words };
    }
    case "refused": {
      const code = c.error && c.error.code;
      return { state: st, text: "Not done: " + refusalText(code, { where: "pc", message: c.error && c.error.message, milestone: c.args && c.args.milestone }),
        cls: "refused", words: "" };
    }
    case "expired": return { state: st, text: "Expired - the office computer did not take it within 7 days", cls: "dim", words: "" };
    case "cancelled": return { state: st, text: "Cancelled", cls: "dim", words: "" };
    default: return { state: st, text: prettyKey(st), cls: "", words: "" };
  }
}

const REFUSAL = {
  // the people's RPCs (photo_change_preview / _request / _cancel; §6.1, §8.6)
  forbidden: "Only an admin or a photographer can change the shoot schedule.",
  bad_key: "The change could not be sent as it was. Try again.",
  key_reused: "That change was sent as another one before. Try again.",
  no_plan: "That plan is not on the shoot schedule any more.",
  plan_not_active: "Only an active or paused plan's shoots can change.",
  bad_kind: "That is not a change the shoot schedule knows.",
  bad_args: "The change's details are not right.",
  bad_rev: "The schedule changed since this page read it - look again.",
  rate: "That is a lot of changes in a short time - wait a moment and try again.",
  too_many: "You have 20 changes waiting for the office computer - wait for them first.",
  no_shoot: "That shoot is not in the plan any more.",
  unknown_shoot: "That shoot is not in the plan any more.",
  changed: "The schedule changed meanwhile - look again.",
  pending: "A change of that shoot is already waiting for the office computer.",
  no_original: "That change is not in this plan.",
  not_undoable: "That change cannot be undone any more.",
  past: "That day has passed.",
  too_far: "That day is more than a year away.",
  no_change: "It is already on that day.",
  not_open: "That shoot is done, skipped or missed.",
  undated: "That shoot has no date to move from yet.",
  not_anchored: "That shoot has a day of its own - it follows no job date.",
  bad_milestone: "That is not one of the job dates.",
  firm: "That job date is Firm - only the office can set it back (move it instead and the office is asked).",
  too_big: "That change moves too many shoots at once.",
  no_request: "There is no such change.",
  // set_photo_team (§3.1, §6.1)
  agents: "The DCR Agents 2 account is not a person on the photo team.",
  inactive: "A turned-off person cannot be added to the photo team.",
  no_person: "There is no such person.",
  bad_email: "That is not an e-mail address.",
  default_needs_photographer: "The default photographer must be a photographer.",
  pick_default_first: "Pick another default photographer first.",
  // the PC's answers (agents_photo_change_error, §8.5) and the rows the database writes itself
  gone: "That shoot or plan is no longer in the plan.",
  not_active: "The plan is in review, done or archived.",
  failed: "The office computer could not make that change.",
  expired: "The office computer did not take it within 7 days.",
  cancelled: "It was cancelled before the office computer took it.",
  offline: "No connection - the change was not sent. Try again when you have signal.",
};
export const REFUSAL_CODES = Object.freeze(Object.keys(REFUSAL));

/** The words of a refusal code. ctx: {where: "request" | "team" | "pc", milestone (a job date key), retryAfter (seconds),
    message (the database's or the PC's own sentence, used for a code this page does not know)}. */
export function refusalText(code, ctx) {
  const x = ctx || {};
  const k = str(code);
  const ms = MILESTONE_LABEL[x.milestone] || null;
  if (k === "changed" && x.where === "team") return "Someone changed the photo team meanwhile - look again.";
  if (k === "changed" && x.where === "pc") return "The shoot changed meanwhile - look again.";
  if (k === "forbidden" && x.where === "team") return "Only an admin can change the photo team.";
  if (k === "forbidden" && x.where === "pc") return "The person who asked lost the right to change the schedule meanwhile.";
  if (k === "forbidden" && x.where === "cancel") return "Only the person who asked, or an admin, can cancel a change.";
  if (k === "forbidden" && x.where === "undo") return "Only the person who made a change, or an admin, can undo it.";
  if (k === "firm" && ms) return ms + " is Firm - only the office can set it back (move it instead and the office is asked).";
  if (k === "too_far" && x.milestone) return "That job date is more than a year away or more than 60 days back.";
  if (k === "rate" && Number(x.retryAfter) > 0) {
    const min = Math.max(1, Math.ceil(Number(x.retryAfter) / 60));
    return "That is a lot of changes in a short time - try again in " + plural(min, "minute") + ".";
  }
  if (REFUSAL[k]) return REFUSAL[k];
  const own = safeText(x.message).trim();
  if (own) return /[.!?]$/.test(own) ? own : own + ".";
  return "The shoot schedule cannot make that change.";
}

/* ── the Move sheet ───────────────────────────────────────────────────── */

/** The three choices the Move sheet always asks (owner 2026-11-09, decision 2): "Only this shoot" preselected, "This shoot
    and the later ones" (the same number of days; not for a shoot with no date), "The job date moved" with the job date to
    pick (framing start, delivery, framing complete, house complete; the one the shoot follows first). */
export function moveChoices(s, plan) {
  const anchored = followsMilestone(s) ? s.anchor : null;
  const ms = plan && plan.milestones ? plan.milestones : {};
  const order = anchored ? [anchored].concat(MILESTONES.filter((k) => k !== anchored)) : MILESTONES.slice();
  return [
    { kind: "move_one", label: "Only this shoot", preselected: true, ok: isOpen(s), why: isOpen(s) ? "" : refusalText("not_open") },
    { kind: "move_later", label: "This shoot and the later ones", hint: "the later shoots move by the same number of days",
      ok: isOpen(s) && !!s.plannedDate, why: !isOpen(s) ? refusalText("not_open") : !s.plannedDate ? refusalText("undated") : "" },
    { kind: "milestone", label: "The job date moved", hint: "pick which job date", ok: true, why: "",
      milestones: order.map((k) => ({ key: k, label: MILESTONE_LABEL[k], date: ms[k] ? ms[k].date : null, firm: !!(ms[k] && ms[k].firm),
        followed: k === anchored })) },
  ];
}

/** The RPC's kind and args for what the sheet picked: {kind, shoot (key), to, milestone, date, reason, firm}. A job date
    the shoot itself follows, given as the shoot's new day (to without date), goes as {shoot, to} - the database works the
    job date out; otherwise {milestone, date}. firm is sent only when given (the database keeps an admin's only). */
export function moveArgs(pick) {
  const p = pick || {};
  const reason = str(p.reason).replace(/\s+/g, " ").trim().slice(0, REASON_MAX);
  const add = (args) => {
    if (reason) args.reason = reason;
    return args;
  };
  if (p.kind === "move_one" || p.kind === "move_later") return { kind: p.kind, args: add({ shoot: str(p.shoot), to: str(p.to) }) };
  if (p.kind === "milestone") {
    const args = p.milestone && isDay(p.date) ? { milestone: str(p.milestone), date: p.date } : { shoot: str(p.shoot), to: str(p.to) };
    if (typeof p.firm === "boolean") args.firm = p.firm;
    return { kind: "milestone", args: add(args) };
  }
  if (p.kind === "done") {
    const note = str(p.note).replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
    return { kind: "done", args: note ? { shoot: str(p.shoot), note } : { shoot: str(p.shoot) } };
  }
  if (p.kind === "undo") return { kind: "undo", args: { change: numOr(p.change, null) } };
  return { kind: str(p.kind), args: {} };
}

function findShoot(shoots, key) {
  if (!shoots || !key) return null;
  if (Array.isArray(shoots)) return shoots.find((s) => s && s.key === key) || null;
  return shoots[key] || null;
}

/** previewWords(preview, ctx) -> the Move sheet's list, in words, from photo_change_preview's answer (§6.3, §7.4):
    {kind, ok, refused: {code, text} | null, moved: [{key, id, name, from, to, text, notes: [{code, text}]}], stays: [{key,
    id, name, reason, text}], passed: [{key, id, name, from, to, text}], replan: [{key, text}], office: text | null, done,
    summary, unknown: [codes this page has no words for]}. ctx: {plan (toPlan), shoots (toShoot list or map by key), today}.
    Nothing is computed: every list, date and code is the database's. */
export function previewWords(pv, ctx) {
  const x = ctx || {};
  const p = pv && typeof pv === "object" ? pv : {};
  const today = isDay(x.today) ? x.today : dayOr(p.today);
  const plan = x.plan || null;
  const args = p.args && typeof p.args === "object" ? p.args : {};
  const unknown = [];
  const nameOf = (it) => safeText(it.name) || (findShoot(x.shoots, it.key) || {}).name || prettyKey(it.key);
  const dt = (d) => (isDay(d) ? dayText(d, today) : "no date");
  const target = (p.moved || []).find((m) => m && m.key === args.shoot) || null;
  const delta = target && isDay(target.from) && isDay(target.to) ? daysBetween(target.from, target.to) : null;
  const msKey = args.milestone || (findShoot(x.shoots, args.shoot) || {}).anchor || null;
  const msLabel = MILESTONE_LABEL[msKey] || "the job date";

  function rawDay(it) {
    // the day before rolling to a shoot day, from the database's own answer: the target's move (move_later) or the new job
    // date plus the shoot's offset (milestone) - null when the answer does not say
    if (p.kind === "move_later" && delta !== null && isDay(it.from)) return addDays(it.from, delta);
    if (p.kind === "milestone" && isDay(args.date)) {
      const s = findShoot(x.shoots, it.key);
      if (s) return addDays(args.date, numOr(s.offsetDays, 0));
    }
    return null;
  }
  function note(code, it) {
    switch (code) {
      case "not_shoot_day": return weekdayName(it.to) + " is not a shoot day - kept on the day you picked";
      case "stops_following": {
        const s = findShoot(x.shoots, it.key);
        return "Gets its own day - it stops following " + (MILESTONE_LABEL[s && s.anchor] || "its job date");
      }
      case "gets_date": return "Gets its first date";
      case "comes_back": return "Planned again - it was skipped because its day had passed";
      case "rolled": {
        const raw = rawDay(it);
        return raw && isDay(it.to) ? weekdayShort(raw) + " → " + weekdayShort(it.to) + ": not a shoot day" : "Moved on to the next shoot day";
      }
      case "heads_up_sent": return "Heads-up already sent - the task on My Tasks will update";
      default: unknown.push(code); return prettyKey(code);
    }
  }
  function stay(reason, it) {
    switch (reason) {
      case "done": return "Done - stays";
      case "skipped": return "Skipped - stays";
      case "missed": return "Missed - stays";
      case "undated": {
        const s = findShoot(x.shoots, it.key);
        return "No date yet - waits for " + (MILESTONE_LABEL[s && s.anchor] || "its job date");
      }
      case "fixed": return "Set to its own day - stays";
      case "same_day": {
        const s = findShoot(x.shoots, it.key);
        return s && s.plannedDate ? "Stays on " + dayText(s.plannedDate, today) + " (the nearest shoot day)" : "Stays on its day (the nearest shoot day)";
      }
      default: unknown.push(reason); return prettyKey(reason) + " - stays";
    }
  }

  const moved = (Array.isArray(p.moved) ? p.moved : []).map((it) => {
    const notes = (Array.isArray(it.notes) ? it.notes : []).slice().sort((a, b) => NOTE_ORDER.indexOf(a) - NOTE_ORDER.indexOf(b))
      .map((code) => ({ code, text: note(code, it) }));
    const name = nameOf(it);
    return { key: it.key, id: numOr(it.id, null), name, from: dayOr(it.from), to: dayOr(it.to), fromText: dt(it.from), toText: dt(it.to),
      text: name + ": " + dt(it.from) + " → " + dt(it.to), notes };
  });
  const stays = (Array.isArray(p.stays) ? p.stays : []).map((it) => {
    const name = nameOf(it);
    return { key: it.key, id: numOr(it.id, null), name, reason: it.reason, text: name + ": " + stay(it.reason, it) };
  });
  const passed = (Array.isArray(p.passed) ? p.passed : []).map((it) => {
    const name = nameOf(it);
    return { key: it.key, id: numOr(it.id, null), name, from: dayOr(it.from), to: dayOr(it.to),
      text: name + ": will be skipped - its day (" + dt(it.to) + ") would be behind us" };
  });
  const seriesName = (k) => {
    const s = plan && Array.isArray(plan.series) ? plan.series.find((y) => y.key === k) : null;
    return s ? s.name : prettyKey(k) || "Series";
  };
  const replan = (Array.isArray(p.replan) ? p.replan : []).map((k) => ({ key: k,
    text: seriesName(k) + " visits will be re-planned - some may be added or cancelled" }));
  const office = p.needs_office === true ? msLabel[0].toUpperCase() + msLabel.slice(1) + " is Firm - the office will be asked to approve" : null;
  const refused = p.refused ? { code: str(p.refused), text: refusalText(p.refused, { milestone: p.kind === "milestone" ? msKey : null, where: p.kind === "undo" ? "undo" : "request" }) } : null;
  if (refused && !REFUSAL[refused.code]) unknown.push(refused.code);
  const done = p.done && typeof p.done === "object" ? { key: p.done.key, id: numOr(p.done.id, null), name: nameOf(p.done),
    text: nameOf(p.done) + " will be marked done" } : null;
  const parts = [];
  if (moved.length) parts.push(plural(moved.length, "shoot") + " move" + (moved.length === 1 ? "s" : ""));
  if (stays.length) parts.push(stays.length + " stay" + (stays.length === 1 ? "s" : ""));
  if (passed.length) parts.push(passed.length + " will be skipped");
  if (replan.length) parts.push(plural(replan.length, "series", "series") + " re-planned");
  let summary = refused ? refused.text : parts.join(", ") || (done ? done.text : "Nothing moves");
  if (office && !refused) summary += " - the office approves first";
  return { kind: p.kind || null, ok: !refused, refused, moved, stays, passed, replan, office, done, summary, unknown };
}

/* ── who may act ──────────────────────────────────────────────────────── */

const ACTIVE_PLAN = ["active", "paused"];

/** What one person may do with one shoot: {move: {ok, why}, done: {ok, why}} (access: toAccess; o.pending: its open
    change). The database decides; these are the page's hints (§3.2). */
export function shootActions(s, plan, access, o) {
  const a = access || {};
  const opt = o || {};
  const no = (why) => ({ ok: false, why });
  let why = "";
  if (!a.canEdit) why = a.marketing ? "Marketing reads the shoot schedule only." : REFUSAL.forbidden;
  else if (!plan || ACTIVE_PLAN.indexOf(plan.status) === -1) why = REFUSAL.plan_not_active;
  else if (!isOpen(s)) why = s && s.status === "done" ? "A shoot that is done is not moved." : REFUSAL.not_open;
  else if (opt.pending) why = REFUSAL.pending;
  return why ? { move: no(why), done: no(why) } : { move: { ok: true, why: "" }, done: { ok: true, why: "" } };
}

/** Whether `me` may undo this change now: an applied move or job date (outcome applied, never a suggestion, never "done"),
    not undone yet, finished within 7 days, asked by me (still a photographer) or I am an admin. -> {ok, why} */
export function canUndo(c, me, access, now) {
  const a = access || {};
  const no = (why) => ({ ok: false, why });
  if (!c) return no("");
  if (c.kind === "done") return no("A shoot marked done is not undone here.");
  if (c.kind === "undo") return no("An undo is not undone - move the shoot instead.");
  if (MOVE_KINDS.indexOf(c.kind) === -1) return no(REFUSAL.not_undoable);
  if ((c.state || c.status) !== "applied" || !c.result || c.result.outcome !== "applied") {
    return no(c.result && c.result.outcome === "suggested" ? "It went to the office - it is not undone here." : "Only an applied change is undone.");
  }
  if (c.undoneBy) return no("It was undone already.");
  const t = now instanceof Date ? now.getTime() : Number.isFinite(Number(now)) && now !== null && now !== undefined ? Number(now) : Date.now();
  const done = Date.parse(c.doneAt || "");
  if (!Number.isFinite(done) || done < t - UNDO_DAYS * 86400000) return no("A change is undone within 7 days only.");
  if (!a.canEdit) return no(a.marketing ? "Marketing reads the shoot schedule only." : REFUSAL.forbidden);
  if (!a.admin && (!me || c.requestedBy !== me)) return no("Only the person who made a change, or an admin, can undo it.");
  return { ok: true, why: "" };
}

/** Whether `me` may cancel this change: still new (not taken, not expired), asked by me (still a photographer) or I am an
    admin. -> {ok, why} */
export function canCancel(c, me, access, now) {
  const a = access || {};
  if (!c) return { ok: false, why: "" };
  const st = c.state || changeState(c, now);
  if (st !== "new") return { ok: false, why: st === "taken" ? "The office computer is applying it already." : "" };
  if (a.admin) return { ok: true, why: "" };
  if (a.canEdit && me && c.requestedBy === me) return { ok: true, why: "" };
  return { ok: false, why: "Only the person who asked, or an admin, can cancel a change." };
}

/* ── the team ─────────────────────────────────────────────────────────── */

const WS = "\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff";
const EDGE_WS = new RegExp("^[" + WS + "]+|[" + WS + "]+$", "g");
const INSIDE_BAD = new RegExp("[" + WS + "\\u0001-\\u001f\\u007f]");

/** The Google e-mail as the database keeps it (trimmed of white space of every kind, lower case) and what is wrong
    with it: {value, problem}. value null = none. The database checks again (22023 bad_email). */
export function googleEmailProblem(v) {
  const s = str(v).replace(EDGE_WS, "").toLowerCase();
  if (!s) return { value: null, problem: "" };
  if (s.length > EMAIL_MAX || !/^.+@.+$/.test(s) || INSIDE_BAD.test(s)) return { value: s, problem: REFUSAL.bad_email };
  return { value: s, problem: "" };
}

/** {photographers, marketing, defaultId, problems} of the team list (toTeamMember rows). */
export function teamSummary(list) {
  const rows = Array.isArray(list) ? list : [];
  const ph = rows.filter((m) => m.photographer);
  const mk = rows.filter((m) => m.marketing);
  const def = ph.filter((m) => m.defaultPhotographer);
  const problems = [];
  if (ph.length && def.length !== 1) problems.push("Pick one default photographer.");
  for (const m of mk) if (!m.googleEmail) problems.push((m.name || "A marketing member") + " has no Google e-mail yet.");
  for (const m of rows) if (m.active === false) problems.push((m.name || "Someone") + " is turned off but still on the list.");
  return { photographers: ph.length, marketing: mk.length, defaultId: def.length ? def[0].profileId : null, problems };
}

/* ── the office computer (the DCR server) ─────────────────────────────── */

/** "just now", "5 min ago", "2 h ago", "3 days ago" */
export function agoText(minutes) {
  const m = numOr(minutes, null);
  if (m === null) return "";
  if (m < 1) return "just now";
  if (m < 60) return m + " min ago";
  if (m < 48 * 60) return Math.floor(m / 60) + " h ago";
  return plural(Math.floor(m / 1440), "day") + " ago";
}

/** The office computer's line (DCR Agents 2, the lease holder): {state: on | paused | off | unknown, text, cls}. */
export function pcLine(st) {
  if (!st) return { state: "unknown", text: "", cls: "" };
  if (st.online && st.paused) return { state: "paused", text: "DCR Agents 2 is paused on the office computer - changes wait until it runs again", cls: "warn" };
  if (st.online) return { state: "on", text: "The office computer is on - a change is applied in a minute or two", cls: "ok" };
  if (st.lastSeen === null || st.lastSeen === undefined || st.minutesAgo === null || st.minutesAgo === undefined) {
    return { state: "off", text: "The office computer has not been seen yet - changes wait until it is on", cls: "warn" };
  }
  return { state: "off", text: "The office computer is off - changes wait until it is back on (last seen " + agoText(st.minutesAgo) + (st.paused ? ", paused" : "") + ")", cls: "warn" };
}
