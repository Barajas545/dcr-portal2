/* The shoot schedule - shoots.html (the photographer screen program, P3; DCR Desktop 2 migration
   20261110000100_photo_schedule, docs/DATABASE.md §39; the contract DCR Desktop 2 docs/PHOTO-SCHEDULE.md; the owner's
   decisions of 2026-11-09).

   DCR Agents 2 on the office computer is the ONLY writer of photo plans: it mirrors them into photo_plans / photo_shoots,
   and this page reads that mirror (repo/photo.js; admins and the photo team - photo_my_access() says who, the database
   decides every read). A change is asked for, never written: photo_change_preview shows what it would do,
   photo_change_request queues it with the plan rev this screen read, the office computer takes it, applies it, answers
   and mirrors the plan again - the new days arrive through the Realtime watch (repo/photo.js watchSchedule).

   * Views: Agenda (the default: Late, Today, This week, Next week, Later, No date yet, Done & closed folded), By job (each
     plan's shoots in order with its job dates) and Month (Sunday first). Phone first (one column; a shoot opens full
     screen with its own way back); from 1024 px the list is on the left and the shoot on the right (Month takes the wide
     side). "Only my jobs" (the plans whose photographer is me) and "Archived plans too".
   * The header says in plain words when the office computer is not running (photo_pc_status: off, paused, not seen).
   * Deep links: ?shoot=<photo_shoots.id> (DCR Agents 2's reminders link here) opens that shoot; ?plan=<id> opens a plan
     in By job; ?task=<a My Tasks task id> opens that task's shoot; ?view= and ?month= too.
   * A shoot: its name, job, day and grace, the anchor in words, the chips (Late, Moved - not told yet, Firm, a change
     waiting), the facts, my changes still waiting (with Cancel while new) and my recent ones (applied, refused in plain
     words, sent to the office), the brief's safe fields and the last history entries. Admins and photographers (can_photo)
     get Move…, Mark done… (an optional note; the sheet is the confirm) and Undo… (my last applied change within 7 days -
     an admin: anyone's; never "done"). Marketing and others read only: no action button at all.
   * Move… (owner decision 2) ALWAYS asks: "Only this shoot" (preselected), "This shoot and the later ones" (the same
     number of days) or "The job date moved" (which job date - framing start, delivery, framing complete, house complete -
     and its new day). The plan's shoot days are the normal choice in the day strip; another day is allowed but marked.
     Every change of choice or day asks photo_change_preview again (debounced) and the sheet lists EVERY shoot that will
     move (from -> to), what stays and why, what will be skipped and the series that will be re-planned, and says when
     the office approves first ("This job date (Framing start) is Firm - your change goes to the office to approve").
     Apply sends photo_change_request with the base rev the screen read; a PT409 "changed" reads the plan again and shows
     the new preview ("Someone changed this plan meanwhile - here is the new preview") - never a silent overwrite.
   Every free text is the mirror's (masked by the database) and goes through the site's money masks again (map/photo.js
   safeText) before it is put on the page escaped. */

import { boot, esc, toast, confirmBox, errorText, D } from "./shell.js";
import { companyToday, rememberPhotoAccess } from "../common2.js";
import * as repo from "../repo/photo.js";
import {
  agenda, monthGrid, planShoots, plansInOrder, visiblePlans, shootChips, milestoneChips, anchorText, moveChoices, moveArgs, previewWords,
  shootActions, canCancel, pendingFor, isOpen, isLate, followsMilestone, dayText, isDay, safeText, movedNotTold, refusalText, lateDays,
  MILESTONES, MILESTONE_LABEL, PHASE_LABEL, NOT_READY_TEXT, EMPTY_TEXT, NOTE_MAX, REASON_MAX, isOpenChange,
} from "../map/photo.js";
import * as V from "../map/shoots.js";
import { addDays } from "../map/pacific.js";

const W = typeof window !== "undefined" ? window : {};
/** The page's state (a function: the tests start each walk from a fresh one). */
function freshState() {
  return {
    me: null, access: null, accessError: "", today: "", plans: [], shoots: [], changes: [], pc: null, ready: false, loaded: false, failed: "",
    view: "agenda", month: "", mine: false, archived: false, planFocus: null, day: null, openClosed: false,
    sel: null, open: false, pushed: false, msg: "", lastDetail: null,
    mv: null, seen: {}, seenReady: false, loadSeq: 0, stopWatch: null, timers: [], wired: false, held: [],
  };
}
const state = freshState();

const $ = (id) => (typeof document !== "undefined" ? document.getElementById(id) : null);
const T = (v) => esc(safeText(v));
const plural = (n, one, many) => n + " " + (n === 1 ? one : many || one + "s");
function wide() {
  try { return !!(W.matchMedia && W.matchMedia("(min-width: 1024px)").matches); } catch (e) { return false; }
}
const planOf = (id) => state.plans.find((p) => p.id === Number(id)) || null;
const shootOf = (id) => state.shoots.find((s) => s.id === Number(id)) || null;
const meId = () => (state.me ? state.me.id : null);
const editor = () => !!(state.access && state.access.canEdit);
const mineOpt = () => (state.mine ? meId() : null);

function errorWords(e) {
  if (e && e.retryable) return "No connection - the shoot schedule could not be read. Try again when you have signal.";
  return errorText(e);
}

/* ── reading ──────────────────────────────────────────────────────────── */

/** Read the mirror (every plan: the archived ones are shown only when asked), the changes the person may see (the last 30
    days) and the office computer's state; draw. o.quiet: a read after a watch or a poll (an error is not shouted). */
async function load(o) {
  const opt = o || {};
  const seq = ++state.loadSeq;
  try {
    const [sched, ch, pc] = await Promise.all([
      repo.loadSchedule({ archived: true }),
      repo.changes({}),
      repo.pcStatus().catch(() => state.pc),
    ]);
    if (seq !== state.loadSeq) return;
    state.today = companyToday();
    state.ready = sched.ready;
    state.plans = sched.plans;
    state.shoots = sched.shoots;
    state.changes = ch;
    state.pc = pc;
    state.loaded = true;
    state.failed = "";
    noticeFinished();
  } catch (e) {
    if (seq !== state.loadSeq) return;
    if (!state.loaded) state.failed = errorWords(e);
    else if (!opt.quiet) toast(errorWords(e), "error");
  }
  render();
}

/** A change of mine that the office computer answered since the last read: say what it came to. */
function noticeFinished() {
  const me = meId();
  for (const c of state.changes) {
    if (!me || c.requestedBy !== me) continue;
    const before = state.seen[c.id];
    state.seen[c.id] = c.state;
    if (!state.seenReady || before === undefined) continue;
    if ((before === "new" || before === "taken") && c.state !== before) {
      const f = V.finishedText(c, { pc: state.pc });
      // a sheet open: said when it closes (a toast would sit over the sheet's preview and its buttons)
      if (f && state.mv) state.held.push(f);
      else if (f) say(f);
    }
  }
  state.seenReady = true;
}

function say(f) {
  toast(f.text, f.kind === "error" ? "error" : f.kind === "ok" ? "ok" : "info");
}

/* ── drawing: the header ──────────────────────────────────────────────── */

function whoText(a) {
  if (!a || !a.ready) return "";
  if (a.admin) return "You: admin" + (a.photographer ? " and photographer" : "");
  if (a.photographer) return "You: photographer" + (a.defaultPhotographer ? " (the default photographer)" : "");
  if (a.marketing) return "You: marketing - read only";
  return "";
}

function renderHead() {
  const a = state.access;
  const ok = !!(a && a.ready && a.canRead);
  if ($("shWho")) $("shWho").textContent = whoText(a);
  // not on the team, or no shoot schedule in the database yet: the box under it says so (once, not twice)
  const lead = state.accessError || (a && (!a.ready || !a.canRead)) ? "" : !a ? "Loading the shoot schedule…" : a.canEdit ? V.EDIT_TEXT : V.READ_ONLY_TEXT;
  if ($("shLead")) $("shLead").textContent = lead;
  const pc = ok && state.loaded ? V.pcHeader(state.pc) : null;
  const pcBox = $("shPc");
  if (pcBox) {
    pcBox.hidden = !pc;
    pcBox.textContent = pc ? pc.text : "";
    pcBox.setAttribute("data-state", pc ? pc.state : "on");
  }
  const bar = $("shBar");
  if (bar) bar.hidden = !(ok && state.loaded && !state.failed && state.plans.length);
  document.querySelectorAll("#shViews [data-view]").forEach((b) => b.setAttribute("aria-pressed", b.getAttribute("data-view") === state.view ? "true" : "false"));
  const mineBox = $("shMineBox");
  if (mineBox) mineBox.hidden = !state.plans.some((p) => p.photographerProfileId && p.photographerProfileId === meId());
  if ($("shMine")) $("shMine").checked = !!state.mine;
  if ($("shArchived")) $("shArchived").checked = !!state.archived;
  const layout = $("shLayout");
  if (layout) {
    layout.classList.toggle("month", state.view === "month");
    // nothing to pick (not for this account, no schedule in the database, a failed read, no plan yet): no empty "Pick a
    // shoot" panel beside the words on a desk
    layout.classList.toggle("solo", !!(state.accessError || (a && (!a.ready || !a.canRead)) || (state.loaded && (state.failed || !state.ready || !state.plans.length))));
  }
  const count = $("shCount");
  if (count) {
    if (!ok || !state.loaded || state.failed || !state.plans.length) { count.innerHTML = ""; return; }
    const plans = visiblePlans(state.plans, { archived: state.archived, mine: mineOpt() });
    const ids = new Set(plans.map((p) => p.id));
    const open = state.shoots.filter((s) => ids.has(s.planId) && isOpen(s));
    const late = open.filter((s) => isLate(s, state.today)).length;
    count.innerHTML = esc(plural(plans.length, "job") + " · " + plural(open.length, "open shoot")) + (late ? " · <b>" + esc(late + " late") + "</b>" : "");
  }
}

/* ── drawing: the lists ───────────────────────────────────────────────── */

function chipHtml(c) {
  return '<span class="sh-chip ' + esc(c.cls || "") + '">' + esc(c.text) + "</span>";
}

function dateHtml(s) {
  if (!isDay(s.plannedDate)) return '<span class="sh-date none"><span class="d">No date</span></span>';
  const f = V.rowFacts(s, null, state.today);
  const mon = dayText(s.plannedDate, state.today).split(" ")[1] || "";
  return '<span class="sh-date"><span class="wd">' + esc(f.wd) + '</span><span class="d">' + esc(f.date) + '</span><span class="mo">' + esc(mon) + "</span></span>";
}

function rowChips(s, plan) {
  const out = shootChips(s, plan, state.today, { pending: pendingFor(state.changes, s) }).filter((c) => !(c.key === "status" && s.status === "planned"));
  // a plan that is not live says so on each of its shoots (in review: its days are not settled yet)
  if (plan && plan.status !== "active") out.push({ key: "plan", text: V.planFacts(plan).statusText, cls: "dim" });
  return out;
}

function rowHtml(s, plan, o) {
  const late = isLate(s, state.today);
  const cls = "sh-row" + (late ? " late" : isOpen(s) && s.plannedDate === state.today ? " today" : "") + (isOpen(s) ? "" : " closed");
  const f = V.rowFacts(s, plan, state.today);
  const chips = rowChips(s, plan);
  return '<button type="button" class="' + cls + '" data-shoot="' + esc(s.id) + '"' + (state.sel === s.id ? ' aria-current="true"' : "") + ">" +
    dateHtml(s) + '<span class="sh-main"><span class="sh-name">' + T(s.name) + "</span>" +
    (o && o.noJob ? "" : '<span class="sh-job">' + T(f.job) + (f.city ? " · " + T(f.city) : "") + "</span>") +
    (chips.length ? '<span class="sh-chips">' + chips.map(chipHtml).join("") + "</span>" : "") + "</span></button>";
}

function emptyHtml(title, text, retry) {
  return '<div class="sh-empty"><b>' + esc(title) + "</b>" + esc(text || "") +
    (retry ? '<div><button type="button" class="sh-btn" data-act="reload" style="margin-top:12px">Try again</button></div>' : "") + "</div>";
}

function agendaHtml() {
  const a = agenda(state.plans, state.shoots, state.today, { weekStart: 0, mine: mineOpt(), archived: state.archived, changes: state.changes });
  if (a.empty) return emptyHtml(state.mine ? "No shoot on your jobs" : "No shoots", state.mine ? "Untick “Only my jobs” to see every job's." : "");
  return a.groups.filter((g) => g.count).map((g) => {
    const rows = g.entries.map((e) => rowHtml(e.shoot, e.plan)).join("");
    if (g.folded) {
      return '<details class="sh-grp closed"' + (state.openClosed ? " open" : "") + '><summary data-act="fold">' + esc(g.label) +
        ' <span class="sh-n">' + g.count + "</span></summary>" + rows + "</details>";
    }
    return '<section class="sh-grp ' + esc(g.key) + '"><h3>' + esc(g.label) + ' <span class="sh-n">' + g.count + "</span></h3>" + rows + "</section>";
  }).join("");
}

function planHtml(p) {
  const f = V.planFacts(p);
  const shoots = planShoots(p, state.shoots);
  const meta = [f.photographer ? "Photographer: " + f.photographer : "", f.shootDays, f.suggestions].filter(Boolean).join(" · ");
  return '<section class="sh-plan' + (state.planFocus === p.id ? " focus" : "") + '" id="shPlan' + esc(p.id) + '" data-plan="' + esc(p.id) + '">' +
    '<header class="sh-plan-hd"><div class="sh-plan-t"><b>' + T(f.label) + "</b>" + (f.city ? "<span>" + T(f.city) + "</span>" : "") +
    (f.title && f.title !== f.label ? "<span>" + T(f.title) + "</span>" : "") +
    (f.statusText ? '<span class="sh-chip dim">' + esc(f.statusText) + "</span>" : "") + "</div>" +
    '<div class="sh-plan-meta">' + T(meta) + "</div>" +
    '<div class="sh-ms" aria-label="Job dates">' + milestoneChips(p, state.today).map((m) => '<span class="sh-chip' + (m.firm ? " firm" : m.date ? "" : " dim") + '">' +
      esc(m.text) + "</span>").join("") + "</div></header>" +
    '<div class="sh-plan-rows">' + (shoots.length ? shoots.map((s) => rowHtml(s, p, { noJob: true })).join("")
      : '<div class="sh-empty" style="margin:0 0 8px">No shoots in this plan yet.</div>') + "</div></section>";
}

function jobHtml() {
  let plans = plansInOrder(visiblePlans(state.plans, { archived: state.archived || !!state.planFocus, mine: state.planFocus ? null : mineOpt() }), state.shoots, state.today);
  let head = "";
  if (state.planFocus) {
    plans = plans.filter((p) => p.id === state.planFocus);
    head = '<button type="button" class="sh-allbtn" data-act="all-jobs">← All jobs</button>';
  }
  if (!plans.length) return head + emptyHtml(state.planFocus ? V.PLAN_GONE_TEXT : "No jobs", state.mine ? "Untick “Only my jobs” to see every job." : "");
  return head + plans.map(planHtml).join("");
}

function evHtml(e) {
  const code = e.plan.projectCode || e.plan.label;
  return '<button type="button" class="sh-ev' + (e.late ? " late" : "") + (e.closed ? " closed" : "") + '" data-shoot="' + esc(e.shoot.id) + '"' +
    (state.sel === e.shoot.id ? ' aria-current="true"' : "") + ' title="' + T(e.shoot.name + " - " + e.plan.label) + '">' + T(e.shoot.name) +
    '<span class="job">' + T(code) + "</span></button>";
}

function monthHtml() {
  const month = state.month || state.today.slice(0, 7);
  const g = monthGrid(month, state.plans, state.shoots, state.today, { weekStart: 0, mine: mineOpt(), archived: state.archived });
  const head = '<div class="sh-mhd"><button type="button" class="sh-mbtn" data-act="month-prev" aria-label="The month before"' +
    (V.monthInRange(g.prev, state.today) ? "" : " disabled") + ">‹</button><b>" + esc(g.label) + "</b>" +
    '<button type="button" class="sh-mbtn" data-act="month-next" aria-label="The month after"' + (V.monthInRange(g.next, state.today) ? "" : " disabled") + ">›</button>" +
    (g.month !== state.today.slice(0, 7) ? '<button type="button" class="sh-mbtn" data-act="month-today">This month</button>' : "") + "</div>";
  const cells = g.weekdays.map((w) => '<div class="sh-wd">' + esc(w) + "</div>").join("") + g.weeks.map((week) => week.map((c) => {
    const n = c.entries.length;
    const dots = n ? '<span class="sh-dots" aria-hidden="true">' + c.entries.slice(0, 3).map((e) => '<span class="sh-dot' + (e.late ? " late" : e.closed ? " closed" : "") + '"></span>').join("") + "</span>" : "";
    return '<div class="sh-cell' + (c.inMonth ? "" : " out") + (c.isToday ? " today" : "") + (c.isPast && !c.isToday ? " past" : "") + (state.day === c.day ? " picked" : "") + '">' +
      '<button type="button" class="sh-dnum" data-act="day" data-day="' + esc(c.day) + '" aria-label="' + esc(dayText(c.day, state.today) + (n ? ", " + plural(n, "shoot") : ", no shoot")) + '"' +
      (state.day === c.day ? ' aria-pressed="true"' : "") + "><span>" + esc(c.date) + "</span>" + dots + "</button>" +
      (n ? '<div class="sh-evs">' + c.entries.slice(0, 3).map(evHtml).join("") + (n > 3 ? '<span class="sh-more">+' + (n - 3) + " more</span>" : "") + "</div>" : "") +
      "</div>";
  }).join("")).join("");
  let dayList = "";
  if (state.day && state.day.slice(0, 7) === g.month) {
    const list = [];
    g.weeks.forEach((w) => w.forEach((c) => { if (c.day === state.day) c.entries.forEach((e) => list.push(e)); }));
    dayList = '<div class="sh-dayl" id="shDayList"><h3>' + esc(dayText(state.day, state.today)) + "</h3>" +
      (list.length ? list.map((e) => rowHtml(e.shoot, e.plan)).join("") : '<div class="sh-empty" style="margin:0">No shoot that day.</div>') + "</div>";
  }
  const undated = g.undated.length ? '<div class="sh-dayl"><h3>No date yet</h3>' + g.undated.map((e) => rowHtml(e.shoot, e.plan)).join("") + "</div>" : "";
  return '<div class="sh-month">' + head + '<div class="sh-grid">' + cells + "</div>" + dayList + undated + "</div>";
}

function renderList() {
  const box = $("shList");
  if (!box) return;
  const a = state.access;
  const note = state.msg ? '<div class="sh-pc" role="status">' + esc(state.msg) + "</div>" : "";
  if (state.accessError) { box.innerHTML = emptyHtml("Could not open the shoot schedule", state.accessError, true); return; }
  if (!a) return;
  if (!a.ready) { box.innerHTML = emptyHtml("Not in the database yet", NOT_READY_TEXT + "."); return; }
  if (!a.canRead) {
    box.innerHTML = emptyHtml("Not for your account", V.NO_ACCESS_TEXT) + '<p style="margin-top:12px"><a class="sh-btn" href="dashboard.html">← Home</a></p>';
    return;
  }
  if (state.failed) { box.innerHTML = note + emptyHtml("Could not read the shoot schedule", state.failed, true); return; }
  if (!state.loaded) return;
  if (!state.ready) { box.innerHTML = emptyHtml("Not in the database yet", NOT_READY_TEXT + "."); return; }
  if (!state.plans.length) { box.innerHTML = note + emptyHtml("No shoot schedule yet", EMPTY_TEXT + "."); return; }
  box.innerHTML = note + (state.view === "job" ? jobHtml() : state.view === "month" ? monthHtml() : agendaHtml());
}

/* ── drawing: the shoot ───────────────────────────────────────────────── */

function changeBox(c, s, plan, mine) {
  const l = V.changeLine(c, { shoots: planShoots(plan, state.shoots), plan, today: state.today, pc: state.pc });
  const can = canCancel(c, meId(), state.access);
  return '<div class="sh-box' + (l.status.cls === "refused" ? " refused" : l.status.cls === "ok" ? " ok" : "") + '" data-change="' + esc(c.id) + '">' +
    '<div class="t">' + esc(mine ? "Your change: " : "A change waiting: ") + T(l.title) + "</div>" +
    '<div class="s ' + esc(l.status.cls) + '">' + T(l.status.text) + "</div>" +
    (l.status.words ? '<div class="w">' + T(l.status.words) + "</div>" : "") +
    (l.when ? '<div class="w">Asked ' + esc(l.when) + "</div>" : "") +
    (can.ok ? '<button type="button" class="sh-btn" data-act="cancel-change" data-change="' + esc(c.id) + '">Cancel this change</button>' : "") +
    "</div>";
}

function factsHtml(s, plan) {
  const today = state.today;
  const d = V.dayLine(s, plan, today);
  const m = followsMilestone(s) ? plan.milestones[s.anchor] : null;
  const rows = [];
  let day = "<b>" + esc(d.day) + "</b>" + (d.window ? " · " + esc(d.window) : "");
  if (d.late) day += '<div class="late">' + esc("Late - " + plural(lateDays(s, today), "day") + " past its grace") + "</div>";
  rows.push(["Day", day]);
  rows.push(["Follows", esc(anchorText(s, plan)) + (m && m.date ? " (" + esc(dayText(m.date, today) + (m.firm ? " · Firm" : " · estimate")) + ")" : "")]);
  rows.push(["Phase", esc((PHASE_LABEL[s.phase] || s.phase || "") + (s.series && s.n ? " · visit " + s.n : ""))]);
  if (s.status === "announced") {
    rows.push(["Heads-up", movedNotTold(s) ? esc("Sent for " + dayText(s.announcedFor, today) + " - the shoot moved since; the photographer hears of it on the next reminder")
      : esc("Sent" + (s.announcedFor ? " for " + dayText(s.announcedFor, today) : ""))]);
  } else if (isOpen(s) && plan.leadDays) {
    rows.push(["Heads-up", esc("Goes out " + plural(plan.leadDays, "day") + " before the shoot")]);
  }
  rows.push(["Photographer", T(plan.photographerName || "No photographer yet")]);
  const done = V.doneLine(s, today);
  if (done) rows.push([s.status === "done" ? "Done" : "Closed", T(done)]);
  return '<dl class="sh-facts">' + rows.map((r) => "<dt>" + esc(r[0]) + "</dt><dd>" + r[1] + "</dd>").join("") + "</dl>";
}

function actionsHtml(s, plan) {
  const parts = [];
  let why = "";
  if (editor()) {
    const pending = pendingFor(state.changes, s);
    const act = shootActions(s, plan, state.access, { pending });
    const undo = V.undoFor(state.changes, s, meId(), state.access, new Date());
    if (act.move.ok) parts.push('<button type="button" class="sh-btn primary" data-act="move" data-shoot="' + esc(s.id) + '">Move…</button>');
    if (act.done.ok) parts.push('<button type="button" class="sh-btn ok" data-act="done" data-shoot="' + esc(s.id) + '">Mark done…</button>');
    if (undo) parts.push('<button type="button" class="sh-btn warn" data-act="undo" data-shoot="' + esc(s.id) + '" data-change="' + esc(undo.id) + '" title="' +
      T(V.changeLine(undo, { shoots: planShoots(plan, state.shoots), plan, today: state.today }).title) + '">Undo my last change…</button>');
    if (!act.move.ok && !pending) why = act.move.why;
  }
  if (s.taskId && editor()) parts.push('<a class="sh-btn" href="my-tasks.html?task=' + esc(s.taskId) + '">✅ Its task in My Tasks</a>');
  return (parts.length ? '<div class="sh-acts">' + parts.join("") + "</div>" : "") + (why ? '<div class="sh-ro">' + esc(why) + "</div>" : "");
}

function briefHtml(s) {
  const sections = V.briefSections(s.brief);
  if (!sections.length) return "";
  return '<h3 class="sh-h3">Brief</h3><div class="sh-brief">' + sections.map((x) => {
    if (x.lines) {
      return "<h4>" + esc(x.title) + '</h4><ul class="sh-shots">' + x.lines.map((l) => "<li>" + (l.title ? "<b>" + T(l.title) + "</b>" : "") + (l.text ? T(l.text) : "") +
        (l.tags.length ? '<span class="tags">' + l.tags.map((t) => '<span class="sh-chip dim">' + esc(t) + "</span>").join("") + "</span>" : "") + "</li>").join("") + "</ul>";
    }
    if (x.items.length === 1 && ["purpose", "time", "sample", "drone"].indexOf(x.key) !== -1) return "<h4>" + esc(x.title) + "</h4><p>" + T(x.items[0]) + "</p>";
    return "<h4>" + esc(x.title) + '</h4><ul class="sh-list">' + x.items.map((i) => "<li>" + T(i) + "</li>").join("") + "</ul>";
  }).join("") + "</div>";
}

function historyHtml(s) {
  const lines = V.historyLines(s, state.today);
  if (!lines.length) return "";
  return '<h3 class="sh-h3">History <span class="sh-n">' + lines.length + '</span></h3><ol class="sh-hist">' + lines.map((l) =>
    "<li>" + (l.when ? '<div class="when">' + esc(l.when) + "</div>" : "") + "<div>" + esc(l.text) + (l.meta ? " " + T(l.meta) : "") + "</div>" +
    (l.reason ? '<div class="why">' + T(l.reason) + "</div>" : "") + "</li>").join("") + "</ol>";
}

function detailHtml(s, plan) {
  const me = meId();
  const chips = shootChips(s, plan, state.today, { pending: pendingFor(state.changes, s) });
  const open = V.shootChanges(state.changes, s).filter((c) => isOpenChange(c));
  const recent = V.recentMine(state.changes, s, me, new Date());
  return '<div class="sh-dtop">' + chips.map(chipHtml).join("") + "</div>" +
    '<h2 class="sh-dtitle" id="shDTitle" tabindex="-1">' + T(s.name) + "</h2>" +
    '<div class="sh-dplace"><button type="button" data-act="plan" data-plan="' + esc(plan.id) + '">' + T(plan.label) + "</button>" +
    (plan.city ? " · " + T(plan.city) : "") + (plan.status !== "active" ? " · " + esc(V.planFacts(plan).statusText) : "") + "</div>" +
    factsHtml(s, plan) +
    open.map((c) => changeBox(c, s, plan, c.requestedBy === me)).join("") +
    actionsHtml(s, plan) +
    (recent.length ? '<h3 class="sh-h3">Your recent changes</h3>' + recent.map((c) => changeBox(c, s, plan, true)).join("") : "") +
    briefHtml(s) + historyHtml(s);
}

function lock(on) {
  try { document.documentElement.classList.toggle("sh-locked", !!on); } catch (e) { /* */ }
}

function renderDetail() {
  const box = $("shDetail");
  const sc = $("shDScroll");
  if (!box || !sc) return;
  const s = state.sel ? shootOf(state.sel) : null;
  const plan = s ? planOf(s.planId) : null;
  box.classList.toggle("open", !!(s && plan) && (state.open || wide()));
  if (!s || !plan) {
    sc.innerHTML = '<div class="sh-ph">' + esc(state.sel && state.loaded ? V.GONE_TEXT : V.PLACEHOLDER) + "</div>";
    state.lastDetail = null;
    lock(state.open && !wide() && !!state.sel);
    return;
  }
  const keep = state.lastDetail === s.id ? sc.scrollTop : 0;
  if (state.lastDetail === s.id) keepFocus("shDScroll", () => { sc.innerHTML = detailHtml(s, plan); });
  else sc.innerHTML = detailHtml(s, plan);
  sc.scrollTop = keep;
  state.lastDetail = s.id;
  lock((state.open && !wide()) || !!state.mv);
}

function render() {
  renderHead();
  renderList();
  renderDetail();
}

/* ── the address and opening a shoot ──────────────────────────────────── */

function setUrl(push) {
  try {
    const url = V.linkFor({ shoot: state.sel, plan: state.view === "job" ? state.planFocus : null, view: state.view, month: state.month });
    if (push && W.history && W.history.pushState) W.history.pushState({ sh: state.sel || 0 }, "", url);
    else if (W.history && W.history.replaceState) W.history.replaceState(W.history.state, "", url);
  } catch (e) { /* not important */ }
}

function openShoot(id, o) {
  const s = shootOf(id);
  if (!s) return;
  const push = !!(o && o.push) && !wide() && !state.open;
  state.sel = s.id;
  state.open = true;
  state.lastDetail = null;
  if (push) state.pushed = true;
  setUrl(push);
  render();
  try {
    const t = $("shDTitle");
    if (t && (!wide() || (o && o.focus))) t.focus();
  } catch (e) { /* */ }
}

function closeShoot(fromHistory) {
  if (!fromHistory && state.pushed && W.history && W.history.back) {
    state.pushed = false;
    W.history.back();                       // popstate closes it (the phone's Back does the same)
    return;
  }
  const was = state.sel;
  state.pushed = false;
  state.open = false;
  state.sel = null;
  setUrl(false);
  render();
  try {
    const row = document.querySelector('[data-shoot="' + was + '"]');
    if (row && row.focus) row.focus();
  } catch (e) { /* */ }
}

function setView(v) {
  if (V.VIEW_KEYS.indexOf(v) === -1) return;
  state.view = v;
  if (v !== "job") state.planFocus = null;
  if (v === "month" && !state.month) state.month = state.today.slice(0, 7);
  setUrl(false);
  render();
}

/** Follow the address once the mirror is read: a shoot (its own id, or a My Tasks task's), a plan, the view. */
async function follow(link) {
  if (link.view) state.view = link.view;
  if (link.month) state.month = link.month;
  let id = link.shoot;
  if (!id && link.task) {
    let hit = null;
    try { hit = await repo.shootForTask(link.task); } catch (e) { hit = null; }
    id = hit ? hit.id : null;
    if (!id) { state.msg = V.TASK_GONE_TEXT; return; }
  }
  if (id) {
    const s = shootOf(id);
    if (!s) { state.msg = V.GONE_TEXT; return; }
    const plan = planOf(s.planId);
    if (plan && plan.status === "archived") state.archived = true;
    if (state.view === "month" && isDay(s.plannedDate)) state.month = s.plannedDate.slice(0, 7);
    state.sel = s.id;
    state.open = true;
    state.lastDetail = null;
    setUrl(false);
    return;
  }
  if (link.plan) {
    const plan = planOf(link.plan);
    if (!plan) { state.msg = V.PLAN_GONE_TEXT; return; }
    state.view = "job";
    state.planFocus = plan.id;
    if (plan.status === "archived") state.archived = true;
  }
}

/* ── the sheets: Move…, Mark done…, Undo… ─────────────────────────────── */

function sheetOpen(on) {
  try { document.documentElement.classList.toggle("sh-sheet", !!on); } catch (e) { /* */ }
}

function sheetShell(title, body, foot, closeLabel) {
  return '<div class="sh-mo" id="shMo" role="dialog" aria-modal="true" aria-labelledby="mvTitle"><div class="sh-mo-card">' +
    '<div class="sh-mo-hd"><h3 id="mvTitle">' + title + '</h3><button type="button" class="sh-x" data-act="mv-close" aria-label="' + esc(closeLabel) + '">×</button></div>' +
    '<div class="sh-mo-body">' + body + "</div>" +
    '<div class="sh-mo-ft"><span class="sh-mo-msg" id="mvMsg" role="alert"></span>' + foot + "</div></div></div>";
}

function mvShoot() { return state.mv ? shootOf(state.mv.shootId) : null; }
function mvPlan() { return state.mv ? planOf(state.mv.planId) : null; }

function setMsg(text, kind) {
  if (!state.mv) return;
  state.mv.msg = text || "";
  state.mv.msgKind = kind || "";
  const n = $("mvMsg");
  if (n) { n.textContent = state.mv.msg; n.className = "sh-mo-msg" + (state.mv.msgKind ? " " + state.mv.msgKind : ""); }
}

function nowLine(s, plan) {
  return '<p class="mv-now">' + T(plan.label) + " · now <b>" + esc(isDay(s.plannedDate) ? dayText(s.plannedDate, state.today) : "no date yet") + "</b>" +
    (followsMilestone(s) ? " · " + esc(anchorText(s, plan)) : "") + "</p>";
}

/** Move… (owner decision 2): the three choices with "Only this shoot" preselected, the day, the preview. */
function openMove(id) {
  const s = shootOf(id);
  const plan = s ? planOf(s.planId) : null;
  if (!s || !plan) return;
  const ms = followsMilestone(s) ? s.anchor : MILESTONES[0];
  state.mv = { type: "move", shootId: s.id, planId: plan.id, baseRev: plan.rev, kind: "move_one", day: null, milestone: ms, msDay: null,
    firm: !!(plan.milestones[ms] && plan.milestones[ms].firm), start: null, seq: 0, timer: null, pv: null, words: null, pvError: "", pending: false,
    busy: false, msg: "", msgKind: "", opener: "move" };
  const body = nowLine(s, plan) +
    '<fieldset class="mv-fs" id="mvChoices"></fieldset><div id="mvMs"></div><div id="mvDay"></div>' +
    '<div class="mv-note" id="mvNote" role="status"></div><div id="mvFirmRow"></div>' +
    '<label class="mv-lab" for="mvReason">Why (optional)</label>' +
    '<input class="mv-reason" id="mvReason" maxlength="' + REASON_MAX + '" autocomplete="off" placeholder="e.g. Rain in the forecast" />' +
    '<div class="mv-pv wait" id="mvPreview" aria-live="polite"></div>';
  const foot = '<button type="button" class="sh-btn" data-act="mv-close">Cancel</button>' +
    '<button type="button" class="sh-btn primary" id="mvApply" data-act="mv-apply" disabled>Apply</button>';
  $("shSheet").innerHTML = sheetShell("Move " + T(s.name), body, foot, "Close without moving");
  fillMove();
  lock(true);
  sheetOpen(true);
  try { const first = document.querySelector('#mvChoices input[value="move_one"]'); if (first && first.focus) first.focus(); } catch (e) { /* */ }
}

/** Redraw a part of the sheet and keep the keyboard where it was (the same choice or day, found by its value). */
function keepFocus(boxId, draw) {
  let key = null;
  try {
    const a = document.activeElement;
    const box = $(boxId);
    if (a && box && box.contains(a)) {
      key = { day: a.getAttribute("data-day"), id: a.getAttribute("id"), value: a.getAttribute("value"), act: a.getAttribute("data-act"), change: a.getAttribute("data-change") };
    }
  } catch (e) { key = null; }
  draw();
  if (!key) return;
  try {
    const box = $(boxId);
    if (!box) return;
    const hit = (key.day && box.querySelector('[data-day="' + key.day + '"]')) || (key.id && $(key.id)) ||
      (key.change && key.act && box.querySelector('[data-act="' + key.act + '"][data-change="' + key.change + '"]')) ||
      (key.value && key.act && box.querySelector('[data-act="' + key.act + '"][value="' + key.value + '"]')) || (key.act && box.querySelector('[data-act="' + key.act + '"]'));
    if (hit && hit.focus) hit.focus();
  } catch (e) { /* */ }
}

const CHOICE_HINT = {
  move_one: "The other shoots stay on their days.",
  move_later: "The later shoots move by the same number of days (on to the next shoot day).",
  milestone: "Pick which job date moved, and its new day: the shoots that follow it move with it.",
};

function fillChoices(s, plan) {
  const mv = state.mv;
  $("mvChoices").innerHTML = '<legend>What moved?</legend>' + moveChoices(s, plan).map((c) =>
    '<label class="mv-choice' + (mv.kind === c.kind ? " on" : "") + (c.ok ? "" : " off") + '"><input type="radio" name="mvKind" value="' + esc(c.kind) + '"' +
    (mv.kind === c.kind ? " checked" : "") + (c.ok ? "" : " disabled") + ' data-act="mv-kind" /><span><b>' + esc(c.label) + "</b><small>" +
    esc(c.ok ? CHOICE_HINT[c.kind] : c.why) + "</small></span></label>").join("");
}

function fillMilestones(s, plan) {
  const mv = state.mv;
  const box = $("mvMs");
  if (mv.kind !== "milestone") { box.innerHTML = ""; return; }
  const c = moveChoices(s, plan).find((x) => x.kind === "milestone");
  box.innerHTML = '<fieldset class="mv-fs"><legend>Which job date</legend><div class="mv-ms">' + c.milestones.map((m) =>
    '<label class="mv-choice' + (mv.milestone === m.key ? " on" : "") + '"><input type="radio" name="mvMs" value="' + esc(m.key) + '"' +
    (mv.milestone === m.key ? " checked" : "") + ' data-act="mv-ms" /><span><b>' + esc(m.label) + "</b><small>" +
    esc((m.date ? dayText(m.date, state.today) : "No date yet") + (m.firm ? " · Firm" : m.date ? " · estimate" : "") + (m.followed ? " · this shoot follows it" : "")) +
    "</small></span></label>").join("") + "</div></fieldset>";
}

function pickedDay() { const mv = state.mv; return mv.kind === "milestone" ? mv.msDay : mv.day; }

function fillDay(s, plan) {
  const mv = state.mv;
  const ms = mv.kind === "milestone" ? plan.milestones[mv.milestone] : null;
  const current = mv.kind === "milestone" ? (ms && ms.date) || null : s.plannedDate;
  const picked = pickedDay();
  const b = V.bounds(mv.kind, state.today);
  const days = V.dayStrip(picked || current || state.today, { today: state.today, kind: mv.kind, shootDays: plan.shootDays, current, picked, start: mv.start });
  const label = mv.kind === "milestone" ? "New day for " + MILESTONE_LABEL[mv.milestone] : "New day";
  $("mvDay").innerHTML = '<span class="mv-lab" id="mvDayLab">' + esc(label) + "</span>" +
    '<div class="mv-strip" role="group" aria-labelledby="mvDayLab"><button type="button" class="mv-nav" data-act="strip-prev" aria-label="Earlier days">‹</button>' +
    '<div class="mv-days">' + days.map((d) => '<button type="button" class="mv-d' + (d.shootDay ? "" : " off") + (d.isToday ? " today" : "") + (d.current ? " cur" : "") +
      '" data-act="pick" data-day="' + esc(d.day) + '" aria-pressed="' + (d.picked ? "true" : "false") + '" aria-label="' +
      esc(dayText(d.day, state.today) + (d.shootDay ? "" : " - not a shoot day") + (d.current ? " - its day now" : "")) + '">' +
      '<span class="wd">' + esc(d.wd) + '</span><span class="n">' + esc(d.date) + '</span><span class="m">' + esc(d.mon) + "</span></button>").join("") + "</div>" +
    '<button type="button" class="mv-nav" data-act="strip-next" aria-label="Later days">›</button></div>' +
    '<div class="mv-other"><label for="mvDate">Another day</label><input type="date" id="mvDate" data-act="mv-date" min="' + esc(b.min) + '" max="' + esc(b.max) + '" value="' +
    esc(picked || "") + '" /></div>';
}

function fillNote(s, plan) {
  const mv = state.mv;
  const day = pickedDay();
  let note = "";
  const b = V.bounds(mv.kind, state.today);
  if (day && !V.inBounds(mv.kind, day, state.today)) note = "Pick a day from " + dayText(b.min, state.today) + " to " + dayText(b.max, state.today) + ".";
  else if (mv.kind === "milestone" && V.needsOffice(plan, mv.milestone, state.access)) note = V.officeLine(mv.milestone);
  else if (day) note = V.nonShootNote(mv.kind, day, plan);
  $("mvNote").textContent = note;
}

function fillFirm(plan) {
  const mv = state.mv;
  const row = $("mvFirmRow");
  if (mv.kind !== "milestone" || !(state.access && state.access.admin)) { row.innerHTML = ""; return; }
  row.innerHTML = '<label class="mv-firm"><input type="checkbox" id="mvFirm" data-act="mv-firm"' + (mv.firm ? " checked" : "") + " /> " +
    esc("Firm - the office's date (a photographer's move of it then goes to the office)") + "</label>";
}

function fillMove() {
  const mv = state.mv;
  const s = mvShoot();
  const plan = mvPlan();
  if (!mv || mv.type !== "move") return;
  if (!s || !plan) { setMsg(V.GONE_TEXT, "error"); fillApply(); return; }
  keepFocus("mvChoices", () => fillChoices(s, plan));
  keepFocus("mvMs", () => fillMilestones(s, plan));
  keepFocus("mvDay", () => fillDay(s, plan));
  fillNote(s, plan);
  keepFocus("mvFirmRow", () => fillFirm(plan));
  fillPreview();
}

/** {kind, args} for what the sheet holds now (null while a piece is missing); withReason: the typed reason too. */
function argsNow(withReason) {
  const mv = state.mv;
  const s = mvShoot();
  if (!mv || !s) return null;
  const reasonBox = $("mvReason");
  const reason = withReason && reasonBox ? reasonBox.value : "";
  if (mv.type === "done") return moveArgs({ kind: "done", shoot: s.key, note: $("dnNote") ? $("dnNote").value : "" });
  if (mv.type === "undo") return moveArgs({ kind: "undo", change: mv.change });
  if (mv.kind === "milestone") {
    if (!V.inBounds("milestone", mv.msDay, state.today)) return null;
    const pick = { kind: "milestone", milestone: mv.milestone, date: mv.msDay, reason };
    if (state.access && state.access.admin) pick.firm = !!mv.firm;
    return moveArgs(pick);
  }
  if (!V.inBounds(mv.kind, mv.day, state.today)) return null;
  return moveArgs({ kind: mv.kind, shoot: s.key, to: mv.day, reason });
}

function schedulePreview() {
  const mv = state.mv;
  if (!mv) return;
  clearTimeout(mv.timer);
  mv.seq += 1;                           // an answer still on its way is for an older pick
  mv.pending = !!argsNow(false);
  fillPreview();
  mv.timer = setTimeout(runPreview, 300);
}

async function runPreview() {
  const mv = state.mv;
  if (!mv) return;
  clearTimeout(mv.timer);
  const want = argsNow(false);
  const seq = ++mv.seq;
  if (!want) { mv.pv = null; mv.words = null; mv.pvError = ""; mv.pending = false; fillPreview(); return; }
  mv.pending = true;
  fillPreview();
  const plan = mvPlan();
  try {
    const pv = await repo.preview(mv.planId, want.kind, want.args);
    if (state.mv !== mv || seq !== mv.seq) return;
    mv.pv = pv;
    mv.words = previewWords(pv, { plan: mvPlan() || plan, shoots: planShoots(mvPlan() || plan, state.shoots), today: (pv && pv.today) || state.today });
    mv.pvError = "";
  } catch (e) {
    if (state.mv !== mv || seq !== mv.seq) return;
    mv.pv = null;
    mv.words = null;
    mv.pvError = e && e.retryable ? "No connection - the preview could not be made." : V.requestProblem(e, { milestone: want.args.milestone });
  }
  mv.pending = false;
  fillPreview();
}

function stayWhy(st) {
  return st.text.indexOf(st.name + ": ") === 0 ? st.text.slice(st.name.length + 2) : st.text;
}

function previewHtml(mv) {
  const w = mv.words;
  if (mv.pvError) return '<div class="no">' + esc(mv.pvError) + '</div><button type="button" class="sh-btn" data-act="mv-repreview">Try again</button>';
  if (!w) {
    if (mv.pending) return "Checking what moves…";
    if (mv.type === "move") return esc(mv.kind === "milestone" ? "Pick the job date's new day to see every shoot that moves." : "Pick the new day to see every shoot that moves.");
    return "";
  }
  if (w.refused) return '<div class="no">' + esc(w.refused.text) + "</div>";
  const out = [];
  const nothing = !w.moved.length && !w.passed.length;
  out.push('<div class="sum">' + esc(mv.type === "move" && mv.kind === "milestone" && nothing ? "No shoot moves - only the job date changes" : w.summary) +
    (mv.pending ? " · checking again…" : "") + "</div>");
  if (w.office) out.push('<div class="office">' + esc(V.officeLine(mv.kind === "milestone" ? mv.milestone : (mvShoot() || {}).anchor)) + "</div>");
  if (w.done) out.push("<p>" + T(w.done.text) + "</p>");
  if (w.moved.length) {
    out.push("<h4>" + esc((mv.type === "undo" ? "Goes back" : "Will move") + " (" + w.moved.length + ")") + "</h4><ul>" + w.moved.map((m) => "<li><b>" + T(m.name) +
      '</b> <span class="from-to">' + esc(m.fromText + " → " + m.toText) + "</span>" + m.notes.map((n) => '<span class="nt">' + esc(n.text) + "</span>").join("") + "</li>").join("") + "</ul>");
  }
  if (w.stays.length) {
    out.push("<h4>" + esc("Stays (" + w.stays.length + ")") + "</h4><ul>" + w.stays.map((st) => "<li><b>" + T(st.name) + '</b> <span class="why">' + T(stayWhy(st)) + "</span></li>").join("") + "</ul>");
  }
  if (w.passed.length) {
    out.push("<h4>" + esc("Will be skipped (" + w.passed.length + ")") + "</h4><ul>" + w.passed.map((p) => "<li>" + T(p.text) + "</li>").join("") + "</ul>");
  }
  if (w.replan.length) out.push("<h4>Re-planned</h4><ul>" + w.replan.map((r) => "<li>" + T(r.text) + "</li>").join("") + "</ul>");
  return out.join("");
}

function fillApply() {
  const mv = state.mv;
  const b = $("mvApply");
  if (!mv || !b) return;
  const ok = mv.type === "done" ? !!mvShoot() : !!(mv.words && mv.words.ok && !mv.pending && !mv.pvError && argsNow(false));
  b.disabled = !ok || mv.busy;
  const label = mv.type === "done" ? "Mark done" : mv.type === "undo" ? "Undo" : V.applyLabel(mv.words);
  b.textContent = mv.busy ? "Sending…" : label;
}

function fillPreview() {
  const mv = state.mv;
  const n = $("mvPreview");
  if (!mv || !n) return;
  n.innerHTML = previewHtml(mv);
  n.className = "mv-pv" + (mv.pending || !mv.words ? " wait" : "");
  fillApply();
}

/** Mark done… : an optional note; the sheet is the confirm. */
function openDone(id) {
  const s = shootOf(id);
  const plan = s ? planOf(s.planId) : null;
  if (!s || !plan) return;
  state.mv = { type: "done", shootId: s.id, planId: plan.id, baseRev: plan.rev, busy: false, msg: "", msgKind: "", seq: 0, opener: "done" };
  const ahead = isDay(s.plannedDate) && s.plannedDate > state.today;
  const body = nowLine(s, plan) +
    (ahead ? '<div class="mv-note">' + esc("Its day (" + dayText(s.plannedDate, state.today) + ") is still ahead - mark it done only if it was shot.") + "</div>" : "") +
    '<label class="mv-lab" for="dnNote">A note (optional)</label>' +
    '<textarea class="mv-text" id="dnNote" maxlength="' + NOTE_MAX + '" rows="3" placeholder="e.g. All shots taken, files on their way"></textarea>' +
    '<p class="mv-now" style="margin-top:10px">' + esc("The office computer marks it done and closes its task on My Tasks. A shoot marked done is not undone here.") + "</p>";
  const foot = '<button type="button" class="sh-btn" data-act="mv-close">Cancel</button>' +
    '<button type="button" class="sh-btn ok" id="mvApply" data-act="mv-apply">Mark done</button>';
  $("shSheet").innerHTML = sheetShell("Mark " + T(s.name) + " done", body, foot, "Close without marking it done");
  fillApply();
  lock(true);
  sheetOpen(true);
  try { const t = $("dnNote"); if (t && t.focus) t.focus(); } catch (e) { /* */ }
}

/** Undo… : my last applied change of this shoot (an admin: anyone's), with the preview of setting it back. */
function openUndo(id, changeId) {
  const s = shootOf(id);
  const plan = s ? planOf(s.planId) : null;
  const c = state.changes.find((x) => x.id === Number(changeId));
  if (!s || !plan || !c) return;
  const line = V.changeLine(c, { shoots: planShoots(plan, state.shoots), plan, today: state.today });
  state.mv = { type: "undo", shootId: s.id, planId: plan.id, baseRev: plan.rev, change: c.id, busy: false, msg: "", msgKind: "", seq: 0, pv: null, words: null,
    pvError: "", pending: true, timer: null, opener: "undo" };
  const body = '<p class="mv-now"><b>' + T(line.title) + "</b>" + (line.when ? " · " + esc(line.when) : "") + "</p>" +
    '<div class="mv-pv wait" id="mvPreview" aria-live="polite"></div>';
  const foot = '<button type="button" class="sh-btn" data-act="mv-close">Keep it</button>' +
    '<button type="button" class="sh-btn warn" id="mvApply" data-act="mv-apply" disabled>Undo</button>';
  $("shSheet").innerHTML = sheetShell("Undo this change?", body, foot, "Close without undoing");
  fillPreview();
  lock(true);
  sheetOpen(true);
  runPreview();
}

/** Close the sheet. The keyboard goes back to the button that opened it (Move…, Mark done…, Undo…) while it is still
    there, else to the shoot's title (a change sent: the shoot is drawn again without that button). */
function closeSheet() {
  const mv = state.mv;
  if (mv) clearTimeout(mv.timer);
  state.mv = null;
  if ($("shSheet")) $("shSheet").innerHTML = "";
  lock(state.open && !wide());
  sheetOpen(false);
  try {
    const back = mv && mv.opener ? document.querySelector('#shDScroll [data-act="' + mv.opener + '"]') : null;
    const t = back || $("shDTitle");
    if (t && t.focus) t.focus();
  } catch (e) { /* */ }
  // what the office computer answered while the sheet was open
  const held = state.held.splice(0);
  held.forEach(say);
}

/** The controls of the open sheet the keyboard reaches, in order (a radio group is one stop: its ticked choice). */
function sheetStops() {
  const mo = $("shMo");
  if (!mo) return [];
  return Array.prototype.filter.call(mo.querySelectorAll("button, input, textarea, select, a[href], [tabindex]:not([tabindex='-1'])"), (n) =>
    !n.disabled && n.getClientRects().length && !(n.type === "radio" && !n.checked && mo.querySelector('input[type=radio][name="' + n.name + '"]:checked')));
}

/** Apply / Mark done / Undo: photo_change_request with the rev this screen read. */
async function apply() {
  const mv = state.mv;
  if (!mv || mv.busy || mv.pending) return;
  const want = argsNow(true);
  if (!want) return;
  if (mv.type !== "done" && !(mv.words && mv.words.ok)) return;
  mv.busy = true;
  setMsg("", "");
  fillApply();
  try {
    const r = await repo.request(mv.planId, want.kind, want.args, mv.baseRev);
    if (r && r.id !== null && r.id !== undefined && state.seen[r.id] === undefined) state.seen[r.id] = isOpenChange(r) ? r.state : "new";
    if (state.mv === mv) closeSheet();
    const t = V.sentText(r, state.pc);
    toast(t.text, t.kind === "ok" ? "ok" : "info");
    await load({ quiet: true });
  } catch (e) {
    if (state.mv !== mv) return;
    mv.busy = false;
    if (e && e.reason === "changed") {
      await load({ quiet: true });
      if (state.mv !== mv) return;
      const plan = mvPlan();
      if (plan) mv.baseRev = plan.rev;
      if (mv.type === "move") fillMove();
      setMsg(V.CHANGED_TEXT, "info");
      if (mv.type === "done") { fillApply(); return; }
      runPreview();
      return;
    }
    setMsg(e && e.retryable ? refusalText("offline") : V.requestProblem(e, { milestone: want.args && want.args.milestone, where: mv.type === "undo" ? "undo" : "request" }), "error");
    fillApply();
  }
}

async function cancelChange(id) {
  const c = state.changes.find((x) => x.id === Number(id));
  if (!c) return;
  if (!(await confirmBox("It has not been applied yet: cancelled, nothing changes on the shoot.", { title: "Cancel this change?", okText: "Cancel the change", cancelText: "Keep it" }))) return;
  try {
    const r = await repo.cancel(c.id);
    state.seen[c.id] = r.status || state.seen[c.id];
    toast(r.ok ? "Cancelled - nothing changed." : "Too late - the office computer has taken it already.", r.ok ? "ok" : "info");
  } catch (e) {
    toast(e && e.retryable ? refusalText("offline") : refusalText(e && e.reason, { where: "cancel", message: e && e.message }), "error");
  }
  await load({ quiet: true });
}

/* ── events ───────────────────────────────────────────────────────────── */

function onClick(ev) {
  const t = ev.target && ev.target.closest ? ev.target : null;
  if (!t) return;
  const v = t.closest("[data-view]");
  if (v) { setView(v.getAttribute("data-view")); return; }
  const a = t.closest("[data-act]");
  const act = a ? a.getAttribute("data-act") : "";
  const mv = state.mv;
  if (act === "mv-close") { closeSheet(); return; }
  if (act === "mv-apply") { apply(); return; }
  if (act === "mv-repreview") { runPreview(); return; }
  if (act === "pick" && mv) {
    const d = a.getAttribute("data-day");
    if (mv.kind === "milestone") mv.msDay = d; else mv.day = d;
    const first = document.querySelector("#mvDay [data-act=pick]");
    if (first) mv.start = first.getAttribute("data-day");       // the strip stays where it is under the finger
    const s = mvShoot(), plan = mvPlan();
    if (s && plan) { keepFocus("mvDay", () => fillDay(s, plan)); fillNote(s, plan); }
    schedulePreview();
    return;
  }
  if ((act === "strip-prev" || act === "strip-next") && mv) {
    const s = mvShoot(), plan = mvPlan();
    if (!s || !plan) return;
    const first = document.querySelector("#mvDay [data-act=pick]");
    const base = first ? first.getAttribute("data-day") : state.today;
    mv.start = addDays(base, act === "strip-prev" ? -7 : 7);
    keepFocus("mvDay", () => fillDay(s, plan));
    return;
  }
  if (act === "mv-kind" || act === "mv-ms" || act === "mv-firm" || act === "mv-date") return;   // their change event does it
  if (act === "move") { openMove(a.getAttribute("data-shoot")); return; }
  if (act === "done") { openDone(a.getAttribute("data-shoot")); return; }
  if (act === "undo") { openUndo(a.getAttribute("data-shoot"), a.getAttribute("data-change")); return; }
  if (act === "cancel-change") { cancelChange(a.getAttribute("data-change")); return; }
  if (act === "reload") { if (state.accessError && W.location) W.location.reload(); else load(); return; }
  if (act === "fold") { const det = a.closest("details"); state.openClosed = !(det && det.open); return; }
  if (act === "all-jobs") { state.planFocus = null; setUrl(false); render(); return; }
  if (act === "plan") {
    state.view = "job";
    state.planFocus = Number(a.getAttribute("data-plan"));
    if (!wide()) { state.open = false; state.sel = null; state.pushed = false; }
    setUrl(false);
    render();
    try { const n = $("shPlan" + state.planFocus); if (n && n.scrollIntoView) n.scrollIntoView({ block: "start" }); } catch (e) { /* */ }
    return;
  }
  if (act === "day") {
    const d = a.getAttribute("data-day");
    state.day = state.day === d ? null : d;
    renderList();
    try { const n = $("shDayList"); if (n && n.scrollIntoView && !wide()) n.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (e) { /* */ }
    return;
  }
  if (act === "month-prev" || act === "month-next" || act === "month-today") {
    const g = monthGrid(state.month || state.today.slice(0, 7), [], [], state.today, {});
    state.month = act === "month-today" ? state.today.slice(0, 7) : act === "month-prev" ? g.prev : g.next;
    state.day = null;
    setUrl(false);
    renderList();
    return;
  }
  const row = t.closest("[data-shoot]");
  if (row && !t.closest("#shSheet") && !t.closest("#shDScroll")) { openShoot(Number(row.getAttribute("data-shoot")), { push: true }); return; }
  if (t.closest("#shBack") || t.closest("#shClose")) { closeShoot(false); return; }
  if (mv && t.id === "shMo") closeSheet();            // a tap on the shade
}

function onChange(ev) {
  const t = ev.target;
  if (!t || !t.getAttribute) return;
  const mv = state.mv;
  const s = mvShoot(), plan = mvPlan();
  const act = t.getAttribute("data-act");
  if (t.id === "shMine") { state.mine = !!t.checked; render(); return; }
  if (t.id === "shArchived") { state.archived = !!t.checked; render(); return; }
  if (!mv || !s || !plan) return;
  if (act === "mv-kind") {
    mv.kind = t.value;
    mv.start = null;
    fillMove();
    schedulePreview();
  } else if (act === "mv-ms") {
    mv.milestone = t.value;
    mv.firm = !!(plan.milestones[mv.milestone] && plan.milestones[mv.milestone].firm);
    mv.msDay = null;
    mv.start = null;
    fillMove();
    schedulePreview();
  } else if (act === "mv-firm") {
    mv.firm = !!t.checked;
    schedulePreview();
  } else if (act === "mv-date") {
    const d = String(t.value || "");
    if (!isDay(d)) return;
    if (mv.kind === "milestone") mv.msDay = d; else mv.day = d;
    mv.start = null;
    keepFocus("mvDay", () => fillDay(s, plan));
    fillNote(s, plan);
    schedulePreview();
  }
}

function onKey(e) {
  if (e.defaultPrevented) return;                             // a dialog of the site's own took it
  if (e.key === "Tab" && state.mv) {
    const f = sheetStops();
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
    return;
  }
  if (e.key !== "Escape") return;
  if (state.mv) { e.preventDefault(); closeSheet(); return; }
  if (state.open && !wide() && state.sel) { e.preventDefault(); closeShoot(false); }
}

function onPop() {
  const link = V.parseLink(W.location ? W.location.search : "");
  if (state.mv) closeSheet();
  if (!link.shoot && state.open && !wide()) { closeShoot(true); return; }
  if (link.shoot && shootOf(link.shoot) && link.shoot !== state.sel) { state.sel = link.shoot; state.open = true; render(); }
}

function wire() {
  if (state.wired || typeof document === "undefined") return;
  state.wired = true;
  const root = $("shRoot") || document;
  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);
  document.addEventListener("keydown", onKey);
  if (W.addEventListener) W.addEventListener("popstate", onPop);
  try {
    if (W.matchMedia) {
      const mq = W.matchMedia("(min-width: 1024px)");
      const again = () => render();
      if (mq.addEventListener) mq.addEventListener("change", again); else if (mq.addListener) mq.addListener(again);
    }
  } catch (e) { /* */ }
}

/** Realtime: the four tables (repo/photo.js watchSchedule reads again on every join and change); the office computer's
    state every minute (it is not a table) and when the page is shown again; and every 20 s while a change of mine waits
    (a channel that dropped never leaves it waiting on screen). */
async function watch() {
  try { state.stopWatch = await repo.watchSchedule(() => load({ quiet: true })); } catch (e) { /* the polls below still read */ }
  state.timers.push(setInterval(() => {
    repo.pcStatus().then((pc) => { state.pc = pc; renderHead(); }).catch(() => null);
  }, 60000));
  state.timers.push(setInterval(() => {
    if (state.changes.some((c) => c.requestedBy === meId() && isOpenChange(c))) load({ quiet: true });
  }, 20000));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") load({ quiet: true }); });
}

/** Everything after signing in: the gates, the first read, the address, the watch. o: {search (the address's query,
    default location.search), watch (false: none - tests)}. */
export async function init(me, o) {
  const opt = o || {};
  state.me = me;
  state.today = companyToday();
  wire();
  let access = null;
  try { access = await repo.myAccess(); } catch (e) { state.accessError = errorWords(e); }
  state.access = access;
  if (access && rememberPhotoAccess(me, access)) {
    try { if (typeof D().topbar === "function") D().topbar("shoots"); } catch (e) { /* */ }
  }
  if (!access || !access.ready || !access.canRead) { render(); return; }
  await load();
  await follow(V.parseLink(opt.search !== undefined ? opt.search : W.location ? W.location.search : ""));
  render();
  if (state.sel && wide()) {
    try { const row = document.querySelector('.sh-listcol [data-shoot="' + state.sel + '"]'); if (row && row.scrollIntoView) row.scrollIntoView({ block: "nearest" }); } catch (e) { /* */ }
  } else if (state.sel && state.open) {
    try { const t = $("shDTitle"); if (t && t.focus) t.focus(); } catch (e) { /* */ }
  }
  if (opt.watch !== false) watch();
}

/** Stop watching and polling (tests; a page being left). */
export function stop() {
  if (state.stopWatch) { try { state.stopWatch(); } catch (e) { /* */ } }
  state.stopWatch = null;
  state.timers.forEach((t) => clearInterval(t));
  state.timers = [];
}

async function start() {
  const me = await boot("shoots");
  document.title = "DCR Portal 2 — Shoot schedule";
  await init(me);
}

if (typeof document !== "undefined" && typeof window !== "undefined" && document.getElementById && !(window && window.__SH_TEST__)) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
}

/** Tests: back to a fresh page (the listeners of a new document are wired again). */
function reset() {
  stop();
  Object.assign(state, freshState());
}

export const _test = { state, reset, init, load, render, openShoot, closeShoot, openMove, openDone, openUndo, closeSheet, apply, runPreview, argsNow,
  previewHtml, detailHtml: (id) => { const s = shootOf(id); return s ? detailHtml(s, planOf(s.planId)) : ""; }, follow, setView, stop };
