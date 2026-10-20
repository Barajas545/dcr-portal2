/* Site Photos (port of the old capture.html / capture.js; MODULES §3 "capture.html").

   Flow: GPS finds the nearest open project -> confirm it (or search by address) -> shoot -> every file
   goes to that project's Photos / <the day> (YYYY-MM-DD, Desktop 2's layout; the old
   "YYYY-Week #NN" folders are gone) as a cloud file, which Desktop 2 shows under "Stored in DCR".

   Bytes: the upload queue (upload-queue2.js) keeps each file on the device before any network call
   and uploads it resumably (TUS); a photo taken with no signal is safe and goes up by itself. Every
   file gets a unique name ("IMG 2026-10-19 14.30.12-2.jpg": iPhones call every capture image.jpg,
   and the same name in the same folder would become a new VERSION of one photo).

   Project pins are learned, not configured (set_project_location, write-once in the database):
   standing on a site with a good fix (<= 100 m) pins that job; addresses are geocoded in the
   background through Nominatim (at most 40 a visit, about one a second, a city cache in
   localStorage dcr2CityGeo). Completed and closed jobs never compete to be "nearest". An import
   from the old portal nobody has changed yet (map/legacy.js dormant) is never pinned
   automatically: the pin would raise its version, and it would leave the Board's "Old portal" fold
   and Desktop 2's dormant rule with nobody having touched it (the database refuses it too).

   No signal: the jobs read last on this device (dcr2CaptureJobs:<profile>, only what this page
   draws — number, name, address, status, pin; no client names) are listed, so a job can be picked and photos taken
   and queued; they upload by themselves once there is a connection. */

import { boot, el, esc, errorText, confirmBox, store, qs } from "./shell.js";
import * as projectsRepo from "../repo/projects.js";
import * as filesRepo from "../repo/files.js";
import { projectTitle, addressLine } from "../map/projects.js";
import { rank, distanceOf, fmtMi, eligible, confidentTop, matches, coordsOf, distanceMi, pinRule, NEAR_MI } from "../map/geo.js";
import { ymd } from "../map/pacific.js";
import * as uploads from "./uploads.js";
import { startSweeper } from "./journal-sync.js";

const GEO_MAX_PER_VISIT = 40;
const GEO_GAP_MS = 1150;
const CITY_KEY = "dcr2CityGeo";
const JOBS_KEY = "dcr2CaptureJobs:";
// only what the job cards and the pin rules need (no client names or contact details on the phone)
const JOB_FIELDS = ["id", "internalIDNumber", "projectName", "projectAddress", "projectCity", "projectState",
  "status", "statusLabel", "lat", "lng", "locationSource", "projectCoordinates", "thumbnailFileId", "dormant", "legacySpId",
  "version", "projectDateLastModified"];

/** The jobs as this page needs them, kept for a start with no signal. */
function keepJobs(list) {
  const slim = list.map(function (p) {
    const o = {};
    JOB_FIELDS.forEach(function (k) { if (p[k] !== undefined) o[k] = p[k]; });
    return o;
  });
  store.set(JOBS_KEY + state.me.id, JSON.stringify({ at: new Date().toISOString(), jobs: slim }));
}
function keptJobs() {
  try {
    const v = JSON.parse(store.get(JOBS_KEY + state.me.id, "null"));
    return v && Array.isArray(v.jobs) ? v : null;
  } catch (e) { return null; }
}

const state = {
  me: null, all: [], pool: [], showAll: false, pos: null, project: null, day: ymd(new Date()),
  jobs: [], q: {}, seq: 0, geoRun: 0, wakeLock: null, thumbs: {},
};

function show(name) {
  ["stepPick", "stepConfirm", "stepShoot"].forEach(function (id) { el(id).classList.toggle("on", id === name); });
  window.scrollTo(0, 0);
}
function msg(id, kind, text) {
  const m = el(id);
  m.className = "cp-msg" + (kind ? " " + kind : "");
  m.textContent = text || "";
}
function byId(id) { return state.all.find(function (p) { return String(p.id) === String(id); }) || null; }

/* ── cards ──────────────────────────────────────────────────────────── */
function cardHtml(p, opts) {
  opts = opts || {};
  const d = distanceOf(p, state.pos);
  const bits = [];
  if (d != null) bits.push('<span class="cp-dist">' + esc(fmtMi(d)) + "</span>");
  bits.push('<span class="cp-stat">' + esc(p.statusLabel) + "</span>");
  const tag = opts.static ? "div" : "button";
  return "<" + tag + ' class="cp-card' + (opts.best ? " best" : "") + '"' + (opts.static ? "" : ' data-pick="' + esc(p.id) + '" type="button"') + ">" +
    '<span class="cp-thumb" data-thumb="' + esc(p.id) + '">🏠</span>' +
    '<span class="cp-info"><span class="cp-nm">' + esc(projectTitle(p)) + "</span>" +
      '<span class="cp-ad">' + esc(addressLine(p, ", ") || "No address on file") + "</span>" +
      '<span class="cp-meta">' + bits.join(" ") + "</span></span></" + tag + ">";
}

async function paintThumbs(scope) {
  const boxes = Array.prototype.slice.call(scope.querySelectorAll("[data-thumb]"));
  const want = boxes.map(function (b) { return byId(b.getAttribute("data-thumb")); }).filter(function (p) { return p && p.thumbnailFileId != null; });
  if (!want.length) return;
  let urls = {};
  try { urls = await filesRepo.thumbnailUrls(want); } catch (e) { return; }
  boxes.forEach(function (b) {
    const u = urls[b.getAttribute("data-thumb")];
    if (u && b.isConnected) b.innerHTML = '<img src="' + esc(u) + '" alt="">';
  });
}

/* ── step 1: pick ───────────────────────────────────────────────────── */
function renderPick() {
  const q = (el("pickSearch").value || "").trim().toLowerCase();
  const pool = state.showAll ? state.all : state.pool;
  const list = rank(pool.filter(function (p) { return matches(p, q); }), state.pos);
  const best = el("pickBest"), rest = el("pickList");
  if (confidentTop(list, state.pos, q)) {
    best.innerHTML = '<div class="cp-sub" style="margin:10px 0 6px"><b>Closest to you</b></div>' + cardHtml(list[0], { best: true });
    rest.innerHTML = list.slice(1, 40).map(function (p) { return cardHtml(p); }).join("");
  } else {
    best.innerHTML = "";
    rest.innerHTML = list.slice(0, 40).map(function (p) { return cardHtml(p); }).join("");
  }
  if (!list.length) {
    rest.innerHTML = '<div class="cp-note">No project matches “' + esc(q) + "”." +
      (state.showAll ? "" : " Closed and completed jobs are hidden — tap “Show all projects” to include them.") + "</div>";
  }
  paintThumbs(best); paintThumbs(rest);
  el("pickMore").textContent = state.showAll ? "Hide closed / completed" : "Show all projects";
  const located = pool.filter(function (p) { return !!coordsOf(p); }).length;
  el("pickSub").innerHTML = (state.offlineList
    ? "<b>No signal</b> — the jobs as of " + esc(new Date(state.offlineList).toLocaleString("en-US",
        { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })) +
      ". Photos are kept on this phone and upload by themselves when there is signal.<br>" : "") +
    (state.pos
      ? "Nearest first. " + located + " of " + pool.length + " jobs have a known location."
      : 'Search for the job below, or <a href="#" id="pickGpsLink">use my location</a>.');
  const lnk = el("pickGpsLink");
  if (lnk) lnk.addEventListener("click", function (e) { e.preventDefault(); locate(); });
}

function pickProject(p) {
  if (!p) return;
  state.project = p;
  state.day = ymd(new Date());
  const d = distanceOf(p, state.pos);
  el("confirmCard").innerHTML = cardHtml(p, { static: true });
  paintThumbs(el("confirmCard"));
  el("confirmWhere").innerHTML = "Files will be saved to <b>" + esc(projectTitle(p)) + "</b> → Photos → <b>" + esc(state.day) + "</b>" +
    (d == null ? "" : d < NEAR_MI ? "<br>You are at this job now." : "<br>" + esc(fmtMi(d)) + " from where you are now.");
  show("stepConfirm");
}

/* ── location ───────────────────────────────────────────────────────── */
function locate() {
  if (!navigator.geolocation) { msg("pickMsg", "err", "This device can't share its location — search for the job instead."); return; }
  el("pickMsg").className = "cp-msg";
  el("pickMsg").innerHTML = '<span class="cp-spin"></span> Getting your location…';
  navigator.geolocation.getCurrentPosition(function (pos) {
    state.pos = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy || 0 };
    msg("pickMsg", "", pos.coords.accuracy ? "Located to about " + Math.round(pos.coords.accuracy) + " m." : "");
    renderPick();
    geocodePass();
  }, function (err) {
    msg("pickMsg", "err", err && err.code === 1
      ? "Location is turned off for this app. Search for the job below, or allow location in your browser settings."
      : "Couldn't get a location fix — search for the job below.");
    renderPick();
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
}

/* background geocoding: the distinct cities first, then street addresses in the nearest cities;
   each result saved write-once (the database refuses anything that would overwrite a real pin). */
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
  const run = ++state.geoRun;
  // never an untouched import from the old portal: a pin nobody chose must not "touch" it
  const pool = state.pool.filter(function (p) { return !coordsOf(p) && !p.dormant && (p.projectAddress || p.projectCity); });
  if (!pool.length || !state.pos || state.me.role === "viewer") return;
  const cities = {};
  pool.forEach(function (p) {
    const c = String(p.projectCity || "").trim();
    if (c) (cities[c.toLowerCase()] = cities[c.toLowerCase()] || { name: c, n: 0 }).n++;
  });
  let cache = {};
  try { cache = JSON.parse(store.get(CITY_KEY, "{}")) || {}; } catch (e) { cache = {}; }
  const names = Object.keys(cities);
  let asked = 0;
  for (let i = 0; i < names.length && asked < GEO_MAX_PER_VISIT; i++) {
    if (run !== state.geoRun) return;
    const k = names[i];
    if (!cache[k]) {
      const hit = await nominatim(cities[k].name + ", CA");
      asked++;
      if (hit) cache[k] = [hit.lat, hit.lng];
      await sleep(GEO_GAP_MS);
    }
    cities[k].c = cache[k] ? { lat: cache[k][0], lng: cache[k][1] } : null;
  }
  store.set(CITY_KEY, JSON.stringify(cache));
  function cityDist(p) {
    const e = cities[String(p.projectCity || "").trim().toLowerCase()];
    return e && e.c ? distanceMi(state.pos, e.c) : null;
  }
  const order = pool.slice().sort(function (a, b) {
    const da = cityDist(a), db = cityDist(b);
    if (da == null && db == null) return 0;
    if (da == null) return 1;
    if (db == null) return -1;
    return da - db;
  });
  for (let j = 0; j < order.length && asked < GEO_MAX_PER_VISIT; j++) {
    if (run !== state.geoRun) return;
    const p = order[j];
    const q = [p.projectAddress, p.projectCity, p.projectState || "CA"].filter(Boolean).join(", ");
    const loc = await nominatim(q);
    asked++;
    if (loc && pinRule(coordsOf(p), { lat: loc.lat, lng: loc.lng, src: "geocode" }, state.me.role, p.dormant) === "store") {
      p.lat = loc.lat; p.lng = loc.lng; p.locationSource = "geocode";
      p.projectCoordinates = loc.lat.toFixed(6) + "," + loc.lng.toFixed(6) + "|geocode";
      projectsRepo.setLocation(p.id, loc.lat, loc.lng, null, "geocode").then(function (r) { keepAnswer(p, r); }, function () {});
      if (run === state.geoRun && el("stepPick").classList.contains("on")) renderPick();
    }
    await sleep(GEO_GAP_MS);
  }
}

/** The pin as the database has it after set_project_location ({stored, reason, lat, lng,
    location_source}): a refused pin ("exists", "accuracy") puts back what the database keeps. */
function keepAnswer(p, r) {
  if (!p || !r || r.lat == null || r.lng == null) return;
  p.lat = Number(r.lat); p.lng = Number(r.lng); p.locationSource = r.location_source || null;
  p.projectCoordinates = p.lat.toFixed(6) + "," + p.lng.toFixed(6) + "|" + (r.location_source || "geocode");
}

/* ── step 3: shoot + upload ─────────────────────────────────────────── */
function fmtSize(n) {
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(0) + " KB";
  if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
  return (n / 1073741824).toFixed(2) + " GB";
}

function addFiles(files, when) {
  const added = [];
  Array.prototype.slice.call(files || []).forEach(function (f) {
    if (!f || !f.size) return;
    const video = uploads.isVideoFile(f);
    state.seq++;
    const job = { id: state.seq, qid: null, name: video ? "Video" : "Photo", size: f.size, video: video, when: when || new Date(),
      done: false, diskError: "" };
    state.jobs.push(job);
    added.push(job);
    // one at a time: the queue gives each its own name ("…-2", "…-3") only when it sees the others
    custodyChain = custodyChain.then(function () { return takeCustody(job, f); });
  });
  renderJobs();
  return added;
}
let custodyChain = Promise.resolve();

/* custody first: the queue keeps the bytes on this device before any network (it names the file:
   "IMG 2026-10-19 14.30.12-2.jpg") */
async function takeCustody(job, file) {
  try {
    job.qid = await uploads.enqueue({ projectId: state.project.id, file: file, kind: job.video ? "video" : "photo", takenAt: job.when,
      gps: state.pos ? { lat: state.pos.lat, lng: state.pos.lng, accuracy_m: state.pos.accuracy } : null });
    const it = state.q[job.qid];
    if (it && it.name) job.name = it.name;
  } catch (e) {
    job.diskError = errorText(e);
  }
  renderJobs();
}

function statusOf(j) {
  if (j.diskError) return "failed";
  if (j.done) return "done";
  const up = j.qid ? state.q[j.qid] : null;
  if (up) return up.state === "failed" ? "failed" : up.state === "uploading" ? "uploading" : "queued";
  return "queued";
}

function renderJobs() {
  const host = el("shootList");
  camPaintStrip();
  if (!state.jobs.length) { host.innerHTML = ""; el("shootRetryRow").classList.add("cp-hide"); msg("shootMsg", "", ""); holdScreen(false); return; }
  host.innerHTML = state.jobs.map(function (j) {
    const st = statusOf(j);
    const up = j.qid ? state.q[j.qid] : null;
    const pct = st === "done" ? 100 : (up ? up.pct : 0);
    const cls = st === "done" ? " done" : st === "failed" ? " err" : "";
    const txt = st === "done" ? "✓ Saved" : st === "failed" ? "✕ " + (j.diskError || (up && up.error) || "Failed")
      : st === "uploading" ? pct + "%" : navigator.onLine === false || (up && up.error) ? "Saved on this device" : j.qid ? "Waiting to upload" : "Saving on this device…";
    return '<div class="cp-up' + cls + '"><div class="cp-upt"><span class="cp-upn">' + esc(j.name) + "</span>" +
      '<span class="cp-ups' + cls + '">' + esc(txt) + " · " + fmtSize(j.size) + "</span></div>" +
      '<div class="cp-bar"><i style="width:' + pct + '%"></i></div></div>';
  }).join("");
  const sts = state.jobs.map(statusOf);
  const failed = sts.filter(function (s) { return s === "failed"; }).length;
  const done = sts.filter(function (s) { return s === "done"; }).length;
  const pending = state.jobs.length - done - failed;
  el("shootRetryRow").classList.toggle("cp-hide", !failed);
  // no signal: the browser says so, or the queue's last try could not reach the server
  const noSignal = navigator.onLine === false || state.jobs.some(function (j) {
    const up = j.qid ? state.q[j.qid] : null;
    return up && up.state === "waiting" && up.error;
  });
  holdScreen(pending > 0 && !noSignal);
  if (pending && noSignal) {
    msg("shootMsg", "", "No signal — " + pending + " file" + (pending === 1 ? " is" : "s are") +
      " saved on this device. They upload by themselves as soon as you have a connection, even if you close the app.");
  } else if (pending) {
    msg("shootMsg", "", "Uploading " + pending + " file" + (pending === 1 ? "" : "s") + " — you can carry on, they finish on their own.");
  } else if (failed) {
    msg("shootMsg", "err", done + " saved, " + failed + " still on this device — tap retry.");
  } else {
    msg("shootMsg", "ok", "✓ All " + done + " file" + (done === 1 ? "" : "s") + " saved to Photos → " + state.day + ".");
  }
}

async function holdScreen(on) {
  try {
    if (on && !state.wakeLock && navigator.wakeLock) {
      state.wakeLock = await navigator.wakeLock.request("screen");
      state.wakeLock.addEventListener("release", function () { state.wakeLock = null; });
    } else if (!on && state.wakeLock) { state.wakeLock.release(); state.wakeLock = null; }
  } catch (e) { /* not supported: the queue survives either way */ }
}

/* ── in-app camera: one tap is one photo, straight into the queue ───── */
const cam = { stream: null, track: null, facing: "environment", torch: false, shots: 0, open: false, pending: [], draining: false };
const CAM_QUEUE_MAX = 6;

function camWhy(e) {
  const n = e && e.name;
  if (n === "NotAllowedError" || n === "SecurityError") return "Camera access is blocked for this site. Allow the camera in your browser settings, then try again.";
  if (n === "NotFoundError" || n === "OverconstrainedError") return "No camera was found on this device.";
  if (n === "NotReadableError") return "The camera is busy — close any other app using it and try again.";
  return (e && e.message) || "The camera could not be opened.";
}
async function camStart(facing) {
  camStop();
  cam.facing = facing || cam.facing;
  cam.stream = await navigator.mediaDevices.getUserMedia({ audio: false,
    video: { facingMode: { ideal: cam.facing }, width: { ideal: 4096 }, height: { ideal: 3072 } } });
  cam.track = cam.stream.getVideoTracks()[0] || null;
  const v = el("camVideo");
  v.muted = true; v.srcObject = cam.stream;
  try { await v.play(); } catch (e) { /* autoplay attributes cover iOS */ }
  let caps = {};
  try { caps = cam.track && cam.track.getCapabilities ? cam.track.getCapabilities() : {}; } catch (e) { caps = {}; }
  cam.torch = false;
  el("camTorch").hidden = !caps.torch;
  el("camTorch").classList.remove("on");
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    el("camFlip").hidden = devs.filter(function (d) { return d.kind === "videoinput"; }).length < 2;
  } catch (e) { el("camFlip").hidden = true; }
}
function camStop() {
  if (cam.stream) cam.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* */ } });
  cam.stream = null; cam.track = null;
  el("camVideo").srcObject = null;
}
function camErr(text, kind) {
  const box = el("camErr");
  box.textContent = text || ""; box.hidden = !text; box.dataset.kind = text ? kind || "" : "";
}
function camCount() {
  if (!cam.open) return;
  const st = state.jobs.map(statusOf);
  const done = st.filter(function (s) { return s === "done"; }).length;
  const failed = st.filter(function (s) { return s === "failed"; }).length;
  el("camCount").textContent = !cam.shots ? "Tap the button — each photo uploads on its own"
    : cam.shots + " taken · " + done + " saved" + (failed ? " · " + failed + " failed" : "");
}
function camPaintStrip() {
  if (!cam.open) return;
  state.jobs.forEach(function (j) {
    const im = el("camStrip").querySelector('img[data-jid="' + j.id + '"]');
    if (!im) return;
    const st = statusOf(j);
    im.className = st === "done" ? "done" : st === "failed" ? "err" : "";
  });
  camCount();
}
function camThumb(src) {
  const s = 96, t = document.createElement("canvas");
  t.width = t.height = s;
  const k = Math.max(s / src.width, s / src.height), w = src.width * k, h = src.height * k;
  t.getContext("2d").drawImage(src, (s - w) / 2, (s - h) / 2, w, h);
  const img = new Image();
  img.src = t.toDataURL("image/jpeg", 0.6);
  const strip = el("camStrip");
  strip.appendChild(img);
  strip.scrollLeft = strip.scrollWidth;
  return img;
}
function camShoot() {
  if (!cam.open) return;
  const v = el("camVideo"), w = v.videoWidth, h = v.videoHeight;
  if (!w || !h) { camErr("The camera is still warming up — try again in a moment."); return; }
  if (cam.pending.length >= CAM_QUEUE_MAX) { camErr("Still saving the last few — give it a second.", "cap"); return; }
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d").drawImage(v, 0, 0, w, h);
  const flash = el("camFlash");
  flash.classList.remove("go"); void flash.offsetWidth; flash.classList.add("go");
  cam.shots++;
  cam.pending.push({ canvas: c, when: new Date(), img: camThumb(c) });
  camErr(""); camCount(); camDrain();
}
async function camDrain() {
  if (cam.draining) return;
  cam.draining = true;
  while (cam.pending.length) {
    const shot = cam.pending.shift();
    try {
      const blob = await new Promise(function (res) { shot.canvas.toBlob(res, "image/jpeg", 0.92); });
      if (!blob || !blob.size) throw new Error("empty frame");
      const job = addFiles([new File([blob], "photo.jpg", { type: "image/jpeg", lastModified: shot.when.getTime() })], shot.when)[0];
      if (job && shot.img) shot.img.setAttribute("data-jid", job.id);
    } catch (e) {
      if (shot.img) shot.img.className = "err";
      camErr("One photo could not be saved — take it again.");
    }
    shot.canvas.width = shot.canvas.height = 0;
    camCount();
    if (el("camErr").dataset.kind === "cap" && cam.pending.length < CAM_QUEUE_MAX) camErr("");
  }
  cam.draining = false;
}
async function camOpen() {
  if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.File)) { camFallback("This browser can't open the camera inside the app."); return; }
  cam.shots = 0; cam.open = true;
  el("camStrip").innerHTML = "";
  el("camJob").textContent = projectTitle(state.project);
  el("shootNativeRow").classList.add("cp-hide");
  camErr(""); camCount();
  el("camWrap").hidden = false;
  holdScreen(true);
  try { await camStart("environment"); camCount(); }
  catch (e) { camClose(); camFallback(camWhy(e)); }
}
function camClose() { cam.open = false; camStop(); el("camWrap").hidden = true; renderJobs(); }
function camFallback(why) { msg("shootMsg", "err", why); el("shootNativeRow").classList.remove("cp-hide"); }
async function camToggleTorch() {
  if (!cam.track) return;
  cam.torch = !cam.torch;
  try { await cam.track.applyConstraints({ advanced: [{ torch: cam.torch }] }); el("camTorch").classList.toggle("on", cam.torch); }
  catch (e) { cam.torch = false; el("camTorch").classList.remove("on"); camErr("This camera's light can't be controlled from the browser."); }
}
async function camSwitch() {
  try { await camStart(cam.facing === "environment" ? "user" : "environment"); camErr(""); } catch (e) { camErr(camWhy(e)); }
}

function startShooting() {
  const p = state.project;
  if (!p) { show("stepPick"); return; }
  state.day = ymd(new Date());           // a crew can be on site across midnight
  el("shootBanner").innerHTML = '<span class="cp-thumb" data-thumb="' + esc(p.id) + '">🏠</span>' +
    '<span class="cp-info"><span class="cp-nm">' + esc(projectTitle(p)) + '</span><span class="cp-ad">' + esc(addressLine(p, ", ")) + "</span></span>";
  paintThumbs(el("shootBanner"));
  el("shootWhere").innerHTML = "Saving to <b>Photos → " + esc(state.day) + "</b> (Desktop 2: “Stored in DCR”)<br>Photos are kept on this device the instant you take them and upload by themselves — " +
    "nothing to confirm, and nothing is lost if you have no signal or close the app. Delete any you don't want later from the project's Files in Desktop 2.";
  show("stepShoot");
  // standing on the job with a good fix is the best pin there will ever be (write-once in the database);
  // not for an untouched import from the old portal (see the notes at the top)
  if (state.pos && state.pos.accuracy && state.pos.accuracy <= 100 && !p.dormant) {
    const rule = pinRule(coordsOf(p), { lat: state.pos.lat, lng: state.pos.lng, src: "gps", accuracy: state.pos.accuracy }, state.me.role, p.dormant);
    if (rule === "store") {
      projectsRepo.setLocation(p.id, state.pos.lat, state.pos.lng, state.pos.accuracy, "gps").then(function (r) {
        keepAnswer(p, r);
      }, function () { /* a nicety, never an interruption */ });
    }
  }
}

async function init() {
  state.me = await boot("capture", { roles: ["admin", "manager", "accountant", "lead", "field"], offline: true });
  startSweeper(state.me);                 // journal entries written with no signal (their photos wait for them)
  el("pickSearch").addEventListener("input", renderPick);
  ["pickBest", "pickList"].forEach(function (id) {
    el(id).addEventListener("click", function (e) {
      const b = e.target.closest && e.target.closest("[data-pick]");
      if (b) pickProject(byId(b.getAttribute("data-pick")));
    });
  });
  el("pickMore").addEventListener("click", function () { state.showAll = !state.showAll; renderPick(); });
  el("pickRetryGps").addEventListener("click", locate);
  el("confirmNo").addEventListener("click", function () { show("stepPick"); });
  el("confirmYes").addEventListener("click", startShooting);
  el("shootDone").addEventListener("click", async function () {
    const left = state.jobs.filter(function (j) { return statusOf(j) !== "done"; }).length;
    if (left) {
      const ok = await confirmBox(left + " file" + (left === 1 ? " is" : "s are") + " saved on this device and will keep uploading on their own" +
        (navigator.onLine === false ? " as soon as you have signal" : "") + ".", { title: "Finish here?", okText: "Finish" });
      if (!ok) return;
    }
    state.jobs = []; renderJobs(); show("stepPick");
  });
  el("shootPhoto").addEventListener("click", camOpen);
  el("camClose").addEventListener("click", camClose);
  el("camDone").addEventListener("click", camClose);
  el("camShot").addEventListener("click", camShoot);
  el("camTorch").addEventListener("click", camToggleTorch);
  el("camFlip").addEventListener("click", camSwitch);
  el("shootNative").addEventListener("click", function () { el("inPhoto").value = ""; el("inPhoto").click(); });
  el("shootVideo").addEventListener("click", function () { el("inVideo").value = ""; el("inVideo").click(); });
  el("shootPick").addEventListener("click", function () { el("inPick").value = ""; el("inPick").click(); });
  ["inPhoto", "inVideo", "inPick"].forEach(function (id) { el(id).addEventListener("change", function () { addFiles(this.files); }); });
  el("shootRetry").addEventListener("click", function () { uploads.retryAll(); });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) return;
    uploads.drain();
    if (cam.open) el("camVideo").play().catch(function () {});
  });
  window.addEventListener("online", function () {
    uploads.drain(); renderJobs();
    if (state.offlineList) {                // the kept list was shown: read the jobs again now
      projectsRepo.loadProjects().then(function (all) {
        state.all = all; state.pool = all.filter(eligible); state.offlineList = null; keepJobs(all);
        if (el("stepPick").classList.contains("on")) renderPick();
      }, function () { /* still no answer: the kept list stays */ });
    }
  });
  window.addEventListener("offline", renderJobs);
  uploads.onProgress(function (items, evt) {
    const map = {};
    items.forEach(function (it) { map[it.id] = it; });
    state.q = map;
    state.jobs.forEach(function (j) {
      const it = j.qid ? map[j.qid] : null;
      if (it && it.name) j.name = it.name;
      if (evt && evt.type === "done" && evt.item && String(evt.item.id) === String(j.qid)) {
        j.done = true;
        j.name = (evt.row && evt.row.name) || evt.item.name || j.name;      // the name the files row got
      }
    });
    renderJobs();
  });

  try {
    state.all = await projectsRepo.loadProjects();
    state.pool = state.all.filter(eligible);
    keepJobs(state.all);
  } catch (e) {
    const kept = keptJobs();
    if (!kept) { msg("pickMsg", "err", errorText(e)); el("pickSub").textContent = "Search needs a connection the first time — open Site Photos once with signal."; return; }
    // no signal: the jobs read last on this device; photos are kept here and go up by themselves
    state.all = kept.jobs;
    state.pool = state.all.filter(eligible);
    state.offlineList = kept.at;
  }
  renderPick();
  const want = qs("project");
  const preset = want && /^\d{1,18}$/.test(want) ? byId(want) : null;
  if (preset) pickProject(preset);
  locate();
}

init().catch(function (e) {
  if (e && /not signed in|not for this role/.test(e.message || "")) return;
  const m = document.getElementById("pickMsg");
  if (m) { m.className = "cp-msg err"; m.textContent = errorText(e); }
});

