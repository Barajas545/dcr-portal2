/* The 📐 plan buttons of Search and the project page (owner decisions 2026-10-26; js/map/plans.js).

   A page draws an empty, hidden slot where a project's button may go:
     <span data-plans="<project id>" data-plans-style="icon | button" data-plans-title="<the project>" hidden></span>
   paintPlans() then asks the broker once for every slot on the page (js/repo/onedrive.js plansFor, op plans_for) and
   fills the slots of the projects whose takeoff folder holds at least one .takeoff file: a link to takeoff-web at the
   project's number, in a new tab (a navigation: nothing new in the security policy). Everyone who can see the project
   sees it (decision 2). When no answer comes (the takeoff folder not set up, the function not deployed, the broker
   busy, offline) nothing is said and the slots stay hidden: the page works as before.

   The Plans Library (owner 2026-10-26): for a person who sees prices (map/plans.js planFilesFor), 📐 opens a menu of
   the project's plan files instead (op plans_list): each one opens in the takeoff app (online, over byte ranges), or is
   saved on this device to open with no signal - and kept up to date by itself (js/plan-library.js). Offline, the menu
   lists what is saved for the project. The page's own link (the Plans Archive on this computer) stays at its foot. */

import * as onedrive from "../repo/onedrive.js";
import { planButtonHtml, planFilesFor, plansLink } from "../map/plans.js";
import { folderLabel, sortFiles, fmtSize, statusText } from "../map/plan-library.js";
import { handoffProblem, iosHomeScreen, IOS_HOME } from "../plan-handoff.js";

const wired = new WeakSet();
let lib = null;
/** js/plan-library.js, loaded the first time a price person needs it (a crew phone never loads it); a failed load is
    tried again next time, never kept. */
function library() {
  if (!lib) lib = import("../plan-library.js").catch(function (e) { lib = null; throw e; });
  return lib;
}

/** The user ids that have plans saved on this device (js/plan-library.js keeps this list: ids only). */
function ownersHere() {
  try {
    const v = JSON.parse(localStorage.getItem("dcr2-plan-owners") || "[]");
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}

/** On a page that opens often (Search, a project, the home page): for a person who sees prices, ask OneDrive for new
    versions of the plans saved on this device now and then, and (opts.download !== false) download what needs it -
    quietly. For a person whose Sees prices was taken away, read online just now, the plans they saved here go (plan files
    carry prices). Never throws. */
export function keepPlansFresh(me, opts) {
  if (!onedrive.LIVE || !me) return;
  const fresh = !!(typeof window !== "undefined" && window.DCR2 && window.DCR2.offline === false);
  if (!planFilesFor(me) && !(fresh && ownersHere().indexOf(me.id) !== -1)) return;
  const o = Object.assign({}, opts || {}, { fresh });
  library().then(function (L) { return L.maybeCheck(me, o); }).catch(function () { /* the next page asks again */ });
}

/** Fill the plan slots under `root` for `me`; `still()` false (the page moved on: a newer search) draws nothing.
    -> how many buttons were drawn. Never throws. */
export async function paintPlans(root, me, still) {
  if (!root || typeof root.querySelectorAll !== "function" || !onedrive.plansShownFor(me)) return 0;
  const slots = Array.prototype.slice.call(root.querySelectorAll("[data-plans]"));
  const ids = slots.map(function (s) { return s.getAttribute("data-plans"); }).filter(Boolean);
  if (!ids.length) return 0;
  let got = {};
  try { got = await onedrive.plansFor(ids); } catch (e) { return 0; }
  if (typeof still === "function" && !still()) return 0;
  const menu = planFilesFor(me);
  let drawn = 0;
  slots.forEach(function (s) {
    const html = planButtonHtml(got[s.getAttribute("data-plans")], s.getAttribute("data-plans-style"), menu);
    s.innerHTML = html;
    s.hidden = !html;
    if (html) drawn++;
  });
  if (menu && drawn && typeof root.addEventListener === "function" && !wired.has(root)) {
    wired.add(root);
    root.addEventListener("click", function (ev) {
      const a = ev.target && ev.target.closest ? ev.target.closest("[data-plan-menu]") : null;
      if (!a || ev.button !== 0 || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
      ev.preventDefault();
      const slot = a.closest("[data-plans]");
      openMenu({ projectId: slot.getAttribute("data-plans"), number: a.getAttribute("data-plan-menu"),
        title: slot.getAttribute("data-plans-title") || "", me, from: a, root });
    });
  }
  return drawn;
}

/* ── the menu ──────────────────────────────────────────────────────────── */

function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function day(iso) {
  const t = Date.parse(iso || "");
  return isFinite(t) ? new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
}

let current = null;

/** The menu's rows: the files OneDrive has (online) or the ones saved here (offline), each with what can be done. */
export function menuRows(files, saved) {
  const rows = sortFiles(files).map(function (f) {
    const s = saved[f.id] || null;
    return { id: f.id, name: f.name, where: folderLabel(f.folder), size: f.size, modified: f.modified, file: f, saved: s,
      status: s ? s.status : "" };
  });
  Object.keys(saved).forEach(function (id) {
    if (!rows.some((r) => r.id === id)) {
      const s = saved[id];
      rows.push({ id, name: s.name, where: folderLabel(s.folder), size: s.size, modified: s.modified, file: null, saved: s, status: s.status });
    }
  });
  return rows;
}

/** A row's state line: "Downloading 45%", or what its status says. */
function stateText(s, done, size) {
  if (!s) return "";
  if (s.status === "downloading" && size) return "Downloading " + Math.min(100, Math.floor((done / size) * 100)) + "%";
  return statusText(s.status, !!s.file) + (s.dl && s.dl.error && s.status !== "downloading" ? " — " + s.dl.error : "");
}

function rowHtml(r, noSave) {
  const s = r.saved;
  const meta = [r.where, r.size != null ? fmtSize(r.size) : "", day(r.modified)].filter(Boolean).join(" · ");
  const state = s ? stateText(s, s.job ? s.job.done : 0, s.job ? s.job.size : 0) : "";
  const openable = (s && s.file) || r.file;
  const btns = [];
  if (openable) btns.push('<button type="button" class="btn btn-sm" data-pl-act="open" data-id="' + esc(r.id) + '">Open</button>');
  if (noSave) { /* an iPhone or iPad home-screen app: no saving here (IOS_HOME) */ }
  else if (!s && r.file) btns.push('<button type="button" class="btn btn-ghost btn-sm" data-pl-act="save" data-id="' + esc(r.id) + '">Save to this device</button>');
  else if (s && s.status === "downloading") btns.push('<button type="button" class="btn btn-ghost btn-sm" data-pl-act="pause" data-id="' + esc(r.id) + '">Pause</button>');
  else if (s && (s.status === "paused" || s.status === "stopped" || s.status === "missing" || s.status === "outdated") && r.file) {
    btns.push('<button type="button" class="btn btn-ghost btn-sm" data-pl-act="save" data-id="' + esc(r.id) + '">' +
      (s.status === "stopped" ? "Try again" : s.status === "outdated" ? "Update now" : "Resume") + "</button>");
  }
  return '<div class="pl-row" data-id="' + esc(r.id) + '">' +
    '<div class="pl-name">' + esc(r.name) + "</div>" +
    (meta ? '<div class="pl-meta">' + esc(meta) + "</div>" : "") +
    '<div class="pl-state' + (s && s.status === "saved" ? " ok" : "") + '"' + (state ? "" : " hidden") + ">" + esc(state) + "</div>" +
    '<div class="pl-btns">' + btns.join("") + "</div></div>";
}

function focusables(c) {
  return Array.prototype.slice.call(c.host.querySelectorAll(".pl-card button, .pl-card a[href]")).filter((n) => !n.disabled);
}

function closeMenu() {
  if (!current) return;
  const c = current;
  current = null;
  if (c.off) c.off();
  clearTimeout(c.repaint);
  document.removeEventListener("keydown", c.onKey, true);
  c.host.remove();
  // back to the 📐 that opened it - or, when the page redrew it meanwhile, to this project's new one
  let to = c.from && c.from.isConnected ? c.from : null;
  if (!to && c.o.root && c.o.root.querySelector) {
    to = c.o.root.querySelector('[data-plans="' + String(c.o.projectId).replace(/["\\]/g, "") + '"] [data-plan-menu]');
  }
  try { if (to && to.focus) to.focus(); } catch (e) { /* */ }
}

function say(text, kind) {
  if (!current) return;
  const n = current.host.querySelector(".pl-say");
  n.textContent = text || "";
  n.className = "pl-say" + (kind ? " " + kind : "");
}

async function openMenu(o) {
  closeMenu();
  const host = document.createElement("div");
  host.className = "pl-sheet";
  host.innerHTML = '<div class="pl-card" role="dialog" aria-modal="true" aria-labelledby="plMenuT">' +
    '<div class="pl-hd"><span id="plMenuT">📐 Plans for ' + esc(o.number) + "</span>" +
    '<button type="button" class="pl-x" aria-label="Close">✕</button></div>' +
    (o.title ? '<div class="pl-proj">' + esc(o.title) + "</div>" : "") +
    '<div class="pl-lead">Open a plan in the takeoff app, or save it on this device to open with no signal. ' +
    "Saved plans update by themselves while the portal is open.</div>" +
    '<div class="pl-list"><div class="pl-empty">Loading the plan files…</div></div>' +
    '<div class="pl-say" role="status" aria-live="polite"></div>' +
    '<div class="pl-ft"><a href="plans-library.html">Plans Library</a>' +
    '<a href="' + esc(plansLink(o.number)) + '" target="_blank" rel="noopener">Plans Archive (Edge or Chrome on a computer) ↗</a></div></div>';
  document.body.appendChild(host);
  const c = current = { host, from: o.from, o, files: null, off: null, onKey: null, repaint: null, keys: {} };
  c.onKey = function (e) {
    if (current !== c) return;
    if (e.key === "Escape") { e.preventDefault(); closeMenu(); return; }
    if (e.key === "Tab") {
      // the sheet is modal: Tab goes round inside it
      const f = focusables(c);
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
    }
  };
  document.addEventListener("keydown", c.onKey, true);
  // the backdrop closes the sheet only when the press began on it too (not a drag out of the card), and not in the first
  // half second (the second click of a double click on 📐)
  let downOnBackdrop = false;
  const openedAt = Date.now();
  host.addEventListener("pointerdown", function (e) { downOnBackdrop = e.target === host && Date.now() - openedAt > 500; });
  host.addEventListener("click", function (e) {
    if (e.target === host) { if (downOnBackdrop) closeMenu(); return; }
    if (e.target.closest && e.target.closest(".pl-x")) { closeMenu(); return; }
    const b = e.target.closest ? e.target.closest("[data-pl-act]") : null;
    if (b && !b.disabled) act(c, b.getAttribute("data-pl-act"), b.getAttribute("data-id"));
  });
  setTimeout(function () { const x = host.querySelector(".pl-x"); if (x) x.focus(); }, 20);

  try {
    c.L = await library();
  } catch (e) {
    if (current === c) c.host.querySelector(".pl-list").innerHTML = '<div class="pl-empty">The plan files could not be opened on this page just now. Reload the page and try again.</div>';
    return;
  }
  if (current !== c) return;
  c.off = c.L.onChange(function (m) {
    if (current !== c || !m || !c.keys[m.key]) return;          // another project's plan: nothing to redraw here
    if (m.t === "progress") { paintProgress(c, m); return; }
    clearTimeout(c.repaint);
    c.repaint = setTimeout(function () { if (current === c) paint(c); }, 150);
  });
  try {
    const got = await onedrive.plansList([o.projectId]);
    if (current !== c) return;
    c.files = got[String(o.projectId)] ? got[String(o.projectId)].files : [];
  } catch (e) {
    if (current !== c) return;
    c.files = null;
    c.error = e && e.code === "offline" ? "You're offline — only the plans saved on this device can open."
      : (e && e.message) || "The plan files could not be listed just now.";
  }
  paint(c);
}

/** Only the state line of the row that is downloading changes: its buttons stay where the pointer is. */
function paintProgress(c, m) {
  const id = String(m.key).slice(String(m.key).indexOf("|") + 1);
  const row = Array.prototype.find.call(c.host.querySelectorAll(".pl-row"), (n) => n.getAttribute("data-id") === id);
  const s = c.savedIndex && c.savedIndex[id];
  if (!row || !s) return;
  if (s.status !== "downloading") { clearTimeout(c.repaint); c.repaint = setTimeout(function () { if (current === c) paint(c); }, 150); return; }
  const n = row.querySelector(".pl-state");
  n.hidden = false;
  n.textContent = stateText(s, m.done, m.size);
}

async function paint(c) {
  let saved = {};
  let readError = "";
  if (c.L.supported()) {
    try { saved = await c.L.savedFor(c.o.projectId); } catch (e) {
      saved = {};
      readError = "The plans saved on this device could not be read just now.";
    }
  }
  if (current !== c) return;
  c.savedIndex = saved;
  const who = c.L.owner();
  c.keys = {};
  (c.files || []).concat(Object.keys(saved).map((id) => ({ id }))).forEach(function (f) { c.keys[who + "|" + f.id] = true; });
  const rows = menuRows(c.files || [], saved);
  const list = c.host.querySelector(".pl-list");
  const notes = [c.error, readError].filter(Boolean).map((t) => '<div class="pl-empty">' + esc(t) + "</div>").join("");
  // the button that had the focus is drawn again: the focus goes back to it (or to ✕), never to the page behind
  const a = document.activeElement;
  const wasId = a && list.contains(a) ? a.getAttribute("data-id") || "" : null;
  const ios = iosHomeScreen();
  if (!rows.length) {
    list.innerHTML = notes || '<div class="pl-empty">' + esc(c.files ? "No plan files for this project in OneDrive." : "Nothing is saved on this device for this project.") + "</div>";
  } else {
    list.innerHTML = notes + rows.map(function (r) { return rowHtml(r, ios); }).join("");
  }
  if (wasId !== null) {
    const n = Array.prototype.find.call(list.querySelectorAll("[data-pl-act]"), (x) => x.getAttribute("data-id") === wasId);
    try { (n || c.host.querySelector(".pl-x")).focus(); } catch (e) { /* */ }
  }
  if (ios) say(IOS_HOME, "warn");
  else if (!c.L.supported()) say(c.L.UNSUPPORTED, "warn");
}

function act(c, what, id) {
  const L = c.L;
  if (!L) return;
  const f = c.files ? c.files.find((x) => x.id === id) : null;
  if (what === "open") {
    // in the click itself: the new tab must open now, before anything is awaited
    say("Opening in the takeoff app…");
    const done = function (r) { if (current === c) say(r.ok ? "" : handoffProblem(r), r.ok ? "" : "warn"); };
    // a copy saved here opens from the device (no signal needed); otherwise the file in OneDrive, over byte ranges
    const s = c.savedIndex && c.savedIndex[id];
    if (s && s.file) L.open(id, done);
    else if (f) L.openOnline(c.o.projectId, c.o.number, f, done);
    return;
  }
  if (what === "save" && f) {
    say("Saving " + f.name + " on this device…");
    L.save({ projectId: c.o.projectId, number: c.o.number, projectTitle: c.o.title, file: f }).then(function (r) {
      if (current === c) say(r && r.paused ? "Paused." : "Saved on this device — it opens with no signal.", r && r.paused ? "" : "ok");
    }, function (e) {
      if (current === c) say((e && e.message) || "Could not save.", "warn");
    });
    return;
  }
  if (what === "pause") L.pause(id);
}
