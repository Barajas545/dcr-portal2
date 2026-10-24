/* Sales Leads (port of the old leads.html / leads.js; BLUEPRINT 3.3.11 "Leads", MODULES §5 "leads.html").

   The same page as before: the category chips, a search, one card per lead with its "contacted" age, and for the
   office (admin, manager) Contacted today, Convert to project, Edit and Delete. What changed:
   * the data is M5c's `leads` table through repo/leads.js (no more ?action=leads); every edit is versioned, so two
     people editing one lead get "changed by someone else" instead of one silently winning;
   * Convert to project is ONE database step (rpc convert_lead): the project is created (the database gives it the
     next number — nobody types an "Internal ID" any more) and the lead is linked to it, or neither happens. A
     converted lead links to its project;
   * the list starts on the open leads (Show: converted, all); "contacted today" and the ages are company days;
   * who: admin, manager, accountant and view-only read; admin and manager write. A lead or a field account is told
     leads are kept by the office and the page asks the database for nothing (it would answer no rows). */

import { boot, el, esc, toast, confirmBox, errorText, store, maskFor } from "./shell.js";
import * as repo from "../repo/leads.js";
import {
  readsLeads, writesLeads, visibleLeads, categories, contactedBadge, suggestions, convertDefaults, telHref, LEAD_COLS,
} from "../map/leads.js";
import { ymd, fmtDay } from "../map/pacific.js";
import { fill, valueOf } from "../map/masked-form.js";

const FIELDS = Object.keys(LEAD_COLS).filter(function (k) { return k !== "leadDate"; });
const SHOW_KEY = "dcr2_leads_show";
const state = { me: null, leads: [], canWrite: false, q: "", cat: "all", show: "open", editing: null, converting: null, busy: false,
  mask: function (t) { return t == null ? "" : String(t); } };

function today() { return ymd(new Date()); }
function byId(id) { return state.leads.find(function (x) { return String(x.id) === String(id); }) || null; }
function put(lead) {
  const i = state.leads.findIndex(function (x) { return String(x.id) === String(lead.id); });
  if (i === -1) state.leads.push(lead); else state.leads[i] = lead;
}
function open(id) { el(id).classList.add("open"); }
function close(id) { el(id).classList.remove("open"); }

/* ── the list ── */
function render() {
  const scoped = visibleLeads(state.leads, { show: state.show });
  const cats = categories(scoped);
  if (state.cat !== "all" && !cats.some(function (c) { return c.id === state.cat; })) state.cat = "all";
  el("ldChips").innerHTML = [{ id: "all", n: scoped.length, label: "All" }].concat(cats).map(function (c) {
    return '<button type="button" class="ls-chip" data-cat="' + esc(c.id) + '" aria-pressed="' + (state.cat === c.id ? "true" : "false") + '">' +
      esc(c.label || c.id) + '<span class="n">' + c.n + "</span></button>";
  }).join("");

  const rows = visibleLeads(state.leads, { show: state.show, cat: state.cat, q: state.q });
  const t = today();
  el("ldList").innerHTML = rows.map(function (l) {
    const b = contactedBadge(l, t);
    const tel = telHref(l.leadClientPhone);
    const acts = state.canWrite ? '<div class="ld-actions">' +
      '<button class="ls-btn ls-btn-sm" type="button" data-touch="' + esc(l.id) + '">&#128222; Contacted today</button>' +
      (l.leadCreateEstimate ? "" : '<button class="ls-btn ls-btn-sm" type="button" data-conv="' + esc(l.id) + '">&#8594; Convert to project</button>') +
      '<button class="ls-btn ls-btn-sm" type="button" data-edit="' + esc(l.id) + '">&#9998; Edit</button>' +
      '<button class="ls-btn ls-btn-sm ls-btn-danger" type="button" data-del="' + esc(l.id) + '" aria-label="Delete this lead" title="Delete this lead">&#128465;</button></div>' : "";
    const conv = l.leadCreateEstimate
      ? '<span class="ld-flag">&#10004; ' + (l.convertedProjectId !== null
        ? 'project <a href="project.html?id=' + encodeURIComponent(l.convertedProjectId) + '">' + esc(l.projectID || "open") + "</a>"
        : "estimate created") + "</span>"
      : "";
    return '<div class="ld-card" data-lead="' + esc(l.id) + '"><div class="ld-top">' +
      '<span class="ld-name">' + esc(state.mask(l.leadClientName) || "(no name)") + "</span>" +
      (l.leadCategory ? '<span class="ld-cat">' + esc(l.leadCategory) + "</span>" : "") + conv +
      '<span class="ld-age ' + esc(b.cls) + '">' + esc(b.text) + "</span></div>" +
      '<div class="ld-meta">' + [
        l.leadProjectName ? "Project: " + esc(state.mask(l.leadProjectName)) : "",
        l.leadClientPhone ? (tel ? '<a href="' + esc(tel) + '">' + esc(l.leadClientPhone) + "</a>" : esc(l.leadClientPhone)) : "",
        l.leadClientAddress ? esc(state.mask(l.leadClientAddress)) : "",
        l.leadSource ? "via " + esc(state.mask(l.leadSource)) : "",
        "lead date " + esc(fmtDay(l.leadDate)),
      ].filter(Boolean).join(" · ") + "</div>" +
      (l.leadNotes ? '<div class="ld-notes">' + esc(state.mask(l.leadNotes)) + "</div>" : "") + acts + "</div>";
  }).join("") || '<div class="ls-empty">No ' + (state.show === "converted" ? "converted " : state.show === "open" ? "open " : "") + "leads" +
    (state.cat !== "all" || state.q ? " match your filters." : " yet.") + "</div>";
}

/* ── writes ── */
async function touch(id) {
  const l = byId(id);
  if (!l || state.busy) return;
  state.busy = true;
  try { put(await repo.touchLead(l, today())); render(); toast("Marked contacted today.", "ok"); }
  catch (e) { await failed(e, l); }
  state.busy = false;
}

/** A refused or raced write: say it, and show the lead as the database has it now. */
async function failed(e, lead) {
  toast(errorText(e), "error");
  if (e && e.current) { put(e.current); render(); }
  else if (e && (e.code === "PT404" || e.status === 404) && lead) { state.leads = state.leads.filter(function (x) { return x !== lead; }); render(); }
}

function fillLists() {
  el("ldCats").innerHTML = suggestions(state.leads, "leadCategory").map(function (c) { return '<option value="' + esc(c) + '"></option>'; }).join("");
  el("ldSrcs").innerHTML = suggestions(state.leads, "leadSource").map(function (c) { return '<option value="' + esc(c) + '"></option>'; }).join("");
}

function openForm(id) {
  state.editing = id ? byId(id) : null;
  el("ldModalTitle").textContent = id ? "Edit lead" : "New lead";
  el("ldModalMsg").textContent = "";
  // words quoting an amount: masked and read-only for a person without prices, and never sent (map/masked-form.js)
  FIELDS.forEach(function (f) { fill(el("lf_" + f), state.editing ? state.editing[f] || "" : "", state.mask); });
  el("lf_leadDate").value = state.editing ? state.editing.leadDate || "" : today();
  fillLists();
  open("ldModal");
  el("lf_leadClientName").focus();
}

function formFields() {
  const f = {};
  FIELDS.forEach(function (k) { f[k] = valueOf(el("lf_" + k), state.editing ? state.editing[k] : ""); });
  f.leadDate = el("lf_leadDate").value;
  return f;
}

async function save(e) {
  if (e) e.preventDefault();
  if (state.busy) return;
  const f = formFields();
  if (!f.leadClientName.trim()) { el("ldModalMsg").textContent = "Client name is required."; el("lf_leadClientName").focus(); return; }
  state.busy = true;
  el("ldSave").disabled = true;
  try {
    const lead = state.editing ? await repo.updateLead(state.editing, f) : await repo.addLead(f, today());
    put(lead);
    close("ldModal");
    if (!state.editing && state.show === "converted") { state.show = "open"; el("ldShow").value = "open"; }
    render();
    toast(state.editing ? "Lead saved." : "Lead added.", "ok");
  } catch (err) {
    el("ldModalMsg").textContent = errorText(err);
    if (err && err.current) { put(err.current); state.editing = err.current; render(); }
  }
  el("ldSave").disabled = false;
  state.busy = false;
}

async function del(id) {
  const l = byId(id);
  if (!l) return;
  const ok = await confirmBox("This cannot be undone.", { title: "Delete the lead for " + (state.mask(l.leadClientName) || "this client") + "?", danger: true, okText: "Delete" });
  if (!ok) return;
  try {
    await repo.deleteLead(l);
    state.leads = state.leads.filter(function (x) { return x !== l; });
    render();
    toast("Lead deleted.", "ok");
  } catch (e) { await failed(e, l); }
}

/* ── convert to a project ── */
function openConvert(id) {
  state.converting = byId(id);
  if (!state.converting) return;
  const d = convertDefaults(state.converting);
  el("cvMsg").textContent = "";
  state.convertFrom = d;              // the words as the lead has them (a masked box sends these, never its mask)
  fill(el("cvName"), d.name, state.mask);
  fill(el("cvAddr"), d.address, state.mask);
  fill(el("cvCity"), d.city, state.mask);
  open("cvModal");
  el("cvName").focus();
}

async function convert(e) {
  if (e) e.preventDefault();
  if (state.busy || !state.converting) return;
  const d = state.convertFrom || {};
  const f = { name: valueOf(el("cvName"), d.name), address: valueOf(el("cvAddr"), d.address), city: valueOf(el("cvCity"), d.city) };
  if (!f.name.trim()) { el("cvMsg").textContent = "The project needs a name."; el("cvName").focus(); return; }
  state.busy = true;
  el("cvGo").disabled = true;
  try {
    const got = await repo.convertLead(state.converting, f);
    if (got.lead) put(got.lead);
    close("cvModal");
    render();
    toast("Project " + (got.project.number || "") + " created on the Board.", "ok");
  } catch (err) {
    el("cvMsg").textContent = errorText(err);
  }
  el("cvGo").disabled = false;
  state.busy = false;
}

/* ── live: another person's change is read again (Realtime, M5c publishes these tables), once per burst, never while a
   form is open or a write is on its way (it waits for that) ── */
let liveTimer = null;
function liveChange(modals) {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(function again() {
    if (state.busy || modals.some(function (id) { return el(id).classList.contains("open"); })) { liveTimer = setTimeout(again, 1500); return; }
    load(true);
  }, 700);
}
async function goLive(tables, modals) {
  try {
    const live = await import("../live.js");
    tables.forEach(function (t) {
      let joined = false;
      live.watch(t, null, function (evt) {
        if (!evt || evt.type === "LOST") return;
        if (evt.type === "SUBSCRIBED" && !joined) { joined = true; return; }   // the first read is load()
        liveChange(modals);
      });
    });
  } catch (e) { /* no live updates: the refresh button reads again */ }
}

/* ── data ── */
/** quiet (a live change): what is on screen stays when the read fails */
async function load(quiet) {
  if (!state.leads.length) el("ldList").innerHTML = '<div class="ls-empty">Loading leads…</div>';
  try {
    state.leads = await repo.loadLeads();
    render();
  } catch (e) {
    if (quiet === true && state.leads.length) return;
    el("ldList").innerHTML = '<div class="ls-empty">' + esc(errorText(e)) + "</div>";
  }
}

async function init() {
  const me = await boot("leads");
  state.me = me;
  if (!readsLeads(me)) {
    el("ldDenied").innerHTML = "<b>Leads are kept by the office.</b> The sales pipeline is open to admins, managers, the " +
      "accountant and view-only accounts. Ask the office if you need a client's details.";
    el("ldDenied").hidden = false;
    el("ldRefresh").hidden = true;
    el("ldSearch").hidden = true;
    return;
  }
  state.canWrite = writesLeads(me);
  state.mask = maskFor(me);              // amounts typed into notes: "(amount hidden)" without the prices switch (display only, Q28)
  state.show = ["open", "converted", "all"].indexOf(store.get(SHOW_KEY, "open")) !== -1 ? store.get(SHOW_KEY, "open") : "open";
  el("ldShow").value = state.show;
  el("ldMain").hidden = false;
  el("ldNewBtn").hidden = !state.canWrite;
  el("ldSearch").addEventListener("input", function () { state.q = this.value; render(); });
  el("ldShow").addEventListener("change", function () { state.show = this.value; store.set(SHOW_KEY, state.show); render(); });
  el("ldRefresh").addEventListener("click", function () { load(); });
  el("ldNewBtn").addEventListener("click", function () { openForm(null); });
  el("ldCancel").addEventListener("click", function () { close("ldModal"); });
  el("ldForm").addEventListener("submit", save);
  el("cvCancel").addEventListener("click", function () { close("cvModal"); });
  el("cvForm").addEventListener("submit", convert);
  ["ldModal", "cvModal"].forEach(function (id) {
    el(id).addEventListener("click", function (e) { if (e.target === el(id)) close(id); });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") ["ldModal", "cvModal"].forEach(close);
  });
  goLive(["leads"], ["ldModal", "cvModal"]);
  el("ldChips").addEventListener("click", function (e) {
    const c = e.target.closest && e.target.closest("[data-cat]");
    if (!c) return;
    state.cat = c.getAttribute("data-cat");
    render();
  });
  el("ldList").addEventListener("click", function (e) {
    const b = e.target.closest && e.target.closest("button");
    if (!b) return;
    if (b.hasAttribute("data-touch")) touch(b.getAttribute("data-touch"));
    else if (b.hasAttribute("data-conv")) openConvert(b.getAttribute("data-conv"));
    else if (b.hasAttribute("data-edit")) openForm(b.getAttribute("data-edit"));
    else if (b.hasAttribute("data-del")) del(b.getAttribute("data-del"));
  });
  await load();
}

init().catch(function (e) {
  if (e && /not signed in|not for this role/.test(e.message || "")) return;
  const l = document.getElementById("ldList");
  if (l) { l.innerHTML = '<div class="ls-empty">' + esc(errorText(e)) + "</div>"; document.getElementById("ldMain").hidden = false; }
});
