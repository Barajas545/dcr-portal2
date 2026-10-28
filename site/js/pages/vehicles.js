/* The Vehicle Board (port of the old vehicles.html / vehicles.js — itself the web port of the Access VehicleBoard;
   BLUEPRINT 3.3.11 "Vehicles", Q18, MODULES §5 "vehicles.html").

   The same board: oil changes due, services due and every vehicle, a panel with the selected vehicle, its open
   maintenance and its history; the office schedules and completes services. What changed:
   * the data is M5c's `vehicles` and `vehicle_maintenance` through repo/vehicles.js; every edit is versioned;
   * the due rules are worked out in company days (map/vehicles.js): "this month" is the Los Angeles month; an oil
     change is also due by miles; registration, emissions and DOT dates have their own list;
   * the office can add and edit a vehicle here (the old portal's generic Data Browser is gone) — never an insurance
     policy number (Q18); a vehicle taken out of service is "retired": due nothing, listed only when asked;
   * completing a service is ONE database step (rpc complete_vehicle_maintenance: done today in company time, an oil
     change stamps the vehicle, its mileage only moves forward); the labour time and recommendations follow it;
   * a service's material cost is money: it is asked for, read and shown only with the financials switch;
   * who: everyone signed in reads the board (the crews need it); admin and manager schedule, complete and edit. */

import { boot, el, esc, toast, errorText, qs, setQs, maskFor } from "./shell.js";
import * as repo from "../repo/vehicles.js";
import {
  board, vLabel, writesVehicles, seesCosts, openFor, historyFor, serviceText, nextOilDate, oilMilesLeft, papersDue, oilDue,
  fmtMiles, fmtMoney, VEHICLE_COLS,
} from "../map/vehicles.js";
import { ymd, fmtDay } from "../map/pacific.js";
import { fill, valueOf } from "../map/masked-form.js";

const VFIELDS = Object.keys(VEHICLE_COLS);
const state = { me: null, vehicles: [], maint: [], canWrite: false, costs: false, selId: null, q: "", retired: false, doneItem: null, editM: null,
  editV: null, busy: false, mask: function (t) { return t == null ? "" : String(t); } };

function today() { return ymd(new Date()); }
function label(v) { return state.mask(vLabel(v)); }
function vehById(id) { return state.vehicles.find(function (v) { return String(v.id) === String(id); }) || null; }
function putV(v) { const i = state.vehicles.findIndex(function (x) { return String(x.id) === String(v.id); }); if (i === -1) state.vehicles.push(v); else state.vehicles[i] = v; }
function putM(m) { const i = state.maint.findIndex(function (x) { return String(x.id) === String(m.id); }); if (i === -1) state.maint.push(m); else state.maint[i] = m; }
function openM(id) { el(id).classList.add("open"); }
function closeM(id) { el(id).classList.remove("open"); }

/* ── the board ── */
function row(v, dueTxt, dueCls, sub) {
  const sel = String(v.id) === String(state.selId) ? " sel" : "";
  return '<button type="button" class="vb-row' + sel + '" data-vid="' + esc(v.id) + '"><span>' + esc(label(v)) +
    (sub ? '<br><span class="vb-sub">' + esc(sub) + "</span>" : "") + "</span>" +
    (dueTxt ? '<span class="due ' + dueCls + '">' + esc(dueTxt) + "</span>" : "") + "</button>";
}

function render() {
  const t = today();
  const b = board(state.vehicles, state.maint, t, state.q, { retired: state.retired, mask: state.mask });
  el("vbOilCount").textContent = b.oil.length;
  el("vbOilList").innerHTML = b.oil.map(function (x) {
    const d = x.due;
    if (d.by === "miles") return row(x.v, "by miles", "over", (d.milesLeft === 0 ? "at" : fmtMiles(-d.milesLeft) + " past") + " the oil interval");
    return row(x.v, fmtDay(d.due), d.over ? "over" : "soon", "");
  }).join("") || '<div class="vb-empty">No oil changes due this month.</div>';

  el("vbSvcCount").textContent = b.svc.length;
  el("vbSvcList").innerHTML = b.svc.map(function (x) {
    return row(x.v, fmtDay(x.m.nextServiceDate), x.over ? "over" : "soon", state.mask(serviceText(x.m)));
  }).join("") || '<div class="vb-empty">No services due this month.</div>';

  el("vbPaperCount").textContent = b.papers.length;
  el("vbPaperList").innerHTML = b.papers.map(function (x) {
    return row(x.v, fmtDay(x.p.due), x.p.over ? "over" : "soon", x.p.what);
  }).join("") || '<div class="vb-empty">Nothing due this month.</div>';

  el("vbAllCount").textContent = b.all.length;
  el("vbRetiredWrap").hidden = !b.retired && !state.retired;
  el("vbRetiredN").textContent = b.retired ? "(" + b.retired + ")" : "";
  el("vbAllList").innerHTML = b.all.map(function (x) {
    if (x.v.vehicleActive === false) return row(x.v, "retired", "muted", x.v.vehicleDriverInformation ? "Driver: " + state.mask(x.v.vehicleDriverInformation) : "");
    return row(x.v, x.open ? x.open + " open" : "", "soon", x.v.vehicleDriverInformation ? "Driver: " + state.mask(x.v.vehicleDriverInformation) : "");
  }).join("") || '<div class="vb-empty">' + (state.q ? "No vehicle matches." : "No vehicles.") + "</div>";
  if (state.selId) panel();
}

function kv(k, v, raw) {
  if (v === null || v === undefined || v === "") return "";
  return '<div class="vb-kv"><span class="k">' + esc(k) + "</span><span>" + (raw ? v : esc(v)) + "</span></div>";
}

/* ── the panel ── */
function panel() {
  const v = vehById(state.selId);
  if (!v) { el("vbPanel").hidden = true; return; }
  const t = today();
  el("vbPanel").hidden = false;
  el("vpName").textContent = label(v);
  el("vpSub").textContent = [v.vehicleName !== v.vehicleDescription ? v.vehicleName : "", v.vehicleActive === false ? "Retired" : ""].filter(Boolean).join(" · ");
  const next = nextOilDate(v);
  const due = oilDue(v, t);
  const left = oilMilesLeft(v);
  const papers = papersDue(v, t);
  const paperDue = function (key) { return papers.some(function (p) { return p.key === key; }); };
  const dayKv = function (label, key) {
    if (!v[key]) return "";
    return kv(label, paperDue(key) ? '<span class="vb-due-over">' + esc(fmtDay(v[key])) + "</span>" : esc(fmtDay(v[key])), true);
  };
  el("vpInfo").innerHTML =
    kv("Driver", state.mask(v.vehicleDriverInformation)) + kv("Plate", v.licensePlateNumber) + kv("VIN", v.vehicleVIN) +
    kv("Mileage", fmtMiles(v.currentMileage)) +
    kv("Last oil change", v.lastOilChangeDate ? fmtDay(v.lastOilChangeDate) + (v.lastOilChangeMileage !== null ? " at " + fmtMiles(v.lastOilChangeMileage) : "") : null) +
    kv("Oil interval", [v.oilChangeIntervalMonths ? v.oilChangeIntervalMonths + " months" : "", v.oilChangeIntervalMiles ? fmtMiles(v.oilChangeIntervalMiles) : ""].filter(Boolean).join(" or ")) +
    kv("Next oil due", next ? '<span class="' + (due && due.by === "date" ? "vb-due-over" : "vb-due-ok") + '">' + esc(fmtDay(next)) + "</span>" : null, true) +
    kv("Miles to oil", left === null ? null : (left <= 0 ? '<span class="vb-due-over">' + esc(fmtMiles(-left)) + " past</span>" : esc(fmtMiles(left))), true) +
    dayKv("Registration exp.", "registrationExpirationDate") + dayKv("Emissions due", "emissionsDueDate") + dayKv("DOT inspection", "dOTInspectionDueDate") +
    kv("Insurance", state.mask(v.insuranceProvider)) + kv("Notes", v.vehicleNotes ? state.mask(v.vehicleNotes) : "");
  el("vpActs").innerHTML = state.canWrite
    ? '<button class="ls-btn ls-btn-sm" type="button" data-sched="' + esc(v.id) + '">&#65291; Schedule service</button>' +
      '<button class="ls-btn ls-btn-sm" type="button" data-editv="' + esc(v.id) + '">&#9998; Edit vehicle</button>'
    : "";

  const open = openFor(state.maint, v.id);
  el("vpOpen").innerHTML = open.map(function (m) {
    return '<div class="vb-maint"><div class="d">' + (m.nextServiceDate ? "Due " + esc(fmtDay(m.nextServiceDate)) : "No date") + "</div>" +
      esc(state.mask(serviceText(m))) +
      (state.canWrite ? '<div class="acts"><button class="ls-btn ls-btn-sm" type="button" data-done="' + esc(m.id) + '">&#10003; Complete</button>' +
        '<button class="ls-btn ls-btn-sm" type="button" data-editm="' + esc(m.id) + '">&#9998; Edit</button></div>' : "") + "</div>";
  }).join("") || '<div class="vb-empty">Nothing scheduled.</div>';

  const hist = historyFor(state.maint, v.id, 10);
  el("vpHistory").innerHTML = hist.map(function (m) {
    const bits = [];
    if (m.currentMileage !== null) bits.push(fmtMiles(m.currentMileage));
    if (m.laborTime) bits.push("labour " + m.laborTime);
    if (state.costs && m.materialCost !== null) bits.push('<span class="cost">' + esc(fmtMoney(m.materialCost)) + "</span> material");
    return '<div class="vb-maint"><div class="d">' + esc(fmtDay(m.serviceCompletionDate)) + "</div>" +
      esc(state.mask(m.servicePerformed || serviceText(m))) +
      (bits.length ? '<div class="vb-sub">' + bits.map(function (b) { return /^<span/.test(b) ? b : esc(b); }).join(" · ") + "</div>" : "") +
      (m.nextServiceRecomendations ? '<div class="vb-sub">Next: ' + esc(state.mask(m.nextServiceRecomendations)) + "</div>" : "") + "</div>";
  }).join("") || '<div class="vb-empty">No completed services.</div>';
}

function select(id, scroll) {
  state.selId = id;
  setQs("id", id);
  el("vpMsg").textContent = "";
  render();
  if (scroll && window.matchMedia && window.matchMedia("(max-width: 900px)").matches) {
    try { el("vbPanel").scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) { /* */ }
  }
}

/* ── schedule ── */
function openSched(vid) {
  el("smMsg").textContent = "";
  el("smVehicle").innerHTML = state.vehicles.slice().sort(function (a, b) { return vLabel(a).localeCompare(vLabel(b), "en", { numeric: true }); })
    .map(function (v) { return '<option value="' + esc(v.id) + '"' + (String(v.id) === String(vid || state.selId) ? " selected" : "") + ">" + esc(label(v)) + "</option>"; }).join("");
  el("smDate").value = "";
  el("smReq").value = "";
  openM("schedModal");
  el("smReq").focus();
}

async function saveSched(e) {
  e.preventDefault();
  if (state.busy) return;
  const v = vehById(el("smVehicle").value);
  state.busy = true; el("smSave").disabled = true; el("smMsg").textContent = "";
  try {
    putM(await repo.scheduleService(v, { date: el("smDate").value, requirements: el("smReq").value }));
    closeM("schedModal");
    select(v.id, false);
    toast("Service scheduled.", "ok");
  } catch (err) { el("smMsg").textContent = errorText(err); }
  el("smSave").disabled = false; state.busy = false;
}

/* ── complete ── */
function openDone(id) {
  state.doneItem = state.maint.find(function (m) { return String(m.id) === String(id); }) || null;
  if (!state.doneItem) return;
  el("dmWhat").textContent = label(vehById(state.doneItem.vehicleID)) + " — " + state.mask(serviceText(state.doneItem));
  ["dmWork", "dmMiles", "dmLabor", "dmRec", "dmCost"].forEach(function (k) { el(k).value = ""; });
  el("dmOil").checked = /\boil\b/i.test(serviceText(state.doneItem));
  el("dmCostRow").hidden = !state.costs;
  el("dmMsg").textContent = "";
  openM("doneModal");
  el("dmWork").focus();
}

async function saveDone(e) {
  e.preventDefault();
  if (state.busy || !state.doneItem) return;
  const m = state.doneItem;
  const v = vehById(m.vehicleID);
  const f = { performed: el("dmWork").value, mileage: el("dmMiles").value, oil: el("dmOil").checked, laborTime: el("dmLabor").value,
    recommendations: el("dmRec").value };
  if (state.costs && el("dmCost").value.trim()) f.materialCost = el("dmCost").value;
  state.busy = true; el("dmSave").disabled = true; el("dmMsg").textContent = "";
  try {
    const got = await repo.completeService(m, v, f);
    putM(got.maintenance);
    if (got.vehicle) putV(got.vehicle);
    closeM("doneModal");
    select(m.vehicleID, false);
    const warn = [];
    if (got.extraError) warn.push("the labour time and recommendations were not saved (" + errorText(got.extraError) + ")");
    if (got.costError) warn.push("the material cost was not saved (" + errorText(got.costError) + ")");
    if (warn.length) { el("vpMsg").className = "ls-msg err"; el("vpMsg").textContent = "Service completed, but " + warn.join(" and ") + "."; }
    else toast("Service completed.", "ok");
  } catch (err) {
    el("dmMsg").textContent = errorText(err);
    if (err && err.current) { putM(err.current); render(); }
  }
  el("dmSave").disabled = false; state.busy = false;
}

/* ── edit a scheduled service ── */
function openEditM(id) {
  state.editM = state.maint.find(function (m) { return String(m.id) === String(id); }) || null;
  if (!state.editM) return;
  el("emDate").value = state.editM.nextServiceDate || "";
  fill(el("emReq"), state.editM.nextServiceRequirements || "", state.mask);
  el("emMsg").textContent = "";
  openM("editMModal");
}

async function saveEditM(e) {
  e.preventDefault();
  if (state.busy || !state.editM) return;
  state.busy = true; el("emSave").disabled = true;
  try {
    putM(await repo.updateMaintenance(state.editM, { nextServiceDate: el("emDate").value, nextServiceRequirements: valueOf(el("emReq"), state.editM.nextServiceRequirements) }));
    closeM("editMModal");
    render();
    toast("Saved.", "ok");
  } catch (err) {
    el("emMsg").textContent = errorText(err);
    if (err && err.current) { putM(err.current); state.editM = err.current; render(); }
  }
  el("emSave").disabled = false; state.busy = false;
}

/* ── add or edit a vehicle ── */
function openVehicle(id) {
  state.editV = id ? vehById(id) : null;
  el("vfTitle").textContent = state.editV ? "Edit vehicle" : "Add vehicle";
  VFIELDS.forEach(function (k) {
    if (k === "vehicleActive") { el("vf_vehicleActive").checked = state.editV ? state.editV.vehicleActive !== false : true; return; }
    const v = state.editV ? state.editV[k] : "";
    fill(el("vf_" + k), v === null || v === undefined ? "" : String(v), state.mask);
  });
  el("vfMsg").textContent = "";
  openM("vehModal");
  el("vf_fleetNumber").focus();
}

async function saveVehicle(e) {
  e.preventDefault();
  if (state.busy) return;
  const f = {};
  VFIELDS.forEach(function (k) {
    const was = state.editV ? state.editV[k] : "";
    f[k] = k === "vehicleActive" ? el("vf_vehicleActive").checked : valueOf(el("vf_" + k), was === null || was === undefined ? "" : String(was));
  });
  state.busy = true; el("vfSave").disabled = true; el("vfMsg").textContent = "";
  try {
    const v = state.editV ? await repo.updateVehicle(state.editV, f) : await repo.addVehicle(f);
    putV(v);
    closeM("vehModal");
    select(v.id, false);
    toast(state.editV ? "Vehicle saved." : "Vehicle added.", "ok");
  } catch (err) {
    el("vfMsg").textContent = errorText(err);
    if (err && err.current) { putV(err.current); state.editV = err.current; render(); }
  }
  el("vfSave").disabled = false; state.busy = false;
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
  try {
    const d = await repo.loadFleet({ costs: state.costs });
    state.vehicles = d.vehicles;
    state.maint = d.maintenance;
    if (state.selId && !vehById(state.selId)) { state.selId = null; setQs("id", null); el("vbPanel").hidden = true; }
    render();
  } catch (e) {
    if (quiet === true && state.vehicles.length) return;
    el("vbAllList").innerHTML = '<div class="vb-empty">' + esc(errorText(e)) + "</div>";
  }
}

async function init() {
  const me = await boot("vehicles");
  state.me = me;
  state.canWrite = writesVehicles(me);
  state.costs = seesCosts(me);
  state.mask = maskFor(me);              // amounts typed into notes: "(amount hidden)" without the prices switch (display only, Q28)
  el("vbSchedBtn").hidden = !state.canWrite;
  el("vbAddBtn").hidden = !state.canWrite;
  el("vbSearch").addEventListener("input", function () { state.q = this.value; render(); });
  el("vbRetired").addEventListener("change", function () { state.retired = this.checked; render(); });
  el("vbRefresh").addEventListener("click", function () { load(); });
  el("vbSchedBtn").addEventListener("click", function () { openSched(null); });
  el("vbAddBtn").addEventListener("click", function () { openVehicle(null); });
  el("vpClose").addEventListener("click", function () { state.selId = null; setQs("id", null); el("vbPanel").hidden = true; render(); });
  el("schedForm").addEventListener("submit", saveSched);
  el("doneForm").addEventListener("submit", saveDone);
  el("editMForm").addEventListener("submit", saveEditM);
  el("vehForm").addEventListener("submit", saveVehicle);
  [["smCancel", "schedModal"], ["dmCancel", "doneModal"], ["emCancel", "editMModal"], ["vfCancel", "vehModal"]].forEach(function (p) {
    el(p[0]).addEventListener("click", function () { closeM(p[1]); });
    el(p[1]).addEventListener("click", function (e) { if (e.target === el(p[1])) closeM(p[1]); });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") ["schedModal", "doneModal", "editMModal", "vehModal"].forEach(closeM);
  });
  el("vbMain").addEventListener("click", function (e) {
    const t = e.target.closest && e.target.closest("[data-vid],[data-done],[data-editm],[data-sched],[data-editv]");
    if (!t) return;
    if (t.hasAttribute("data-vid")) select(t.getAttribute("data-vid"), true);
    else if (t.hasAttribute("data-done")) openDone(t.getAttribute("data-done"));
    else if (t.hasAttribute("data-editm")) openEditM(t.getAttribute("data-editm"));
    else if (t.hasAttribute("data-sched")) openSched(t.getAttribute("data-sched"));
    else if (t.hasAttribute("data-editv")) openVehicle(t.getAttribute("data-editv"));
  });
  const want = qs("id");
  if (want) state.selId = want;
  goLive(["vehicles", "vehicle_maintenance"].concat(state.costs ? ["vehicle_maintenance_costs"] : []), ["schedModal", "doneModal", "editMModal", "vehModal"]);
  await load();
}

init().catch(function (e) {
  if (e && /not signed in|not for this role/.test(e.message || "")) return;
  const l = document.getElementById("vbAllList");
  if (l) l.innerHTML = '<div class="vb-empty">' + esc(errorText(e)) + "</div>";
});
