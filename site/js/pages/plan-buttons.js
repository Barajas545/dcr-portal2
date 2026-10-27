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
import { handoffProblem } from "../plan-handoff.js";

const wired = new WeakSet();
let lib = null;
/** js/plan-library.js, loaded the first time a price person needs it (a crew phone never loads it). */
function library() {
  if (!lib) lib = import("../plan-library.js");
  return lib;
}

/** On a page that opens often (Search, a project, the home page): for a person who sees prices, ask OneDrive for new
    versions of the plans saved on this device now and then, and download what needs it - quietly. Never throws. */
export function keepPlansFresh(me) {
  if (!planFilesFor(me) || !onedrive.LIVE) return;
  library().then(function (L) { return L.maybeCheck(me); }).catch(function () { /* the next page asks again */ });
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
        title: slot.getAttribute("data-plans-title") || "", me, from: a });
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

function rowHtml(r) {
  const s = r.saved;
  const pct = s && s.job && s.job.size ? Math.min(100, Math.floor((s.job.done / s.job.size) * 100)) : null;
  const meta = [r.where, r.size != null ? fmtSize(r.size) : "", day(r.modified)].filter(Boolean).join(" · ");
  let state = "";
  if (s) state = s.status === "downloading" && pct !== null ? "Downloading " + pct + "%" : statusText(s.status);
  const openable = (s && s.file) || r.file;
  const btns = [];
  if (openable) btns.push('<button type="button" class="btn btn-sm" data-pl-act="open" data-id="' + esc(r.id) + '">Open</button>');
  if (!s && r.file) btns.push('<button type="button" class="btn btn-ghost btn-sm" data-pl-act="save" data-id="' + esc(r.id) + '">Save to this device</button>');
  else if (s && s.status === "downloading") btns.push('<button type="button" class="btn btn-ghost btn-sm" data-pl-act="pause" data-id="' + esc(r.id) + '">Pause</button>');
  else if (s && (s.status === "paused" || s.status === "stopped" || s.status === "missing") && r.file) {
    btns.push('<button type="button" class="btn btn-ghost btn-sm" data-pl-act="save" data-id="' + esc(r.id) + '">' + (s.status === "stopped" ? "Try again" : "Resume") + "</button>");
  }
  return '<div class="pl-row">' +
    '<div class="pl-name">' + esc(r.name) + "</div>" +
    (meta ? '<div class="pl-meta">' + esc(meta) + "</div>" : "") +
    (state ? '<div class="pl-state' + (s && s.status === "saved" ? " ok" : "") + '">' + esc(state) +
      (s && s.dl && s.dl.error && s.status !== "downloading" ? " — " + esc(s.dl.error) : "") + "</div>" : "") +
    '<div class="pl-btns">' + btns.join("") + "</div></div>";
}

function closeMenu() {
  if (!current) return;
  const c = current;
  current = null;
  if (c.off) c.off();
  document.removeEventListener("keydown", c.onKey, true);
  c.host.remove();
  try { if (c.from && c.from.focus) c.from.focus(); } catch (e) { /* */ }
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
    '<div class="pl-list" aria-live="polite"><div class="pl-empty">Loading the plan files…</div></div>' +
    '<div class="pl-say" role="status"></div>' +
    '<div class="pl-ft"><a href="plans-library.html">Plans Library</a>' +
    '<a href="' + esc(plansLink(o.number)) + '" target="_blank" rel="noopener">Plans Archive (Edge or Chrome on a computer) ↗</a></div></div>';
  document.body.appendChild(host);
  const c = current = { host, from: o.from, o, files: null, off: null, onKey: null };
  c.onKey = function (e) { if (e.key === "Escape") { e.preventDefault(); closeMenu(); } };
  document.addEventListener("keydown", c.onKey, true);
  host.addEventListener("click", function (e) {
    if (e.target === host || (e.target.closest && e.target.closest(".pl-x"))) { closeMenu(); return; }
    const b = e.target.closest ? e.target.closest("[data-pl-act]") : null;
    if (b && !b.disabled) act(c, b.getAttribute("data-pl-act"), b.getAttribute("data-id"));
  });
  setTimeout(function () { const x = host.querySelector(".pl-x"); if (x) x.focus(); }, 20);

  const L = await library();
  if (current !== c) return;
  c.L = L;
  c.off = L.onChange(function () { if (current === c) paint(c); });
  try {
    const got = await onedrive.plansList([o.projectId]);
    if (current !== c) return;
    c.files = got[String(o.projectId)] ? got[String(o.projectId)].files : [];
  } catch (e) {
    if (current !== c) return;
    c.files = null;
    c.error = e && e.code === "offline" ? "You're offline — the plans saved on this device for this project are below."
      : (e && e.message) || "The plan files could not be listed just now.";
  }
  paint(c);
}

async function paint(c) {
  const saved = c.L.supported() ? await c.L.savedFor(c.o.projectId) : {};
  if (current !== c) return;
  c.savedIndex = saved;
  const rows = menuRows(c.files || [], saved);
  const list = c.host.querySelector(".pl-list");
  if (!rows.length) {
    list.innerHTML = '<div class="pl-empty">' + esc(c.error || (c.files ? "No plan files for this project in OneDrive." : "")) + "</div>";
    return;
  }
  list.innerHTML = (c.error ? '<div class="pl-empty">' + esc(c.error) + "</div>" : "") + rows.map(rowHtml).join("");
  if (!c.L.supported()) say(c.L.UNSUPPORTED, "warn");
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
