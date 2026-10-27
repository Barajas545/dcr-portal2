/* The Plans Library page (owner 2026-10-26: the old portal's plans-library.html, for Portal 2).

   The plan files this person saved on this device (js/plan-library.js), by project: each opens in the takeoff app in a
   new tab - with no signal too, once the app has opened on this device (it keeps itself offline) - and shows whether
   it is the version OneDrive holds, downloading, paused or stopped. A newer version downloads by itself while a portal
   page is open and online; "Check now" asks at once. Remove takes a copy off the device.

   Works offline: the page is in the service worker's list, and the sign-in this device holds is read without the
   network (boot's offline mode). Only for the people who see prices (map/plans.js planFilesFor): plan files carry
   prices, and the broker refuses anyone else. */

import { boot, el, esc, confirmBox } from "./shell.js";
import { planFilesFor } from "../map/plans.js";
import { folderLabel, fmtSize, fmtAgo, statusText } from "../map/plan-library.js";
import { handoffProblem, lastReady } from "../plan-handoff.js";
import * as L from "../plan-library.js";

const state = { me: null, rows: [], busy: false, timer: null };

function day(iso) {
  const t = Date.parse(iso || "");
  return isFinite(t) ? new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
}
function say(text, kind) {
  el("libSay").textContent = text || "";
  el("libSay").className = "lib-say" + (kind ? " " + kind : "");
}

async function paintBar() {
  const u = await L.usage();
  const last = await L.lastChecked();
  const free = u.quota != null && u.usage != null ? Math.max(0, u.quota - u.usage) : null;
  el("libBar").innerHTML =
    "<span><b>" + u.plans + " plan" + (u.plans === 1 ? "" : "s") + "</b> · " + esc(fmtSize(u.bytes)) + " on this device" +
    (free != null ? " · " + esc(fmtSize(free)) + " free for the portal" : "") + "</span>" +
    "<span>" + (last ? "Checked for new versions " + esc(fmtAgo(last, Date.now())) : "Not checked for new versions yet") + "</span>" +
    '<button type="button" class="btn btn-ghost btn-sm" id="libCheck"' + (navigator.onLine === false ? " disabled" : "") + ">Check now</button>";
}

function paintTool() {
  const n = el("libTool");
  const at = lastReady();
  if (!state.rows.length) { n.hidden = true; return; }
  n.hidden = false;
  n.className = "lib-note" + (at ? " ok" : " warn");
  n.textContent = at
    ? "The takeoff app opened on this device " + fmtAgo(at, Date.now()) + ": saved plans open with no signal."
    : "Open one plan while online first: this device then keeps the takeoff app, and saved plans open with no signal.";
}

function paintNet() {
  const n = el("libNet");
  n.hidden = navigator.onLine !== false;
  n.textContent = "You're offline. Saved plans still open; new versions download once you're back online.";
}

function rowHtml(r) {
  const pct = r.job && r.job.size ? Math.min(100, Math.floor((r.job.done / r.job.size) * 100)) : null;
  const meta = [folderLabel(r.folder), r.size ? fmtSize(r.size) : r.latest && r.latest.size ? fmtSize(r.latest.size) : "",
    r.modified ? "version of " + day(r.modified) : ""].filter(Boolean).join(" · ");
  let state = r.status === "downloading" && pct !== null ? "Downloading " + pct + "%" +
    (r.job && r.job.rate ? " · " + fmtSize(r.job.rate) + "/s" : "") : statusText(r.status);
  if (r.savedAt && r.status === "saved") state += " · " + day(r.savedAt);
  if (r.dl && r.dl.error && r.status !== "downloading") state += " — " + r.dl.error;
  const kind = r.status === "saved" ? " ok" : r.status === "stopped" || r.status === "gone" || r.status === "denied" ? " warn" : "";
  const b = [];
  if (r.file) b.push('<button type="button" class="btn btn-sm" data-act="open" data-id="' + esc(r.itemId) + '">Open</button>');
  if (r.status === "downloading") b.push('<button type="button" class="btn btn-ghost btn-sm" data-act="pause" data-id="' + esc(r.itemId) + '">Pause</button>');
  if (r.status === "paused" || r.status === "stopped" || r.status === "missing" || r.status === "outdated") {
    b.push('<button type="button" class="btn btn-ghost btn-sm" data-act="resume" data-id="' + esc(r.itemId) + '"' +
      (navigator.onLine === false ? " disabled" : "") + ">" + (r.status === "stopped" ? "Try again" : r.status === "outdated" ? "Update now" : "Resume") + "</button>");
  }
  b.push('<button type="button" class="btn btn-ghost btn-sm" data-act="remove" data-id="' + esc(r.itemId) + '">Remove</button>');
  return '<div class="lib-row">' +
    '<div class="lib-name">' + esc(r.name) + "</div>" +
    (meta ? '<div class="lib-meta">' + esc(meta) + "</div>" : "") +
    '<div class="lib-state' + kind + '">' + esc(state) +
      (r.status === "downloading" && pct !== null ? '<div class="lib-bar-p"><i style="width:' + pct + '%"></i></div>' : "") + "</div>" +
    '<div class="lib-btns">' + b.join("") + "</div></div>";
}

async function render() {
  state.rows = await L.list();
  paintTool();
  paintNet();
  await paintBar();
  if (!state.rows.length) {
    el("libList").innerHTML = '<div class="lib-empty">Nothing saved on this device yet.<br>Search a project, tap 📐, then ' +
      "<b>Save to this device</b>.</div>";
    return;
  }
  const groups = [];
  state.rows.forEach(function (r) {
    let g = groups.find((x) => x.pid === r.projectId);
    if (!g) groups.push(g = { pid: r.projectId, number: r.number, title: r.projectTitle, rows: [] });
    g.rows.push(r);
  });
  el("libList").innerHTML = groups.map(function (g) {
    return '<div class="lib-proj"><a class="lib-proj-hd" href="project.html?id=' + encodeURIComponent(g.pid) + '">' +
      "<b>" + esc(g.number) + "</b><span>" + esc(g.title && g.title !== g.number ? g.title : "") + "</span></a>" +
      g.rows.map(rowHtml).join("") + "</div>";
  }).join("");
}

let queued = false;
function queueRender() {
  if (queued) return;
  queued = true;
  setTimeout(function () { queued = false; render().catch(function () { /* the next change draws again */ }); }, 120);
}

async function checkNow() {
  if (state.busy || navigator.onLine === false) return;
  state.busy = true;
  say("Asking OneDrive for new versions…");
  try {
    const s = await L.checkUpdates();
    const bits = ["Checked " + s.checked + " plan" + (s.checked === 1 ? "" : "s") + ":"];
    bits.push(s.updates ? s.updates + " with a new version (downloading now)." : "all up to date.");
    if (s.gone) bits.push(s.gone + " no longer in OneDrive.");
    if (s.denied) bits.push(s.denied + " no longer open to your account.");
    say(bits.join(" "));
    L.autoWork();
  } catch (e) {
    say((e && e.message) || "Could not check for new versions.", "warn");
  } finally {
    state.busy = false;
    queueRender();
  }
}

function act(what, id) {
  if (what === "open") {
    // in the click itself: the new tab opens now
    say("Opening in the takeoff app…");
    L.open(id, function (r) { say(r.ok ? "" : handoffProblem(r), r.ok ? "" : "warn"); queueRender(); });
    return;
  }
  if (what === "pause") { L.pause(id); return; }
  if (what === "resume") {
    L.resume(id).catch(function (e) { say((e && e.message) || "Could not download it.", "warn"); });
    return;
  }
  if (what === "remove") {
    const r = state.rows.find((x) => x.itemId === id);
    confirmBox("Remove " + (r ? r.name : "this plan") + " from this device? It stays in OneDrive.", { title: "Remove", okText: "Remove", danger: true })
      .then(function (yes) { if (yes) return L.remove(id).then(function () { say("Removed from this device."); }); return null; })
      .catch(function (e) { say((e && e.message) || "Could not remove it.", "warn"); })
      .finally(queueRender);
  }
}

async function main() {
  state.me = await boot("", { offline: true });
  if (!planFilesFor(state.me)) {
    el("libList").innerHTML = '<div class="lib-empty">The Plans Library is for the people who see prices: plan files carry prices.</div>';
    el("libBar").textContent = "";
    return;
  }
  if (!L.supported()) {
    el("libList").innerHTML = '<div class="lib-empty">' + esc(L.UNSUPPORTED) + "</div>";
    return;
  }
  el("libList").addEventListener("click", function (e) {
    const b = e.target.closest ? e.target.closest("button[data-act]") : null;
    if (b && !b.disabled) act(b.getAttribute("data-act"), b.getAttribute("data-id"));
  });
  el("libBar").addEventListener("click", function (e) {
    if (e.target && e.target.id === "libCheck") checkNow();
  });
  L.onChange(function (m) {
    if (m.t === "progress") {
      const r = state.rows.find((x) => x.key === m.key);
      if (r) { r.job = { done: m.done, size: m.size, rate: m.rate }; r.status = "downloading"; }
    }
    queueRender();
  });
  window.addEventListener("online", function () { queueRender(); L.maybeCheck(state.me); });
  window.addEventListener("offline", queueRender);
  try { await L.sweep(); } catch (e) { /* leftovers can wait for the next visit */ }
  await render();
  // new versions, interrupted downloads, copies the browser lost: quietly, while this page is open
  L.maybeCheck(state.me).finally(queueRender);
  state.timer = setInterval(function () { L.maybeCheck(state.me); }, 5 * 60 * 1000);
}

main().catch(function (e) {
  if (e && /not signed in|not for this role/.test(String(e.message))) return;
  el("libList").innerHTML = '<div class="lib-empty">' + esc((e && e.message) || "The Plans Library could not open.") + "</div>";
});
