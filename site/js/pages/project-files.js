/* Project tab Files + the capture bar (MODULES §3 "Files + capture bar", Redesign; BLUEPRINT 2.2.5; the OneDrive part:
   owner decisions 2026-10-24, D9 / D10).

   Two boxes:
   * "OneDrive project folder" - the project's folder in the owner's OneDrive (/Projects/<folder_name>/: Floor Plans,
     Photos, Documents, "Old portal documents" and their folders - the same folder the office PCs have), through the
     broker (repo/onedrive.js; the Edge Function holds the Microsoft secret, the database decides who may do what).
     Every active person browses it and opens its files (a link made per click, opened at once, kept nowhere); a
     person the broker says may upload (can_upload: the "Can upload to OneDrive" switch) adds files - the picker, or
     dropped on the box - to Documents or Floor Plans (or the folder of them open now), straight from the browser to
     Microsoft (js/onedrive-upload.js: chunks, progress, resumable within the page, never kept on the device); the
     broker then records the file's row, so DCR Desktop 2 lists it as it lists a file a PC copied there. Names the
     broker hides (priced or money names, amounts, .takeoff / .pdfnotes for people without prices) never come here; a
     row of the project's file list at the same path lends its caption and version. No folder yet: "Make the folder"
     for projects editors and uploaders (never a second folder beside another one with the project's number).
     Only while repo/onedrive.js LIVE is on - and, before that, for an admin on the self-test project A000T2, with the
     "OneDrive self-test" (pages/onedrive-selftest.js, loaded only when it is clicked).
   * "Stored in DCR" - current_files (the newest live version of each file) in the cloud, as a folder browser: Photos,
     Documents/Site Notes, Journal photos ... A cloud row opens through a signed URL (120 s). Receipts and the priced
     folders never reach people without the switch (database rule). While the OneDrive part is off or cannot be
     reached, this box also lists the rows of OneDrive files ("On the office computers", by name and date) as before.

   Capture bar (everyone who may add files: not view-only accounts): 📷 photos, 🎬 video,
   🎙 voice note (with live transcription where the browser has it), 📝 text note. Everything goes
   through the upload queue: photos and videos into photos/<the day>, voice and text notes into
   documents/Site Notes. Each file gets a unique name (IMG 2026-10-19 14.30.12-2.jpg). Photos and voice notes keep
   this cloud capture (D9): OneDrive takes documents and floor plans only. */

import * as filesRepo from "../repo/files.js";
import * as onedrive from "../repo/onedrive.js";
import { listAt, crumbs, fmtSize, fileIcon, LOCAL_LABEL, CLOUD_LABEL, SIGNED_DOC_S, folderLabel } from "../map/files.js";
import * as OD from "../map/onedrive.js";
import { fmtDay, stamp } from "../map/pacific.js";
import { createUploader, xhrTransport } from "../onedrive-upload.js";
import * as uploads from "./uploads.js";

const st = { host: null, ctx: null, items: [], path: [], seq: 0, timer: null, progress: [], rec: null, odOn: false, od: null, up: null };

function capBarHtml(ctx) {
  if (!ctx.canFiles) return "";
  return '<div class="cap-bar"><span class="cap-title">📸 Site documentation</span>' +
    '<button class="pj-btn pj-btn-sm" type="button" id="capPhoto">📷 Photo</button>' +
    '<button class="pj-btn pj-btn-sm" type="button" id="capVideo">🎬 Video</button>' +
    '<button class="pj-btn pj-btn-sm" type="button" id="capVoice">🎙 Voice note</button>' +
    '<button class="pj-btn pj-btn-sm" type="button" id="capNote">📝 Note</button>' +
    '<span class="cap-prog" id="capProg" role="status"></span></div>' +
    '<input type="file" id="capPhotoIn" accept="image/*" capture="environment" multiple hidden>' +
    '<input type="file" id="capVideoIn" accept="video/*" capture="environment" hidden>';
}

/** A name typed by a person (a file, a sub-folder) as this person may see it: amounts masked
    without the prices switch, as Desktop 2's file browser does (display_name -> redact_money). */
function shownName(ctx, name) { return ctx.mask(String(name == null ? "" : name)); }

function listHtml(ctx) {
  const esc = ctx.esc;
  const cloudOnly = odListing();
  const items = cloudOnly ? st.items.filter(function (f) { return f.cloud; }) : st.items;
  let at = listAt(items, st.path);
  if (cloudOnly && st.path.length && !at.folders.length && !at.files.length) {   // a folder of OneDrive rows only
    st.path = [];
    at = listAt(items, st.path);
  }
  const cr = crumbs(st.path).map(function (c, i, all) {
    const n = i < 2 ? c.name : shownName(ctx, c.name);          // the top folder's label is ours, sub-folders are typed
    return i === all.length - 1 ? "<b>" + esc(n) + "</b>" : '<a href="#" data-crumb="' + i + '">' + esc(n) + "</a>";
  }).join(' <span class="pj-sep">/</span> ');
  const rows = at.folders.map(function (f) {
    return '<div class="pj-file" data-path="' + esc(JSON.stringify(f.path)) + '" role="button" tabindex="0">' +
      "<span>" + (f.icon || "📁") + "</span><span>" + esc(f.path.length > 1 ? shownName(ctx, f.name) : f.name) + '</span><span class="meta">' + f.count + " file" + (f.count === 1 ? "" : "s") + "</span></div>";
  }).concat(at.files.map(function (f) {
    const where = f.cloud ? CLOUD_LABEL : LOCAL_LABEL;
    const name = shownName(ctx, f.name);
    return '<div class="pj-file' + (f.cloud ? "" : " local") + '" data-fid="' + esc(f.id) + '"' + (f.cloud ? ' role="button" tabindex="0"' : "") +
      ' title="' + esc(f.cloud ? "Open " + name : name + " — on the office computers (OneDrive project folder); open it there") + '">' +
      "<span>" + fileIcon(f) + '</span><span class="pj-fname">' + esc(name) +
        (f.description ? '<span class="pj-fdesc">' + esc(ctx.mask(f.description)) + "</span>" : "") + "</span>" +
      '<span class="meta">' + esc([fmtSize(f.size), fmtDay(f.modifiedTime), f.versionNo > 1 ? "v" + f.versionNo : ""].filter(Boolean).join(" · ")) +
        '<span class="pj-where' + (f.cloud ? " cloud" : "") + '">' + esc(where) + "</span></span>" +
      (f.cloud ? '<button class="pj-dl" type="button" data-dl="' + esc(f.id) + '" title="Download ' + esc(name) + '" aria-label="Download ' + esc(name) + '">⬇</button>' : "") +
      "</div>";
  }));
  const empty = !st.path.length
    ? '<div class="pj-empty">' + (cloudOnly ? "Nothing stored in DCR yet." : "No files yet.") +
      (ctx.canFiles ? " Use the buttons above to add photos, videos and notes." : "") + "</div>"
    : '<div class="pj-empty">Empty folder.</div>';
  const note = cloudOnly
    ? esc(CLOUD_LABEL) + ": photos, videos and notes from the buttons above, journal photos — they open here."
    : esc(CLOUD_LABEL) + ": opens here. " + esc(LOCAL_LABEL) +
      ": floor plans, photos and documents kept in the project's OneDrive folder — open them on an office PC." +
      (st.odOn && st.od && st.od.state === "down" ? " (The OneDrive folder above cannot be read just now: the files the project's list knows from it are listed here by name.)" : "");
  return '<div class="pj-crumb">' + cr + "</div>" + '<div class="pj-tblwrap">' + (rows.join("") || empty) + "</div>" +
    '<div class="pj-sub" style="margin-top:8px">' + note + "</div>";
}

function paint() {
  const ctx = st.ctx;
  const box = st.host.querySelector("#flList");
  if (box) box.innerHTML = listHtml(ctx);
}

async function load() {
  const ctx = st.ctx;
  const my = ++st.seq;
  try {
    const items = await filesRepo.listCurrent(ctx.pid);
    if (my !== st.seq) return;
    st.items = items;
    paint();
    paintOd();
  } catch (e) {
    if (my !== st.seq) return;
    const box = st.host.querySelector("#flList");
    if (box) box.innerHTML = '<div class="pj-empty">' + ctx.esc(ctx.errorText(e)) + "</div>";
  }
}

async function openFile(id, download) {
  const ctx = st.ctx;
  const f = st.items.find(function (x) { return String(x.id) === String(id); });
  if (!f || !f.cloud || !f.storagePath) return;
  const w = download ? null : window.open("", "_blank");
  try {
    const url = await filesRepo.signedUrl(f.storagePath, SIGNED_DOC_S);
    if (!url) throw new Error("No link for this file.");
    if (download) {
      const a = document.createElement("a");
      a.href = url + (url.indexOf("?") === -1 ? "?" : "&") + "download=" + encodeURIComponent(shownName(ctx, f.name));
      a.rel = "noopener";
      document.body.appendChild(a); a.click(); a.remove();
    } else if (w) w.location.href = url;
    else location.href = url;
  } catch (e) {
    if (w) w.close();
    ctx.toast(ctx.errorText(e), "error");
  }
}

/* ── the OneDrive project folder ────────────────────────────────────── */
const OD_RELIST_MS = 800;          // after an upload of one's own
const OD_LIVE_MS = 5000;           // after someone else's local row changed (each re-list is Graph calls: never per keystroke)

function viewer() { return OD.viewerOf(st.ctx.me); }

function odShellHtml(ctx) {
  const test = onedrive.selfTestFor(ctx.me, ctx.project)
    ? '<button class="pj-btn pj-btn-sm" type="button" id="odSelfTest" title="The OneDrive connection end to end, on this test project only">🧪 OneDrive self-test</button>' : "";
  return '<section class="od-box" id="odBox" aria-label="OneDrive project folder">' +
    '<div class="od-top"><span class="od-title">☁️ OneDrive project folder</span>' +
      '<span class="pj-sub od-sub">the same folder the office computers have</span>' +
      '<button class="pj-btn pj-btn-sm" type="button" id="odRefresh" title="Read the folder again" aria-label="Read the OneDrive folder again">↻</button>' + test + "</div>" +
    '<div id="odBar"></div><div id="odJobs" class="od-jobs" role="status" aria-live="polite"></div>' +
    '<div id="odList"><div class="pj-empty">Loading the OneDrive folder…</div></div>' +
    '<input type="file" id="odIn" multiple hidden></section><div id="odTest"></div>';
}

/** The OneDrive part lists the project's OneDrive files itself: the cloud box then lists cloud rows only. */
function odListing() { return st.odOn && st.od && st.od.state !== "down"; }

function odBarHtml(ctx) {
  const od = st.od;
  if (!od.canUpload || (od.state !== "ok" && od.state !== "none")) return "";
  const esc = ctx.esc;
  const choices = OD.targetChoices(od.path);
  const want = choices.some(function (c) { return c.value === od.target; }) ? od.target : OD.defaultTarget(od.path);
  od.target = want;
  const opts = choices.map(function (c) {
    return '<option value="' + esc(c.value) + '"' + (c.value === want ? " selected" : "") + ">" + esc(shownName(ctx, c.label)) + "</option>";
  }).join("");
  const where = OD.isOldCopy(od.path) ? "The old portal's copy is read only: files go to the folder chosen here."
    : od.path.length && OD.sameName(od.path[0], "Photos") ? "Photos and videos: the 📷 and 🎬 buttons above (kept in DCR). Files picked here go to the folder chosen."
    : "PDFs, pictures, videos, Office, text and CAD files; or drop them on this box.";
  return '<div class="od-bar"><button class="pj-btn pj-btn-sm pj-btn-primary" type="button" id="odAdd">⬆ Add files</button>' +
    '<label class="od-to">to <select id="odTo" aria-label="The OneDrive folder the files go to">' + opts + "</select></label>" +
    '<span class="pj-sub od-hint">' + esc(where) + "</span></div>";
}

function jobText(j) {
  switch (j.state) {
    case "waiting": return "Waiting";
    case "starting": return "Starting…";
    case "sending": return "Uploading " + j.pct + "%";
    case "finishing": return "Checking…";
    case "done": return j.result && j.result.recorded === false ? "✓ In OneDrive (not in the file list)" : "✓ Added";
    case "cancelled": return "Stopped";
    case "refused": return j.error;
    default: return j.error || "Could not upload";
  }
}

function paintJobs() {
  const box = document.getElementById("odJobs");
  if (!box || !st.od) return;
  const ctx = st.ctx, esc = ctx.esc;
  const jobs = st.od.refused.concat(st.up ? st.up.list() : []);
  box.innerHTML = jobs.map(function (j) {
    const busy = ["waiting", "starting", "sending", "finishing"].indexOf(j.state) !== -1;
    const bad = j.state === "failed" || j.state === "refused";
    return '<div class="od-job' + (bad ? " err" : j.state === "done" ? " ok" : "") + '">' +
      '<span class="od-jname">' + esc(shownName(ctx, j.result && j.result.name ? j.result.name : j.name)) +
        ' <span class="pj-sep">→</span> ' + esc(shownName(ctx, j.label || j.folder || "")) + "</span>" +
      (busy ? '<span class="od-jbar" aria-hidden="true"><i style="width:' + j.pct + '%"></i></span>' : "") +
      '<span class="od-jstate">' + esc(jobText(j)) + "</span>" +
      (j.canRetry ? '<button class="pj-btn pj-btn-sm" type="button" data-odretry="' + esc(j.id) + '">↻ Retry</button>' : "") +
      '<button class="pj-btn pj-btn-sm" type="button" data-odx="' + esc(j.id) + '" title="' + (busy ? "Stop this upload" : "Take it off the list") + '" aria-label="' +
        (busy ? "Stop the upload of " : "Take off the list ") + esc(shownName(ctx, j.name)) + '">✕</button></div>';
  }).join("");
}

function odListHtml(ctx) {
  const od = st.od, esc = ctx.esc;
  if (od.state === "loading") return '<div class="pj-empty">Loading the OneDrive folder…</div>';
  if (od.state === "down") {
    return '<div class="pj-empty">' + esc(od.message || "The OneDrive folder cannot be read just now.") +
      ' <button class="pj-btn pj-btn-sm" type="button" data-odagain="1">↻ Try again</button></div>';
  }
  if (od.state === "none") {
    let h = '<div class="pj-empty">No OneDrive folder for this project yet.';
    if (od.other) h += "<br>" + esc(od.other);
    else if (od.canMakeFolder) h += ' <button class="pj-btn pj-btn-sm" type="button" id="odMake">📁 Make the folder (Floor Plans, Photos, Documents)</button>';
    if (od.canUpload && !od.other) h += '<br><span class="pj-sub">Adding a file makes it too.</span>';
    return h + "</div>";
  }
  const v = viewer();
  const cr = OD.crumbs(od.path).map(function (c, i, all) {
    const n = i === 0 ? c.name : shownName(ctx, c.name);
    return i === all.length - 1 ? "<b>" + esc(n) + "</b>" : '<a href="#" data-odcrumb="' + i + '">' + esc(n) + "</a>";
  }).join(' <span class="pj-sep">/</span> ');
  const shown = OD.mergeLocal(od.entries.filter(function (e) { return !OD.nameHidden(e.name, v); }), st.items, od.path);
  const rows = shown.map(function (e) {
    const name = shownName(ctx, e.name);
    if (e.folder) {
      const old = OD.isOldCopy(od.path.concat([e.name]));
      const meta = e.children != null ? e.children + " item" + (e.children === 1 ? "" : "s") : "";
      return '<div class="pj-file od-row" data-odpath="' + esc(JSON.stringify(od.path.concat([e.name]))) + '" role="button" tabindex="0">' +
        "<span>" + OD.folderIcon(od.path, e.name) + '</span><span class="pj-fname">' + esc(name) +
          (old ? '<span class="pj-fdesc">read only (the old portal\'s copy)</span>' : "") + "</span>" +
        '<span class="meta">' + esc(meta) + "</span></div>";
    }
    const open = OD.downloadable(e.name);
    const busy = od.opening === e.id;
    return '<div class="pj-file od-row' + (open ? "" : " local") + '" data-odid="' + esc(e.id) + '"' + (open ? ' role="button" tabindex="0"' : "") +
      ' title="' + esc(open ? "Open " + name : name + " — programs and shortcuts are not opened from the portal") + '">' +
      "<span>" + OD.fileIconOf(e.name) + '</span><span class="pj-fname">' + esc(name) +
        (e.caption ? '<span class="pj-fdesc">' + esc(ctx.mask(e.caption)) + "</span>" : "") + "</span>" +
      '<span class="meta">' + esc(busy ? "Opening…" : [fmtSize(e.size), fmtDay(e.modified), e.versionNo > 1 ? "v" + e.versionNo : ""].filter(Boolean).join(" · ")) +
        '<span class="pj-where od">OneDrive</span></span>' +
      (open ? '<button class="pj-dl" type="button" data-oddl="' + esc(e.id) + '" title="Download ' + esc(name) + '" aria-label="Download ' + esc(name) + '">⬇</button>' : "") +
      "</div>";
  });
  const empty = '<div class="pj-empty">' + (od.path.length ? "Empty folder." : "The folder is empty.") + "</div>";
  return '<div class="pj-crumb">' + cr + "</div>" + '<div class="pj-tblwrap od-drop">' + (rows.join("") || empty) + "</div>" +
    (od.next ? '<div class="pj-row"><button class="pj-btn pj-btn-sm" type="button" id="odMore">Show more</button></div>' : "");
}

function paintOd() {
  if (!st.odOn || !st.od) return;
  const ctx = st.ctx;
  // drawn again only when it changed (a cloud read repaints too: an open "to" list or a row being pressed stays put)
  const put = function (node, html) { if (node && node._odHtml !== html) { node.innerHTML = html; node._odHtml = html; } };
  put(document.getElementById("odList"), odListHtml(ctx));
  put(document.getElementById("odBar"), odBarHtml(ctx));
  const inp = document.getElementById("odIn");
  if (inp) inp.setAttribute("accept", OD.acceptFor(viewer()));
  paintJobs();
}

/** Read the folder open now (more: the next page of it). */
async function loadOd(more) {
  const ctx = st.ctx, od = st.od;
  const my = ++od.seq;
  if (!more && od.state !== "ok") { od.state = "loading"; paintOd(); }
  try {
    const page = await onedrive.list(ctx.pid, od.path, more ? od.next : null);
    if (my !== od.seq) return;
    od.canUpload = page.canUpload;
    od.canMakeFolder = page.canMakeFolder;
    if (!page.folderExists) {
      od.state = "none"; od.entries = []; od.next = null; od.path = [];
    } else {
      od.state = "ok"; od.other = "";
      od.entries = more ? od.entries.concat(page.entries) : page.entries;
      od.next = page.next;
    }
    od.listedAt = Date.now();
  } catch (e) {
    if (my !== od.seq) return;
    const code = String((e && e.code) || "");
    if (code === "not_found" && od.path.length) {              // moved, renamed or hidden meanwhile: back to the top
      od.path = []; od.next = null;
      ctx.toast("That folder is not in OneDrive any more.", "error");
      loadOd(false);
      return;
    }
    if (code === "invalid" && e.field === "cursor") { od.next = null; loadOd(false); return; }   // the list's page ran out
    od.state = "down"; od.code = code; od.message = e && e.message ? e.message : "";
  }
  paintOd();
  paint();                                                     // the cloud box: with or without the OneDrive rows
}

function odGo(path) {
  st.od.path = path;
  st.od.target = "";                     // the "to" choice follows the folder opened (the folder itself, when files may go there)
  st.od.next = null;
  st.od.entries = [];
  st.od.state = "loading";
  loadOd(false);
}

/** A link made for this click, opened at once (a file download; the page stays), kept nowhere. */
async function odOpen(id) {
  const ctx = st.ctx, od = st.od;
  const e = od.entries.find(function (x) { return x.id === id; });
  if (!e || e.folder || !OD.downloadable(e.name) || od.opening) return;
  od.opening = id;
  paintOd();
  try {
    const link = await onedrive.download(ctx.pid, id);
    const a = document.createElement("a");
    a.href = link.url;
    a.rel = "noopener noreferrer";
    if (/^blob:/.test(link.url)) a.download = link.name || e.name;   // the local demo's own file
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (err) {
    ctx.toast(err && err.message ? err.message : "That file could not be opened.", "error");
  }
  od.opening = null;
  paintOd();
}

async function odMake() {
  const ctx = st.ctx, od = st.od;
  const b = document.getElementById("odMake");
  if (b) { b.disabled = true; b.textContent = "Making the folder…"; }
  const r = await onedrive.ensureFolder(ctx.pid);
  if (r.state === "made" || r.state === "exists") {
    ctx.toast("✓ The project's OneDrive folder is there (Floor Plans, Photos, Documents)", "ok");
    odGo([]);
    return;
  }
  if (r.state === "other_folder") {
    od.other = r.message + (r.folders && r.folders.length ? " Found: " + r.folders.join("; ") + "." : "");
    paintOd();
    return;
  }
  ctx.toast(r.message || "OneDrive could not make the folder just now.", "error");
  paintOd();
}

function targetNow() {
  const od = st.od;
  const sel = document.getElementById("odTo");
  const value = sel ? sel.value : od.target;
  const c = OD.targetChoices(od.path).find(function (x) { return x.value === value; }) || { folder: "Documents", relDir: "", label: "Documents" };
  return c;
}

/** Files picked or dropped: each checked here first (the broker checks again), then queued in this page. */
function odAddFiles(files) {
  const ctx = st.ctx, od = st.od;
  if (!od || !od.canUpload) return;
  const to = targetNow();
  const v = viewer();
  Array.prototype.slice.call(files || []).forEach(function (f) {
    if (!f) return;
    const name = OD.nfc(f.name || "");
    const problem = OD.sessionProblem({ folder: to.folder, relDir: to.relDir, name: name, size: f.size, viewer: v,
      folderName: ctx.project && ctx.project.folderName, maxBytes: od.maxBytes });
    if (problem) {
      od.refused.push({ id: "r" + (++od.rseq), name: name, label: to.label, folder: to.folder, state: "refused", error: problem, pct: 0, canRetry: false });
      return;
    }
    ensureUploader().add({ projectId: ctx.pid, file: f, folder: to.folder, relDir: to.relDir, name: name, label: to.label });
  });
  paintJobs();
}

function ensureUploader() {
  if (st.up) return st.up;
  const up = createUploader({
    send: xhrTransport(),
    broker: {
      session: function (j) { return onedrive.uploadSession({ projectId: j.projectId, folder: j.folder, relDir: j.relDir, name: j.name, size: j.size, modified: j.modified }); },
      done: function (j, itemId, ticket) { return onedrive.uploadDone(j.projectId, itemId, ticket); },
      find: function (j) { return onedrive.findFile(j.projectId, [j.folder].concat(j.relDir ? j.relDir.split("/") : []), j.target || j.name, j.size); },
    },
  });
  up.onChange(function (items, evt) {
    paintJobs();
    if (!evt || evt.type !== "done" || !evt.job) return;
    const r = evt.job.result || {};
    const label = shownName(st.ctx, evt.job.label || evt.job.folder || "");
    const name = shownName(st.ctx, r.name || evt.job.name);
    if (r.recorded === false) st.ctx.toast(r.message || "Saved in OneDrive (not added to the project's file list).", "ok");
    else st.ctx.toast("✓ " + name + " added to " + label + (r.renamed ? " (OneDrive renamed it: a file of that name was there)" : ""), "ok");
    clearTimeout(st.od.relist);
    st.od.relist = setTimeout(function () { loadOd(false); }, OD_RELIST_MS);
  });
  if (typeof window !== "undefined") {
    // an upload lives in this page only: leaving it stops the upload (nothing was kept on the device)
    window.addEventListener("beforeunload", function (e) {
      if (st.up && st.up.active()) { e.preventDefault(); e.returnValue = ""; }
    });
    window.addEventListener("online", function () { if (st.up) st.up.wake(); });
  }
  st.up = up;
  return up;
}

function odSelfTest() {
  const ctx = st.ctx;
  const box = document.getElementById("odTest");
  if (!box || !onedrive.selfTestFor(ctx.me, ctx.project)) return;
  box.innerHTML = '<div class="pj-empty">Loading the self-test…</div>';
  import("./onedrive-selftest.js").then(function (m) { return m.run(ctx, box); }).then(function () { odGo(st.od.path); }, function (e) {
    box.innerHTML = '<div class="pj-empty">' + ctx.esc(ctx.errorText(e)) + "</div>";
  });
}

function wireOd(host) {
  const ctx = st.ctx;
  host.addEventListener("click", function (e) {
    const t = e.target;
    if (!t.closest || !t.closest("#odBox")) return;
    const crumb = t.closest("[data-odcrumb]");
    if (crumb) { e.preventDefault(); odGo(OD.crumbs(st.od.path)[Number(crumb.getAttribute("data-odcrumb"))].path); return; }
    if (t.closest("#odRefresh") || t.closest("[data-odagain]")) { loadOd(false); return; }
    if (t.closest("#odSelfTest")) { odSelfTest(); return; }
    if (t.closest("#odMake")) { odMake(); return; }
    if (t.closest("#odMore")) { loadOd(true); return; }
    if (t.closest("#odAdd")) { const inp = document.getElementById("odIn"); inp.value = ""; inp.click(); return; }
    const x = t.closest("[data-odx]");
    if (x) {
      const id = x.getAttribute("data-odx");
      const i = st.od.refused.findIndex(function (r) { return r.id === id; });
      if (i !== -1) { st.od.refused.splice(i, 1); paintJobs(); }
      else if (st.up) st.up.remove(id);
      return;
    }
    const rt = t.closest("[data-odretry]");
    if (rt) { if (st.up) st.up.retry(rt.getAttribute("data-odretry")); return; }
    const dl = t.closest("[data-oddl]");
    if (dl) { odOpen(dl.getAttribute("data-oddl")); return; }
    const row = t.closest(".od-row");
    if (!row) return;
    if (row.hasAttribute("data-odpath")) { odGo(JSON.parse(row.getAttribute("data-odpath"))); return; }
    if (row.hasAttribute("data-odid") && !row.classList.contains("local")) odOpen(row.getAttribute("data-odid"));
  });
  host.addEventListener("change", function (e) {
    if (e.target && e.target.id === "odTo") st.od.target = e.target.value;
    if (e.target && e.target.id === "odIn") odAddFiles(e.target.files);
  });
  const box = document.getElementById("odBox");
  box.addEventListener("dragover", function (e) {
    if (!st.od.canUpload) return;
    e.preventDefault();
    box.classList.add("over");
  });
  box.addEventListener("dragleave", function (e) { if (!box.contains(e.relatedTarget)) box.classList.remove("over"); });
  box.addEventListener("drop", function (e) {
    box.classList.remove("over");
    if (!st.od.canUpload) return;
    e.preventDefault();
    const dt = e.dataTransfer;
    const items = dt && dt.items ? Array.prototype.slice.call(dt.items) : [];
    const folder = items.some(function (it) {
      const en = it && typeof it.webkitGetAsEntry === "function" ? it.webkitGetAsEntry() : null;
      return !!(en && en.isDirectory);
    });
    if (folder) ctx.toast(OD.MESSAGES.folder, "error");
    const files = Array.prototype.slice.call((dt && dt.files) || []).filter(function (f, i) {
      const it = items[i];
      const en = it && typeof it.webkitGetAsEntry === "function" ? it.webkitGetAsEntry() : null;
      return !(en && en.isDirectory);
    });
    odAddFiles(files);
  });
}

function startOd(host) {
  st.od = { path: [], entries: [], next: null, state: "loading", code: "", message: "", canUpload: false, canMakeFolder: false,
    target: "", opening: null, seq: 0, refused: [], rseq: 0, other: "", listedAt: 0, relist: null, live: null, maxBytes: OD.MAX_UPLOAD_BYTES };
  wireOd(host);
  loadOd(false);
}

/* ── capture ────────────────────────────────────────────────────────── */
function prog(text) { const p = document.getElementById("capProg"); if (p) p.textContent = text || ""; }

function paintProgress() {
  const s = uploads.summaryOf(st.progress, st.ctx.pid);
  const p = document.getElementById("capProg");
  if (!p) return;
  if (!s.total) { if (st.landed) { p.textContent = "✓ " + st.landed + " saved"; st.landed = 0; } return; }
  const pending = s.total - s.failed;
  p.innerHTML = "";
  p.textContent = (pending ? (navigator.onLine === false ? "No signal — " + pending + " file" + (pending === 1 ? "" : "s") + " kept on this device"
    : "Uploading " + pending + " file" + (pending === 1 ? "" : "s") + "…") : "") +
    (s.failed ? (pending ? " · " : "") + s.failed + " could not upload " : "");
  if (s.failed) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "pj-btn pj-btn-sm"; b.textContent = "↻ Retry";
    b.addEventListener("click", function () { uploads.retryAll(); });
    p.appendChild(b);
  }
}

async function addFiles(files, kind) {
  const ctx = st.ctx;
  const arr = Array.prototype.slice.call(files || []).filter(function (f) { return f && f.size; });
  if (!arr.length) return;
  let ok = 0;
  for (let i = 0; i < arr.length; i++) {
    const f = arr[i];
    const k = kind || (uploads.isVideoFile(f) ? "video" : "photo");
    const when = new Date();
    try {
      await uploads.enqueue({ projectId: ctx.pid, file: f, kind: k, takenAt: when });
      ok++;
    } catch (e) { ctx.toast(ctx.errorText(e), "error"); }
  }
  if (ok) prog(ok + " file" + (ok === 1 ? "" : "s") + " saved on this device — uploading…");
}

async function saveNote(title, body) {
  const ctx = st.ctx;
  const when = new Date();
  const content = (title ? title + "\n" : "") + stamp(when).replace(/\./g, ":") + " (Pacific)\n\n" + body;
  const file = new File([content], "note.txt", { type: "text/plain" });
  await uploads.enqueue({ projectId: ctx.pid, file: file, kind: "note", takenAt: when,
    name: title ? uploads.noteName("Note", when, title, ".txt") : undefined });
}

function noteModal() {
  const ctx = st.ctx;
  const m = document.getElementById("noteModal");
  document.getElementById("noteTitle").value = "";
  document.getElementById("noteBody").value = "";
  document.getElementById("noteMsg").textContent = "";
  m.classList.add("open");
  document.getElementById("noteBody").focus();
}

/* voice notes: Start → live transcript where the browser has one → Stop → review (editable) →
   Save queues the audio, and the reviewed transcript as a .txt beside it, into Site Notes. */
function recOpen() {
  const r = st.rec = { phase: "idle", tx: "", interim: "", chunks: [], blob: null, mime: "", sr: null, mr: null, stream: null, timer: null, t0: 0 };
  const supported = window.SpeechRecognition || window.webkitSpeechRecognition;
  const ta = document.getElementById("recTranscript");
  ta.value = ""; ta.readOnly = true;
  document.getElementById("recHint").textContent = supported ? "" :
    "Live transcription isn't available on this device — the audio still saves; you can type the transcript after stopping.";
  document.getElementById("recTimer").textContent = "0:00";
  document.getElementById("recState").textContent = "Ready to record";
  document.getElementById("recMsg").textContent = "";
  const b = document.getElementById("recBtn");
  b.textContent = "● Start recording"; b.disabled = false;
  document.getElementById("recModal").classList.add("open");
  return r;
}

async function recToggle() {
  const r = st.rec;
  if (!r) return;
  const $ = function (id) { return document.getElementById(id); };
  if (r.phase === "review") { recSave(); return; }
  if (r.phase === "rec") {
    clearInterval(r.timer);
    if (r.sr) { try { r.sr.onend = null; r.sr.stop(); } catch (e) { /* */ } }
    const full = (r.tx + " " + r.interim).replace(/\s+/g, " ").trim();
    $("recTranscript").value = full;
    $("recTranscript").readOnly = false;
    $("recTranscript").placeholder = "No transcript was captured — you can type one here before saving.";
    $("recState").textContent = "Review — check the transcript, then Save";
    $("recHint").textContent = "The transcript is saved as a .txt next to the audio in Site Notes.";
    $("recBtn").textContent = "⬆ Save";
    r.phase = "review";
    try { r.mr.stop(); } catch (e) { /* */ }
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    r.sr = new SR();
    r.sr.continuous = true; r.sr.interimResults = true; r.sr.lang = navigator.language || "en-US";
    r.sr.onresult = function (ev) {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) r.tx += ev.results[i][0].transcript + " ";
        else interim += ev.results[i][0].transcript;
      }
      r.interim = interim;
      $("recTranscript").value = (r.tx + " " + interim).replace(/\s+/g, " ").trim();
    };
    r.sr.onend = function () { if (r.phase === "rec") { try { r.sr.start(); } catch (e) { /* */ } } };
    try { r.sr.start(); } catch (e) { /* */ }
    await new Promise(function (res) { setTimeout(res, 350); });   // the recognizer first (Android)
  }
  try { r.stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) {
    if (r.sr) { try { r.sr.onend = null; r.sr.stop(); } catch (x) { /* */ } }
    $("recMsg").textContent = "Microphone access was denied.";
    return;
  }
  const MR = window.MediaRecorder;
  const mime = MR && MR.isTypeSupported && MR.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus"
    : MR && MR.isTypeSupported && MR.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
  r.mime = mime || "audio/webm";
  r.mr = mime ? new MR(r.stream, { mimeType: mime }) : new MR(r.stream);
  r.mr.ondataavailable = function (e) { if (e.data && e.data.size) r.chunks.push(e.data); };
  r.mr.onstop = function () {
    if (r.stream) r.stream.getTracks().forEach(function (t) { t.stop(); });
    r.blob = new Blob(r.chunks, { type: (r.mr && r.mr.mimeType) || r.mime });
  };
  r.mr.start();
  r.phase = "rec"; r.t0 = Date.now();
  r.timer = setInterval(function () {
    const s = Math.floor((Date.now() - r.t0) / 1000);
    $("recTimer").textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }, 500);
  $("recState").textContent = "Recording…";
  $("recBtn").textContent = "■ Stop";
}

async function recSave() {
  const ctx = st.ctx, r = st.rec;
  const $ = function (id) { return document.getElementById(id); };
  for (let w = 0; w < 20 && !r.blob; w++) await new Promise(function (res) { setTimeout(res, 100); });
  if (!r.blob || !r.blob.size) { $("recMsg").textContent = "No audio was captured."; return; }
  const type = r.blob.type || r.mime;
  const ext = type.indexOf("mp4") !== -1 ? ".m4a" : ".webm";
  const when = new Date();
  const name = uploads.noteName("Voice note", when, "", ext);
  $("recBtn").disabled = true;
  $("recState").textContent = "Saving…";
  try {
    await uploads.enqueue({ projectId: ctx.pid, file: new File([r.blob], "voice" + ext, { type: type }), kind: "voice", takenAt: when, name: name });
    const txt = $("recTranscript").value.trim();
    if (txt && $("recSaveTx").checked) {
      const base = name.replace(/\.[^.]+$/, "");
      await uploads.enqueue({ projectId: ctx.pid, kind: "note", takenAt: when, name: base + " - transcript.txt",
        file: new File(["Voice note transcript — " + base + "\n\n" + txt], "transcript.txt", { type: "text/plain" }) });
    }
    r.phase = "idle";
    $("recModal").classList.remove("open");
    prog("✓ Voice note saved on this device — uploading to Site Notes");
  } catch (e) {
    $("recMsg").textContent = ctx.errorText(e);
    $("recBtn").disabled = false;
    $("recBtn").textContent = "⬆ Save";
    $("recState").textContent = "Review — check the transcript, then Save";
  }
}

function recCancel() {
  const r = st.rec;
  if (r) {
    clearInterval(r.timer);
    if (r.sr) { try { r.sr.onend = null; r.sr.stop(); } catch (e) { /* */ } }
    if (r.mr && r.mr.state === "recording") { r.mr.onstop = null; try { r.mr.stop(); } catch (e) { /* */ } }
    if (r.stream) r.stream.getTracks().forEach(function (t) { t.stop(); });
  }
  st.rec = null;
  document.getElementById("recModal").classList.remove("open");
}

let wiredOnce = false;
function wireModals() {
  if (wiredOnce) return;
  wiredOnce = true;
  const ctx = st.ctx;
  const $ = function (id) { return document.getElementById(id); };
  $("noteCancel").addEventListener("click", function () { $("noteModal").classList.remove("open"); });
  $("noteSave").addEventListener("click", async function () {
    const body = $("noteBody").value.trim();
    if (!body) { $("noteMsg").textContent = "Write something first."; return; }
    $("noteSave").disabled = true;
    try {
      await saveNote($("noteTitle").value.trim(), body);
      $("noteModal").classList.remove("open");
      prog("✓ Note saved on this device — uploading to Site Notes");
    } catch (e) { $("noteMsg").textContent = ctx.errorText(e); }
    $("noteSave").disabled = false;
  });
  $("recBtn").addEventListener("click", recToggle);
  $("recCancel").addEventListener("click", recCancel);
}

export function render(ctx, host) {
  st.host = host; st.ctx = ctx;
  st.odOn = onedrive.shownFor(ctx.me, ctx.project);
  host.innerHTML = capBarHtml(ctx) + (st.odOn ? odShellHtml(ctx) : "") +
    '<div id="flBox">' + (st.odOn ? '<div class="od-top"><span class="od-title">🗂️ ' + ctx.esc(CLOUD_LABEL) + "</span></div>" : "") +
    '<div id="flList"><div class="pj-empty">Loading files…</div></div></div>';
  host.addEventListener("click", function (e) {
    const t = e.target;
    if (t.closest && (t.closest("#odBox") || t.closest("#odTest"))) return;      // the OneDrive part's own (wireOd)
    const crumb = t.closest && t.closest("[data-crumb]");
    if (crumb) { e.preventDefault(); st.path = crumbs(st.path)[Number(crumb.getAttribute("data-crumb"))].path; paint(); return; }
    const dl = t.closest && t.closest("[data-dl]");
    if (dl) { e.stopPropagation(); openFile(dl.getAttribute("data-dl"), true); return; }
    const row = t.closest && t.closest(".pj-file");
    if (!row) return;
    if (row.hasAttribute("data-path")) { st.path = JSON.parse(row.getAttribute("data-path")); paint(); return; }
    if (row.hasAttribute("data-fid") && !row.classList.contains("local")) openFile(row.getAttribute("data-fid"), false);
  });
  host.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    const row = e.target.closest && e.target.closest(".pj-file");
    if (row) row.click();
  });
  if (ctx.canFiles) {
    wireModals();
    const $ = function (id) { return document.getElementById(id); };
    $("capPhoto").addEventListener("click", function () { $("capPhotoIn").value = ""; $("capPhotoIn").click(); });
    $("capVideo").addEventListener("click", function () { $("capVideoIn").value = ""; $("capVideoIn").click(); });
    $("capVoice").addEventListener("click", recOpen);
    $("capNote").addEventListener("click", noteModal);
    $("capPhotoIn").addEventListener("change", function () { addFiles(this.files, "photo"); });
    $("capVideoIn").addEventListener("change", function () { addFiles(this.files, "video"); });
    uploads.onProgress(function (items, evt) {
      st.progress = items;
      if (evt && evt.type === "done" && evt.item && String(evt.item.projectId) === String(ctx.pid)) {
        st.landed = (st.landed || 0) + 1;
        reload(ctx);
      }
      paintProgress();
    });
  }
  const want = new URLSearchParams(location.search).get("folder");
  if (want && folderLabel(want) !== want) st.path = [want];
  if (st.odOn) startOd(host);
  load();
}

/** A change to the project's files (live): the cloud box reads again; the OneDrive box only for a OneDrive file's row
    (storage local - another office PC, another upload), later, and not right after it read the folder itself. */
export function reload(ctx, evt) {
  if (!st.host) return;
  clearTimeout(st.timer);
  st.timer = setTimeout(load, 500);
  const row = evt && (evt.new || evt.old);
  const od = st.od;
  if (!st.odOn || !od || od.state !== "ok" || !row || row.storage !== "local") return;
  clearTimeout(od.live);
  od.live = setTimeout(function () { if (Date.now() - od.listedAt > OD_LIVE_MS) loadOd(false); }, OD_LIVE_MS);
}
