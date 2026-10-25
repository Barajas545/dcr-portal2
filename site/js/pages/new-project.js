/* The New Project dialog, one for the Board and the project page (owner decision 2026-10-24 D13; DCR Desktop 2's
   ui/pages/new_project.py without its address look-up and file drop).

   openNewProject(me) -> Promise<project | null>; isOpen().
   Fields: Project name *, Address, City, State (CA), ZIP; Client name, phone, e-mail; Start date, Starts as (the
   status), Scope; the labor rate's zone — "Automatic from the city" (nothing sent: the database decides), Local,
   Out of area (a zone alone: the database prices it, no prices switch needed) and, for people who see prices only,
   "Custom rate" with its $/hour. map/projects.js newProjectFields checks and shapes them; the database gives the
   number (rpc create_project, admin and manager; it refuses everything else itself).

   One attempt, as Desktop 2 ("One attempt, no automatic retry"): Create is blocked while its answer is on the way
   (a second click, Enter, a double tap); an answer that never arrived leaves the dialog saying the project may exist
   and every later Create in it sends nothing. Closing the dialog while it creates does not stop it: the new number
   is still said (with its link) and the OneDrive folder still made. After creating: "Created A306", the project's
   OneDrive folder (repo/onedrive.js ensureFolder, at most 8 seconds; the function not deployed yet: nothing to say),
   then the project's page. Nothing typed is logged.

   Also used after a lead becomes a project (leads.js): makeFolder(project). Browser-only module. */

import { esc, toast, errorText, seesPrices, D } from "./shell.js";
import * as projectsRepo from "../repo/projects.js";
import * as onedrive from "../repo/onedrive.js";
import { newProjectFields, RATE_ZONES } from "../map/projects.js";
import { STATUS_ORDER, statusLabel } from "../map/status.js";

export const FOLDER_WAIT_MS = 8000;
export const NOTICE_KEY = "dcr2:project.notice";       // sessionStorage: one sentence the next project page says
const LOST = "The answer didn't arrive: the project may have been created. Close this and look on the Board before making it again.";

const st = { open: false, busy: false, lost: false, host: null, resolve: null, prices: false, gen: 0 };

export function isOpen() { return st.open; }

function node(id) { return document.getElementById(id); }

function html(prices) {
  const f = (id, label, input, wide) => '<div class="dcr-mo-f' + (wide ? " np-wide" : "") + '"><label for="' + id + '">' + esc(label) + "</label>" + input + "</div>";
  const text = (id, extra) => '<input id="' + id + '" type="text" autocomplete="off"' + (extra || "") + ">";
  return '<div class="dcr-mo-card np-card" role="dialog" aria-modal="true" aria-labelledby="npT">' +
    '<div class="dcr-mo-t" id="npT">＋ New project</div>' +
    '<div class="dcr-mo-m">The project number is given by the database when the project is created.</div>' +
    '<form id="npForm" novalidate autocomplete="off"><div class="np-grid">' +
    f("npName", "Project name *", text("npName", ' maxlength="200" placeholder="e.g. Smith Residence"'), true) +
    f("npAddr", "Address", text("npAddr", ' maxlength="300"'), true) +
    f("npCity", "City", text("npCity", ' maxlength="120"')) +
    '<div class="np-pair">' + f("npState", "State", text("npState", ' maxlength="2" value="CA"')) +
      f("npZip", "ZIP", text("npZip", ' maxlength="10" inputmode="numeric"')) + "</div>" +
    f("npClient", "Client name", text("npClient", ' maxlength="200"'), true) +
    f("npPhone", "Client phone", '<input id="npPhone" type="tel" maxlength="80" autocomplete="off">') +
    f("npEmail", "Client e-mail", '<input id="npEmail" type="email" maxlength="200" autocomplete="off">') +
    f("npStart", "Start date", '<input id="npStart" type="date">') +
    f("npStatus", "Starts as", '<select id="npStatus">' + STATUS_ORDER.map((s) => '<option value="' + s + '"' +
      (s === "new_request" ? " selected" : "") + ">" + esc(statusLabel(s)) + "</option>").join("") + "</select>") +
    f("npScope", "Scope", '<textarea id="npScope" rows="3" maxlength="4000"></textarea>', true) +
    f("npZone", "Labor rate", '<select id="npZone">' + RATE_ZONES.filter((z) => prices || !z.prices).map((z) =>
      '<option value="' + z.id + '">' + esc(z.label) + "</option>").join("") + "</select>") +
    (prices ? f("npRate", "Custom rate ($ per hour)", '<input id="npRate" type="text" inputmode="decimal" disabled placeholder="Pick “Custom rate”">') : "") +
    '</div><div class="dcr-mo-err" id="npMsg" role="alert"></div><div class="dcr-mo-ft">' +
    '<button type="button" class="btn btn-ghost btn-sm" id="npCancel">Cancel</button>' +
    '<button type="submit" class="btn btn-sm" id="npCreate">✓ Create project</button></div></form></div>';
}

function values() {
  const v = (id) => { const n = node(id); return n ? n.value : ""; };
  return { name: v("npName"), address: v("npAddr"), city: v("npCity"), state: v("npState"), zip: v("npZip"), client_name: v("npClient"),
    client_phone: v("npPhone"), client_email: v("npEmail"), start_date: v("npStart"), status: v("npStatus"), scope: v("npScope"),
    zone: v("npZone"), rate: v("npRate") };
}

function say(text) { const m = node("npMsg"); if (m) m.textContent = text || ""; }

function close(value) {
  if (!st.open) return;
  st.open = false;
  document.removeEventListener("keydown", onKey, true);
  if (st.host) { st.host.classList.remove("open"); st.host.innerHTML = ""; }
  const r = st.resolve;
  st.resolve = null;
  if (r) r(value === undefined ? null : value);
}

function onKey(e) {
  if (!st.open) return;
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(null); }
}

/** One sentence the project page says when it opens next (the dialog's toast is gone with the page). */
function leaveNotice(pid, text) {
  try { sessionStorage.setItem(NOTICE_KEY, JSON.stringify({ id: String(pid), text })); } catch (e) { /* not important */ }
}
/** The project page: the sentence left for this project, once. */
export function takeNotice(pid) {
  try {
    const n = JSON.parse(sessionStorage.getItem(NOTICE_KEY) || "null");
    sessionStorage.removeItem(NOTICE_KEY);
    return n && String(n.id) === String(pid) ? String(n.text || "") : "";
  } catch (e) { return ""; }
}

/** The OneDrive folder of a project just made (also after a lead's conversion): -> the sentence to say, "" for none. */
export async function makeFolder(project) {
  const pid = project && project.id;
  if (pid === null || pid === undefined) return "";
  let timer = null;
  const slow = new Promise((done) => { timer = setTimeout(() => done({ state: "slow" }), FOLDER_WAIT_MS); });
  const r = await Promise.race([onedrive.ensureFolder(pid), slow]);
  clearTimeout(timer);
  if (!r || r.state === "made" || r.state === "exists" || r.state === "not_deployed") return "";
  if (r.state === "slow") return "OneDrive is slow to answer: the project's OneDrive folder can be made from the Files tab.";
  if (r.state === "other_folder") return r.message;
  return "The project's OneDrive folder was not made just now: it can be made from the Files tab.";
}

/** A link to the new project in a toast (the dialog was closed while it was being created). */
function createdToast(p) {
  const text = "Created " + (p.internalIDNumber || "the project") + ".";
  const t = D().toast;
  let n = null;
  try { n = typeof t === "function" ? t(text, { kind: "ok", ms: 15000 }) : null; } catch (e) { n = null; }
  if (!n || !n.appendChild) { toast(text, "ok"); return; }
  const a = document.createElement("a");
  a.href = "project.html?id=" + encodeURIComponent(p.id);
  a.textContent = " Open it →";
  a.style.cssText = "color:inherit;font-weight:800;margin-left:6px";
  n.appendChild(a);
}

async function create() {
  if (st.busy) { say("Still creating — a moment."); return; }   // its answer is on the way: never a second project
  if (st.lost) { say(LOST); return; }
  const got = newProjectFields(values(), st.prices);
  if (got.problem) { say(got.problem); return; }
  st.busy = true;
  const gen = st.gen;
  const btn = node("npCreate");
  if (btn) { btn.disabled = true; btn.textContent = "Creating…"; }
  say("");
  let p = null;
  try {
    p = await projectsRepo.createProject(got.fields);
  } catch (e) {
    st.busy = false;
    // no answer at all (a database refusal always carries its code): the project may exist
    const lost = !e || ((!e.code || e.code === "NETWORK") && !(Number(e.status) >= 400));
    if (lost) st.lost = true;
    if (st.open && st.gen === gen) {
      say(lost ? LOST : errorText(e));
      const b = node("npCreate");
      if (b) { b.disabled = false; b.textContent = "✓ Create project"; }
    } else {
      toast(lost ? "The answer didn't arrive: the project may have been created — look on the Board." : errorText(e), "error");
    }
    return;
  }
  st.busy = false;
  const stayed = st.open && st.gen === gen;
  if (!stayed) {                                      // closed while it was created: say so with its link
    createdToast(p);
    const note = await makeFolder(p);
    if (note) toast(note, "info");
    return;
  }
  toast("Created " + p.internalIDNumber + ".", "ok");
  say("");
  const b = node("npCreate");
  if (b) b.textContent = "Making the OneDrive folder…";
  const note = await makeFolder(p);
  if (note) leaveNotice(p.id, note);
  const done = st.resolve;
  st.resolve = null;
  close(null);
  if (done) done(p);
  location.href = "project.html?id=" + encodeURIComponent(p.id);
}

/** Opens the dialog (one at a time). -> the new project, or null when it was closed without one. */
export function openNewProject(me) {
  if (st.open) return Promise.resolve(null);
  st.prices = seesPrices(me);
  st.gen += 1;
  st.lost = false;
  let host = document.getElementById("npHost");
  if (!host) {
    host = document.createElement("div");
    host.id = "npHost";
    host.className = "dcr-mo";
    document.body.appendChild(host);
    host.addEventListener("click", (e) => { if (e.target === host) close(null); });
  }
  st.host = host;
  host.innerHTML = html(st.prices);
  host.classList.add("open");
  st.open = true;
  document.addEventListener("keydown", onKey, true);
  node("npForm").addEventListener("submit", (e) => { e.preventDefault(); create(); });
  node("npCancel").addEventListener("click", () => close(null));
  const zone = node("npZone"), rate = node("npRate");
  if (zone && rate) {
    zone.addEventListener("change", () => {
      rate.disabled = zone.value !== "custom";
      rate.placeholder = rate.disabled ? "Pick “Custom rate”" : "e.g. 95";
      if (rate.disabled) rate.value = ""; else rate.focus();
    });
  }
  setTimeout(() => { const n = node("npName"); if (n) n.focus(); }, 0);
  return new Promise((resolve) => { st.resolve = resolve; });
}
