/* The new-task form (the web version of the Access "Project Task Request", BLUEPRINT 3.3.7), shared by
   the tasks map ("New task here"), the project's Tasks tab and My Tasks.

   Who may give a task to whom is the database's rule (Q8): admin, manager and lead to anyone; field
   and the accountant to themselves or nobody (Desktop 2's rule); a view-only account creates nothing.
   The form only offers what the database would take. A task given to someone else writes its
   new-task notice into the outbox (the tasks trigger); the push function is then asked to send the
   phone notice (fire-and-forget) and DCR Agents 2 sends the e-mail when the owner turns that on.

   It is one deliberate tap, never autosaved: it creates a record and tells a person.

   openNewTask({me, project, pickProject, onCreated}) -> Promise<row|null>
     project:      the project it belongs to ({id, internalIDNumber, projectName, projectAddress,
                   projectCity}), fixed; or null with pickProject (a list of projects to choose from,
                   "No project" allowed). */

import { el as byId, esc, errorText } from "./shell.js";
import * as tasksRepo from "../repo/tasks.js";
import { CATEGORIES, SUB_CATEGORIES, PRIORITIES, PRIORITY_LABELS, assigneeChoices, canAssignAnyone, canCreate } from "../map/tasks.js";
import { switcherLabel } from "../map/projects.js";
import { companyToday } from "../common2.js";

let open = null;

function options(list, chosen, blank) {
  return (blank ? '<option value="">' + esc(blank) + "</option>" : "") +
    list.map(function (v) { return '<option' + (v === chosen ? " selected" : "") + ">" + esc(v) + "</option>"; }).join("");
}

export function isOpen() { return !!open; }

export async function openNewTask(o) {
  const opts = o || {};
  const me = opts.me;
  if (!canCreate(me)) return null;
  if (open) open.close(null);
  const editor = canAssignAnyone(me);
  const project = opts.project || null;
  const projects = !project && opts.pickProject ? await Promise.resolve(opts.pickProject()).catch(function () { return []; }) : [];
  return new Promise(function (resolve) {
    const host = document.createElement("div");
    host.className = "tk-overlay";
    host.id = "tkOverlay";
    const where = project
      ? [project.internalIDNumber, project.projectName].filter(Boolean).join(" — ") + (project.projectAddress ? " · " + project.projectAddress : "")
      : "";
    host.innerHTML =
      '<div class="tk-sheet" role="dialog" aria-modal="true" aria-labelledby="tkTitle">' +
        '<div class="tk-head"><div style="min-width:0"><div class="tk-title" id="tkTitle" tabindex="-1">New task</div>' +
          (where ? '<div class="tk-sub" id="tkWhere">' + esc(where) + "</div>" : "") + "</div>" +
          '<button type="button" class="tk-x" id="tkX" aria-label="Close">✕</button></div>' +
        '<form class="tk-body" id="tkForm" novalidate>' +
          '<label class="tk-lab" for="tkAssign">Assign to' + (editor ? " *" : "") + "</label>" +
          '<select class="tk-in" id="tkAssign"><option value="">Loading…</option></select>' +
          '<label class="tk-lab" for="tkName">Task name *</label>' +
          '<input class="tk-in" id="tkName" maxlength="200" placeholder="What needs doing" autocomplete="off">' +
          '<label class="tk-lab" for="tkDesc">Description</label>' +
          '<textarea class="tk-in" id="tkDesc" rows="3" maxlength="4000" placeholder="Details about this task"></textarea>' +
          (project ? "" :
            '<label class="tk-lab" for="tkProject">Project</label>' +
            '<input class="tk-in" id="tkProject" list="tkProjects" placeholder="Number, name or address — or leave empty" autocomplete="off">' +
            '<datalist id="tkProjects">' + projects.map(function (p) { return '<option value="' + esc(switcherLabel(p)) + '"></option>'; }).join("") + "</datalist>") +
          '<div class="tk-row"><div><label class="tk-lab" for="tkCat">Category</label>' +
            '<select class="tk-in" id="tkCat">' + options(CATEGORIES, "", "—") + "</select></div>" +
            '<div><label class="tk-lab" for="tkPri">Priority</label><select class="tk-in" id="tkPri">' +
            PRIORITIES.map(function (p) { return '<option value="' + p + '"' + (p === "normal" ? " selected" : "") + ">" + PRIORITY_LABELS[p] + "</option>"; }).join("") +
            "</select></div></div>" +
          '<label class="tk-lab" for="tkSub">Sub-category</label>' +
          '<select class="tk-in" id="tkSub">' + options(SUB_CATEGORIES, "", "—") + "</select>" +
          '<div class="tk-row"><div><label class="tk-lab" for="tkDue">Due</label>' +
            '<input class="tk-in" id="tkDue" type="date" min="' + esc(companyToday()) + '"></div>' +
            '<div><label class="tk-lab" for="tkTime">Time</label><input class="tk-in" id="tkTime" type="time"></div></div>' +
          '<div class="tk-msg" id="tkMsg" role="status" aria-live="polite"></div>' +
        "</form>" +
        '<div class="tk-foot"><button type="button" class="tk-cancel" id="tkCancel">Cancel</button>' +
          '<button type="button" class="tk-go" id="tkGo">✓ Create task</button></div>' +
      "</div>";
    document.body.appendChild(host);
    const last = document.activeElement;
    let busy = false;
    function msg(kind, text) { const m = byId("tkMsg"); m.className = "tk-msg" + (kind ? " " + kind : ""); m.textContent = text || ""; }
    function close(v) {
      if (!open || open.host !== host) return;
      document.removeEventListener("keydown", onKey, true);
      host.remove();
      open = null;
      try { if (last && last.focus) last.focus(); } catch (e) { /* */ }
      resolve(v);
    }
    function onKey(e) {
      if (e.key !== "Escape" || document.querySelector(".dcr-mo.open")) return;
      e.preventDefault();
      e.stopPropagation();
      close(null);
    }
    open = { host: host, close: close };
    document.addEventListener("keydown", onKey, true);
    host.addEventListener("click", function (e) { if (e.target === host) close(null); });
    byId("tkX").addEventListener("click", function () { close(null); });
    byId("tkCancel").addEventListener("click", function () { close(null); });
    byId("tkForm").addEventListener("submit", function (e) { e.preventDefault(); submit(); });
    byId("tkGo").addEventListener("click", submit);
    // a mouse: straight into the name; a phone: the sheet itself (its title is read out), so the keyboard
    // does not cover the form before the person has seen it (as My Tasks does)
    setTimeout(function () {
      const fine = !!(window.matchMedia && window.matchMedia("(pointer: fine)").matches);
      const n = fine ? byId("tkName") : byId("tkTitle");
      if (n) n.focus({ preventScroll: !fine });
    }, 30);

    tasksRepo.people().then(function (people) {
      const sel = byId("tkAssign");
      if (!sel) return;
      const list = assigneeChoices(me, people);
      sel.innerHTML = (editor ? '<option value="">Choose who it is for…</option>' : "") +
        list.map(function (p) {
          const self = String(p.id) === String(me.id);
          return '<option value="' + esc(p.id) + '"' + (!editor && self ? " selected" : "") + ">" + esc(p.name + (self ? " (you)" : "")) + "</option>";
        }).join("") + '<option value="-">Nobody yet (unassigned)</option>';
    }, function () {
      const sel = byId("tkAssign");
      if (sel) sel.innerHTML = '<option value="' + esc(me.id) + '">' + esc((me.name || "You") + " (you)") + '</option><option value="-">Nobody yet (unassigned)</option>';
    });

    async function submit() {
      if (busy) return;
      const sel = byId("tkAssign");
      const who = sel.value;
      if (!who) { msg("err", "Choose who this task is for — or “Nobody yet”."); sel.focus(); return; }
      const name = byId("tkName").value.trim();
      if (!name) { msg("err", "Give the task a name."); byId("tkName").focus(); return; }
      let projectId = project ? project.id : null;
      if (!project && byId("tkProject")) {
        const v = byId("tkProject").value.trim().toLowerCase();
        if (v) {
          const hit = projects.find(function (p) { return switcherLabel(p).toLowerCase() === v; }) ||
            projects.find(function (p) { return String(p.internalIDNumber || "").toLowerCase() === v; });
          if (!hit) { msg("err", "Pick the project from the list (or leave it empty)."); byId("tkProject").focus(); return; }
          projectId = hit.id;
        }
      }
      const form = {
        title: name, description: byId("tkDesc").value, category: byId("tkCat").value, subCategory: byId("tkSub").value,
        priority: byId("tkPri").value, assignedTo: who === "-" ? null : who, dueDate: byId("tkDue").value, dueTime: byId("tkTime").value,
        projectId: projectId,
      };
      busy = true;
      byId("tkGo").disabled = true;
      msg("", "Creating…");
      try {
        const row = await tasksRepo.create(form, me);
        const other = form.assignedTo && String(form.assignedTo) !== String(me.id);
        const whoName = other ? (sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : "") : "";
        msg("ok", other ? "Task created for " + whoName + " — it is on their My Tasks now (and on their phone, if reminders are on)." : "Task created.");
        if (opts.onCreated) { try { await opts.onCreated(row); } catch (e) { /* the page refreshes on its own too */ } }
        setTimeout(function () { close(row); }, 900);
      } catch (e) {
        msg("err", errorText(e));
        busy = false;
        const go = byId("tkGo");
        if (go) go.disabled = false;
      }
    }
  });
}
