/* Project tab Tasks (MODULES §3 "Tasks", BLUEPRINT 3.3.7; the old project page's Tasks tab).

   The project's tasks, Pending / Completed / All, with the old table's habits: the tick completes a
   task in one tap (rpc complete_task: the status and an optional closing note in one transaction) and
   unticking opens it again (a versioned PATCH); "＋ New task" is the shared new-task form (Q8: task
   editors for anyone, field and the accountant for themselves or nobody). A row opens its updates
   and, for whoever may work on it, a box to add one (rpc add_task_note — the same draft My Tasks keeps
   on this phone). The old tab's priced columns (quantity, unit price, markup, invoiced, paid) are
   never read: they do not exist in this database (an old leak to leads, closed). Who sees which task
   is the database's rule (Q3). Live: the project's tasks and their notes. */

import * as tasksRepo from "../repo/tasks.js";
import { canWork, canCreate, whenText, dueText, clientKey, cleanNote, NOTE_MAX, noteLabel, dayText, dayOf, recurLabel } from "../map/tasks.js";
import { openNewTask } from "./task-form.js";
import { companyToday } from "../common2.js";
import { store } from "./shell.js";

let host = null, seq = 0, timer = null, filter = "pending", rows = [], openId = "", busy = {};
const today = function () { return companyToday(); };
const DRAFT = "dcr2:taskDraft:";

function draftKey(ctx, id) { return DRAFT + ctx.me.id + ":" + id; }
function readDraft(ctx, id) {
  try { const d = JSON.parse(store.get(draftKey(ctx, id), "") || "null"); return d && Date.now() - Number(d.at || 0) < 30 * 86400000 ? d : null; }
  catch (e) { return null; }
}
function setDraft(ctx, id, t, key, keyFor) {
  const was = readDraft(ctx, id) || {};
  const d = { t: t || "", at: Date.now() };
  const k = key !== undefined ? key : was.key;
  if (k) { d.key = k; d.keyFor = keyFor !== undefined ? keyFor : was.keyFor; }
  store.set(draftKey(ctx, id), String(d.t).trim() || d.key ? JSON.stringify(d) : null);
}

export function render(ctx, el) {
  host = el;
  host.classList.add("pt-tk");
  host.innerHTML = '<div class="pj-bar" id="tkBar"></div><div class="pj-msg" id="tkMsg" role="status" aria-live="polite" style="margin:-4px 0 8px"></div>' +
    '<div id="tkList"><div class="pj-empty">Loading tasks…</div></div>';
  host.addEventListener("click", function (e) { onClick(ctx, e); });
  host.addEventListener("change", function (e) { onChange(ctx, e); });
  host.addEventListener("input", function (e) {
    const ta = e.target.closest && e.target.closest("[data-note]");
    if (ta) setDraft(ctx, ta.getAttribute("data-note"), ta.value);
  });
  load(ctx);
}

function bar(ctx) {
  const counts = { pending: rows.filter(function (t) { return !t.done; }).length, completed: rows.filter(function (t) { return t.done; }).length, all: rows.length };
  return ["pending", "completed", "all"].map(function (c) {
    return '<button type="button" class="pj-chip' + (filter === c ? " on" : "") + '" data-tf="' + c + '" aria-pressed="' + String(filter === c) + '">' +
      c.charAt(0).toUpperCase() + c.slice(1) + " (" + counts[c] + ")</button>";
  }).join("") + (canCreate(ctx.me) ? '<button type="button" class="pj-btn pj-btn-primary pj-btn-sm" id="tkAddBtn" style="margin-left:auto">＋ New task</button>' : "") +
    '<a class="pj-btn pj-btn-sm" href="tasks-map.html" style="' + (canCreate(ctx.me) ? "" : "margin-left:auto") + '">🗺️ Map</a>';
}

function notesHtml(ctx, t) {
  const esc = ctx.esc;
  const notes = (t.notes || []).slice().reverse();
  const list = notes.length ? '<ol class="mt-history">' + notes.map(function (n) {
    const who = [n.who, n.viaLabel && n.viaLabel !== "old portal" ? n.viaLabel : ""].filter(Boolean).join(" · ");
    return '<li class="mt-note"><div class="mt-nday">' + esc(noteLabel(n, today())) + (who ? ' · <span class="mt-nwho">' + esc(who) + "</span>" : "") + "</div>" +
      '<div class="mt-ntext">' + esc(n.text || "—") + "</div></li>";
  }).join("") + "</ol>" : '<div class="mt-none">No updates yet.</div>';
  const work = canWork(ctx.me, t) && !t.done;
  const d = readDraft(ctx, t.id);
  return '<div class="tk-notes">' + (t.description ? '<p class="mt-desc" style="margin:0 0 10px">' + esc(t.description) + "</p>" : "") +
    '<div class="mt-h3" style="margin:4px 0 8px">Updates <span class="mt-n">' + (t.notes || []).length + "</span></div>" + list +
    (work ? '<div class="tk-add"><label class="tk-lab" for="tkNote' + esc(t.id) + '">Add an update</label>' +
      '<textarea class="tk-in" id="tkNote' + esc(t.id) + '" data-note="' + esc(t.id) + '" rows="2" maxlength="' + NOTE_MAX + '" placeholder="What was done? What is next?">' +
        esc(d && d.t ? d.t : "") + "</textarea>" +
      '<div class="pj-row"><button type="button" class="pj-btn pj-btn-primary pj-btn-sm" data-send="' + esc(t.id) + '">Send update</button>' +
      '<span class="pj-msg" id="tkSt' + esc(t.id) + '" role="status" aria-live="polite">' + (d && d.t ? "Draft restored — not sent yet." : "") + "</span></div></div>" : "") +
    '<a class="pj-more" href="my-tasks.html?task=' + encodeURIComponent(t.id) + '">Open in My Tasks ›</a></div>';
}

function draw(ctx) {
  if (!host) return;
  const esc = ctx.esc;
  host.querySelector("#tkBar").innerHTML = bar(ctx);
  const shown = rows.filter(function (t) { return filter === "all" || (filter === "pending" ? !t.done : t.done); });
  const list = host.querySelector("#tkList");
  if (!shown.length) {
    list.innerHTML = '<div class="pj-empty">No ' + (filter === "all" ? "" : filter + " ") + "tasks." + (canCreate(ctx.me) && filter !== "completed" ? " Add one with ＋ New task." : "") + "</div>";
    return;
  }
  list.innerHTML = '<div class="pj-tblwrap"><table class="pj-tbl pt-tbl"><thead><tr><th aria-label="Done"></th><th>Task</th><th>Category</th><th>Assigned</th><th>Requested</th></tr></thead><tbody>' +
    shown.map(function (t) {
      const work = canWork(ctx.me, t);
      // the box sits in a label that is the finger's target (44 px on a phone: project.html)
      const tick = work
        ? '<label class="pt-tick"><input type="checkbox" data-tk="' + esc(t.id) + '"' + (t.done ? " checked" : "") + (busy[t.id] ? " disabled" : "") + ' aria-label="' + esc((t.done ? "Open again: " : "Mark complete: ") + t.title) + '"></label>'
        : '<span aria-label="' + (t.done ? "Done" : "Open") + '">' + (t.done ? "✅" : "⬜") + "</span>";
      const flags = [t.recurring ? recurLabel(t) : "", t.photo ? "📷 shoot" : "", t.dueDate && !t.done ? dueText(t, today()) : "", t.legacy ? "old portal" : ""].filter(Boolean).join(" · ");
      const isOpen = openId === String(t.id);
      return '<tr class="pt-row' + (t.done ? " done" : "") + (t.needsUpdate ? " needs" : "") + '">' +
        '<td class="pt-c">' + tick + "</td>" +
        '<td class="pt-t"><button type="button" class="pt-open" data-open="' + esc(t.id) + '" aria-expanded="' + String(isOpen) + '">' +
          '<span class="tk-dot ' + esc(t.priKey) + '" title="' + esc(t.priorityLabel) + '"></span>' + esc(t.title) + "</button>" +
          '<span class="pj-sub pt-when' + (t.needsUpdate ? " warn" : "") + '">' + esc(t.done ? "Completed" + (t.completedAt ? " " + dayText(dayOf(t.completedAt), today()) : "") : whenText(t)) + "</span>" +
          (flags ? '<span class="pj-sub">' + esc(flags) + "</span>" : "") + "</td>" +
        '<td class="pt-cat">' + esc([t.category, t.subCategory].filter(Boolean).join(" / ")) + "</td>" +
        '<td class="pt-who">' + esc(t.assignedTo ? t.assigneeName : "Unassigned") + "</td>" +
        '<td class="pt-req">' + esc(t.requested ? dayText(t.requested, today()) : "") + "</td></tr>" +
        (isOpen ? '<tr class="pt-more"><td></td><td colspan="4">' + notesHtml(ctx, t) + "</td></tr>" : "");
    }).join("") + "</tbody></table></div>";
}

function msg(kind, text) {
  const m = host && host.querySelector("#tkMsg");
  if (!m) return;
  m.className = "pj-msg " + (kind || "");
  m.textContent = text || "";
  if (kind === "ok") setTimeout(function () { if (m.textContent === text) m.textContent = ""; }, 3500);
}

async function load(ctx) {
  if (!host) return;
  const my = ++seq;
  try {
    const list = await tasksRepo.forProject(ctx.pid, { me: ctx.me.id, mask: ctx.mask, project: ctx.project });
    if (my !== seq) return;
    rows = list;
    draw(ctx);
  } catch (e) {
    if (my !== seq) return;
    host.querySelector("#tkList").innerHTML = '<div class="pj-empty">' + ctx.esc(ctx.errorText(e)) + "</div>";
  }
}

function onClick(ctx, e) {
  const t = e.target;
  const chip = t.closest("[data-tf]");
  if (chip) { filter = chip.getAttribute("data-tf"); draw(ctx); return; }
  if (t.closest("#tkAddBtn")) {
    openNewTask({ me: ctx.me, project: ctx.project, onCreated: function () { filter = filter === "completed" ? "pending" : filter; return load(ctx); } });
    return;
  }
  const op = t.closest("[data-open]");
  if (op) { const id = op.getAttribute("data-open"); openId = openId === id ? "" : id; draw(ctx); return; }
  const send = t.closest("[data-send]");
  if (send) sendNote(ctx, send.getAttribute("data-send"));
}

async function onChange(ctx, e) {
  const cb = e.target.closest && e.target.closest("[data-tk]");
  if (!cb) return;
  const id = cb.getAttribute("data-tk");
  const task = rows.find(function (r) { return String(r.id) === id; });
  if (!task || busy[id]) { cb.checked = !cb.checked; return; }
  busy[id] = true;
  cb.disabled = true;
  try {
    // the row as the database answered it, drawn at once (the fresh read follows)
    const answer = cb.checked ? await tasksRepo.complete(task, "", ctx.me && ctx.me.id) : await tasksRepo.reopen(task);
    if (answer && answer.status) {
      task.status = answer.status;
      task.done = answer.status === "done";
      if (answer.version !== undefined && answer.version !== null) task.version = Number(answer.version);
      task.completedAt = answer.completed_at || null;
    }
    draw(ctx);
    msg("ok", cb.checked ? (answer && answer.already ? "✓ It was already complete." : "✓ Marked complete") : "↺ Open again");
  } catch (x) {
    cb.checked = !cb.checked;
    msg("err", x && (x.code === "PT409" || x.status === 409) ? "Changed by someone else — shown fresh now; try again." : ctx.errorText(x));
  } finally {
    delete busy[id];
    load(ctx);
  }
}

async function sendNote(ctx, id) {
  const task = rows.find(function (r) { return String(r.id) === String(id); });
  const ta = host.querySelector('[data-note="' + String(id).replace(/[^0-9]/g, "") + '"]');
  const st = host.querySelector("#tkSt" + String(id).replace(/[^0-9]/g, ""));
  if (!task || !ta || busy["n" + id]) return;
  const text = cleanNote(ta.value);
  const say = function (k, x) { if (st) { st.className = "pj-msg " + (k || ""); st.textContent = x; } };
  if (!text) { say("err", "Write an update first."); return; }
  if (text.length > NOTE_MAX) { say("err", "Keep it under 2,000 characters."); return; }
  const d = readDraft(ctx, id);
  const key = d && d.key && d.keyFor === text ? d.key : clientKey();
  setDraft(ctx, id, ta.value, key, text);
  busy["n" + id] = true;
  say("", "Sending…");
  try {
    await tasksRepo.addNote(task, text, key);
    store.set(draftKey(ctx, id), null);
    ta.value = "";
    say("ok", "Saved ✓");
    load(ctx);
  } catch (x) {
    if (x && x.complete) { store.set(draftKey(ctx, id), null); say("err", "This task is already complete — not added. What you wrote: “" + text + "”"); load(ctx); }
    else say("err", ctx.errorText(x) + " Your update is kept here.");
  } finally {
    delete busy["n" + id];
  }
}

/** A change arrived (live): read again, once per burst. */
export function reload(ctx) {
  if (!host) return;
  clearTimeout(timer);
  timer = setTimeout(function () { load(ctx); }, 250);
}

/** Does a task_notes change concern this tab? */
export function hasTask(id) {
  return rows.some(function (r) { return String(r.id) === String(id); });
}
