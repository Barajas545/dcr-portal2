/* Tasks, notes and the update clock (BLUEPRINT 3.3.7, migration M3): Desktop 2 rows <-> what My Tasks,
   the tasks map and the project's Tasks tab draw. A port of the old portal's lib/task-notes.js
   decorateTask, lib/photo-agent.js and lib/recurring-agent.js readers and the pure parts of
   my-tasks.js / tasks-map.html, over the new data:

   * the clock is the database's (app.task_clock, through rpc my_tasks): last_update,
     last_update_source, days_since_update (Pacific days), last_note, needs_update (more than 5 days,
     a photo task never before its shoot day is over). clockOf() is the same rule in JavaScript, for
     rows read straight from the tables (the project's Tasks tab, a task opened from a link);
   * notes are task_notes rows (no more "[Mon Oct 05, 2026] --- …" stamps); `via` says how a note
     came (a text, an e-mail, the assistant, the import …) and `on_behalf_of` whose words an agent filed;
   * a Photo & Video shoot and a Recurring Tasks task are tasks.agent_kind 'photo' | 'recurring' with
     agent_ref and agent_date (no more description footers; a footer still in an imported
     description is hidden and, for a recurring task, read for its "Weekly on Mondays" words);
   * priorities are low | normal | high | urgent; the old portal's three colours stay: urgent and high
     red ("urgent"), normal amber ("medium"), low green ("low").

   Every word drawn from a task goes through the page's escaping; amounts in free text go through the
   page's mask (Q28: on screen only). Pure module (node tests import it). */

import { ymd, addDays } from "./pacific.js";

export const NEEDS_UPDATE_DAYS = 5;
export const NOTE_MAX = 2000;
export const TITLE_MAX = 200;
export const DESC_MAX = 4000;

export const PRIORITIES = Object.freeze(["urgent", "high", "normal", "low"]);
export const PRIORITY_LABELS = Object.freeze({ urgent: "Urgent", high: "High", normal: "Normal", low: "Low" });

/* The old portal's lists (the Access task form), offered as suggestions: category stays free text
   (Desktop 2's own words are kept as typed). The agents' own sub-categories ("Photo Agent",
   "Recurring Agent") are not offered: agent tasks are marked by agent_kind, set by the agents only. */
export const CATEGORIES = Object.freeze(["Photos & Video", "Sales", "Customer Relations", "General Task", "Electrical",
  "Plumbing", "Estimate", "Drafting", "Change Order", "Office Work", "Marketing"]);
export const SUB_CATEGORIES = Object.freeze(["Photos & Video", "Camera Setup", "Sales", "General Task", "Website",
  "Content Creation", "Social Media", "Marketing", "Follow up", "Review"]);

export const PHRASES = Object.freeze(["Started today", "Waiting on materials", "Waiting on the client"]);
/* On a shoot these replace the phrases above. "Shoot done" is not a note: it closes the task. */
export const PHOTO_PHRASES = Object.freeze(["On site now", "Weather — need a new day", "Can't make it — please move it", "Drone not possible today"]);
export const SHOOT_DONE = "Shoot done — photos uploaded";

export const VIA_LABELS = Object.freeze({
  desktop: "", portal: "", email: "by e-mail", sms: "by text", whatsapp: "by WhatsApp",
  assistant: "through the assistant", agent: "DCR Agents", import: "old portal",
});

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const text = (v) => (v === null || v === undefined ? "" : String(v));
const trim = (v) => text(v).trim();
const ident = (s) => text(s);

/* ── words and days ─────────────────────────────────────────────────────── */

/** Imported descriptions can carry <br>, stray tags and entities (Access rich text): plain text
    with the line breaks kept. &lt; / &gt; are left as typed, so "&lt;script&gt;" shows as written;
    the result still goes through the page's escaping like any other words. */
export function plain(s) {
  return text(s).replace(/<br\s*\/?>/gi, "\n").replace(/<\/?(?:div|p)\b[^>]*>/gi, "\n").replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ").replace(/&#183;|&middot;/gi, "·").replace(/&quot;|&#34;/g, '"')
    .replace(/&#39;/g, "'").replace(/&#58;/g, ":").replace(/&#123;/g, "{").replace(/&#125;/g, "}")
    .replace(/&#10;/g, "\n").replace(/&amp;/g, "&").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** A note as add_task_note keeps it: one line, whitespace collapsed (the database cleans it the same
    way and decides; this only lets the page say "too long" first). */
export function cleanNote(s) {
  return text(s).replace(/[\r\n\u0085\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
}

/** The company (Pacific) day of an instant, or a "YYYY-MM-DD" as it is. */
export function dayOf(v) {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "string" && DAY_RE.test(v)) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? "" : ymd(d);
}

/** Whole calendar days from `from` to `to` (both "YYYY-MM-DD"). */
export function daysBetween(from, to) {
  if (!DAY_RE.test(text(from)) || !DAY_RE.test(text(to))) return null;
  return Math.round((Date.parse(to + "T12:00:00Z") - Date.parse(from + "T12:00:00Z")) / 86400000);
}

/** "Thu Oct 15" (", 2025" when not this year). */
export function dayText(key, today) {
  if (!DAY_RE.test(text(key))) return "";
  const d = new Date(key + "T12:00:00Z");
  const s = WD[d.getUTCDay()] + " " + MO[d.getUTCMonth()] + " " + d.getUTCDate();
  return today && key.slice(0, 4) !== String(today).slice(0, 4) ? s + ", " + key.slice(0, 4) : s;
}

export function agoText(n) { return n === 0 ? "today" : n === 1 ? "yesterday" : n + " days ago"; }

/** "7:30 AM" for a time column ("07:30:00"). */
export function timeText(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(text(t));
  if (!m) return "";
  const h = Number(m[1]);
  return (h % 12 || 12) + ":" + m[2] + " " + (h < 12 ? "AM" : "PM");
}

/* ── priority ───────────────────────────────────────────────────────────── */

export function priorityOf(v) {
  const l = trim(v).toLowerCase();
  if (PRIORITIES.indexOf(l) !== -1) return l;
  if (l.indexOf("urgent") !== -1) return "urgent";
  if (l.indexOf("high") !== -1) return "high";
  if (l.indexOf("low") !== -1) return "low";
  return "normal";
}

/** The old portal's colour family: "urgent" (urgent, high) | "medium" (normal) | "low". */
export function priKey(p) {
  const v = priorityOf(p);
  return v === "urgent" || v === "high" ? "urgent" : v === "low" ? "low" : "medium";
}
export const PRI_RANK = Object.freeze({ urgent: 0, high: 1, normal: 2, low: 3 });

/* ── agent tasks: a shoot, a recurring task ─────────────────────────────── */

export const PHOTO_FOOT = /^Shoot date: (\d{4}-\d{2}-\d{2}) · Ref: (PV-[0-9A-Za-z-]+)/;
export const RECUR_FOOT = /^Recurring: ([A-Za-z0-9_-]{1,40}) · (\d{4}-\d{2}-\d{2})(?: · ([^·\r\n]{1,60}))?/;
const RECUR_TAIL = "Made by the DCR Recurring Tasks agent";

function lines(desc) { return plain(desc).split("\n").map(function (l) { return l.trim(); }); }

/** A recurring task's repeat words from a footer the import left in the description ("" if none). */
export function recurringEvery(desc) {
  let every = "";
  lines(desc).forEach(function (l) {
    const m = RECUR_FOOT.exec(l);
    if (m) every = trim(m[3]) === RECUR_TAIL ? "" : trim(m[3]);
  });
  return every;
}

/** The description without the agents' bookkeeping lines (a shoot's or a recurring task's footer). */
export function withoutFooter(desc) {
  return lines(desc).filter(function (l) { return !PHOTO_FOOT.test(l) && !RECUR_FOOT.test(l); }).join("\n")
    .replace(/\n{3,}/g, "\n\n").trim();
}

export const BRIEF_HEAD = /^(WHEN|WHERE|SHOT LIST|TIPS|SAMPLE SHOT|BRING|SAFETY|CAPTION IDEAS|DRONE CHECK)(?:\s*:\s*(.*)|\s*)$/;
const MAP_LINE = /^Map:\s*(https:\/\/www\.google\.com\/maps\/search\/\?\S+)$/;

/** A shoot brief from the description the Photo & Video Agent wrote, as blocks the page draws:
    {kind: "head", text, rest} for WHEN, SHOT LIST …; {kind: "p", text}; {kind: "list", shots, items:
    [{text} | {map: url} | {shot: i, text, done}]}. The footer is not shown. `done` is the set of
    shot words ticked on this phone (a rewritten brief keeps the ticks of the shots it kept).
    -> {blocks, shots} (shots: the shot list in order, for the checkboxes' index). */
export function brief(desc, done) {
  const ticked = done || {};
  const blocks = [];
  const shots = [];
  let list = null;
  let head = "";
  lines(desc).forEach(function (line) {
    if (!line) { list = null; return; }
    if (PHOTO_FOOT.test(line) || RECUR_FOOT.test(line)) return;
    const h = BRIEF_HEAD.exec(line);
    if (h) {
      list = null;
      head = h[1];
      blocks.push({ kind: "head", text: head, rest: trim(h[2]) });
      return;
    }
    const b = /^[•·*-]\s*(.+)$/.exec(line);
    if (!b) { list = null; blocks.push({ kind: "p", text: line }); return; }
    const shot = head === "SHOT LIST";
    if (!list) { list = { kind: "list", shots: shot, items: [] }; blocks.push(list); }
    const map = shot ? null : MAP_LINE.exec(b[1]);
    if (map) { list.items.push({ map: map[1] }); return; }
    if (!shot) { list.items.push({ text: b[1] }); return; }
    list.items.push({ shot: shots.length, text: b[1], done: !!ticked[b[1]] });
    shots.push(b[1]);
  });
  return { blocks: blocks, shots: shots };
}

/* ── the update clock (app.task_clock) ──────────────────────────────────── */

/** The clock of a task from its row and notes, as app.task_clock computes it: the newest of the
    newest note and the request; days in Pacific calendar days; "needs an update" after MORE than
    five days; a photo task is never stale up to and including its shoot day. Pin, priority and
    reassignment changes do not count (only notes and the request do). */
export function clockOf(task, notes, today) {
  const t = task || {};
  // a note dated after `today` (Pacific) does not count; the newest wins, the higher id on a tie
  const list = (notes || []).filter(function (n) { return n && n.created_at && dayOf(n.created_at) <= today; });
  let newest = null;
  list.forEach(function (n) {
    const a = Date.parse(n.created_at), b = newest ? Date.parse(newest.created_at) : -Infinity;
    if (!newest || a > b || (a === b && (Number(n.id) || 0) > (Number(newest.id) || 0))) newest = n;
  });
  const created = t.created_at || null;
  const useNote = !!(newest && (!created || Date.parse(newest.created_at) >= Date.parse(created)));   // a tie says note
  const last = useNote ? newest.created_at : created;
  const days = last ? Math.max(0, daysBetween(dayOf(last), today)) : 0;
  const shootAhead = t.agent_kind === "photo" && DAY_RE.test(text(t.agent_date)) && today <= t.agent_date;
  return {
    last_update: last,
    last_update_source: useNote ? "note" : "created",
    days_since_update: days,
    last_note: newest ? newest.text : null,
    needs_update: (t.status || "open") === "open" && days > NEEDS_UPDATE_DAYS && !shootAhead,
  };
}

/* ── rows -> the page's shape ───────────────────────────────────────────── */

function pick(row, names) {
  for (let i = 0; i < names.length; i++) {
    const v = row[names[i]];
    if (v !== undefined) return v;
  }
  return undefined;
}

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** An imported author as both apps write it: "Ana" -> "Ana · old portal"; the import itself ("Old
    portal") stays "Old portal" (DCR Desktop 2 domain/legacy.py author_label). */
export function oldAuthor(name) {
  const t = trim(name).replace(/\s+/g, " ");
  if (!t) return "";
  return t.toLowerCase() === "old portal" ? "Old portal" : t + " · old portal";
}

/** One note row -> {id, at, day, text, who, via, viaLabel, imported}. `who`: the person whose words
    they are (on_behalf_of when an agent filed them, else the writer), an imported author with
    "· old portal", or "". */
export function toNote(n, opts) {
  const o = opts || {};
  const nameOf = o.nameOf || function () { return ""; };
  const mask = o.mask || ident;
  const via = trim(n.via).toLowerCase();
  // rpc my_tasks names them: author (the writer's name, or an imported note's author_name) and
  // on_behalf_of_name; a row read from task_notes has the ids (and author_name for an imported note)
  let who = "";
  if (n.on_behalf_of) who = nameOf(n.on_behalf_of) || trim(n.on_behalf_of_name);
  if (!who && n.created_by) who = nameOf(n.created_by) || trim(n.author || n.by_name || n.author_name);
  if (!who && trim(n.author_name || n.author)) who = oldAuthor(n.author_name || n.author);
  return {
    id: n.id,
    at: n.created_at || null,
    day: dayOf(n.created_at),
    text: mask(text(n.text)),
    who: who,
    via: via,
    viaLabel: VIA_LABELS[via] === undefined ? "" : VIA_LABELS[via],
    imported: via === "import" || (!n.created_by && !!trim(n.author_name || n.author)),
  };
}

/** A row from rpc my_tasks (or a tasks row with its notes and project) -> the page's task.
    opts: {me (uuid), nameOf, mask, today}. Column names are those of migration M3; a project embed
    ({project: {number, name, address, city, lat, lng}}) is read too, for rows read from the table. */
export function toTask(row, opts) {
  const o = opts || {};
  const r = row || {};
  const mask = o.mask || ident;
  const nameOf = o.nameOf || function () { return ""; };
  const today = o.today || ymd(new Date());
  const pj = r.project || r.projects || {};
  const clockIn = r.clock && typeof r.clock === "object" ? r.clock : r;
  const rawNotes = Array.isArray(r.notes) ? r.notes : Array.isArray(r.task_notes) ? r.task_notes : [];
  const notesSorted = rawNotes.slice().sort(function (a, b) {
    return (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0) || (Number(a.id) || 0) - (Number(b.id) || 0);
  });
  const hasClock = clockIn.needs_update !== undefined || clockIn.days_since_update !== undefined;
  const clock = hasClock ? clockIn : clockOf(r, notesSorted, today);
  const kind = trim(r.agent_kind).toLowerCase();
  const agentDate = DAY_RE.test(text(r.agent_date)) ? text(r.agent_date) : "";
  const assigned = r.assigned_to || null;
  const assigneeName = trim(pick(r, ["assignee_name", "assigned_name", "assigned_to_name"])) || (assigned ? nameOf(assigned) : "");
  const status = trim(r.status).toLowerCase() === "done" ? "done" : "open";
  const lastSrc = trim(clock.last_update_source).toLowerCase();
  const days = num(clock.days_since_update);
  const task = {
    id: r.id,
    version: num(r.version),
    title: mask(trim(r.title)) || "(untitled task)",
    rawTitle: trim(r.title),
    description: mask(plain(r.description)),
    category: trim(r.category),
    subCategory: trim(pick(r, ["sub_category", "subcategory"])),
    priority: priorityOf(r.priority),
    priorityLabel: PRIORITY_LABELS[priorityOf(r.priority)],
    priKey: priKey(r.priority),
    assignedTo: assigned,
    assigneeName: assigneeName,
    // my_tasks says it (assigned to the caller, or unassigned and made by them); a table row: assigned
    mine: typeof r.mine === "boolean" ? r.mine : !!(o.me && assigned && String(assigned) === String(o.me)),
    createdBy: r.created_by || null,
    createdByMe: !!(o.me && r.created_by && String(r.created_by) === String(o.me)),
    requestedBy: r.created_by ? (nameOf(r.created_by) || trim(r.created_by_name)) : oldAuthor(r.author_name || r.created_by_name),
    createdAt: r.created_at || null,
    requested: dayOf(r.created_at),
    dueDate: DAY_RE.test(text(r.due_date)) ? text(r.due_date) : "",
    dueTime: trim(r.due_time).slice(0, 5),
    status: status,
    done: status === "done",
    completedAt: r.completed_at || null,
    projectId: num(r.project_id),
    projectNumber: trim(pick(r, ["project_number"]) !== undefined ? r.project_number : pj.number),
    projectName: trim(pick(r, ["project_name"]) !== undefined ? r.project_name : pj.name),
    address: trim(pick(r, ["project_address", "address"]) !== undefined ? pick(r, ["project_address", "address"]) : pj.address).replace(/[\r\n]+/g, ", "),
    city: trim(pick(r, ["project_city", "city"]) !== undefined ? pick(r, ["project_city", "city"]) : pj.city),
    lat: num(pick(r, ["lat", "project_lat"]) !== undefined ? pick(r, ["lat", "project_lat"]) : pj.lat),
    lng: num(pick(r, ["lng", "project_lng"]) !== undefined ? pick(r, ["lng", "project_lng"]) : pj.lng),
    locationSource: trim(pick(r, ["location_source", "project_location_source"]) || pj.location_source) || null,
    projectVersion: num(r.project_version !== undefined ? r.project_version : pj.version),
    projectLegacy: r.project_legacy_sp_id !== undefined ? r.project_legacy_sp_id : pj.legacy_sp_id !== undefined ? pj.legacy_sp_id : null,
    notes: notesSorted.map(function (n) { return toNote(n, { nameOf: nameOf, mask: mask }); }),
    lastUpdate: clock.last_update || null,
    lastUpdateSource: lastSrc === "note" ? "note" : "requested",
    daysSinceUpdate: days,
    lastNote: clock.last_note === null || clock.last_note === undefined ? "" : mask(text(clock.last_note)),
    needsUpdate: status !== "done" && clock.needs_update === true,
    agentKind: kind === "photo" || kind === "recurring" ? kind : "",
    photo: null,
    recurring: null,
    // imported from the old portal: the row says so (legacy_sp_id), or my_tasks' author without a person
    legacy: (r.legacy_sp_id !== undefined && r.legacy_sp_id !== null) || (!r.created_by && !!trim(r.author_name)),
  };
  if (task.agentKind === "photo") task.photo = { shootDate: agentDate, ref: trim(r.agent_ref) };
  if (task.agentKind === "recurring") task.recurring = { agentId: trim(r.agent_ref), date: agentDate, every: recurringEvery(r.description) };
  if (task.agentKind) task.description = mask(withoutFooter(r.description));
  return task;
}

/* ── words the pages show ───────────────────────────────────────────────── */

/** How long a task has been quiet, in the words a crew member would use. A task nobody ever wrote
    on says "no update yet" — "no update for 12 days" would read as if they had ignored it. */
export function whenText(t) {
  const d = t ? t.daysSinceUpdate : null;
  if (d === null || d === undefined) return "";
  if (t.lastUpdateSource === "requested") {
    if (!t.needsUpdate) return "New · requested " + agoText(d);
    return t.notes && t.notes.length ? "No update for " + d + " days" : "No update yet · requested " + agoText(d);
  }
  if (t.needsUpdate) return "No update for " + d + " days";
  return d === 0 ? "Updated today" : d === 1 ? "Updated yesterday" : "Updated " + d + " days ago";
}

export function previewText(t) { return t && t.lastNote ? "Last: " + t.lastNote : "No updates yet"; }

/** {project, addr, city} for the place line. */
export function placeOf(t) {
  const name = [t.projectNumber, t.projectName].filter(Boolean).join(" — ");
  return { project: name, addr: trim(t.address), city: trim(t.city) };
}

/** Google Maps directions to the address (the old portal's link), or to the pin when there is no
    address. */
export function dirUrl(pl, t) {
  const q = [pl && pl.addr, pl && pl.city].filter(Boolean).join(", ");
  if (q && pl.addr) return "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(q);
  if (t && t.lat !== null && t.lng !== null && t.lat !== undefined && t.lng !== undefined) {
    return "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(t.lat + "," + t.lng);
  }
  return "";
}

/** A shoot's day against today: {label, cls}: "Shoot: Today" (today), "Shoot was Tue Oct 13" (late). */
export function shootLabel(t, today) {
  if (!t || !t.photo || !DAY_RE.test(text(t.photo.shootDate))) return null;
  const n = daysBetween(t.photo.shootDate, today);
  const past = n !== null && n > 0;
  return {
    label: n === 0 ? "Shoot: Today" : past ? "Shoot was " + dayText(t.photo.shootDate, today) : "Shoot: " + dayText(t.photo.shootDate, today),
    cls: n === 0 ? "today" : past ? "late" : "",
  };
}

export function recurLabel(t) {
  return t && t.recurring ? "↻ " + (t.recurring.every || "Recurring") : "";
}

/** "Due Thu Oct 22 · 7:30 AM" or "". */
export function dueText(t, today) {
  if (!t || !t.dueDate) return "";
  const n = daysBetween(today, t.dueDate);
  const day = n === 0 ? "today" : n === 1 ? "tomorrow" : dayText(t.dueDate, today);
  return "Due " + day + (t.dueTime ? " · " + timeText(t.dueTime) : "");
}

/** What should stay in the box once an update is saved: only the words that were sent leave; what
    was typed after them while sending stays as the next draft; a change to the sent words keeps
    the whole box, so the person can see it and decide. */
export function leftAfterSend(now, sent) {
  const cur = text(now).replace(/^\s+/, "");
  if (cur.indexOf(sent) !== 0) return text(now);
  const rest = cur.slice(sent.length);
  if (rest && !/^[\s.,;:!?]/.test(rest)) return text(now);
  return rest.replace(/^\s*[.,;]?\s*/, "");
}

/** A quick phrase added after what is there, never in place of it. */
export function withPhrase(cur, p) {
  const c = text(cur).replace(/\s+$/, "");
  return c ? c + (/[.!?]$/.test(c) ? " " : ". ") + p : p;
}

/* ── order ──────────────────────────────────────────────────────────────── */

export function byDays(a, b) { return (b.daysSinceUpdate || 0) - (a.daysSinceUpdate || 0); }
export function byPriority(a, b) {
  return (PRI_RANK[a.priority] - PRI_RANK[b.priority]) || text(a.requested).localeCompare(text(b.requested));
}
/** Inside each group the shoots come first, the soonest first: a shoot has a day it happens on. */
export function photoFirst(rest) {
  return function (a, b) {
    const pa = a.photo ? 1 : 0, pb = b.photo ? 1 : 0;
    if (pa !== pb) return pb - pa;
    const c = pa ? text(a.photo.shootDate || "9999").localeCompare(text(b.photo.shootDate || "9999")) : 0;
    return c || rest(a, b);
  };
}

/** Needs-an-update first (the longest quiet first), then the rest by priority. */
export function needsFirst(list) {
  const needs = list.filter(function (t) { return t.needsUpdate; }).sort(photoFirst(byDays));
  const fine = list.filter(function (t) { return !t.needsUpdate; }).sort(photoFirst(byPriority));
  return { needs: needs, fine: fine };
}

/** Tasks grouped by the person they are assigned to ("Unassigned" last, the caller's own first). */
export function byPerson(list) {
  const groups = {};
  const order = [];
  list.forEach(function (t) {
    const k = t.assignedTo ? String(t.assignedTo) : "";
    if (!groups[k]) { groups[k] = { key: k, name: t.assignedTo ? (t.assigneeName || "Someone") : "Unassigned", mine: !!(t.mine && t.assignedTo), list: [] }; order.push(k); }
    groups[k].list.push(t);
  });
  return order.map(function (k) { return groups[k]; }).sort(function (a, b) {
    return (Number(b.mine) - Number(a.mine)) || (Number(!a.key) - Number(!b.key)) || a.name.localeCompare(b.name);
  });
}

/** Pins: one per project (the tasks map). -> [{key, projectId, number, name, address, city, lat, lng,
    tasks}] — a project's tasks share its pin; tasks without a project share "No project". */
export function groupByProject(list) {
  const m = {};
  const order = [];
  list.forEach(function (t) {
    const k = t.projectId === null ? "none" : String(t.projectId);
    if (!m[k]) {
      m[k] = { key: k, projectId: t.projectId, number: t.projectNumber, name: t.projectName, address: t.address, city: t.city,
        lat: t.lat, lng: t.lng, locationSource: t.locationSource, projectVersion: t.projectVersion, legacy: t.projectLegacy, tasks: [] };
      order.push(k);
    }
    m[k].tasks.push(t);
  });
  return order.map(function (k) { return m[k]; });
}

export function pinLabel(g) {
  if (!g) return "";
  if (g.projectId === null) return "No project";
  return trim(g.address) || [g.number, g.name].filter(Boolean).join(" — ") || "Project";
}

/* ── who may do what (the database decides; these only hide controls) ──── */

const TASK_EDITORS = ["admin", "manager", "lead"];             // app.can_edit('tasks'): for anyone (Q8)
const OWN_TASKS = ["admin", "manager", "lead", "accountant", "field"];   // app.can_edit('own_tasks')

/** May this person create tasks at all? */
export function canCreate(me) { return !!me && me.active !== false && OWN_TASKS.indexOf(me.role) !== -1; }
/** May they create a task for someone else (or anyone at all)? A field user and the accountant only
    for themself or unassigned (Desktop 2's rule). */
export function canAssignAnyone(me) { return !!me && TASK_EDITORS.indexOf(me.role) !== -1; }

/** Whom the new-task form offers: everyone active (not the DCR Agents account) for task editors;
    otherwise oneself only (and "Unassigned"). people: [{id, name, role, active}]. */
export function assigneeChoices(me, people) {
  const list = (people || []).filter(function (p) { return p && p.active !== false && p.role !== "agents" && trim(p.name); });
  const mine = list.filter(function (p) { return me && String(p.id) === String(me.id); });
  const pool = canAssignAnyone(me) ? list : mine;
  return pool.slice().sort(function (a, b) {
    return (Number(me && String(b.id) === String(me.id)) - Number(me && String(a.id) === String(me.id))) || a.name.localeCompare(b.name);
  });
}

/** May they complete / reopen / add notes on this task? (the M1 policies: task editors any task;
    the others their own or the ones they created) */
export function canWork(me, t) {
  if (!me || !t || me.active === false) return false;
  if (TASK_EDITORS.indexOf(me.role) !== -1) return true;
  if (OWN_TASKS.indexOf(me.role) === -1) return false;
  return t.mine || t.createdByMe;
}

/** Which lists My Tasks offers: field and view-only people have their own only (Q3); a lead their
    crew's and everyone's; the office everyone's. The database refuses a view a role may not have. */
export function viewsFor(me) {
  const r = me && me.role;
  if (r === "lead") return ["mine", "crew", "everyone"];
  if (r === "admin" || r === "manager" || r === "accountant") return ["mine", "everyone"];
  return ["mine"];
}
export const VIEW_LABELS = Object.freeze({ mine: "Mine", crew: "My crew's tasks", everyone: "Everyone's tasks" });

/** The new-task form -> the row for INSERT, or {error}. */
export function newTaskRow(f, me) {
  const title = trim(f && f.title).replace(/\s+/g, " ");
  if (!title) return { error: "Give the task a name." };
  if (title.length > TITLE_MAX) return { error: "Keep the task name under " + TITLE_MAX + " characters." };
  const desc = trim(f.description);
  if (desc.length > DESC_MAX) return { error: "Keep the description under 4,000 characters." };
  const assignee = f.assignedTo ? String(f.assignedTo) : null;
  if (assignee && me && !canAssignAnyone(me) && assignee !== String(me.id)) {
    return { error: "You can give a task to yourself or leave it unassigned." };
  }
  if (f.dueTime && !/^\d{2}:\d{2}$/.test(String(f.dueTime))) return { error: "The time is not a time of day." };
  if (f.dueTime && !f.dueDate) return { error: "A time needs a day — pick the due day too." };   // M3: due_time goes with due_date
  if (f.dueDate && !DAY_RE.test(String(f.dueDate))) return { error: "Pick the day from the calendar." };
  const row = {
    title: title,
    description: desc || null,
    category: trim(f.category) || null,
    sub_category: trim(f.subCategory) || null,
    priority: PRIORITIES.indexOf(f.priority) !== -1 ? f.priority : "normal",
    assigned_to: assignee,
    due_date: f.dueDate || null,
    due_time: f.dueTime ? f.dueTime + ":00" : null,
  };
  if (f.projectId !== null && f.projectId !== undefined && f.projectId !== "") row.project_id = Number(f.projectId);
  return { row: row };
}

/* ── the home page's badge (rpc my_tasks_summary) ───────────────────────── */

/** rpc my_tasks_summary() (jsonb {mine, mine_needs_update, mine_overdue, mine_due_today, crew,
    crew_needs_update, everyone, everyone_needs_update, today}: open tasks; crew = a lead's own and their
    crew's, everyone = every task the office reads; NULL when the role has no such list) -> counts. */
export function summaryOf(r) {
  const s = Array.isArray(r) ? r[0] || {} : r || {};
  const n = function (k) { const v = num(s[k]); return v === null ? 0 : v; };
  const has = function (k) { return s[k] !== null && s[k] !== undefined; };
  return {
    open: n("mine"), needUpdate: n("mine_needs_update"), overdue: n("mine_overdue"), dueToday: n("mine_due_today"),
    crew: has("crew") ? n("crew") : null, crewNeedUpdate: has("crew_needs_update") ? n("crew_needs_update") : null,
    everyone: has("everyone") ? n("everyone") : null, everyoneNeedUpdate: has("everyone_needs_update") ? n("everyone_needs_update") : null,
  };
}

/** The My Tasks card's badge (the old one): one's own tasks needing an update, red — somebody's job
    today; else one's own open tasks, dimmed; with none of one's own, a lead's crew's (else the office's
    everyone's) needing an update, dimmed. null: no badge. */
/** The list My Tasks opens on: the one remembered on this phone (when the role still has it), else the
    person's own when they have any, else the list the home badge counted — a lead's crew (as the old
    portal's "My crew's tasks"), the office's everyone — and "mine" for anyone with a single view. */
export function defaultView(views, mineCount, saved) {
  const v = Array.isArray(views) && views.length ? views : ["mine"];
  if (saved && v.indexOf(saved) !== -1) return saved;
  if (mineCount || v.length < 2) return "mine";
  return v.indexOf("crew") !== -1 ? "crew" : v[v.length - 1];
}

export function badgeOf(sum) {
  const s = sum || {};
  if (s.needUpdate) return { text: s.needUpdate + (s.needUpdate === 1 ? " needs" : " need") + " an update", cls: "warn" };
  if (s.open) return { text: s.open + " open", cls: "dim" };
  if (s.crewNeedUpdate) return { text: s.crewNeedUpdate + " crew task" + (s.crewNeedUpdate === 1 ? " needs" : "s need") + " an update", cls: "dim" };
  if (s.everyoneNeedUpdate) return { text: s.everyoneNeedUpdate + " task" + (s.everyoneNeedUpdate === 1 ? " needs" : "s need") + " an update", cls: "dim" };
  return null;
}

/* ── small things ───────────────────────────────────────────────────────── */

/** A fresh key for add_task_note's p_client_key: the same key is accepted once, so a send whose
    answer was lost can be sent again without a second note. */
export function clientKey() {
  const c = typeof globalThis !== "undefined" && globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return "p2-" + c.randomUUID();
  return "p2-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

/** "Thu Oct 15 · 2 days ago" for a note. */
export function noteLabel(n, today) {
  if (!n || !n.day) return "Earlier note";
  let label = dayText(n.day, today);
  const ago = daysBetween(n.day, today);
  if (ago !== null && ago >= 0 && ago <= 1) label += " · " + agoText(ago);
  return label;
}

export { addDays };
