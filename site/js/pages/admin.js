/* Employees & crews (admin and manager; MODULES §2 "admin.html", BLUEPRINT 3.3.5).

   The old admin page managed SharePoint users, roles, per-list overrides, the free-text "employee
   identity" and "manages timesheets for". In Portal 2 the accounts, roles and switches stay in
   DCR Desktop 2 → Users; this page keeps the two things the timesheets need:
   - Employees: everyone who logs time or is reminded (with or without an account) — name, number,
     phone (the database derives the texting number), e-mail, address, normal hours; add, edit,
     deactivate (they stay in the history); link to an account (one employee per account).
   - Crews: each lead's crew (crew_members), added and removed one person at a time.
   Never pay rates (Q16), never the old portal's address/password columns. The database refuses
   every write from anyone but an admin or a manager. */

import { boot, el, esc, errorText, toast, confirmBox } from "./shell.js";
import * as employees from "../repo/employees.js";
import { scheduleText, hm, hoursText } from "../map/timesheets.js";
import { avatarInitials } from "./ts-shared.js";

const state = { list: [], accounts: [], crews: [], tab: "emp" };
const ROLE_WORD = { admin: "Admin", manager: "Manager", accountant: "Accountant", lead: "Lead", field: "Field", viewer: "View only" };

function account(id) { return state.accounts.find(function (a) { return String(a.id) === String(id); }) || null; }
function employee(id) { return state.list.find(function (e) { return String(e.id) === String(id); }) || null; }
function leadsOf(empId) {
  return state.crews.filter(function (c) { return String(c.employee_id) === String(empId); }).map(function (c) { return account(c.lead_profile_id); }).filter(Boolean);
}
function normalHours(e) {
  return scheduleText({ leave: false, start1: hm(e.normal_start1), end1: hm(e.normal_end1), start2: hm(e.normal_start2), end2: hm(e.normal_end2),
    lunch: e.normal_lunch_hours === null || e.normal_lunch_hours === undefined ? null : Number(e.normal_lunch_hours) });
}

/* ── employees ─────────────────────────────────────────────────────────── */

function renderEmployees() {
  const q = el("adSearch").value.trim().toLowerCase();
  const showOff = el("adInactive").checked;
  const rows = state.list.filter(function (e) {
    if (!showOff && e.active === false) return false;
    if (!q) return true;
    return [e.full_name, e.employee_no, e.phone, e.email].some(function (v) { return String(v || "").toLowerCase().indexOf(q) !== -1; });
  });
  const active = state.list.filter(function (e) { return e.active !== false; }).length;
  el("adCount").textContent = active + " active" + (state.list.length > active ? " · " + (state.list.length - active) + " left" : "");
  if (!rows.length) { el("adList").innerHTML = '<div class="ad-empty">' + (state.list.length ? "Nobody matches." : "No employees yet. Add the first with “+ New employee”.") + "</div>"; return; }
  el("adList").innerHTML = '<div class="ad-grid">' + rows.map(function (e) {
    const acc = account(e.profile_id);
    const leads = leadsOf(e.id);
    const hrs = normalHours(e);
    const kv = [];
    kv.push(["Phone", e.phone ? e.phone + (e.phone_e164 ? "" : " ⚠") : "—"]);
    if (e.phone && !e.phone_e164) kv.push(["", "Not a number DCR Agents can text"]);
    kv.push(["E-mail", e.email || "—"]);
    kv.push(["Address", e.address || "—"]);
    kv.push(["Normal hours", hrs || "—"]);
    kv.push(["Account", acc ? acc.name + " · " + (ROLE_WORD[acc.role] || acc.role) + (acc.active ? "" : " (turned off)") : "Not linked"]);
    kv.push(["Crew of", leads.length ? leads.map(function (a) { return a.name; }).join(", ") : "—"]);
    return '<div class="ad-card' + (e.active === false ? " off" : "") + '" data-id="' + esc(e.id) + '">' +
      '<div class="ad-top"><div class="ad-av">' + esc(avatarInitials(e.full_name)) + '</div><div style="min-width:0;flex:1"><div class="ad-nm">' + esc(e.full_name) + "</div>" +
      '<div class="ad-no">' + esc(e.employee_no || "No number") + (e.legacy_sp_id ? " · from the old portal" : "") + "</div></div>" +
      (e.active === false ? '<span class="ad-pill">Left</span>' : acc ? '<span class="ad-pill ok">Signs in</span>' : '<span class="ad-pill warn">No account</span>') + "</div>" +
      '<div class="ad-kv">' + kv.map(function (p) { return "<span>" + esc(p[0]) + "</span><span>" + esc(p[1]) + "</span>"; }).join("") + "</div>" +
      (e.notes ? '<div class="ad-no" style="white-space:pre-wrap">' + esc(e.notes) + "</div>" : "") +
      '<div class="ad-acts"><button type="button" class="btn btn-ghost btn-sm" data-edit="' + esc(e.id) + '">✎ Edit</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-active="' + esc(e.id) + '">' + (e.active === false ? "Reactivate" : "Deactivate") + "</button></div></div>";
  }).join("") + "</div>";
}

function friendly(e) {
  const m = String((e && (e.message || "")) + " " + (e && e.details || ""));
  if (e && e.code === "23505") {
    if (/profile/.test(m)) return "That account is already linked to another employee.";
    if (/name/.test(m)) return "Another active employee already has that name.";
  }
  return errorText(e);
}

function openEditor(emp) {
  const e = emp || { active: true, normal_lunch_hours: 1 };
  const linkedElsewhere = {};
  state.list.forEach(function (x) { if (x.profile_id && (!emp || String(x.id) !== String(emp.id))) linkedElsewhere[String(x.profile_id)] = x.full_name; });
  const opts = '<option value="">— Not linked —</option>' + state.accounts.map(function (a) {
    const taken = linkedElsewhere[String(a.id)];
    return '<option value="' + esc(a.id) + '"' + (String(a.id) === String(e.profile_id || "") ? " selected" : "") + (taken ? " disabled" : "") + ">" +
      esc(a.name + " · " + (ROLE_WORD[a.role] || a.role) + (a.active ? "" : " (turned off)") + (taken ? " — linked to " + taken : "")) + "</option>";
  }).join("");
  const t = function (v) { return esc(hm(v)); };
  el("adModal").innerHTML = '<div class="ad-mo"><form class="ad-box" id="adForm" novalidate autocomplete="off" role="dialog" aria-modal="true" aria-labelledby="adFormT">' +
    '<h3 id="adFormT">' + (emp ? "Edit employee" : "New employee") + "</h3>" +
    '<div class="ad-fg">' +
    '<div class="full"><label for="fName">Full name *</label><input id="fName" maxlength="120" value="' + esc(e.full_name || "") + '"></div>' +
    '<div><label for="fNo">Employee number</label><input id="fNo" maxlength="40" value="' + esc(e.employee_no || "") + '"></div>' +
    '<div><label for="fPhone">Phone (for texted reminders)</label><input id="fPhone" maxlength="80" inputmode="tel" value="' + esc(e.phone || "") + '"></div>' +
    '<div><label for="fEmail">E-mail</label><input id="fEmail" type="email" maxlength="200" value="' + esc(e.email || "") + '"></div>' +
    '<div><label for="fAccount">Account (sign-in)</label><select id="fAccount">' + opts + "</select></div>" +
    '<div class="full"><label for="fAddress">Address</label><input id="fAddress" maxlength="300" value="' + esc(e.address || "") + '"></div>' +
    '<div class="full"><label>Normal hours (fill the Time Sheet\'s schedule)</label><div class="ad-sched">' +
      '<div><label for="fS1">Morning start</label><input id="fS1" type="time" value="' + t(e.normal_start1) + '"></div>' +
      '<div><label for="fE1">Morning end</label><input id="fE1" type="time" value="' + t(e.normal_end1) + '"></div>' +
      '<div><label for="fL">Lunch (h)</label><input id="fL" inputmode="decimal" value="' + esc(e.normal_lunch_hours === null || e.normal_lunch_hours === undefined ? "" : hoursText(e.normal_lunch_hours)) + '"></div>' +
      '<div><label for="fS2">Afternoon start</label><input id="fS2" type="time" value="' + t(e.normal_start2) + '"></div>' +
      '<div><label for="fE2">Afternoon end</label><input id="fE2" type="time" value="' + t(e.normal_end2) + '"></div>' +
    "</div></div>" +
    '<div class="full"><label for="fNotes">Notes (the person and their lead can read them)</label><textarea id="fNotes" rows="2" maxlength="2000">' + esc(e.notes || "") + "</textarea></div>" +
    '<div class="full"><label class="ad-chk" style="margin-top:12px"><input type="checkbox" id="fActive"' + (e.active === false ? "" : " checked") + "> Active (shown in the timesheet pickers and reminded)</label></div>" +
    '</div><div class="ad-msg" id="adMsg" role="alert"></div><div class="ad-foot"><button type="button" class="btn btn-ghost btn-sm" data-close="1">Cancel</button>' +
    '<button type="submit" class="btn btn-sm" id="adSave">Save</button></div></form></div>';
  const mo = el("adModal").firstChild;
  mo.addEventListener("click", function (ev) { if (ev.target === mo || ev.target.closest("[data-close]")) el("adModal").innerHTML = ""; });
  el("fName").focus();
  el("adForm").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    const f = {
      full_name: el("fName").value, employee_no: el("fNo").value, phone: el("fPhone").value, email: el("fEmail").value,
      address: el("fAddress").value, normal_start1: el("fS1").value, normal_end1: el("fE1").value, normal_start2: el("fS2").value,
      normal_end2: el("fE2").value, normal_lunch_hours: el("fL").value, notes: el("fNotes").value, active: el("fActive").checked,
      profile_id: el("fAccount").value || null,
    };
    if (!f.full_name.trim()) { el("adMsg").textContent = "A name is needed."; return; }
    if (f.normal_lunch_hours !== "" && !(Number(f.normal_lunch_hours) >= 0 && Number(f.normal_lunch_hours) <= 8)) { el("adMsg").textContent = "Lunch is 0 to 8 hours."; return; }
    let patch = f;
    if (emp) {
      const before = employees.employeeRow({ full_name: emp.full_name, employee_no: emp.employee_no, phone: emp.phone, email: emp.email, address: emp.address,
        normal_start1: emp.normal_start1, normal_end1: emp.normal_end1, normal_start2: emp.normal_start2, normal_end2: emp.normal_end2,
        normal_lunch_hours: emp.normal_lunch_hours, notes: emp.notes, active: emp.active !== false, profile_id: emp.profile_id });
      const after = employees.employeeRow(f);
      patch = {};
      Object.keys(after).forEach(function (k) { if (String(after[k]) !== String(before[k])) patch[k] = f[k]; });
      if (!Object.keys(patch).length) { el("adModal").innerHTML = ""; return; }
    }
    el("adSave").disabled = true;
    el("adMsg").textContent = "";
    try {
      if (emp) await employees.updateEmployee(emp, patch); else await employees.createEmployee(f);
      el("adModal").innerHTML = "";
      toast(emp ? "Saved." : "Employee added.", "ok");
      await load();
    } catch (e2) {
      el("adMsg").textContent = e2 && e2.code === "PT409" ? "Someone else changed this employee meanwhile. Close and open it again to see the latest." : friendly(e2);
      el("adSave").disabled = false;
    }
  });
}

async function toggleActive(emp) {
  const off = emp.active !== false;
  const ok = await confirmBox(off
    ? emp.full_name + " leaves the timesheet pickers and the reminders. Their hours stay in the history, and they can be reactivated."
    : emp.full_name + " comes back to the timesheet pickers and the reminders.",
  { title: off ? "Deactivate " + emp.full_name + "?" : "Reactivate " + emp.full_name + "?", okText: off ? "Deactivate" : "Reactivate", danger: off });
  if (!ok) return;
  try {
    await employees.setActive(emp, !off);
    toast(off ? "Deactivated." : "Reactivated.", "ok");
  } catch (e) {
    toast(friendly(e), "error");
  }
  await load();
}

/* ── crews ─────────────────────────────────────────────────────────────── */

function renderCrews() {
  const ids = {};
  state.accounts.forEach(function (a) { if (a.role === "lead" && a.active) ids[String(a.id)] = 1; });
  state.crews.forEach(function (c) { ids[String(c.lead_profile_id)] = 1; });
  const leads = Object.keys(ids).map(account).filter(Boolean).sort(function (a, b) { return a.name.localeCompare(b.name); });
  if (!leads.length) {
    el("adCrews").innerHTML = '<div class="ad-empty">No lead accounts yet. Give someone the Lead role in DCR Desktop 2 → Users, then set their crew here.</div>';
    return;
  }
  const active = state.list.filter(function (e) { return e.active !== false; });
  el("adCrews").innerHTML = leads.map(function (a) {
    const crew = state.crews.filter(function (c) { return String(c.lead_profile_id) === String(a.id); }).map(function (c) { return employee(c.employee_id); }).filter(Boolean)
      .sort(function (x, y) { return x.full_name.localeCompare(y.full_name); });
    const own = state.list.find(function (e) { return String(e.profile_id) === String(a.id); });
    const free = active.filter(function (e) { return !crew.some(function (c) { return String(c.id) === String(e.id); }) && (!own || String(own.id) !== String(e.id)); });
    return '<div class="ad-crew" data-lead="' + esc(a.id) + '"><h3>' + esc(a.name) + ' <span class="ad-pill">' + esc(ROLE_WORD[a.role] || a.role) + "</span>" +
      '<span class="ad-pill ' + (crew.length ? "ok" : "warn") + '">' + crew.length + (crew.length === 1 ? " person" : " people") + "</span></h3>" +
      (own ? "" : '<div class="ad-no">⚠ This account is not linked to an employee yet: link it on the Employees tab so they can log their own hours.</div>') +
      '<div class="ad-chips">' + (crew.length ? crew.map(function (e) {
        return '<span class="ad-chip">' + esc(e.full_name) + (e.active === false ? " (left)" : "") + '<button type="button" data-unlink="' + esc(e.id) + '" aria-label="Remove ' + esc(e.full_name) + ' from the crew">&times;</button></span>';
      }).join("") : '<span class="ad-no">Nobody yet.</span>') + "</div>" +
      '<div class="ad-add"><select aria-label="Add to ' + esc(a.name) + '’s crew" data-pick="1"><option value="">Add someone to the crew…</option>' +
      free.map(function (e) { return '<option value="' + esc(e.id) + '">' + esc(e.full_name) + (e.employee_no ? " · " + esc(e.employee_no) : "") + "</option>"; }).join("") +
      '</select><button type="button" class="btn btn-sm" data-addcrew="1">Add</button></div></div>';
  }).join("");
}

async function onCrewClick(ev) {
  const box = ev.target.closest("[data-lead]");
  if (!box) return;
  const lead = box.getAttribute("data-lead");
  const un = ev.target.closest("[data-unlink]");
  if (un) {
    const e = employee(un.getAttribute("data-unlink"));
    const a = account(lead);
    if (!(await confirmBox("Remove " + (e ? e.full_name : "this person") + " from " + (a ? a.name : "the lead") + "’s crew?", { title: "Remove from crew", okText: "Remove" }))) return;
    try {
      const done = await employees.removeFromCrew(lead, un.getAttribute("data-unlink"));
      toast(done ? "Removed from the crew." : "Nothing to remove (already gone, or not allowed).", done ? "ok" : "error");
    } catch (e2) { toast(friendly(e2), "error"); }
    await load();
    return;
  }
  if (ev.target.closest("[data-addcrew]")) {
    const sel = box.querySelector("[data-pick]");
    if (!sel.value) { sel.focus(); return; }
    try {
      await employees.addToCrew(lead, sel.value);
      toast("Added to the crew.", "ok");
    } catch (e3) { toast(e3 && e3.code === "23505" ? "Already in this crew." : friendly(e3), "error"); }
    await load();
  }
}

/* ── load, tabs ────────────────────────────────────────────────────────── */

async function load() {
  try {
    const [list, accounts, crews] = await Promise.all([employees.listEmployees(), employees.listAccounts(), employees.listCrews()]);
    state.list = list; state.accounts = accounts; state.crews = crews;
    renderEmployees();
    renderCrews();
  } catch (e) {
    el("adList").innerHTML = '<div class="ad-empty">' + esc(errorText(e)) + "</div>";
    el("adCrews").innerHTML = '<div class="ad-empty">' + esc(errorText(e)) + "</div>";
  }
}

function tab(which) {
  state.tab = which;
  el("tabEmp").setAttribute("aria-selected", which === "emp" ? "true" : "false");
  el("tabCrew").setAttribute("aria-selected", which === "crew" ? "true" : "false");
  el("paneEmp").hidden = which !== "emp";
  el("paneCrew").hidden = which !== "crew";
  try { history.replaceState(null, "", which === "crew" ? "admin.html?tab=crews" : "admin.html"); } catch (e) { /* */ }
}

async function start() {
  await boot("admin", { roles: ["admin", "manager"] });
  el("adNew").addEventListener("click", function () { openEditor(null); });
  el("adSearch").addEventListener("input", renderEmployees);
  el("adInactive").addEventListener("change", renderEmployees);
  el("tabEmp").addEventListener("click", function () { tab("emp"); });
  el("tabCrew").addEventListener("click", function () { tab("crew"); });
  el("adList").addEventListener("click", function (ev) {
    const ed = ev.target.closest("[data-edit]"), ac = ev.target.closest("[data-active]");
    if (ed) openEditor(employee(ed.getAttribute("data-edit")));
    else if (ac) toggleActive(employee(ac.getAttribute("data-active")));
  });
  el("adCrews").addEventListener("click", onCrewClick);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && el("adModal").firstChild) el("adModal").innerHTML = ""; });
  if (/[?&]tab=crews\b/.test(location.search)) tab("crew");
  await load();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();
