/* Project tab Files + the capture bar (MODULES §3 "Files + capture bar", Redesign; BLUEPRINT 2.2.5).

   The list is current_files (the newest live version of each file) as a folder browser:
   Floor Plans, Photos, Documents, Journal photos … then their sub-folders. A cloud row ("Stored in
   DCR") opens through a signed URL (120 s); a local row lives in the OneDrive project folder on the
   office PCs and is listed by name and date, labelled "On the office computers". Receipts and the
   priced folders never reach people without the switch (database rule). Photos placed straight into
   OneDrive (not through Desktop 2) have no row and are not listed.

   Capture bar (everyone who may add files: not view-only accounts): 📷 photos, 🎬 video,
   🎙 voice note (with live transcription where the browser has it), 📝 text note. Everything goes
   through the upload queue: photos and videos into photos/<the day>, voice and text notes into
   documents/Site Notes. Each file gets a unique name (IMG 2026-10-19 14.30.12-2.jpg). */

import * as filesRepo from "../repo/files.js";
import { listAt, crumbs, fmtSize, fileIcon, LOCAL_LABEL, CLOUD_LABEL, SIGNED_DOC_S, folderLabel } from "../map/files.js";
import { fmtDay, stamp } from "../map/pacific.js";
import * as uploads from "./uploads.js";

const st = { host: null, ctx: null, items: [], path: [], seq: 0, timer: null, progress: [], rec: null };

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
  const at = listAt(st.items, st.path);
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
    ? '<div class="pj-empty">No files yet.' + (ctx.canFiles ? " Use the buttons above to add photos, videos and notes." : "") + "</div>"
    : '<div class="pj-empty">Empty folder.</div>';
  return '<div class="pj-crumb">' + cr + "</div>" + '<div class="pj-tblwrap">' + (rows.join("") || empty) + "</div>" +
    '<div class="pj-sub" style="margin-top:8px">' + esc(CLOUD_LABEL) + ": opens here. " + esc(LOCAL_LABEL) +
      ": floor plans, photos and documents kept in the project's OneDrive folder — open them on an office PC.</div>";
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
  host.innerHTML = capBarHtml(ctx) + '<div id="flList"><div class="pj-empty">Loading files…</div></div>';
  host.addEventListener("click", function (e) {
    const t = e.target;
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
  load();
}

export function reload(ctx) {
  if (!st.host) return;
  clearTimeout(st.timer);
  st.timer = setTimeout(load, 500);
}
