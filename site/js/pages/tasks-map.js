/* Tasks on Map (port of the old portal's tasks-map.html; MODULES §5, BLUEPRINT 3.3.7, P3).

   The old page's inline script, moved here; its 36 inline handlers — including the ones built inside
   popup and card HTML strings — are listeners now (data-act attributes and nodes made with
   createElement), and every word drawn from a task goes through esc(). Leaflet 1.9.4 comes from
   jsDelivr (pinned, with its integrity hash); the pins are drawn with CSS, so no picture is fetched
   from the CDN.

   What changed under the old habits:
   - one pin per PROJECT (projects.lat / lng), not per typed address; a task without a project is on
     the list, not on the map;
   - a project without a point is placed from its address (OpenStreetMap's search, one a second, at
     most 40 a visit) and the point is offered to the database through set_project_location
     (source geocode: it only ever fills an empty point; an untouched import from the old portal takes
     none). Moving a pin by hand is for managers and admins (source manual) — the database's rule;
   - the tasks are rpc my_tasks (the widest list this role has: everyone's for the office and leads,
     one's own for field and view-only people — Q3), the notes are task_notes rows, Complete is
     complete_task (with a closing note), a note is add_task_note (one line, kept as a draft on this
     phone until saved — the same draft My Tasks shows);
   - "New task here" is for anyone who may create tasks (Q8): admin, manager and lead for anyone,
     field and the accountant for themselves or nobody;
   - live: a change elsewhere (a task added, finished, given to someone else, a note) arrives through
     Realtime and the pins and sheets follow. */

import { boot, el, esc, errorText, maskFor, D, store, toast as shellToast, can } from "./shell.js";
import { companyToday } from "../common2.js";
import * as tasksRepo from "../repo/tasks.js";
import * as projectsRepo from "../repo/projects.js";
import {
  viewsFor, groupByProject, pinLabel, priKey, PRI_RANK, whenText, dirUrl, placeOf, dayText, daysBetween, agoText,
  canWork, canCreate, clientKey, cleanNote, NOTE_MAX, noteLabel, dueText, recurLabel, shootLabel,
} from "../map/tasks.js";
import { pinRule } from "../map/geo.js";
import { dormant } from "../map/legacy.js";
import { openNewTask, isOpen as formOpen } from "./task-form.js";

const GEO_MAX = 40;
const GEO_GAP_MS = 1100;
const CITY_KEY = "dcr2CityGeo";
const HOME = [35.49, -120.67];            // the company's corner of California, before any pin is known
const COLORS = { urgent: "#c62828", medium: "#d07a12", low: "#2e7d32" };
const LABELS = { urgent: "Urgent", medium: "Normal", low: "Low" };

const S = {
  me: null, mask: function (t) { return t; }, view: "mine",
  records: [], filter: "all", person: "all", multi: false,
  map: null, tiles: null, markers: {}, allMarkers: [], fitted: false,
  current: "", master: false, masterSort: "project", taskId: "",
  pinMove: null, geoRun: 0, geoDone: {}, busy: {}, can: { create: false, move: false },
};
const today = function () { return companyToday(); };
const L = function () { return window.L; };

/* ── the records ─────────────────────────────────────────────────────── */
function personKey(t) { return t.assignedTo ? String(t.assignedTo) : "-"; }
function personName(t) { return t.assignedTo ? (t.assigneeName || "Someone") : "Unassigned"; }
function personRecords() {
  if (S.person === "all") return S.records.slice();
  return S.records.filter(function (t) { return personKey(t) === S.person; });
}
function filtered() {
  const r = personRecords();
  return S.filter === "all" ? r : r.filter(function (t) { return t.priKey === S.filter; });
}
function groups(list) { return groupByProject(list || personRecords()); }
function groupOf(key, list) { return groups(list).find(function (g) { return g.key === key; }) || null; }
function findTask(id) { return S.records.find(function (t) { return String(t.id) === String(id); }) || null; }
const KEY_RANK = { urgent: 0, medium: 1, low: 2 };
/** A pin's colour: its most pressing task's. */
function topPri(tasks) {
  let best = "low";
  tasks.forEach(function (t) { if (KEY_RANK[t.priKey] < KEY_RANK[best]) best = t.priKey; });
  return best;
}
function sortByPri(a, b) { return (PRI_RANK[a.priority] - PRI_RANK[b.priority]) || (b.daysSinceUpdate || 0) - (a.daysSinceUpdate || 0); }

/* ── messages ─────────────────────────────────────────────────────────── */
let toastTimer = null;
function toast(text, color) {
  const t = el("tmToast");
  t.textContent = text;
  t.style.background = color || "#1a1a1a";
  t.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.style.display = "none"; }, 2600);
}

/* ── the bar: counts, the person picker, the filter chips ─────────────── */
function updateCounts() {
  const base = personRecords();
  const n = function (id, v) { const x = el(id); if (x) x.textContent = v > 0 ? String(v) : ""; };
  n("tmNall", base.length);
  n("tmNurgent", base.filter(function (t) { return t.priKey === "urgent"; }).length);
  n("tmNmedium", base.filter(function (t) { return t.priKey === "medium"; }).length);
  n("tmNlow", base.filter(function (t) { return t.priKey === "low"; }).length);
  el("tmCount").textContent = String(filtered().length);
}

function buildPersonSel() {
  const sel = el("tmPerson");
  const counts = {}, names = {};
  S.records.forEach(function (t) { const k = personKey(t); counts[k] = (counts[k] || 0) + 1; names[k] = personName(t); });
  const keys = Object.keys(counts).sort(function (a, b) {
    return (Number(b === String(S.me.id)) - Number(a === String(S.me.id))) || (Number(a === "-") - Number(b === "-")) || names[a].localeCompare(names[b]);
  });
  // one's own list (field and view-only people) has no one else to pick
  S.multi = keys.length > 1 && S.view !== "mine";
  if (!S.multi) { sel.hidden = true; S.person = "all"; return; }
  sel.innerHTML = '<option value="all">👥 Everyone (' + S.records.length + ")</option>" + keys.map(function (k) {
    return '<option value="' + esc(k) + '">' + esc(names[k] + (k === String(S.me.id) ? " (you)" : "") + " (" + counts[k] + ")") + "</option>";
  }).join("");
  if (S.person !== "all" && !counts[S.person]) S.person = "all";
  sel.value = S.person;
  sel.hidden = false;
}

function setFilter(f) {
  S.filter = f;
  document.querySelectorAll("#tmChips [data-f]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-f") === f)); });
  updatePins();
  updateCounts();
  if (S.master) openMaster();
  else if (S.current) openPin(S.current);
  if (!S.map) return;
  if (f === "all") { flyAll(); return; }
  const keys = new Set(groups(filtered()).map(function (g) { return g.key; }));
  const mks = Object.keys(S.markers).filter(function (k) { return keys.has(k); }).map(function (k) { return S.markers[k]; });
  if (!mks.length) toast("No " + LABELS[f] + " tasks", COLORS[f]);
  else if (mks.length === 1) S.map.flyTo(mks[0].getLatLng(), 15, { animate: true, duration: 1 });
  else S.map.flyToBounds(L().featureGroup(mks).getBounds().pad(0.3), { animate: true, duration: 1.2, maxZoom: 14 });
}

function setPerson(p) {
  S.person = p || "all";
  updateCounts();
  refreshSide();
  drawPins();
  if (S.master) openMaster();
  else if (S.current) { if (groupOf(S.current, filtered())) openPin(S.current); else closeD1(); }
  const keys = new Set(groups().map(function (g) { return g.key; }));
  const mks = Object.keys(S.markers).filter(function (k) { return keys.has(k); }).map(function (k) { return S.markers[k]; });
  if (S.map && mks.length > 1) S.map.flyToBounds(L().featureGroup(mks).getBounds().pad(0.3), { animate: true, duration: 1, maxZoom: 13 });
  else if (S.map && mks.length === 1) S.map.flyTo(mks[0].getLatLng(), 14, { animate: true, duration: 1 });
}

/* ── the map and its pins ─────────────────────────────────────────────── */
function noMap(text) {
  const n = el("tmNoMap");
  n.hidden = false;
  n.innerHTML = '<div><b>' + esc(text) + '</b><div style="margin-top:8px">Your tasks are on <a href="my-tasks.html">My Tasks</a>; ' +
    'the list here (All Tasks, Projects) still works.</div></div>';
}

function initMap() {
  if (S.map) return true;
  if (!L()) { noMap("The map could not load (no connection to the map library)."); return false; }
  const map = L().map("tmMap", { zoomControl: false });
  L().control.zoom({ position: "bottomright" }).addTo(map);
  S.tiles = L().tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    subdomains: "abc", maxZoom: 19, attribution: "© OpenStreetMap contributors",
  }).addTo(map);
  map.setView(HOME, 9);
  S.map = map;
  setTimeout(function () { map.invalidateSize(); }, 200);
  window.addEventListener("resize", function () { map.invalidateSize(); });
  return true;
}

function pinIcon(g, dim) {
  const k = topPri(g.tasks);
  return L().divIcon({
    className: "", iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -30],
    html: '<div class="tm-pin ' + k + (dim ? " dim" : "") + '" data-pin="' + esc(g.key) + '"><b>' + g.tasks.length + "</b></div>",
  });
}

/** The popup of a pin, as nodes with listeners (the old one was an HTML string with onclick). */
function popupFor(g) {
  const box = document.createElement("div");
  box.className = "tm-pop";
  const title = document.createElement("strong");
  title.textContent = pinLabel(g);
  box.appendChild(title);
  const sub = [g.number, g.name].filter(Boolean).join(" — ") + (g.city ? " · " + g.city : "");
  if (sub) { const c = document.createElement("span"); c.className = "c"; c.textContent = sub; box.appendChild(c); }
  const n = document.createElement("span");
  n.className = "n";
  n.textContent = g.tasks.length + " open task" + (g.tasks.length === 1 ? "" : "s");
  box.appendChild(n);
  const row = document.createElement("div");
  row.className = "r";
  const view = document.createElement("button");
  view.type = "button";
  view.textContent = "View Tasks";
  view.addEventListener("click", function () { chipClick(g.key); });
  const dir = document.createElement("button");
  dir.type = "button";
  dir.className = "dir";
  dir.textContent = "Directions";
  dir.addEventListener("click", function () {
    const u = dirUrl(placeOf(g.tasks[0] || g), { lat: g.lat, lng: g.lng });
    if (u) window.open(u, "_blank", "noopener");
  });
  row.appendChild(view);
  row.appendChild(dir);
  box.appendChild(row);
  return box;
}

function drawPins() {
  if (!S.map) return;
  const keep = new Set();
  const visible = new Set(groups(filtered()).map(function (g) { return g.key; }));
  groups().forEach(function (g) {
    if (g.lat === null || g.lng === null || g.lat === undefined || g.lng === undefined) return;
    keep.add(g.key);
    let mk = S.markers[g.key];
    if (S.pinMove && S.pinMove.key === g.key) return;           // being moved: leave it alone
    if (!mk) {
      mk = L().marker([g.lat, g.lng], { icon: pinIcon(g, !visible.has(g.key)), draggable: false, keyboard: true, title: pinLabel(g) }).addTo(S.map);
      S.markers[g.key] = mk;
    } else {
      mk.setLatLng([g.lat, g.lng]);
      mk.setIcon(pinIcon(g, !visible.has(g.key)));
    }
    mk.unbindPopup();
    mk.bindPopup(popupFor(g));
  });
  Object.keys(S.markers).forEach(function (k) {
    if (!keep.has(k) && !(S.pinMove && S.pinMove.key === k)) { S.map.removeLayer(S.markers[k]); delete S.markers[k]; }
  });
  S.allMarkers = Object.keys(S.markers).map(function (k) { return S.markers[k]; });
}

function updatePins() {
  if (!S.map) return;
  const visible = new Set(groups(filtered()).map(function (g) { return g.key; }));
  groups().forEach(function (g) { const mk = S.markers[g.key]; if (mk) mk.setIcon(pinIcon(g, !visible.has(g.key))); });
}

function flyAll() {
  if (!S.map) return;
  if (S.allMarkers.length > 1) S.map.flyToBounds(L().featureGroup(S.allMarkers).getBounds().pad(0.3), { animate: true, duration: 1.2, maxZoom: 13 });
  else if (S.allMarkers.length === 1) S.map.flyTo(S.allMarkers[0].getLatLng(), 14, { animate: true, duration: 1 });
}

function fitOnce() {
  if (S.fitted || !S.map || !S.allMarkers.length) return;
  S.fitted = true;
  if (S.allMarkers.length === 1) S.map.setView(S.allMarkers[0].getLatLng(), 14);
  else S.map.fitBounds(L().featureGroup(S.allMarkers).getBounds().pad(0.25));
}

/* ── placing projects that have no point yet (OpenStreetMap search) ───── */
function nominatim(q) {
  const url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(q);
  return fetch(url, { headers: { Accept: "application/json" } }).then(function (r) { return r.json(); }).then(function (d) {
    if (d && d.length) {
      const lat = parseFloat(d[0].lat), lng = parseFloat(d[0].lon);
      if (isFinite(lat) && isFinite(lng)) return { lat: lat, lng: lng };
    }
    return null;
  }).catch(function () { return null; });
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function geocodePass() {
  const run = ++S.geoRun;
  const todo = groups(S.records).filter(function (g) {
    return g.projectId !== null && (g.lat === null || g.lng === null) && (g.address || g.city) && !S.geoDone[g.key];
  });
  if (!todo.length) return;
  let cache = {};
  try { cache = JSON.parse(store.get(CITY_KEY, "{}")) || {}; } catch (e) { cache = {}; }
  const status = el("tmGeo");
  let asked = 0;
  for (let i = 0; i < todo.length && asked < GEO_MAX; i++) {
    if (run !== S.geoRun) return;
    const g = todo[i];
    S.geoDone[g.key] = true;
    status.style.display = "block";
    status.textContent = "Locating " + (i + 1) + "/" + todo.length + "…";
    let loc = await nominatim([g.address, g.city, "CA"].filter(Boolean).join(", "));
    asked++;
    let fromCity = false;
    if (!loc && g.city) {
      const ck = String(g.city).trim().toLowerCase();
      if (cache[ck]) loc = { lat: cache[ck][0], lng: cache[ck][1] };
      else if (asked < GEO_MAX) {
        await sleep(GEO_GAP_MS);
        loc = await nominatim(g.city + ", CA");
        asked++;
        if (loc) cache[ck] = [loc.lat, loc.lng];
      }
      fromCity = !!loc;
    }
    if (loc) {
      S.records.forEach(function (t) { if (String(t.projectId) === g.key) { t.lat = loc.lat; t.lng = loc.lng; t.locationSource = "geocode"; } });
      drawPins();
      // only a street address is worth keeping; a city's middle is not where the job is
      const quiet = dormant({ legacy_sp_id: g.legacy, version: g.projectVersion });
      if (!fromCity && S.me.role !== "viewer" && pinRule(null, { lat: loc.lat, lng: loc.lng, src: "geocode" }, S.me.role, quiet) === "store") {
        projectsRepo.setLocation(g.projectId, loc.lat, loc.lng, null, "geocode").then(function () { return null; }, function () { return null; });
      }
    }
    await sleep(GEO_GAP_MS);
  }
  store.set(CITY_KEY, JSON.stringify(cache));
  status.style.display = "none";
  fitOnce();
}

/* ── moving a pin (managers and admins: source manual) ────────────────── */
function positionPinCtl() {
  const pm = S.pinMove;
  if (!pm || !S.map) return;
  const box = el("tmPinCtl");
  const pt = S.map.latLngToContainerPoint(pm.marker.getLatLng());
  const wrap = el("tmWrap");
  const w = wrap.clientWidth, h = wrap.clientHeight;
  const x = Math.min(Math.max(pt.x, 110), w - 110);
  let y = pt.y - 50;
  y = Math.max(y, 86);
  y = Math.min(y, h - 16);
  box.style.left = x + "px";
  box.style.top = y + "px";
}
function stopPinMove(back) {
  const pm = S.pinMove;
  if (!pm) return;
  if (back) pm.marker.setLatLng(pm.from);
  pm.marker.dragging.disable();
  pm.marker.off("drag", positionPinCtl);
  S.map.off("move zoom", positionPinCtl);
  el("tmPinCtl").style.display = "none";
  S.map.getContainer().style.cursor = "";
  S.pinMove = null;
  drawPins();
}
function startPinMove(key) {
  const mk = S.markers[key];
  if (!mk || !S.can.move) return;
  closeD2(true);
  closeD1();
  if (S.pinMove) stopPinMove(true);
  S.pinMove = { key: key, marker: mk, from: mk.getLatLng() };
  mk.closePopup();
  mk.dragging.enable();
  mk.on("drag", positionPinCtl);
  S.map.on("move zoom", positionPinCtl);
  S.map.panTo(mk.getLatLng(), { animate: true, duration: 0.5 });
  el("tmPinCtl").style.display = "flex";
  positionPinCtl();
  setTimeout(positionPinCtl, 600);
  S.map.getContainer().style.cursor = "crosshair";
}
async function savePinMove() {
  const pm = S.pinMove;
  if (!pm) return;
  const ll = pm.marker.getLatLng();
  const g = groupOf(pm.key, S.records);
  const save = el("tmPinSave");
  save.disabled = true;
  try {
    const r = await projectsRepo.setLocation(g ? g.projectId : Number(pm.key), ll.lat, ll.lng, null, "manual");
    if (r && r.stored === false) throw Object.assign(new Error("The pin was not moved."), { own: true });
    S.records.forEach(function (t) { if (String(t.projectId) === pm.key) { t.lat = ll.lat; t.lng = ll.lng; t.locationSource = "manual"; } });
    stopPinMove(false);
    toast("📍 Pin location saved");
  } catch (e) {
    stopPinMove(true);
    toast(errorText(e), "#b3402f");
  } finally {
    save.disabled = false;
  }
}

/* ── the projects panel ───────────────────────────────────────────────── */
function toggleSide(on) {
  const open = on === undefined ? !el("tmSide").classList.contains("open") : !!on;
  el("tmSide").classList.toggle("open", open);
  el("tmSideOver").classList.toggle("open", open);
  if (!open) navActive("");
}
function navActive(which) {
  el("tmNavTasks").setAttribute("aria-pressed", String(which === "tasks"));
  el("tmNavProjects").setAttribute("aria-pressed", String(which === "projects"));
}
function refreshSide() {
  const gs = groups();
  const box = el("tmAddrList");
  if (!gs.length) { box.innerHTML = '<p class="none">' + esc(S.records.length ? "No tasks for this person." : "No open tasks right now.") + "</p>"; return; }
  box.innerHTML = gs.map(function (g) {
    const sub = g.projectId === null ? "" : [g.number, g.name].filter(Boolean).join(" — ");
    return '<button type="button" class="tm-addr' + (g.key === S.current ? " on" : "") + '" data-act="pin" data-key="' + esc(g.key) + '">' +
      '<span class="t">' + esc(pinLabel(g)) + (sub ? "<small>" + esc(sub) + "</small>" : "") + '</span><span class="k">' + g.tasks.length + "</span></button>";
  }).join("") + '<button type="button" class="tm-addr all" data-act="all">View All Tasks</button>';
}

function chipClick(key) {
  toggleSide(false);
  const mk = S.markers[key];
  if (mk && S.map) {
    const ll = mk.getLatLng();
    if (S.map.getBounds().contains(ll)) S.map.panTo(ll, { animate: true, duration: 0.6 });
    else S.map.flyTo(ll, 14, { animate: true, duration: 1.2 });
  }
  openPin(key);
}

/* ── sheet 1: a pin's tasks, or all of them ───────────────────────────── */
function miniCard(t, showPerson) {
  const work = canWork(S.me, t);
  const sub = (t.needsUpdate ? "Needs an update · " : "") + whenText(t) +
    (showPerson ? " · 👤 " + personName(t) : "") + (t.dueDate ? " · " + dueText(t, today()) : "");
  return '<div class="tm-mini' + (t.needsUpdate ? " needs" : "") + '" data-task="' + esc(t.id) + '">' +
    '<span class="tk-dot ' + esc(t.priKey) + '" title="' + esc(t.priorityLabel) + '"></span>' +
    '<div class="i"><div class="t">' + esc(t.title) + "</div>" +
      '<div class="s' + (t.needsUpdate ? " warn" : "") + '">' + esc(sub) + "</div></div>" +
    '<div class="b"><button type="button" data-act="details" data-id="' + esc(t.id) + '">Details</button>' +
      (work ? '<button type="button" class="ok" data-act="done" data-id="' + esc(t.id) + '" aria-label="Mark complete: ' + esc(t.title) + '">✓</button>' : "") +
    "</div></div>";
}

function renderMaster() {
  const tasks = filtered();
  const scroll = el("tmScroll");
  if (!tasks.length) { scroll.innerHTML = '<div class="tm-empty">No open tasks</div>'; return; }
  if (S.masterSort === "project") {
    scroll.innerHTML = groupByProject(tasks).map(function (g) {
      const sorted = g.tasks.slice().sort(sortByPri);
      const sub = g.projectId === null ? "" : [g.number, g.name].filter(Boolean).join(" — ");
      return '<div class="tm-sec"><span>' + esc(pinLabel(g)) + "</span>" + (sub ? "<small>" + esc(sub) + "</small>" : "") + "<i></i></div>" +
        sorted.map(function (t) { return miniCard(t, S.multi); }).join("");
    }).join("");
  } else {
    scroll.innerHTML = ["urgent", "medium", "low"].map(function (p) {
      const list = tasks.filter(function (t) { return t.priKey === p; }).sort(sortByPri);
      if (!list.length) return "";
      return '<div class="tm-sec"><span style="color:' + COLORS[p] + '">● ' + LABELS[p] + "</span><i></i></div>" +
        list.map(function (t) { return miniCard(t, S.multi); }).join("");
    }).join("");
  }
}

function showOver(id) { el(id).classList.add("open"); }
function openMaster() {
  S.master = true;
  S.current = "";
  const base = filtered();
  const locs = groupByProject(base).length;
  el("tmD1Title").textContent = S.person === "all" ? "All Tasks" : (base[0] ? personName(base[0]) : "Tasks");
  el("tmD1Sub").textContent = base.length + " open across " + locs + " place" + (locs === 1 ? "" : "s");
  el("tmSort").hidden = false;
  el("tmD1Btns").hidden = true;
  renderMaster();
  showOver("tmOver1");
}

function openPin(key) {
  S.master = false;
  S.current = key;
  el("tmSort").hidden = true;
  el("tmD1Btns").hidden = false;
  const g = groupOf(key, filtered()) || groupOf(key, S.records);
  el("tmD1Title").textContent = g ? pinLabel(g) : "";
  el("tmD1Sub").textContent = g && g.projectId !== null ? [g.number, g.name].filter(Boolean).join(" — ") + (g.city ? " · " + g.city : "") : "";
  const dir = g ? dirUrl(placeOf(g), { lat: g.lat, lng: g.lng }) : "";
  el("tmD1Dir").hidden = !dir;
  if (dir) el("tmD1Dir").href = dir;
  el("tmD1Move").hidden = !(S.can.move && S.markers[key]);
  el("tmD1New").hidden = !(S.can.create && g && g.projectId !== null);
  const tasks = g ? g.tasks.filter(function (t) { return S.filter === "all" || t.priKey === S.filter; }).sort(sortByPri) : [];
  el("tmScroll").innerHTML = tasks.length ? tasks.map(function (t) { return miniCard(t, S.multi); }).join("") : '<div class="tm-empty">No open tasks</div>';
  refreshSide();
  showOver("tmOver1");
}

function closeD1() {
  el("tmOver1").classList.remove("open");
  S.current = "";
  S.master = false;
  el("tmSort").hidden = true;
  el("tmD1Btns").hidden = false;
  navActive("");
  refreshSide();
}

/* ── sheet 2: one task ────────────────────────────────────────────────── */
const DRAFT = "dcr2:taskDraft:";
function draftKey(id) { return DRAFT + S.me.id + ":" + id; }
function readDraft(id) {
  try { const d = JSON.parse(store.get(draftKey(id), "") || "null"); return d && Date.now() - Number(d.at || 0) < 30 * 86400000 ? d : null; }
  catch (e) { return null; }
}
function setDraft(id, t, key, keyFor) {
  const was = readDraft(id) || {};
  const d = { t: t || "", at: Date.now() };
  const k = key !== undefined ? key : was.key;
  if (k) { d.key = k; d.keyFor = keyFor !== undefined ? keyFor : was.keyFor; }
  store.set(draftKey(id), String(d.t).trim() || d.key ? JSON.stringify(d) : null);
}

function notesHtml(t) {
  const notes = (t.notes || []).slice().reverse();
  if (!notes.length) return '<p class="tm-nonote">No notes yet.</p>';
  return notes.map(function (n) {
    const who = [n.who, n.viaLabel && n.viaLabel !== "old portal" ? n.viaLabel : ""].filter(Boolean).join(" · ");
    return '<div class="tm-note"><div class="d">' + esc(noteLabel(n, today()) + (who ? " · " + who : "")) + '</div><div class="x">' + esc(n.text || "—") + "</div></div>";
  }).join("");
}

function openD2(id) {
  const t = findTask(id);
  if (!t) return;
  S.taskId = String(t.id);
  const g = groupOf(t.projectId === null ? "none" : String(t.projectId), S.records);
  el("tmD2Addr").textContent = g ? pinLabel(g) : "";
  el("tmD2Sub").textContent = [t.projectNumber, t.projectName].filter(Boolean).join(" — ");
  el("tmD2Move").hidden = !(S.can.move && g && S.markers[g.key]);
  const dir = dirUrl(placeOf(t), t);
  el("tmD2Dir").hidden = !dir;
  if (dir) el("tmD2Dir").href = dir;
  const work = canWork(S.me, t);
  el("tmD2Done").hidden = !work;
  const cat = [t.category, t.subCategory].filter(Boolean).join(" / ");
  const reqAgo = t.requested ? daysBetween(t.requested, today()) : null;
  const sh = shootLabel(t, today());
  el("tmD2Body").innerHTML =
    '<span class="tm-badge ' + esc(t.priKey) + '">● ' + esc(t.priorityLabel) + " priority</span>" +
    (t.photo ? '<span class="tm-badge" style="background:var(--tint);color:var(--acc-text)">📷 ' + esc(sh ? sh.label : "Photo & Video") + "</span>" : "") +
    (t.recurring ? '<span class="tm-badge" style="background:var(--tint);color:var(--acc-text)">' + esc(recurLabel(t)) + "</span>" : "") +
    '<h2 class="tm-name" id="tmD2Name">' + esc(t.title) + "</h2>" +
    (t.description ? '<p class="tm-desc">' + esc(t.description) + "</p>" : "") +
    '<hr class="tm-div">' +
    (cat ? '<div class="tm-meta"><span class="ic">🏷</span>' + esc(cat) + "</div>" : "") +
    '<div class="tm-meta"><span class="ic">🕐</span>' + esc((t.requested ? dayText(t.requested, today()) : "") + (reqAgo !== null ? " · " + agoText(reqAgo) : "") +
      " · " + whenText(t)) + "</div>" +
    '<div class="tm-meta"><span class="ic">👤</span>' + esc("Assigned to: " + personName(t) + (t.mine ? " (you)" : "")) + "</div>" +
    (t.dueDate ? '<div class="tm-meta"><span class="ic">📅</span>' + esc(dueText(t, today())) + "</div>" : "") +
    '<hr class="tm-div">' +
    '<div class="tm-sh">Notes</div>' +
    '<div id="tmNotes">' + notesHtml(t) + "</div>" +
    (work
      ? '<button type="button" class="tm-addnote" id="tmAddNote" aria-expanded="false" aria-controls="tmNoteForm">+ Add Note</button>' +
        '<div class="tm-noteform" id="tmNoteForm" hidden>' +
          '<label for="tmNoteText" class="tm-sh" style="display:block;margin:12px 0 0">Your note</label>' +
          '<textarea id="tmNoteText" maxlength="' + NOTE_MAX + '" placeholder="Write your note here..."></textarea>' +
          '<button type="button" class="tm-save" id="tmNoteSave">Save Note</button>' +
          '<span class="tm-st" id="tmNoteSt" role="status" aria-live="polite"></span>' +
        "</div>"
      : '<p class="tm-nonote">' + esc(S.me.role === "viewer" ? "View only." : "Only the person it is given to (or who asked for it), a lead, a manager or an admin updates this task.") + "</p>") +
    '<a class="tm-mylink" href="my-tasks.html?task=' + encodeURIComponent(t.id) + '">Open in My Tasks ›</a>';
  if (work) {
    const ta = el("tmNoteText");
    const d = readDraft(t.id);
    if (d && d.t) { ta.value = d.t; el("tmNoteForm").hidden = false; el("tmAddNote").setAttribute("aria-expanded", "true"); noteStatus("", "Draft restored — it hasn't been sent yet."); }
    let timer = null;
    ta.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(function () { setDraft(t.id, ta.value); }, 350); });
    el("tmAddNote").addEventListener("click", function () {
      const f = el("tmNoteForm");
      f.hidden = !f.hidden;
      el("tmAddNote").setAttribute("aria-expanded", String(!f.hidden));
      if (!f.hidden) ta.focus();
    });
    el("tmNoteSave").addEventListener("click", function () { saveNote(t.id); });
  }
  showOver("tmOver2");
}

function noteStatus(kind, text) {
  const s = el("tmNoteSt");
  if (!s) return;
  s.className = "tm-st" + (kind ? " " + kind : "");
  s.textContent = text || "";
}

function closeD2(quiet) {
  el("tmOver2").classList.remove("open");
  const ta = el("tmNoteText");
  if (ta && S.taskId && ta.value.trim()) setDraft(S.taskId, ta.value);
  S.taskId = "";
  if (!quiet && S.master) renderMaster();
}

function offline(e) { return !e || (!e.status && !e.code) || /fetch|network|Failed to|offline/i.test(String(e.message || "")); }

async function saveNote(id) {
  const t = findTask(id);
  const ta = el("tmNoteText");
  if (!t || !ta) return;
  if (S.busy[id]) { noteStatus("", "Still saving — one moment."); return; }
  const text = cleanNote(ta.value);
  if (!text) { noteStatus("err", "Nothing to save."); return; }
  if (text.length > NOTE_MAX) { noteStatus("err", "Keep the note under 2,000 characters."); return; }
  const d = readDraft(id);
  const key = d && d.key && d.keyFor === text ? d.key : clientKey();
  setDraft(id, ta.value, key, text);
  S.busy[id] = true;
  el("tmNoteSave").disabled = true;
  noteStatus("", "Saving…");
  try {
    const r = await tasksRepo.addNote(t, text, key);
    setDraft(id, "", null);
    store.set(draftKey(id), null);
    if (!(r && r.already)) {
      t.notes = (t.notes || []).concat([{ id: "local", day: today(), text: S.mask(text), who: S.me.name || "", via: "portal", viaLabel: "" }]);
      t.lastNote = S.mask(text); t.lastUpdateSource = "note"; t.daysSinceUpdate = 0; t.needsUpdate = false;
    }
    if (String(S.taskId) === String(id)) {
      ta.value = "";
      el("tmNotes").innerHTML = notesHtml(t);
      el("tmNoteForm").hidden = true;
      el("tmAddNote").setAttribute("aria-expanded", "false");
    }
    toast("Saved ✓", "#1f7a4d");
    refreshSoon();
  } catch (e) {
    if (e && e.complete) {
      store.set(draftKey(id), null);
      gone(t, "done", text);
    } else {
      noteStatus("err", offline(e) ? "No signal — your note is kept on this phone. Tap Save Note again when you have signal." : errorText(e) + " Your note is kept here.");
    }
  } finally {
    delete S.busy[id];
    const b = el("tmNoteSave");
    if (b) b.disabled = false;
  }
}

/** A task finished (or given away) elsewhere: it leaves the map; any words still typed are shown. */
function gone(t, how, words) {
  const ta = String(S.taskId) === String(t.id) ? el("tmNoteText") : null;
  const unsent = ((ta && ta.value) || words || "").trim();
  S.records = S.records.filter(function (x) { return String(x.id) !== String(t.id); });
  if (String(S.taskId) === String(t.id)) { if (ta) ta.value = ""; closeD2(true); }
  afterChange();
  const title = how === "done" ? "“" + t.title + "” was marked complete elsewhere." : "“" + t.title + "” is no longer on your list.";
  if (unsent) D().alert(title + " Your note was not added. What you wrote: “" + unsent + "”", { title: how === "done" ? "This task is already complete" : "Not on your list any more" });
  else toast(how === "done" ? "Completed elsewhere: " + t.title : "No longer yours: " + t.title);
}

async function markComplete(id, btn) {
  const t = findTask(id);
  if (!t || S.busy[id]) return;
  const v = await D().modal({
    title: "Mark as complete?",
    message: "“" + t.title + "” will leave the list and the map. Add a closing note if there is anything the office should know.",
    okText: "Yes, complete",
    fields: [{ name: "note", type: "textarea", rows: 3, label: "Closing note (optional)", value: (readDraft(id) || {}).t || "", placeholder: "e.g. All framed, photos taken" }],
    validate: function (x) { return String(x.note || "").trim().length > NOTE_MAX ? "Keep the closing note under 2,000 characters." : ""; },
  });
  if (!v) return;
  const note = String(v.note || "").trim();
  S.busy[id] = true;
  if (btn) { btn.textContent = "…"; btn.disabled = true; }
  try {
    const r = await tasksRepo.complete(t, note, S.me && S.me.id);
    store.set(draftKey(id), null);
    S.records = S.records.filter(function (x) { return String(x.id) !== String(id); });
    if (String(S.taskId) === String(id)) closeD2(true);
    afterChange();
    if (r && r.already && note) {
      // completed elsewhere first: the database still kept the closing words, as an update of their own
      D().alert("“" + t.title + "” was marked complete elsewhere before you did. Your closing note was still added to its updates: “" + note + "”",
        { title: "This task was already complete" });
    } else if (r && r.already) {
      toast("Already complete: " + t.title);
    } else {
      toast("✓ Marked complete", "#1f7a4d");
    }
    refreshSoon();
  } catch (e) {
    if (btn) { btn.textContent = "✓"; btn.disabled = false; }
    if (note) setDraft(id, note);
    if (e && (e.code === "PT409" || e.status === 409)) refreshSoon(0);
    D().alert((e && (e.code === "PT409" || e.status === 409) ? "Someone changed this task while you had it open — it is shown fresh now; check it and complete it again." : offline(e)
      ? "No signal — the task is still open. Try again when you have signal." : errorText(e)) + (note ? " Your closing note is kept." : ""), { title: "Not marked complete" });
  } finally {
    delete S.busy[id];
  }
}

/** After the records changed: the bar, the panel, the pins and whichever sheet is open. */
function afterChange() {
  buildPersonSel();
  updateCounts();
  refreshSide();
  drawPins();
  if (el("tmOver1").classList.contains("open")) {
    if (S.master) openMaster();
    else if (S.current && groupOf(S.current, filtered())) openPin(S.current);
    else closeD1();
  }
  if (S.taskId && el("tmOver2").classList.contains("open")) {
    const t = findTask(S.taskId);
    if (t) { const n = el("tmNotes"); if (n) n.innerHTML = notesHtml(t); }
  }
}

/* ── loading and live updates ─────────────────────────────────────────── */
async function load() {
  const views = viewsFor(S.me).slice().reverse();          // the widest list this role has first
  let last = null;
  for (let i = 0; i < views.length; i++) {
    try {
      S.records = await tasksRepo.list(views[i], { me: S.me.id, mask: S.mask });
      S.view = views[i];
      return;
    } catch (e) {
      last = e;
      if (!(e && (e.code === "42501" || e.code === "22023" || e.status === 403))) throw e;
    }
  }
  throw last;
}

let refreshTimer = null, refreshing = false;
function refreshSoon(ms) { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, ms === undefined ? 400 : ms); }
async function refresh() {
  if (refreshing) { refreshSoon(500); return; }
  refreshing = true;
  const open = S.taskId;
  const before = open ? findTask(open) : null;
  try {
    const keep = {};
    S.records.forEach(function (t) { if (t.lat !== null && t.projectId !== null) keep[String(t.projectId)] = [t.lat, t.lng]; });
    await load();
    // a point found by the search this visit stays until the database has one
    S.records.forEach(function (t) { const k = keep[String(t.projectId)]; if (k && t.lat === null) { t.lat = k[0]; t.lng = k[1]; } });
    if (open && before && !findTask(open)) {
      const one = await tasksRepo.getOne(open, { me: S.me.id, mask: S.mask }).catch(function () { return undefined; });
      if (one !== undefined) gone(before, one && one.done ? "done" : "gone");
    }
    afterChange();
    geocodePass();
  } catch (e) { /* the map keeps what it shows; it reads again on the next change or focus */ }
  finally { refreshing = false; }
}

function onLive(evt) {
  if (!evt) return;
  if (evt.type === "SUBSCRIBED") { refreshSoon(); return; }
  if (evt.table === "tasks" && S.taskId) {
    const row = evt.new || evt.old || {};
    if (String(row.id) === String(S.taskId)) {
      const t = findTask(S.taskId);
      if (t && evt.type === "UPDATE" && evt.new && evt.new.status === "done") { gone(t, "done"); refreshSoon(); return; }
      if (t && evt.type === "DELETE") { gone(t, "gone"); refreshSoon(); return; }
    }
  }
  refreshSoon();
}

async function startLive() {
  try {
    const live = await import("../live.js");
    live.watch("tasks", null, onLive);
    live.watch("task_notes", null, onLive);
  } catch (e) { /* the map works without live updates */ }
}

/* ── wiring (every former inline handler is one of these listeners) ───── */
function wire() {
  el("tmChips").addEventListener("click", function (e) {
    const b = e.target.closest("[data-f]");
    if (b) setFilter(b.getAttribute("data-f"));
  });
  el("tmPerson").addEventListener("change", function () { setPerson(el("tmPerson").value); });
  el("tmRefresh").addEventListener("click", async function () { toast("Refreshing…"); await refresh(); el("tmToast").style.display = "none"; });
  el("tmNavTasks").addEventListener("click", function () { toggleSide(false); navActive("tasks"); openMaster(); });
  el("tmNavProjects").addEventListener("click", function () { closeD1(); toggleSide(true); navActive("projects"); });
  el("tmPull").addEventListener("click", function () { toggleSide(); });
  el("tmSideOver").addEventListener("click", function () { toggleSide(false); });
  el("tmAddrList").addEventListener("click", function (e) {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    if (b.getAttribute("data-act") === "all") { toggleSide(false); flyAll(); openMaster(); }
    else chipClick(b.getAttribute("data-key"));
  });
  el("tmSort").addEventListener("click", function (e) {
    const b = e.target.closest("[data-sort]");
    if (!b) return;
    S.masterSort = b.getAttribute("data-sort");
    el("tmSort").querySelectorAll("[data-sort]").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
    renderMaster();
  });
  el("tmScroll").addEventListener("click", function (e) {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const id = b.getAttribute("data-id");
    if (b.getAttribute("data-act") === "details") openD2(id);
    else if (b.getAttribute("data-act") === "done") markComplete(id, b);
  });
  el("tmD1Close").addEventListener("click", closeD1);
  el("tmD1Move").addEventListener("click", function () { const k = S.current; if (k) startPinMove(k); });
  el("tmD1New").addEventListener("click", function () {
    const g = groupOf(S.current, S.records);
    if (!g || g.projectId === null) return;
    openNewTask({
      me: S.me,
      project: { id: g.projectId, internalIDNumber: g.number, projectName: g.name, projectAddress: g.address, projectCity: g.city },
      onCreated: function () { return refresh(); },
    });
  });
  el("tmD2Back").addEventListener("click", function () { closeD2(); });
  el("tmD2Move").addEventListener("click", function () {
    const t = findTask(S.taskId);
    if (t) startPinMove(t.projectId === null ? "none" : String(t.projectId));
  });
  el("tmD2Done").addEventListener("click", function () { if (S.taskId) markComplete(S.taskId, el("tmD2Done")); });
  el("tmPinSave").addEventListener("click", savePinMove);
  el("tmPinCancel").addEventListener("click", function () { stopPinMove(true); });
  ["tmOver1", "tmOver2"].forEach(function (id) {
    const over = el(id);
    over.addEventListener("click", function (e) { if (e.target === over) { if (id === "tmOver1") closeD1(); else closeD2(); } });
    let startY = 0;
    over.addEventListener("touchstart", function (e) { startY = e.touches[0].clientY; }, { passive: true });
    over.addEventListener("touchend", function (e) {
      if (e.changedTouches[0].clientY - startY > 80 && !(e.target.closest && e.target.closest("textarea, .tm-scroll, .tm-d2body"))) {
        if (id === "tmOver1") closeD1(); else closeD2();
      }
    }, { passive: true });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" || e.defaultPrevented || document.querySelector(".dcr-mo.open") || formOpen()) return;
    if (S.pinMove) { stopPinMove(true); return; }
    if (el("tmOver2").classList.contains("open")) { closeD2(); return; }
    if (el("tmOver1").classList.contains("open")) { closeD1(); return; }
    if (el("tmSide").classList.contains("open")) toggleSide(false);
  });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") refreshSoon(0); });
}

async function init() {
  S.me = await boot("tasks");
  S.mask = maskFor(S.me);
  S.can.create = canCreate(S.me);
  S.can.move = can(S.me, "projects");                   // set_project_location 'manual': managers and admins
  wire();
  initMap();
  try {
    await load();
  } catch (e) {
    el("tmAddrList").innerHTML = '<p class="none" style="color:#e57373">' + esc(offline(e) ? "No signal — the tasks load when you're back online." : errorText(e)) + "</p>";
    el("tmCount").textContent = "–";
    return;
  }
  afterChange();
  fitOnce();
  if (!S.records.length) toast("No open tasks right now");
  else if (!S.records.some(function (t) { return t.projectId !== null; })) toast("Your tasks have no job on the map — see All Tasks");
  startLive();
  geocodePass();
}

init().catch(function (e) {
  if (e && /not signed in|not for this role/.test(e.message || "")) return;
  shellToast(errorText(e), "error");
});
