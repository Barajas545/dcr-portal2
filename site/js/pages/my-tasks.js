/* My Tasks (port of the old portal's my-tasks.html / my-tasks.js; MODULES §5, BLUEPRINT 3.3.7, P3).

   Your open tasks, and the place to send an update on one. A reminder about a quiet task (DCR Agents
   2, by text, e-mail or a phone notice) links here as my-tasks.html?task=<id>, and so does the
   new-task notice: the task opens straight away with a box to say what was done.

   What changed under the old habits:
   - the lists come from rpc my_tasks ('mine', a lead's 'crew', the office's 'everyone' — Q3 is the
     database's rule), with the database's clock (app.task_clock: more than five days quiet = needs an
     update, Pacific days; a shoot is never stale before its day is over);
   - an update is rpc add_task_note: one line, at most 2,000 characters, written as a task_notes row
     (no more stamped text). Each send carries a key kept with the draft, so a send whose answer was
     lost is sent again with the same key and never adds a second note;
   - Mark complete is rpc complete_task: the status and the closing note in one transaction;
   - a task finished, handed to someone else or changed elsewhere while it is open arrives through
     Realtime (tasks, task_notes and the "no longer yours" tombstone): the page says so, and the words
     still in the box are shown back, never lost.

   Kept: needs-an-update first, the deep link, drafts per task on this phone (per account), the quick
   phrases and "Scheduled for…", the shoot brief with its shot list, the recurring chip, "Next:" after
   Saved, the phone's Back gesture closing the task, the keyboard-aware full-screen task view. */

import { boot, el, esc, errorText, maskFor, D, store } from "./shell.js";
import { companyToday } from "../common2.js";
import * as tasksRepo from "../repo/tasks.js";
import * as projectsRepo from "../repo/projects.js";
import {
  PHRASES, PHOTO_PHRASES, SHOOT_DONE, VIEW_LABELS, NOTE_MAX, viewsFor, whenText, previewText, placeOf, dirUrl, shootLabel,
  recurLabel, dueText, brief, leftAfterSend, withPhrase, needsFirst, byPerson, byDays, canWork, canCreate, clientKey,
  noteLabel, dayText, daysBetween, defaultView,
} from "../map/tasks.js";
import { openNewTask, isOpen as formOpen } from "./task-form.js";

const WIDE = window.matchMedia("(min-width: 960px)");
const SEG_LABELS = { mine: "Mine", crew: "My crew", everyone: "Everyone" };    // short: three fit on a phone
const FINE = window.matchMedia("(pointer: fine)");
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const S = {
  me: null, mask: function (t) { return t; },
  views: ["mine"], lists: {}, extra: {}, view: "mine",
  sel: "", pushed: false, loaded: false,
  /* tasks with a request still out, by id: "send" or "complete" (per task: on a slow signal a person
     sends on one task and moves on to the next, and that one's Send must go) */
  busy: {},
  live: null,
};

const today = function () { return companyToday(); };

/* ── this phone's drafts, ticked shots and chosen list (per account) ──────── */
const DRAFT = "dcr2:taskDraft:";
const SHOTS = "dcr2:taskShots:";
const VIEW = "dcr2:myTasksView:";
function draftKey(id) { return DRAFT + (S.me ? S.me.id : "") + ":" + id; }
function readDraft(id) {
  const raw = store.get(draftKey(id), "");
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    if (!d || Date.now() - Number(d.at || 0) > 30 * 86400000) { store.set(draftKey(id), null); return null; }
    return d;
  } catch (e) { return null; }
}
function getDraft(id) { const d = readDraft(id); return d ? String(d.t || "") : ""; }
/** The words in the box; `key` / `keyFor`: the client key of a send that is still out or whose answer
    was lost — it goes with those exact words, so a resend adds nothing twice. */
function setDraft(id, t, key, keyFor) {
  const keep = t && String(t).trim();
  if (!keep && !key) { store.set(draftKey(id), null); return; }
  const was = readDraft(id) || {};
  const d = { t: t || "", at: Date.now() };
  const k = key !== undefined ? key : was.key;
  const kf = keyFor !== undefined ? keyFor : was.keyFor;
  if (k) { d.key = k; d.keyFor = kf; }
  store.set(draftKey(id), JSON.stringify(d));
}
function dropKey(id) {
  const d = readDraft(id);
  if (!d) return;
  delete d.key; delete d.keyFor;
  if (String(d.t || "").trim()) store.set(draftKey(id), JSON.stringify(d)); else store.set(draftKey(id), null);
}
function shotsKey(id) { return SHOTS + (S.me ? S.me.id : "") + ":" + id; }
function getShots(id) {
  try {
    const d = JSON.parse(store.get(shotsKey(id), "null"));
    const out = {};
    ((d && d.done) || []).forEach(function (s) { out[String(s)] = true; });
    return out;
  } catch (e) { return {}; }
}
function setShot(id, shot, on) {
  const done = getShots(id);
  if (on) done[shot] = true; else delete done[shot];
  const list = Object.keys(done);
  store.set(shotsKey(id), list.length ? JSON.stringify({ done: list, at: Date.now() }) : null);
}

/* ── which task ───────────────────────────────────────────────────────── */
function visible() { return S.lists[S.view] || []; }
function find(id) {
  const k = String(id);
  const order = [S.view].concat(S.views);
  for (let i = 0; i < order.length; i++) {
    const hit = (S.lists[order[i]] || []).find(function (t) { return String(t.id) === k; });
    if (hit) return hit;
  }
  return S.extra[k] || null;
}
function viewHaving(id) {
  const k = String(id);
  if ((S.lists[S.view] || []).some(function (t) { return String(t.id) === k; })) return S.view;
  return S.views.find(function (v) { return (S.lists[v] || []).some(function (t) { return String(t.id) === k; }); }) || "";
}

/* ── the list ─────────────────────────────────────────────────────────── */
function chip(t) {
  return '<span class="mt-chip ' + esc(t.priKey) + '">' + esc(t.priorityLabel) + "</span>";
}
function photoChips(t) {
  if (!t.photo) return "";
  const sh = shootLabel(t, today());
  return '<span class="mt-chip photo">📷 Photo &amp; Video</span>' + (sh ? '<span class="mt-chip shoot ' + esc(sh.cls) + '">' + esc(sh.label) + "</span>" : "");
}
function recurChip(t) { return t.recurring ? '<span class="mt-chip recur">' + esc(recurLabel(t)) + "</span>" : ""; }
function dueChip(t) {
  const d = dueText(t, today());
  if (!d) return "";
  const n = daysBetween(today(), t.dueDate);
  return '<span class="mt-chip due' + (n === 0 ? " today" : n !== null && n < 0 ? " late" : "") + '">' + esc(d) + "</span>";
}
function chips(t) {
  return '<span class="mt-chips">' + photoChips(t) + recurChip(t) + dueChip(t) + chip(t) + "</span>";
}
function dirLink(t) {
  const pl = placeOf(t);
  const url = dirUrl(pl, t);
  if (!url || !pl.addr) return "";
  const q = [pl.addr, pl.city].filter(Boolean).join(", ");
  return '<a class="mt-dir" target="_blank" rel="noopener" href="' + esc(url) + '" aria-label="Directions to ' + esc(q) + ' (opens maps)">' +
    esc(pl.addr) + " ↗</a>";
}
function card(t) {
  const pl = placeOf(t);
  const place = '<div class="mt-place">' + (pl.project ? '<span class="proj">' + esc(pl.project) + "</span>" : t.projectId === null ? '<span class="proj">No project</span>' : "") +
    dirLink(t) + "</div>";
  return '<article class="mt-card' + (t.needsUpdate ? " needs" : "") + (String(S.sel) === String(t.id) ? " sel" : "") + '" data-task="' + esc(t.id) + '">' +
    '<button type="button" class="mt-open" data-open="' + esc(t.id) + '">' +
      '<span class="mt-row1"><span class="mt-name">' + esc(t.title) + "</span>" + chips(t) + "</span>" +
      '<span class="mt-when' + (t.needsUpdate ? " warn" : "") + '">' + esc(whenText(t)) + "</span>" +
      '<span class="mt-last">' + esc(previewText(t)) + "</span>" +
    "</button>" + place + "</article>";
}
function group(label, list, warn) {
  if (!list.length) return "";
  return '<h3 class="mt-grp">' + esc(label) + ' <span class="mt-n' + (warn ? " warn" : "") + '">' + list.length + "</span></h3>" + list.map(card).join("");
}
function countPeople(tasks) {
  const seen = {};
  tasks.forEach(function (t) { seen[t.assignedTo ? String(t.assignedTo) : "-"] = 1; });
  return Object.keys(seen).length;
}
function viewTitle(v) { return v === "mine" ? "My tasks" : VIEW_LABELS[v]; }

function renderHeader(tasks) {
  const needs = tasks.filter(function (t) { return t.needsUpdate; }).length;
  el("mtTitle").textContent = viewTitle(S.view);
  const sub = el("mtSub");
  if (!tasks.length) { sub.textContent = S.view === "mine" ? "Nothing open on your list right now." : "Nothing open right now."; return; }
  const people = countPeople(tasks);
  sub.innerHTML = (needs ? "<b>" + needs + (needs === 1 ? " needs" : " need") + " an update</b> · " : "All up to date · ") +
    tasks.length + " open" + (S.view === "mine" ? "" : " across " + people + (people === 1 ? " person" : " people")) +
    ". Tap a task to " + (S.me && S.me.role === "viewer" ? "read its updates." : "send an update.");
}

function renderSeg() {
  const seg = el("mtSeg");
  seg.hidden = S.views.length < 2;
  if (seg.hidden) { seg.innerHTML = ""; return; }
  seg.innerHTML = S.views.map(function (v) {
    const n = (S.lists[v] || []).length;
    return '<button type="button" data-view="' + v + '" aria-pressed="' + String(S.view === v) + '">' + esc(SEG_LABELS[v] + " (" + n + ")") + "</button>";
  }).join("");
}

function renderList() {
  if (!S.loaded) return;
  const list = el("mtList");
  list.removeAttribute("aria-busy");
  const tasks = visible();
  renderSeg();
  renderHeader(tasks);
  if (!tasks.length) {
    list.innerHTML = '<div class="mt-empty"><b>Nothing to update.</b>' +
      (S.view === "mine" && S.views.length > 1 ? "No open tasks are assigned to you. " : "") +
      "New tasks show up here as soon as the office adds them.</div>";
    return;
  }
  let html = "";
  if (S.view === "mine") {
    const g = needsFirst(tasks);
    html = group("Needs an update", g.needs, true) + group("Up to date", g.fine, false);
  } else {
    html = byPerson(tasks).map(function (g) {
      const p = needsFirst(g.list);
      const label = g.mine ? "You (" + (S.me.name || g.name) + ")" : g.name;
      return '<h3 class="mt-grp"><span class="who">' + esc(label) + '</span><span class="mt-n">' + g.list.length + "</span>" +
        (p.needs.length ? '<span class="mt-n warn">' + p.needs.length + " need" + (p.needs.length === 1 ? "s" : "") + " an update</span>" : "") +
        "</h3>" + p.needs.concat(p.fine).map(card).join("");
    }).join("");
  }
  list.innerHTML = html;
}

function setView(v, remember) {
  if (S.views.indexOf(v) === -1) v = "mine";
  S.view = v;
  if (remember) store.set(VIEW + S.me.id, v);
  renderList();
}

/** A message above the list. `action`: a button label; it clears the message and puts focus back. */
function notice(kind, title, text, action) {
  const box = el("mtNotice");
  if (!title) { box.innerHTML = ""; return; }
  box.innerHTML = '<div class="mt-notice ' + esc(kind) + '"><b>' + esc(title) + "</b>" + (text ? "<span>" + esc(text) + "</span>" : "") +
    (action ? '<button type="button" class="mt-nbtn" id="mtNoticeBtn">' + esc(action) + "</button>" : "") + "</div>";
  const b = el("mtNoticeBtn");
  if (b) b.addEventListener("click", function () {
    notice();
    const first = document.querySelector("#mtList .mt-open");
    if (first) first.focus(); else el("mtTitle").focus();
  });
}

/* ── the task ─────────────────────────────────────────────────────────── */
function historyHtml(t, freshFirst) {
  const notes = (t.notes || []).slice().reverse();
  if (!notes.length) return '<li class="mt-none">No updates yet.' + (canWork(S.me, t) ? " Yours will be the first." : "") + "</li>";
  return notes.map(function (n, i) {
    const who = [n.who, n.viaLabel && n.viaLabel !== "old portal" ? n.viaLabel : ""].filter(Boolean).join(" · ");
    return '<li class="mt-note' + (freshFirst && i === 0 ? " fresh" : "") + '">' +
      '<div class="mt-nday">' + esc(noteLabel(n, today())) + (who ? ' · <span class="mt-nwho">' + esc(who) + "</span>" : "") + "</div>" +
      '<div class="mt-ntext">' + (n.text ? esc(n.text) : "—") + "</div></li>";
  }).join("");
}

function briefHtml(t) {
  const b = brief(t.description, getShots(t.id));
  const html = b.blocks.map(function (x) {
    if (x.kind === "head") return '<h4 class="mt-bh">' + esc(x.text) + "</h4>" + (x.rest ? '<p class="mt-bp">' + esc(x.rest) + "</p>" : "");
    if (x.kind === "p") return '<p class="mt-bp">' + esc(x.text) + "</p>";
    return '<ul class="mt-blist' + (x.shots ? " shots" : "") + '">' + x.items.map(function (it) {
      if (it.map) return '<li><a href="' + esc(it.map) + '" target="_blank" rel="noopener">Open in Maps ↗</a></li>';
      if (it.shot === undefined) return "<li>" + esc(it.text) + "</li>";
      return '<li><label class="mt-shot"><input type="checkbox" data-shot="' + it.shot + '"' + (it.done ? " checked" : "") + " /> <span>" + esc(it.text) + "</span></label></li>";
    }).join("") + "</ul>";
  }).join("");
  return { html: html, shots: b.shots };
}

function renderDetail(t) {
  const pl = placeOf(t);
  const reqAgo = t.requested ? daysBetween(t.requested, today()) : null;
  const cat = [t.category, t.subCategory].filter(Boolean).join(" / ");
  const work = canWork(S.me, t);
  const facts =
    (t.requested ? "<dt>Requested</dt><dd>" + esc(dayText(t.requested, today()) + (reqAgo !== null && reqAgo >= 0 ? " (" + (reqAgo === 0 ? "today" : reqAgo === 1 ? "yesterday" : reqAgo + " days ago") + ")" : "") +
      (t.requestedBy ? " by " + t.requestedBy : "")) + "</dd>" : "") +
    "<dt>Assigned to</dt><dd>" + esc(t.assignedTo ? (t.assigneeName || "Someone") + (t.mine ? " (you)" : "") : "Nobody yet") + "</dd>" +
    (cat ? "<dt>Category</dt><dd>" + esc(cat) + "</dd>" : "") +
    (t.dueDate ? "<dt>Due</dt><dd>" + esc(dueText(t, today()).replace(/^Due /, "")) + "</dd>" : "") +
    (t.legacy ? "<dt>From</dt><dd>the old portal</dd>" : "");
  const shoot = t.photo ? briefHtml(t) : null;
  const phrases = shoot ? PHOTO_PHRASES.concat([SHOOT_DONE]) : PHRASES;
  const maps = shoot ? dirUrl(pl, t) : "";
  const pid = t.projectId === null ? "" : String(t.projectId);
  const upload = S.me.role === "viewer" ? "" : shoot
    ? '<a class="mt-photo" href="' + esc("capture.html" + (pid ? "?project=" + encodeURIComponent(pid) : "")) + '">📷 Upload photos &amp; videos</a>'
    : '<a class="mt-photo" href="capture.html' + (pid ? "?project=" + encodeURIComponent(pid) : "") + '">📷 Site photos</a>';
  const projLink = pid ? '<a class="mt-photo" href="project.html?id=' + encodeURIComponent(pid) + '&amp;tab=tasks">📁 Project</a>' : "";
  el("mtDScroll").innerHTML =
    '<div class="mt-dtop">' + recurChip(t) + chip(t) + photoChips(t) + dueChip(t) + "</div>" +
    '<h2 class="mt-dtitle" id="mtDTitle" tabindex="-1">' + esc(t.title) + "</h2>" +
    ((pl.project || pl.addr) ? '<div class="mt-dplace">' + esc(pl.project) + (pl.project && pl.addr ? " · " : "") + dirLink(t) + "</div>" : "") +
    '<div class="mt-dwhen' + (t.needsUpdate ? " warn" : "") + '" id="mtDWhen">' + esc(whenText(t)) + "</div>" +
    (shoot ? (shoot.html ? '<div class="mt-brief" role="group" aria-label="Shoot brief">' + shoot.html + "</div>" : "")
      : t.description ? '<p class="mt-desc">' + esc(t.description) + "</p>" : "") +
    '<dl class="mt-facts">' + facts + "</dl>" +
    (work
      ? '<form class="mt-compose" id="mtCompose" novalidate>' +
          '<label class="mt-label" for="mtText">Add an update</label>' +
          '<div class="mt-quick" role="group" aria-label="Quick phrases — each adds its words to your update">' +
            phrases.map(function (p) { return '<button type="button"' + (p === SHOOT_DONE ? ' class="done"' : "") + ' data-phrase="' + esc(p) + '">' + esc(p) + "</button>"; }).join("") +
            '<button type="button" id="mtSchedBtn" aria-controls="mtDatePick" aria-expanded="false">Scheduled for…</button>' +
            '<button type="button" class="done" id="mtDoneBtn">Done ✓</button>' +
          "</div>" +
          '<div class="mt-datepick" id="mtDatePick" hidden>' +
            '<label for="mtDate">Scheduled for</label><input type="date" id="mtDate"' + (DAY_RE.test(today()) ? ' min="' + esc(today()) + '"' : "") + " />" +
            '<button type="button" class="mt-dateadd" id="mtDateAdd">Add</button>' +
          "</div>" +
          '<textarea class="mt-text" id="mtText" rows="3" maxlength="' + NOTE_MAX + '" ' +
            'placeholder="What was done? What is next? Anything the office should know?"></textarea>' +
          '<div class="mt-row"><span class="mt-status" id="mtStatus" role="status" aria-live="polite"></span>' +
            '<button type="submit" class="mt-send" id="mtSend">Send update</button></div>' +
          '<div class="mt-next" id="mtNext" hidden></div>' +
        "</form>"
      : '<div class="mt-ro" id="mtReadOnly">' + esc(S.me.role === "viewer" ? "View only: you can read this task's updates." : "Only the person it is given to (or who asked for it), a lead, a manager or an admin updates this task.") + "</div>") +
    '<h3 class="mt-h3">Updates <span class="mt-n" id="mtHCount">' + (t.notes || []).length + "</span></h3>" +
    '<ol class="mt-history" id="mtHistory">' + historyHtml(t, false) + "</ol>" +
    '<div class="mt-dactions">' +
      (work ? '<button type="button" class="mt-complete" id="mtComplete">Mark complete</button>' : "") +
      (maps ? '<a class="mt-photo" target="_blank" rel="noopener" href="' + esc(maps) + '">🗺️ Open in Maps</a>' : "") +
      upload + projLink +
    "</div>";

  if (shoot) {
    el("mtDScroll").querySelectorAll("[data-shot]").forEach(function (c) {
      c.addEventListener("change", function () {
        const words = shoot.shots[Number(c.getAttribute("data-shot"))];
        if (words !== undefined) setShot(t.id, words, !!c.checked);
      });
    });
  }
  if (!work) return;
  const ta = el("mtText");
  const draft = getDraft(t.id);
  if (draft) { ta.value = draft; status("", "Draft restored — it hasn't been sent yet."); }
  const busy = S.busy[String(t.id)];
  if (busy === "send") { el("mtSend").disabled = true; el("mtSend").textContent = "Sending…"; status("", "Sending…"); }
  if (busy === "complete") { el("mtComplete").disabled = true; el("mtComplete").textContent = "Marking complete…"; status("", "Marking complete…"); }
  let timer = null;
  ta.addEventListener("input", function () {
    clearTimeout(timer);
    const id = t.id;
    timer = setTimeout(function () { setDraft(id, ta.value); }, 350);
    if (el("mtStatus").className.indexOf("ok") !== -1) status("", "");
  });
  ta.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
  });
  // on a phone the keyboard covers half the screen: bring the box into the part that is left
  ta.addEventListener("focus", function () {
    if (WIDE.matches) return;
    setTimeout(function () { try { ta.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) { /* */ } }, 250);
  });
  el("mtCompose").addEventListener("submit", function (e) { e.preventDefault(); send(); });
  /* "Shoot done — photos uploaded" puts its words in the box and then asks the same question as
     Done ✓, with them as the closing note: the agent reads the task being closed. */
  el("mtCompose").querySelectorAll("[data-phrase]").forEach(function (b) {
    b.addEventListener("click", function () {
      const p = b.getAttribute("data-phrase");
      addPhrase(p);
      if (shoot && p === SHOOT_DONE) complete();
    });
  });
  el("mtSchedBtn").addEventListener("click", function () {
    const box = el("mtDatePick"), input = el("mtDate");
    box.hidden = !box.hidden;
    el("mtSchedBtn").setAttribute("aria-expanded", String(!box.hidden));
    if (box.hidden) return;
    try { input.focus(); if (input.showPicker) input.showPicker(); } catch (e) { /* not every browser opens it from script */ }
  });
  /* the day is added only when the person says so (Add or Enter), not on every change */
  function addDay() {
    const input = el("mtDate"), key = input.value;
    if (!DAY_RE.test(key)) { status("err", "Pick a day first."); input.focus(); return; }
    if (key < today()) { status("err", "Pick today or a later day."); input.focus(); return; }
    addPhrase("Scheduled for " + dayText(key, today()));
    input.value = "";
    el("mtDatePick").hidden = true;
    el("mtSchedBtn").setAttribute("aria-expanded", "false");
    if (!FINE.matches) el("mtSchedBtn").focus();
  }
  el("mtDateAdd").addEventListener("click", addDay);
  el("mtDate").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addDay(); } });
  /* "Done" is not a note — it closes the task, with whatever was typed as the closing note */
  el("mtDoneBtn").addEventListener("click", complete);
  el("mtComplete").addEventListener("click", complete);
}

/** A quick phrase is added to the end of what is there. On a phone the keyboard is not opened for it:
    most of the time the phrase is the whole update and the next tap is Send. */
function addPhrase(p) {
  const ta = el("mtText");
  if (!ta) return;
  ta.value = withPhrase(ta.value, p);
  if (S.sel) setDraft(S.sel, ta.value);
  if (FINE.matches) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  status("", "");
}

function status(kind, text) {
  const s = el("mtStatus");
  if (!s) return;
  s.className = "mt-status" + (kind ? " " + kind : "");
  s.textContent = text || "";
}

function refreshDetailParts(t, fresh) {
  if (String(S.sel) !== String(t.id)) return;
  const w = el("mtDWhen");
  if (w) { w.textContent = whenText(t); w.className = "mt-dwhen" + (t.needsUpdate ? " warn" : ""); }
  const h = el("mtHistory");
  if (h) h.innerHTML = historyHtml(t, fresh);
  const c = el("mtHCount");
  if (c) c.textContent = String((t.notes || []).length);
}

/** After "Saved", the next task that needs an update is one tap away. */
function showNext(afterId) {
  const box = el("mtNext");
  if (!box) return;
  const next = visible().filter(function (x) { return String(x.id) !== String(afterId) && x.needsUpdate && canWork(S.me, x); }).sort(byDays)[0];
  if (!next) { box.hidden = true; box.innerHTML = ""; return; }
  box.innerHTML = '<button type="button" class="mt-nextbtn" id="mtNextBtn"><span>Next:</span> <b>' + esc(next.title) +
    "</b> <small>" + esc(whenText(next)) + "</small></button>";
  box.hidden = false;
  el("mtNextBtn").addEventListener("click", function () { openTask(next.id); });
}

function busyText(id) {
  const b = S.busy[String(id)];
  return b === "send" ? "Still sending your last update — one moment." : b === "complete" ? "Still marking this task complete — one moment." : "";
}

function offline(e) { return !e || (!e.status && !e.code) || /fetch|network|Failed to|offline/i.test(String(e.message || "")); }

function sendError(e) {
  if (offline(e)) return "No signal - your update is kept on this phone. Tap Send again when you have signal.";
  if (e.code === "PT404" || e.status === 404) return "This task isn't on your list any more. Your words are kept here.";
  if (e.status === 429) return "The database is busy - your update is kept here. Try again in a moment.";
  return errorText(e) + " Your update is kept here.";
}

/** The note shows at once (the database's copy replaces it when the list is read again). */
function noteLocally(t, words) {
  t.notes = (t.notes || []).concat([{ id: "local", at: new Date().toISOString(), day: today(), text: S.mask(words), who: S.me.name || "", via: "portal", viaLabel: "" }]);
  t.lastNote = S.mask(words);
  t.lastUpdateSource = "note";
  t.daysSinceUpdate = 0;
  t.needsUpdate = false;
}

/** Finished (or taken away) elsewhere: close it the way a finished task closes, and show the words
    that were still in the box — never lose them. */
function finishedElsewhere(t, how, extra) {
  const onScreen = String(S.sel) === String(t.id) && el("mtText");
  const unsent = ((onScreen ? el("mtText").value : getDraft(t.id)) || extra || "").trim();
  if (onScreen) el("mtText").value = "";
  setDraft(t.id, "", null);
  Object.keys(S.lists).forEach(function (v) { S.lists[v] = S.lists[v].filter(function (x) { return String(x.id) !== String(t.id); }); });
  delete S.extra[String(t.id)];
  if (String(S.sel) === String(t.id)) closeTask();
  const done = how === "done";
  notice(unsent ? "warn" : "ok", done ? "This task is already complete" : "This task isn't on your list any more",
    (done ? "“" + t.title + "” was marked complete" + (unsent ? " before your update reached it, so it was not added." : ". Nothing more to do here.")
      : "“" + t.title + "” was given to someone else or removed." + (unsent ? "" : "")) +
    (unsent ? " What you wrote: “" + unsent + "”" : ""));
  renderList();
}

async function send() {
  const t = find(S.sel);
  if (!t) return;
  if (S.busy[String(t.id)]) { status("", busyText(t.id)); return; }
  const ta = el("mtText"), btn = el("mtSend");
  const text = ta.value.trim();
  if (!text) { status("err", "Write an update first — or tap one of the phrases above."); ta.focus(); return; }
  if (text.length > NOTE_MAX) { status("err", "That update is too long — keep it under 2,000 characters."); ta.focus(); return; }
  // the same words as a send whose answer was lost go with the same key: the database adds them once
  const d = readDraft(t.id);
  const key = d && d.key && d.keyFor === text ? d.key : clientKey();
  setDraft(t.id, ta.value, key, text);                 // kept before the send, in case the page is left mid-flight
  S.busy[String(t.id)] = "send";
  btn.disabled = true;
  btn.textContent = "Sending…";
  status("", "Sending…");
  try {
    const r = await tasksRepo.addNote(t, text, key);
    const shown = String(S.sel) === String(t.id) && el("mtText") ? el("mtText") : ta;
    const left = leftAfterSend(shown.value, text);
    setDraft(t.id, left, null);
    dropKey(t.id);
    const now = find(t.id) || t;
    if (!(r && r.already)) noteLocally(now, text);
    if (String(S.sel) === String(t.id)) {
      shown.value = left;
      refreshDetailParts(now, true);
      status("ok", (r && r.already ? "Saved ✓ — that update was already on the task." : "Saved ✓ The office can see it now.") +
        (left.trim() ? " What you typed while it was sending is still in the box." : ""));
      showNext(t.id);
    }
    renderList();
    refreshSoon();
  } catch (e) {
    if (e && e.complete) {
      dropKey(t.id);
      finishedElsewhere(t, "done", text);
    } else if (String(S.sel) === String(t.id)) {
      if (!offline(e)) dropKey(t.id);              // refused: that key was not used
      status("err", sendError(e));
    } else {
      notice("warn", "Your update on “" + t.title + "” was not saved", "It is kept on this phone. Open the task and tap Send again.");
    }
  } finally {
    delete S.busy[String(t.id)];
    const b = String(S.sel) === String(t.id) ? el("mtSend") : null;
    if (b) { b.disabled = false; b.textContent = "Send update"; }
  }
}

/** A close that did not go through keeps its closing note — back in the box and as the draft. */
function keepClosingNote(t, note, typed) {
  if (!note) return false;
  const ta = String(S.sel) === String(t.id) ? el("mtText") : null;
  const now = (ta ? ta.value : getDraft(t.id)).trim();
  const kept = !now || now === typed ? note : now.indexOf(note) !== -1 ? now : note + "\n" + now;
  if (ta) ta.value = kept;
  setDraft(t.id, kept);
  return !!ta;
}

async function complete() {
  const t = find(S.sel);
  if (!t) return;
  if (S.busy[String(t.id)]) { status("", busyText(t.id)); return; }
  const typed = el("mtText") ? el("mtText").value.trim() : "";
  const v = await D().modal({
    title: "Mark this task complete?",
    message: "“" + t.title + "” will leave the list. Add a closing note if there is anything the office should know.",
    okText: "Mark complete",
    fields: [{ name: "note", type: "textarea", rows: 3, label: "Closing note (optional)", value: typed, placeholder: "e.g. All framed, photos taken" }],
    validate: function (x) { return String(x.note || "").trim().length > NOTE_MAX ? "Keep the closing note under 2,000 characters." : ""; },
  });
  if (!v) return;
  const note = String(v.note || "").trim();
  const btn = el("mtComplete");
  S.busy[String(t.id)] = "complete";
  if (btn) { btn.disabled = true; btn.textContent = "Marking complete…"; }
  if (note) setDraft(t.id, note);
  try {
    const r = await tasksRepo.complete(t, note, S.me && S.me.id);
    if (String(S.sel) === String(t.id)) { if (el("mtText")) el("mtText").value = ""; closeTask(); }
    setDraft(t.id, "", null);
    store.set(shotsKey(t.id), null);                 // a finished shoot's checklist is not needed again
    Object.keys(S.lists).forEach(function (k) { S.lists[k] = S.lists[k].filter(function (x) { return String(x.id) !== String(t.id); }); });
    delete S.extra[String(t.id)];
    if (r && r.already) {
      // someone else completed it first: the database still kept the closing words, as an update of their own
      notice(note ? "warn" : "ok", "“" + t.title + "” was already complete",
        "Someone else marked it complete before you did, so it has left your list." +
        (note ? " Your closing note was still added to its updates: “" + note + "”" : " Nothing more to do here."));
    } else {
      notice("ok", "“" + t.title + "” is marked complete.", "It has left your list, and the office can see it.");
    }
    renderList();
    refreshSoon();
  } catch (e) {
    const inBox = keepClosingNote(t, note, typed);
    const conflict = e && (e.code === "PT409" || e.status === 409);
    const why = offline(e) ? "No signal - the task is still open. Try again when you have signal."
      : conflict ? "Someone changed this task while you had it open — it is shown fresh now; check it and tap Mark complete again."
        : errorText(e);
    if (conflict) refreshSoon(0);
    if (String(S.sel) === String(t.id)) {
      status("err", why + (inBox ? " Your closing note is kept in the box." : ""));
      const b = el("mtComplete");
      if (b) { b.disabled = false; b.textContent = "Mark complete"; }
    } else {
      notice("warn", "“" + t.title + "” was not marked complete", why + (note ? " Your closing note is kept with the task." : ""));
    }
  } finally {
    delete S.busy[String(t.id)];
  }
}

/* ── opening and closing, with the Back button ────────────────────────── */
function urlFor(id) {
  const u = new URL(location.href);
  if (id) u.searchParams.set("task", id); else u.searchParams.delete("task");
  return u.pathname + u.search + u.hash;
}
function stateWith(id) {
  const s = Object.assign({}, history.state || {});
  if (id) s.mtTask = String(id); else delete s.mtTask;
  return s;
}
/* on a phone the task covers the list, so the rest of the page is inert while it is open */
function setModal(on) {
  const modal = !!on && !WIDE.matches;
  const d = el("mtDetail");
  d.setAttribute("role", modal ? "dialog" : "region");
  if (modal) d.setAttribute("aria-modal", "true"); else d.removeAttribute("aria-modal");
  if (on) d.setAttribute("aria-labelledby", "mtDTitle"); else d.removeAttribute("aria-labelledby");
  [el("mtListCol"), document.querySelector(".topbar")].forEach(function (n) {
    if (!n) return;
    if (modal) n.setAttribute("inert", ""); else n.removeAttribute("inert");
  });
  document.documentElement.classList.toggle("mt-locked", modal);
}

/** Opening a task is a step in the browser's history (?task=<id>), so the phone's Back gesture closes
    the task instead of leaving the page (from a text message, leaving would drop them in Messages). */
function openTask(id, o) {
  const opts = o || {};
  const t = find(id);
  if (!t) return false;
  const wasOpen = !!S.sel;
  if (opts.history !== false) {
    if (wasOpen && history.state && history.state.mtTask) history.replaceState(stateWith(t.id), "", urlFor(t.id));
    else { history.pushState(stateWith(t.id), "", urlFor(t.id)); S.pushed = true; }
  }
  S.sel = String(t.id);
  renderDetail(t);
  el("mtDetail").classList.add("open");
  el("mtDScroll").scrollTop = 0;
  setModal(true);
  renderList();
  // the keyboard is opened only where there is a real pointer: on a phone it would cover the task
  if (FINE.matches && opts.focusText !== false && el("mtText")) el("mtText").focus({ preventScroll: true });
  else el("mtDTitle").focus({ preventScroll: true });
  refreshSoon();
  return true;
}

function closeTask(o) {
  const opts = o || {};
  if (!S.sel) return;
  if (!opts.fromPop) {
    if (S.pushed && history.state && history.state.mtTask) {
      S.pushed = false;
      history.back();               // popstate closes it
      return;
    }
    history.replaceState(stateWith(""), "", urlFor(""));
  }
  const ta = el("mtText");
  if (ta && ta.value.trim()) setDraft(S.sel, ta.value);
  const id = S.sel;
  S.sel = "";
  S.pushed = false;
  el("mtDetail").classList.remove("open");
  el("mtDScroll").innerHTML = '<div class="mt-ph">Pick a task to see its updates and send one.</div>';
  setModal(false);
  renderList();
  const back = document.querySelector('#mtList [data-open="' + String(id).replace(/[^0-9]/g, "") + '"]');
  if (back) back.focus({ preventScroll: false }); else el("mtTitle").focus();
}

window.addEventListener("popstate", function (e) {
  const want = e.state && e.state.mtTask;
  if (want && find(want)) {
    S.pushed = true;
    if (String(want) !== String(S.sel)) openTask(want, { history: false, focusText: false });
  } else if (S.sel) {
    closeTask({ fromPop: true });
  }
});

/* the app dialog hears Escape first (capture phase) and marks the key handled */
document.addEventListener("keydown", function (e) {
  if (e.key !== "Escape" || !S.sel || e.defaultPrevented) return;
  if (document.querySelector(".dcr-mo.open") || formOpen()) return;
  e.preventDefault();
  closeTask();
});
if (WIDE.addEventListener) WIDE.addEventListener("change", function () { if (S.sel) setModal(true); });

/* ── loading and live updates ─────────────────────────────────────────── */
async function loadView(v) {
  try {
    S.lists[v] = await tasksRepo.list(v, { me: S.me.id, mask: S.mask });
  } catch (e) {
    if (v !== "mine" && e && (e.code === "42501" || e.code === "22023" || e.code === "PGRST202" || e.status === 403)) {
      S.views = S.views.filter(function (x) { return x !== v; });       // this role has no such list
      delete S.lists[v];
      if (S.view === v) S.view = "mine";
      return;
    }
    throw e;
  }
}

async function loadAll() {
  await Promise.all(S.views.map(loadView));
}

let refreshTimer = null;
let refreshing = null;
/** Read the lists again (after a change elsewhere, a send, a join of the live channel); the open task
    is drawn again from the fresh copy, or closed with a notice when it left every list. */
function refreshSoon(ms) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, ms === undefined ? 350 : ms);
}
async function refresh() {
  if (refreshing) { refreshSoon(400); return; }
  refreshing = (async function () {
    try { await loadAll(); } catch (e) { return; }
    S.loaded = true;
    if (S.sel) {
      const t = find(S.sel);
      if (t && !S.extra[S.sel]) {
        refreshDetailParts(t, false);
      } else {
        const one = await tasksRepo.getOne(S.sel, { me: S.me.id, mask: S.mask }).catch(function () { return undefined; });
        if (one === undefined) { /* no signal: keep what is shown */ }
        else if (!one) finishedElsewhere(t || S.extra[S.sel] || { id: S.sel, title: "This task" }, "gone");
        else if (one.done) finishedElsewhere(one, "done");
        else { S.extra[String(one.id)] = one; refreshDetailParts(one, false); }
      }
    }
    renderList();
  })();
  try { await refreshing; } finally { refreshing = null; }
}

function onLive(evt) {
  if (!evt) return;
  if (evt.type === "SUBSCRIBED") { el("mtLive").textContent = "Live"; refreshSoon(); return; }
  if (evt.table === "tasks" && S.sel) {
    const row = evt.new || evt.old || {};
    if (String(row.id) === String(S.sel)) {
      const t = find(S.sel) || { id: S.sel, title: "This task" };
      if (evt.type === "UPDATE" && evt.new && evt.new.status === "done") { finishedElsewhere(t, "done"); refreshSoon(); return; }
      if (evt.type === "DELETE") { finishedElsewhere(t, "gone"); refreshSoon(); return; }
    }
  }
  refreshSoon();
}

async function startLive() {
  let live;
  try { live = await import("../live.js"); } catch (e) { return; }
  S.live = live;
  try {
    live.watch("tasks", null, onLive);
    live.watch("task_notes", null, onLive);
  } catch (e) { /* the page works without live updates; it reads again on focus */ }
}

function loadFailed(e) {
  el("mtList").removeAttribute("aria-busy");
  el("mtSub").textContent = "";
  el("mtList").innerHTML = '<div class="mt-empty"><b>' +
    esc(offline(e) ? "No signal — your tasks will load when you're back online." : "Couldn't load your tasks.") + "</b>" +
    (!offline(e) ? esc(errorText(e)) + " " : "") +
    '<div style="margin-top:10px"><button type="button" class="mt-nbtn btn btn-ghost" id="mtRetry">Try again</button></div></div>';
  el("mtRetry").addEventListener("click", function () { location.reload(); });
}

/** A link opens its task on top of the list, as if tapped there: the list goes under it in the
    browser's history (Back closes the task). An entry that already holds this task (a reload) has the
    list under it already. */
function openLinked(want) {
  if (history.state && history.state.mtTask === String(want)) {
    openTask(want, { history: false });
    S.pushed = true;
    return;
  }
  history.replaceState(stateWith(""), "", urlFor(""));
  openTask(want);
}

/** A link to one task: open it (switching to the list that has it); finished since -> say so kindly;
    not readable -> "not on your list" (the same answer as a task that does not exist). */
async function openFromLink(want) {
  if (!/^\d{1,15}$/.test(want)) {
    history.replaceState(stateWith(""), "", urlFor(""));
    notice("warn", "That link doesn't name a task", "Here are your open tasks.");
    return;
  }
  const v = viewHaving(want);
  if (v) { S.view = v; renderList(); openLinked(want); return; }
  let one;
  try { one = await tasksRepo.getOne(want, { me: S.me.id, mask: S.mask }); }
  catch (e) {
    history.replaceState(stateWith(""), "", urlFor(""));
    notice("warn", "Couldn't open that task", offline(e) ? "No signal — try the link again when you're back online." : errorText(e));
    return;
  }
  if (one && one.done) {
    history.replaceState(stateWith(""), "", urlFor(""));
    notice("ok", "This task is already complete", "“" + one.title + "” was marked complete. Nothing more to do here.", visible().length ? "See my other tasks" : "");
    return;
  }
  if (one) { S.extra[String(one.id)] = one; openLinked(want); return; }
  history.replaceState(stateWith(""), "", urlFor(""));
  notice("warn", "This task isn't on your list", "It may have been given to someone else or removed. Your open tasks are below.");
}

async function init() {
  S.me = await boot("tasks");
  S.mask = maskFor(S.me);
  S.views = viewsFor(S.me);
  el("mtList").addEventListener("click", function (e) {
    const b = e.target.closest ? e.target.closest("[data-open]") : null;
    if (b) openTask(b.getAttribute("data-open"));
  });
  el("mtSeg").addEventListener("click", function (e) {
    const b = e.target.closest ? e.target.closest("[data-view]") : null;
    if (b) setView(b.getAttribute("data-view"), true);
  });
  el("mtBack").addEventListener("click", function () { closeTask(); });
  el("mtClose").addEventListener("click", function () { closeTask(); });
  if (S.me.role === "viewer") el("mtCaptureLink").hidden = true;
  if (canCreate(S.me)) {
    el("mtNew").hidden = false;
    el("mtNew").addEventListener("click", function () {
      openNewTask({ me: S.me, pickProject: function () { return projectsRepo.loadProjects(); }, onCreated: function () { refreshSoon(0); } });
    });
  }
  // the part of the screen the keyboard leaves, for the full-screen task view on a phone
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const fit = function () { document.documentElement.style.setProperty("--vvh", Math.round(vv.height) + "px"); };
    vv.addEventListener("resize", fit);
    fit();
  }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && S.loaded) refreshSoon(0); });
  try {
    await loadAll();
  } catch (e) {
    loadFailed(e);
    return;
  }
  S.loaded = true;
  // remembered, else mine, else the list the home badge counted (a lead: the crew) - map/tasks.js
  S.view = defaultView(S.views, (S.lists.mine || []).length, store.get(VIEW + S.me.id, ""));
  renderList();
  startLive();
  const want = new URLSearchParams(location.search).get("task");
  if (want !== null) await openFromLink(want);
}

init().catch(function (e) {
  if (e && /not signed in|not for this role/.test(e.message || "")) return;
  loadFailed(e);
});
