/* The Plans Library page (owner 2026-10-26: the old portal's plans-library.html, for Portal 2).

   The plan files this person saved on this device (js/plan-library.js), by project: each opens in the takeoff app in a
   new tab - with no signal too, once the app said it keeps itself on this device - and shows whether it is the version
   OneDrive holds, downloading, paused or stopped. A newer version downloads by itself while a portal page is open and
   online; "Check now" asks at once. Remove takes a copy off the device.

   Works offline: the page is in the service worker's list, and the sign-in this device holds is read without the
   network (boot's offline mode). Only for the people who see prices (map/plans.js planFilesFor): plan files carry
   prices, and the broker refuses anyone else; a person whose Sees prices was taken away finds their saved plans gone
   from the device once this page (or Search, a project, Home) reads their profile online. */

import { boot, el, esc, confirmBox } from "./shell.js";
import { planFilesFor } from "../map/plans.js";
import { folderLabel, fmtSize, fmtAgo, statusText, readyFresh } from "../map/plan-library.js";
import { handoffProblem, lastReady, iosHomeScreen } from "../plan-handoff.js";
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
  if (!state.rows.length) { n.hidden = true; return; }
  n.hidden = false;
  if (iosHomeScreen()) {
    n.className = "lib-note warn";
    n.textContent = "On an iPhone or iPad, plans open from the portal in Safari: open portal.dcrframing.com in Safari (not from the home-screen icon) to open them.";
    return;
  }
  const at = lastReady();
  const ok = readyFresh(at, Date.now());
  n.className = "lib-note" + (ok ? " ok" : " warn");
  n.textContent = ok
    ? "The takeoff app is kept on this device (it said so " + fmtAgo(at, Date.now()) + "): saved plans open with no signal."
    : "Open one plan while online now and then: this device then keeps the takeoff app, and saved plans open with no signal.";
}

function paintNet() {
  const n = el("libNet");
  n.hidden = navigator.onLine !== false;
  n.textContent = "You're offline. Saved plans still open; new versions download once you're back online.";
}

function stateLine(r, done, size) {
  const pct = size ? Math.min(100, Math.floor((done / size) * 100)) : null;
  let s = r.status === "downloading" && pct !== null ? "Downloading " + pct + "%" +
    (r.job && r.job.rate ? " · " + fmtSize(r.job.rate) + "/s" : "") : statusText(r.status, !!r.file);
  if (r.savedAt && r.status === "saved") s += " · " + day(r.savedAt);
  if (r.dl && r.dl.error && r.status !== "downloading") s += " — " + r.dl.error;
  return { text: s, pct };
}

function rowHtml(r) {
  const meta = [folderLabel(r.folder), r.size ? fmtSize(r.size) : r.latest && r.latest.size ? fmtSize(r.latest.size) : "",
    r.modified ? "version of " + day(r.modified) : ""].filter(Boolean).join(" · ");
  const line = stateLine(r, r.job ? r.job.done : 0, r.job ? r.job.size : 0);
  const kind = r.status === "saved" ? " ok" : r.status === "stopped" || r.status === "gone" || r.status === "denied" ? " warn" : "";
  const b = [];
  if (r.file) b.push('<button type="button" class="btn btn-sm" data-act="open" data-id="' + esc(r.itemId) + '">Open</button>');
  if (r.status === "downloading") b.push('<button type="button" class="btn btn-ghost btn-sm" data-act="pause" data-id="' + esc(r.itemId) + '">Pause</button>');
  if (r.status === "paused" || r.status === "stopped" || r.status === "missing" || r.status === "outdated") {
    b.push('<button type="button" class="btn btn-ghost btn-sm" data-act="resume" data-id="' + esc(r.itemId) + '"' +
      (navigator.onLine === false ? " disabled" : "") + ">" + (r.status === "stopped" ? "Try again" : r.status === "outdated" ? "Update now" : "Resume") + "</button>");
  }
  b.push('<button type="button" class="btn btn-ghost btn-sm" data-act="remove" data-id="' + esc(r.itemId) + '">Remove</button>');
  return '<div class="lib-row" data-key="' + esc(r.key) + '">' +
    '<div class="lib-name">' + esc(r.name) + "</div>" +
    (meta ? '<div class="lib-meta">' + esc(meta) + "</div>" : "") +
    '<div class="lib-state' + kind + '"><span class="lib-state-t">' + esc(line.text) + "</span>" +
      '<div class="lib-bar-p"' + (r.status === "downloading" && line.pct !== null ? "" : " hidden") + '><i style="width:' + (line.pct || 0) + '%"></i></div></div>' +
    '<div class="lib-btns">' + b.join("") + "</div></div>";
}

/** Only the downloading row's line and bar change while it downloads: its buttons stay where the pointer is. */
function paintProgress(m) {
  const r = state.rows.find((x) => x.key === m.key);
  const row = Array.prototype.find.call(document.querySelectorAll(".lib-row"), (n) => n.getAttribute("data-key") === m.key);
  if (!r || !row) { queueRender(); return; }
  r.job = { done: m.done, size: m.size, rate: m.rate };
  if (r.status !== "downloading") { r.status = "downloading"; queueRender(); return; }
  const line = stateLine(r, m.done, m.size);
  row.querySelector(".lib-state-t").textContent = line.text;
  const bar = row.querySelector(".lib-bar-p");
  bar.hidden = line.pct === null;
  bar.querySelector("i").style.width = (line.pct || 0) + "%";
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
  setTimeout(function () { queued = false; render().catch(function () { /* the next change draws again */ }); }, 150);
}

async function checkNow() {
  if (state.busy || navigator.onLine === false) return;
  state.busy = true;
  say("Asking OneDrive for new versions…");
  try {
    const s = await L.checkUpdates();
    if (s.revoked) {
      say("Your account no longer opens plan files, so the plans saved here were removed from this device.", "warn");
      return;
    }
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
  const fresh = !!(window.DCR2 && window.DCR2.offline === false);
  if (!planFilesFor(state.me)) {
    // Sees prices taken away: what this person saved here goes (plan files carry prices) - once the profile was read
    // online, never on an old copy of it
    let gone = 0;
    if (fresh && L.supported()) { try { gone = await L.purgeOwner(L.owner()); } catch (e) { gone = 0; } }
    el("libList").innerHTML = '<div class="lib-empty">The Plans Library is for the people who see prices: plan files carry prices.' +
      (gone ? "<br>The " + gone + " plan" + (gone === 1 ? "" : "s") + " you had saved on this device " + (gone === 1 ? "was" : "were") + " removed." : "") + "</div>";
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
    if (m.t === "progress") paintProgress(m);
    else queueRender();
  });
  window.addEventListener("online", function () { queueRender(); L.maybeCheck(state.me, { fresh: true }); });
  window.addEventListener("offline", queueRender);
  window.addEventListener("storage", function (e) { if (e.key === "dcr2-takeoff-ready-at") paintTool(); });
  try { await L.sweep(); } catch (e) { /* leftovers can wait for the next visit */ }
  await render();
  // new versions, interrupted downloads, copies the browser lost: quietly, while this page is open
  L.maybeCheck(state.me, { fresh }).finally(queueRender);
  state.timer = setInterval(function () { L.maybeCheck(state.me, { fresh }); }, 5 * 60 * 1000);
}

main().catch(function (e) {
  if (e && /not signed in|not for this role/.test(String(e.message))) return;
  el("libList").innerHTML = '<div class="lib-empty">' + esc((e && e.message) || "The Plans Library could not open.") + "</div>";
});
