/* Project tab Journal (MODULES §3 "Journal"; BLUEPRINT 3.3.3): the daily diary of the job.

   Writing (admin, manager, lead, field — field their own entries, Q4; accountant and viewer read):
   nothing has a Save button. Every keystroke goes to this device first (localStorage
   dcr2JrnDraft:<profile>:<project>, Appendix C) and, once there is something worth keeping, the
   entry row is created and kept up to date by journal-sync.js:
     * only the fields this person changed are sent, with the version; when someone else saved the
       same entry meanwhile, their changes are taken into the form and a field both changed keeps
       theirs, saying so ("Use mine") — a phone left open for days never overwrites an office fix;
     * text first: the row exists before its photos are queued, so each photo carries its
       journal_entry_id. With no signal a photo is still taken into custody at once, waiting for "its
       entry" under the draft's local key, and released the moment the row is saved — by this tab,
       or by the sweep of the home page / Site Photos / any project page after the app was killed;
     * "Finish this entry" with no signal keeps everything on this device and finishes by itself
       once the row is saved;
     * a refresh that fails keeps the form and the list on screen (a small "couldn't refresh" note).

   Photos and videos go to the upload queue (custody on the device, then cloud storage, then a files
   row in the journal folder, the entry's date as its sub-folder, the caption as its description).
   A caption typed while the photo is still on its way is written onto its row when it lands. A photo
   still on its way can be taken off (✕) before it uploads.

   Amounts (Q28, on screen only): for people without the prices switch an entry or a caption with an
   amount is shown masked and never put into an editable field (✎ is refused for it).

   The list: entries newest first, each with its photos (signed URLs, up to an hour), captions,
   facts, author; Edit / Delete for the author or a lead, manager, admin. */

import * as journalRepo from "../repo/journal.js";
import * as filesRepo from "../repo/files.js";
import { CATEGORIES, CATEGORY_LABELS, worthKeeping, factsLine } from "../map/journal.js";
import { ymd, fmtDay } from "../map/pacific.js";
import { SIGNED_GALLERY_S, SIGNED_DOC_S } from "../map/files.js";
import { can } from "./shell.js";
import * as uploads from "./uploads.js";
import * as J from "./journal-sync.js";

const st = {
  host: null, ctx: null, rows: [], pending: [], pushTimer: null, retryTimer: null,
  urls: {}, seq: 0, reloadTimer: null, progress: {}, wired: false, painted: false,
};

const INPUTS = { date: "jrDate", cat: "jrCat", wx: "jrWx", crew: "jrCrew", hrs: "jrHrs", title: "jrTitle", body: "jrBody", follow: "jrFollow" };
const FIELD_WORDS = { date: "date", cat: "kind of entry", wx: "weather", crew: "people on site", hrs: "hours worked",
  title: "headline", body: "write-up", follow: "follow-up flag" };

function who(ctx) { return ctx.me ? String(ctx.me.id) : "anon"; }
function readDraft(ctx) { return J.read(who(ctx), ctx.pid); }
function writeDraft(ctx, d) { J.write(who(ctx), ctx.pid, d); }
function hasAmount(ctx, t) { return !!t && ctx.mask(String(t)) !== String(t); }

function canEditEntry(ctx, e) {
  return can(ctx.me, "all_journal") || (can(ctx.me, "journal") && ctx.me && String(e.createdBy) === String(ctx.me.id));
}
/** May this person open the entry in the form? Not when it holds an amount hidden from them. */
function editable(ctx, e) {
  return canEditEntry(ctx, e) && (ctx.prices || (!hasAmount(ctx, e.title) && !hasAmount(ctx, e.journalEntry)));
}
function canCaption(ctx, m) {
  return can(ctx.me, "all_files") || (can(ctx.me, "files") && ctx.me && String(m.createdBy) === String(ctx.me.id));
}

/* ── the list ───────────────────────────────────────────────────────── */
function mediaHtml(ctx, e) {
  const esc = ctx.esc;
  if (!e.media.length) return "";
  return '<div class="pj-jrn-media">' + e.media.map(function (m) {
    const thumbPath = m.previewPath || (!m.video ? m.storagePath : null);
    const src = thumbPath ? st.urls[thumbPath] : null;
    const local = m.storage === "local";
    // a caption is an editable field only for whom it may be shown as it is (Q28)
    const editCap = canCaption(ctx, m) && !local && (ctx.prices || !hasAmount(ctx, m.desc));
    return '<figure class="pj-jrn-fig">' +
      '<div class="pj-jrn-thumb"' + (m.storagePath && !local ? ' data-open="' + esc(m.storagePath) + '" title="Open the full size" role="button" tabindex="0"' : "") +
        (local ? ' title="On the office computers"' : "") + ">" +
        (src ? '<img src="' + esc(src) + '" alt="">' : '<span class="pj-jrn-ph">' + (local ? "💻" : m.video ? "🎬" : "🖼️") + "</span>") +
        (m.video ? '<span class="pj-jrn-play">▶</span>' : "") + "</div>" +
      (editCap
        ? '<input class="pj-jrn-cap" data-cap="' + esc(m.fileId) + '" placeholder="Describe this photo…" value="' + esc(m.desc) + '" aria-label="Caption">'
        : (m.desc ? "<figcaption>" + esc(ctx.mask(m.desc)) + "</figcaption>" : "")) +
      "</figure>";
  }).join("") + "</div>";
}

function entryHtml(ctx, e) {
  const esc = ctx.esc;
  const facts = factsLine(e);
  const mine = canEditEntry(ctx, e);
  const open = editable(ctx, e);
  return '<div class="pj-jrn" data-jrn-row="' + esc(e.id) + '">' +
    '<div class="pj-jrn-top"><b>' + esc(fmtDay(e.journalDate)) + "</b>" +
      '<span class="pj-tag on">' + esc(e.journalCategory) + "</span>" +
      (e.journalFollowUp ? '<span class="pj-tag pj-jrn-flag">⚑ Follow up</span>' : "") +
      '<span class="pj-sub pj-jrn-who">' + esc(e.journalAuthor || "") + "</span>" +
      (mine ? (open
        ? '<button class="pj-btn pj-btn-sm" type="button" data-jrn-edit="' + esc(e.id) + '" title="Edit this entry" aria-label="Edit this entry">✎</button>'
        : '<button class="pj-btn pj-btn-sm" type="button" disabled title="This entry has an amount hidden for you: it is changed in DCR Desktop 2 by someone who sees prices" aria-label="Edit this entry (not available)">✎</button>') +
        '<button class="pj-btn pj-btn-sm" type="button" data-jrn-del="' + esc(e.id) + '" title="Delete this entry" aria-label="Delete this entry">🗑</button>' : "") +
    "</div>" +
    (e.title ? '<div class="pj-jrn-h">' + esc(ctx.mask(e.title)) + "</div>" : "") +
    (e.journalEntry ? '<div class="pj-jrn-body">' + esc(ctx.mask(e.journalEntry)) + "</div>" : "") +
    (facts.length ? '<div class="pj-sub pj-jrn-meta">' + facts.map(esc).join(" · ") + "</div>" : "") +
    mediaHtml(ctx, e) + "</div>";
}

function listRows(ctx) {
  const d = readDraft(ctx);
  const id = d && !d.captionsOnly && d.id;
  return id ? st.rows.filter(function (r) { return String(r.id) !== String(id); }) : st.rows;
}

function paintList(ctx) {
  const list = document.getElementById("jrList");
  if (!list) return;
  const stale = document.getElementById("jrStale");
  if (stale) stale.remove();
  const rows = listRows(ctx);
  list.innerHTML = rows.length ? rows.map(function (e) { return entryHtml(ctx, e); }).join("") : '<div class="pj-empty">Nothing in the journal yet.</div>';
}

/** A refresh failed: what is on screen stays (the form, the list); a small note says so. */
function staleNote(ctx, err) {
  const list = document.getElementById("jrList");
  if (!list) return;
  let n = document.getElementById("jrStale");
  if (!n) {
    n = document.createElement("div");
    n.id = "jrStale";
    n.className = "pj-msg err pj-jrn-stale";
    n.setAttribute("role", "status");
    list.parentNode.insertBefore(n, list);
  }
  n.textContent = "Couldn't refresh the journal — " + ctx.errorText(err) + " What you see is what was read last; your writing is kept on this device.";
}

/* ── the form ───────────────────────────────────────────────────────── */
function formHtml(ctx, d) {
  const esc = ctx.esc;
  const day = d.date || ymd(new Date());
  return '<div class="pj-sec" id="jrForm"><h3><span id="jrHead">' + (day === ymd(new Date()) ? "Today's entry" : "Entry of " + esc(fmtDay(day))) + "</span>" +
    ' <span class="pj-jrn-auto" id="jrAuto">saved automatically</span></h3>' +
    '<div id="jrClash"></div>' +
    '<div class="pj-grid">' +
      '<div class="pj-f"><label for="jrDate">Date</label><input type="date" id="jrDate" value="' + esc(d.date || ymd(new Date())) + '"></div>' +
      '<div class="pj-f"><label for="jrCat">What kind of entry</label><select id="jrCat">' + CATEGORIES.map(function (c) {
        return '<option value="' + c + '"' + ((d.cat || "progress") === c ? " selected" : "") + ">" + esc(CATEGORY_LABELS[c]) + "</option>";
      }).join("") + "</select></div>" +
      '<div class="pj-f"><label for="jrWx">Weather</label><input id="jrWx" placeholder="Clear, 78F" value="' + esc(d.wx || "") + '"></div>' +
      '<div class="pj-f"><label for="jrCrew">People on site</label><input id="jrCrew" type="number" min="0" step="1" inputmode="numeric" value="' + esc(d.crew == null ? "" : d.crew) + '"></div>' +
      '<div class="pj-f"><label for="jrHrs">Hours worked</label><input id="jrHrs" type="number" min="0" step="any" inputmode="decimal" value="' + esc(d.hrs == null ? "" : d.hrs) + '"></div>' +
    "</div>" +
    '<div class="pj-f full pj-jrn-row"><label for="jrTitle">Headline</label><input id="jrTitle" placeholder="One line — what today was about" value="' + esc(d.title || "") + '"></div>' +
    '<div class="pj-f full pj-jrn-row"><label for="jrBody">What happened</label><textarea id="jrBody" rows="5" placeholder="What got done, who was on site, what got in the way…">' + esc(d.body || "") + "</textarea></div>" +
    '<div class="pj-links pj-jrn-row" style="align-items:center">' +
      '<label class="pj-check"><input type="checkbox" id="jrFollow"' + (d.follow ? " checked" : "") + "> Needs follow-up</label>" +
      (ctx.canFiles ? '<button class="pj-btn pj-btn-sm" type="button" id="jrPick">📷 Add photos / video</button>' : "") +
      '<button class="pj-btn pj-btn-sm" type="button" id="jrDone">✓ Finish this entry</button>' +
      '<span class="pj-msg" id="jrMsg" role="status"></span>' +
    "</div>" +
    '<input type="file" id="jrInput" accept="image/*,video/*" multiple hidden>' +
    '<div id="jrPending"></div></div>';
}

/** The form's fields as typed ({} when the form is not on screen). */
function formFields() {
  if (!document.getElementById("jrForm")) return {};
  const v = function (id) { const n = document.getElementById(id); return n ? n.value : ""; };
  const f = document.getElementById("jrFollow");
  return { date: v("jrDate"), cat: v("jrCat"), wx: v("jrWx"), crew: v("jrCrew"), hrs: v("jrHrs"),
    title: v("jrTitle"), body: v("jrBody"), follow: f ? f.checked : false };
}

function pendingMedia() {
  return st.pending.map(function (m) { return { qid: m.qid, name: m.name || "", desc: m.desc || "", video: !!m.video, landed: !!m.landed }; });
}

/** Captions of photos still on their way from a closed draft travel with the next one. */
function carriedOf(d) {
  if (!d) return [];
  const list = d.captionsOnly ? d.media || [] : ((J.closedDraft(d) || {}).media || []);     // carried ones included
  return list.filter(function (m) { return m && m.desc; });
}

/** The stored draft with the form and the photos on their way as they are now. */
function formDraft(ctx) {
  let d = readDraft(ctx) || {};
  if (d.captionsOnly) d = { carried: carriedOf(d) };
  return Object.assign(d, formFields(), document.getElementById("jrForm") ? { media: pendingMedia() } : {});
}

function status(kind) {
  const n = document.getElementById("jrAuto");
  if (!n) return;
  n.textContent = kind === "saving" ? "saving…" : kind === "saved" ? "saved" : kind === "error" ? "not saved — will retry" :
    kind === "local" ? "kept on this device — saved when there is signal" :
    kind === "finishing" ? "kept on this device — finishes by itself when there is signal" :
    kind === "pending" ? "not saved yet" : "saved automatically";
  n.className = "pj-jrn-auto" + (kind === "error" ? " err" : kind === "local" || kind === "finishing" || kind === "pending" ? " wait" : "");
}

/** What the label says when the form is drawn from a kept draft. */
function statusOf(d) {
  if (!d || d.captionsOnly) return "";
  if (!d.id) return worthKeeping(d, J.mediaCount(d)) ? (d.finishing ? "finishing" : "local") : "";
  return J.needsSync(d) ? "pending" : "";
}

function msg(kind, text) {
  const m = document.getElementById("jrMsg");
  if (!m) return;
  m.className = "pj-msg" + (kind ? " " + kind : "");
  m.textContent = text || "";
}

function touched(e) {
  const ctx = st.ctx;
  const d = formDraft(ctx);
  // typing in a field that met someone else's change settles it: this person's text goes in
  const f = e && e.target && fieldOfInput(e.target.id);
  if (f && d.conflicts && f in d.conflicts) { delete d.conflicts[f]; paintClash(ctx, d); }
  writeDraft(ctx, d);
  status("saving");
  ctx.setEditing(true);
  clearTimeout(st.pushTimer);
  st.pushTimer = setTimeout(function () { st.pushTimer = null; push(); }, 900);
}

function fieldOfInput(id) {
  for (const k in INPUTS) if (INPUTS[k] === id) return k;
  return null;
}

/** Save what this device has (create the row, or send what changed). -> the sync result. */
async function push(opts) {
  const ctx = st.ctx;
  clearTimeout(st.pushTimer); st.pushTimer = null;
  clearTimeout(st.retryTimer); st.retryTimer = null;
  if (document.getElementById("jrForm")) writeDraft(ctx, formDraft(ctx));
  const still = st.pending.filter(function (x) { return !x.landed; }).length;
  const res = await J.sync(who(ctx), ctx.pid, opts);
  afterSync(ctx, res, still);
  return res;
}

function afterSync(ctx, res, still) {
  const d = readDraft(ctx);
  if (res.state === "saved") {
    const adopted = res.adopted || {};
    // someone else's change brought an amount this person may not see: the form closes (the entry
    // is saved; it shows masked in the list)
    if (!ctx.prices && Object.keys(adopted).some(function (f) { return typeof adopted[f] === "string" && hasAmount(ctx, adopted[f]); })) {
      writeDraft(ctx, { carried: carriedOf(d) });
      st.pending = [];
      ctx.setEditing(false);
      ctx.toast("Someone else changed this entry — it is in the list below.", "info");
      load(ctx, true);
      return;
    }
    if (res.closed) { afterClose(ctx, still); return; }
    paintAdopted(d, adopted);
    paintClash(ctx, d);
    status(J.needsSync(d) ? "pending" : "saved");
    if (!st.pushTimer) ctx.setEditing(false);          // saved and nobody typing: not "editing" any more
    // typed while it was saving: soon; anything else left (photos to release, the close): in a while
    if (Object.keys(J.changes(d)).length && !st.pushTimer) st.pushTimer = setTimeout(function () { st.pushTimer = null; push(); }, 900);
    else if (J.needsSync(d) && !st.pushTimer && !st.retryTimer) {
      st.retryTimer = setTimeout(function () { st.retryTimer = null; if (J.needsSync(readDraft(ctx))) push(); }, 15000);
    }
    if (res.created && st.pending.length) msg("", "");
    return;
  }
  if (res.state === "empty" || res.state === "none") { status(""); return; }
  if (res.state === "gone") {
    msg("err", "This entry was deleted by someone else. What you wrote is kept and saved as a new entry.");
    st.pushTimer = setTimeout(function () { st.pushTimer = null; push(); }, 400);
    return;
  }
  if (res.state === "refused") {
    status("error");
    msg("err", ctx.errorText(res.error));
    return;
  }
  // no signal, or the server did not answer: everything stays on this device; try again by itself
  status(d && d.finishing && !d.id ? "finishing" : navigator.onLine === false || res.state === "offline" ? "local" : "error");
  st.retryTimer = setTimeout(function () { st.retryTimer = null; if (J.needsSync(readDraft(ctx))) push(); }, 15000);
}

/** Fields someone else changed (adopted into the stored draft) go into the inputs. */
function paintAdopted(d, adopted) {
  if (!d) return;
  Object.keys(adopted || {}).forEach(function (f) {
    const n = document.getElementById(INPUTS[f]);
    if (!n) return;
    if (n.type === "checkbox") n.checked = !!d[f]; else n.value = d[f] == null ? "" : String(d[f]);
  });
}

function paintClash(ctx, d) {
  const box = document.getElementById("jrClash");
  if (!box) return;
  const c = (d && d.conflicts) || {};
  box.innerHTML = Object.keys(c).map(function (f) {
    const mine = c[f];
    const shown = typeof mine === "boolean" ? (mine ? "ticked" : "not ticked") : String(mine == null ? "" : mine);
    return '<div class="pj-clash">' + ctx.esc("Someone else changed the " + (FIELD_WORDS[f] || f) +
      " of this entry while you were writing — theirs is shown. Yours was “" + (ctx.prices ? shown : ctx.mask(shown)) + "”.") +
      ' <button type="button" class="pj-btn pj-btn-sm" data-mine="' + ctx.esc(f) + '">Use mine</button></div>';
  }).join("");
}

function useMine(f) {
  const ctx = st.ctx;
  const d = readDraft(ctx);
  if (!d || !d.conflicts || !(f in d.conflicts)) return;
  const n = document.getElementById(INPUTS[f]);
  if (n) { if (n.type === "checkbox") n.checked = !!d.conflicts[f]; else n.value = d.conflicts[f] == null ? "" : String(d.conflicts[f]); }
  d[f] = d.conflicts[f];
  delete d.conflicts[f];
  writeDraft(ctx, d);
  paintClash(ctx, d);
  touched();
}

/** The photos the entry being written already has (landed before this page was opened). */
function draftMediaHtml(ctx) {
  const d = readDraft(ctx);
  if (!d || d.captionsOnly || !d.id) return "";
  const e = st.rows.find(function (r) { return String(r.id) === String(d.id); });
  if (!e || !e.media.length) return "";
  const mine = {};
  st.pending.forEach(function (m) { if (m.fileId != null) mine[String(m.fileId)] = 1; });
  const rest = e.media.filter(function (m) { return !mine[String(m.fileId)]; });
  if (!rest.length) return "";
  return mediaHtml(ctx, { media: rest }).replace('<div class="pj-jrn-media">', "").replace(/<\/div>$/, "");
}

function renderPending() {
  const host = document.getElementById("jrPending");
  if (!host) return;
  const esc = st.ctx.esc;
  const before = draftMediaHtml(st.ctx);
  host.innerHTML = st.pending.length || before ? '<div class="pj-jrn-media">' + before + st.pending.map(function (m, i) {
    const up = m.qid ? st.progress[m.qid] : null;
    const failed = up && up.state === "failed";
    const label = m.error ? m.error : m.landed ? "saved" : !m.qid ? "saving on this device…" : uploads.itemLabel(up, navigator.onLine !== false);
    return '<figure class="pj-jrn-fig"><div class="pj-jrn-thumb">' +
      (m.preview ? '<img src="' + esc(m.preview) + '" alt="">' : '<span class="pj-jrn-ph">' + (m.video ? "🎬" : "🖼️") + "</span>") +
      (m.video ? '<span class="pj-jrn-play">▶</span>' : "") +
      (up && up.state === "uploading" ? '<span class="pj-jrn-bar"><i style="width:' + (up.pct || 0) + '%"></i></span>' : "") +
      (!m.landed && m.qid ? '<button type="button" class="pj-jrn-x" data-prm="' + i + '" title="Remove this file" aria-label="Remove this file">✕</button>' : "") +
      '<span class="pj-jrn-up' + (failed || m.error ? " err" : "") + '"' + (failed ? ' data-retry="1"' : "") + ">" + esc(label) + "</span></div>" +
      '<input class="pj-jrn-cap" data-pcap="' + i + '" placeholder="Describe this photo…" value="' + esc(m.desc || "") + '" aria-label="Caption"></figure>';
  }).join("") + "</div>" : "";
}

/** ✕ on a photo still on its way: taken off the entry, never uploaded (the old portal's rule). */
async function removePending(i) {
  const ctx = st.ctx;
  const m = st.pending[i];
  if (!m || m.landed || !m.qid) return;
  const ok = await ctx.confirm("This photo will be taken off the entry and will not be uploaded.",
    { title: "Remove this photo?", okText: "Remove", danger: true });
  if (!ok) return;
  const at = st.pending.indexOf(m);
  if (at === -1 || m.landed) return;                  // it landed while the question was open
  try { await uploads.remove(m.qid); } catch (e) { ctx.toast(ctx.errorText(e), "error"); return; }
  st.pending.splice(at, 1);
  if (m.preview) { try { URL.revokeObjectURL(m.preview); } catch (e) { /* */ } }
  writeDraft(ctx, formDraft(ctx));
  renderPending();
}

async function queueFiles(files) {
  const ctx = st.ctx;
  const arr = Array.prototype.slice.call(files || []).filter(function (f) { return f && f.size; });
  if (!arr.length) return;
  const fresh = arr.map(function (f) {
    const video = uploads.isVideoFile(f);
    return { file: f, video: video, when: new Date(), desc: "", name: "", qid: null, landed: false,
      preview: video ? "" : URL.createObjectURL(f) };
  });
  fresh.forEach(function (m) { st.pending.push(m); });
  renderPending();
  // text first: the entry exists before its photos are queued; with no signal they wait for it
  await push();
  let d = readDraft(ctx) || formDraft(ctx);
  const id = d.id || null;
  if (!id && !d.localKey) {
    d.localKey = J.newLocalKey(ctx.pid);
    writeDraft(ctx, d);                    // kept BEFORE any photo waits under it (a kill in between strands nothing)
  }
  const date = (document.getElementById("jrDate") || {}).value || ymd(new Date());
  for (let i = 0; i < fresh.length; i++) {
    const m = fresh[i];
    try {
      m.qid = await uploads.enqueue({ projectId: ctx.pid, file: m.file, kind: "journal", caption: m.desc, takenAt: m.when,
        journalEntryId: id || null, pendingEntry: id ? null : d.localKey, entryDate: date });
    } catch (e) {
      m.error = ctx.errorText(e);
    }
    m.file = null;                         // the queue holds the bytes now
    writeDraft(ctx, formDraft(ctx));       // its queue id goes with the draft at once
  }
  if (!id) {
    msg("", "Kept on this device — the photos go up with the entry once it is saved.");
    d = readDraft(ctx);
    if (d && d.id && !d.bound) push();     // the entry was saved meanwhile: release them now
  }
  renderPending();
}

/** A queued file landed: its row exists. A caption typed meanwhile goes onto it. */
function onLanded(evt) {
  const ctx = st.ctx;
  if (!evt || evt.type !== "done" || !evt.item) return;
  const row = evt.row;
  const m = st.pending.find(function (x) { return x.qid && String(x.qid) === String(evt.item.id); });
  if (!m) {
    // a photo of a finished entry: its caption was carried with this device's draft
    const d = readDraft(ctx);
    const list = (d && (d.captionsOnly ? d.media : d.carried)) || [];
    const c = list.find(function (x) { return x && x.qid && String(x.qid) === String(evt.item.id); });
    if (c && row && c.desc && (row.description || "") !== c.desc && canCaption(ctx, { createdBy: row.created_by })) {
      filesRepo.setCaption({ fileId: row.id, version: row.version }, c.desc).then(function () {
        const now = readDraft(ctx);
        if (!now) return;
        if (now.captionsOnly) now.media = (now.media || []).filter(function (x) { return x !== c && String(x.qid) !== String(c.qid); });
        else now.carried = (now.carried || []).filter(function (x) { return String(x.qid) !== String(c.qid); });
        writeDraft(ctx, now.captionsOnly && !now.media.length ? null : now);
      }, function () {});
    }
    reload(ctx);
    return;
  }
  m.landed = true;
  m.name = evt.item.name || m.name;
  if (row) { m.fileId = row.id; m.fileVersion = row.version; m.createdBy = row.created_by; }
  if (row && m.desc && (row.description || "") !== m.desc && canCaption(ctx, { createdBy: row.created_by })) {
    filesRepo.setCaption({ fileId: row.id, version: row.version }, m.desc).then(function (r) { m.fileVersion = r.version; }, function () {});
  }
  writeDraft(ctx, formDraft(ctx));
  renderPending();
  reload(ctx);
}

async function finish() {
  const ctx = st.ctx;
  const d = formDraft(ctx);
  if (!worthKeeping(d, J.mediaCount(d)) && !d.id) {
    msg("err", "Write something, or add a photo, first.");
    return;
  }
  d.finishing = true;
  writeDraft(ctx, d);
  const res = await push();
  if (res && res.closed) return;           // afterClose did the rest
  if (res && res.state === "refused") return;
  if (res && res.state === "saved") {
    // saved, with a little left to do (typed meanwhile, its photos being released): it closes next time
    msg("", "Finishing…");
    return;
  }
  // not saved yet (no signal): nothing is lost and nothing is cleared — it finishes by itself
  status("finishing");
  msg("", "No signal — this entry and its photos are kept on this device. It is saved and finished by itself as soon as there is a connection, even if you close the app.");
}

/** The entry is saved and finished: a fresh form. */
function afterClose(ctx, still) {
  st.pending = [];
  ctx.setEditing(false);
  // the form is drawn again even with the focus in it (the Finish button): the old text must go,
  // or the next key would start a second entry with it
  load(ctx, true).then(function () {
    if (!still) { msg("ok", "✓ Entry saved"); return; }
    msg("", still + (still === 1 ? " file is" : " files are") + (navigator.onLine === false
      ? " saved on this device — " + (still === 1 ? "it uploads" : "they upload") + " as soon as you have signal."
      : " still uploading — " + (still === 1 ? "it finishes" : "they finish") + " on its own."));
  });
}

async function editEntry(id) {
  const ctx = st.ctx;
  const e = st.rows.find(function (r) { return String(r.id) === String(id); });
  if (!e) return;
  if (!editable(ctx, e)) {
    ctx.toast("This entry has an amount hidden for you — it is changed in DCR Desktop 2 by someone who sees prices.", "error");
    return;
  }
  const cur = formDraft(ctx);
  const unsaved = cur.id ? J.needsSync(cur) : worthKeeping(cur, J.mediaCount(cur));
  if (String(cur.id || "") !== String(e.id) && unsaved) {
    // the entry being written is finished first (saved now; with no signal it stays in the form)
    cur.finishing = true;
    writeDraft(ctx, cur);
    const res = await push();
    if (!res || !res.closed) {
      ctx.toast("Finish the entry you are writing first — it is not saved yet.", "error");
      return;
    }
  }
  const nd = J.draftOfEntry(e);
  nd.carried = carriedOf(readDraft(ctx));
  st.pending = [];
  writeDraft(ctx, nd);
  paint(ctx);
  const f = document.getElementById("jrForm");
  if (f && f.scrollIntoView) f.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function delEntry(id) {
  const ctx = st.ctx;
  const e = st.rows.find(function (r) { return String(r.id) === String(id); });
  if (!e) return;
  const ok = await ctx.confirm("This cannot be undone from here. Its photos stay in the project's files.",
    { title: "Delete this journal entry?", danger: true, okText: "Delete" });
  if (!ok) return;
  try {
    await journalRepo.remove(e);
    const d = readDraft(ctx);
    const was = d && String(d.id) === String(id);
    if (was) { writeDraft(ctx, { carried: carriedOf(d) }); st.pending = []; }
    ctx.toast("Journal entry deleted", "ok");
    load(ctx, was);
  } catch (err) { ctx.toast(ctx.errorText(err), "error"); }
}

/* ── paint + load ───────────────────────────────────────────────────── */
function paint(ctx) {
  const host = st.host;
  let draft = readDraft(ctx) || {};
  if (draft.captionsOnly) draft = {};                      // a new, empty form (the captions stay kept)
  if (!st.pending.length && Array.isArray(draft.media)) {
    st.pending = draft.media.filter(function (m) { return m.qid && !m.landed; })
      .map(function (m) { return { qid: m.qid, name: m.name, desc: m.desc || "", video: !!m.video, preview: "", landed: false }; });
  }
  host.innerHTML =
    '<div class="pj-links" style="margin-bottom:10px"><a class="pj-btn pj-btn-sm" href="report-journal.html?id=' + encodeURIComponent(ctx.pid) +
      "&from=" + encodeURIComponent(ymd(new Date())) + '">📄 Day report (PDF / email)</a></div>' +
    (ctx.canJournal ? formHtml(ctx, draft) : "") +
    '<div id="jrList"></div>';
  st.painted = true;
  paintList(ctx);
  if (ctx.canJournal) {
    Object.keys(INPUTS).forEach(function (f) {
      const n = document.getElementById(INPUTS[f]);
      if (!n) return;
      n.addEventListener("input", touched);
      n.addEventListener("change", touched);
    });
    const pick = document.getElementById("jrPick");
    if (pick) pick.addEventListener("click", function () { const i = document.getElementById("jrInput"); i.value = ""; i.click(); });
    document.getElementById("jrInput").addEventListener("change", function () { queueFiles(this.files); });
    document.getElementById("jrDone").addEventListener("click", finish);
    renderPending();
    status(statusOf(draft));
    paintClash(ctx, draft);
  }
  signThumbs(ctx);
}

async function signThumbs(ctx) {
  const paths = [];
  st.rows.forEach(function (e) {
    e.media.forEach(function (m) {
      const p = m.previewPath || (!m.video ? m.storagePath : null);
      if (p && m.storage !== "local" && !st.urls[p]) paths.push(p);
    });
  });
  if (!paths.length) return;
  try {
    const urls = await filesRepo.signedUrls(paths, SIGNED_GALLERY_S);
    Object.keys(urls).forEach(function (k) { st.urls[k] = urls[k]; });
  } catch (e) { return; }
  paintList(ctx);
  renderPending();
}

/** Captions typed for photos that landed while this page was closed: matched by name. */
async function applyCaptions(ctx) {
  const draft = readDraft(ctx);
  const want = {};
  ((draft && draft.media) || []).concat((draft && draft.carried) || []).forEach(function (m) {
    if (m && m.desc && m.name) want[m.name.toLowerCase()] = m.desc;
  });
  st.pending.forEach(function (m) { if (m.desc && m.name) want[m.name.toLowerCase()] = m.desc; });
  if (!Object.keys(want).length) return;
  const jobs = [], done = {};
  st.rows.forEach(function (e) {
    e.media.forEach(function (m) {
      const k = String(m.name || "").toLowerCase();
      const w = want[k];
      if (w && !m.desc && canCaption(ctx, m)) {
        jobs.push(filesRepo.setCaption(m, w).then(function (row) { m.desc = w; m.version = row.version; done[k] = 1; }, function () {}));
      } else if (w && m.desc === w) done[k] = 1;
    });
  });
  if (jobs.length) await Promise.all(jobs);
  const now = readDraft(ctx);
  if (!now) return;
  const left = function (list) { return (list || []).filter(function (m) { return !(m && m.name && done[m.name.toLowerCase()]); }); };
  if (now.captionsOnly) {
    now.media = left(now.media);
    writeDraft(ctx, now.media.length ? now : null);
  } else if (now.carried && now.carried.length) {
    now.carried = left(now.carried);
    writeDraft(ctx, now);
  }
}

/** Read the journal and draw it. force: draw the form again even while someone has focus in it. */
async function load(ctx, force) {
  const my = ++st.seq;
  try {
    const rows = await journalRepo.list(ctx.pid);
    if (my !== st.seq) return;
    st.rows = rows;
    await applyCaptions(ctx);
    const form = st.host.querySelector("#jrForm");
    if (!force && form && document.activeElement && form.contains(document.activeElement)) {
      paintList(ctx);                       // someone is typing: refresh the list only
      signThumbs(ctx);
      return;
    }
    paint(ctx);
    if (ctx.canJournal) {
      // a kept draft goes up now (written offline, the app killed); a newer row is merged in
      const d = readDraft(ctx);
      const cur = d && d.id ? st.rows.find(function (r) { return String(r.id) === String(d.id); }) : null;
      if (J.needsSync(d) || (cur && Number(cur.version) > Number(d.version || 0))) push(cur ? { current: cur } : undefined);
    }
  } catch (e) {
    if (my !== st.seq) return;
    if (st.painted && document.getElementById("jrList")) { staleNote(ctx, e); return; }
    // nothing on screen yet: the form from this device's draft anyway, so writing goes on offline
    paint(ctx);
    const list = document.getElementById("jrList");
    if (list) list.innerHTML = '<div class="pj-empty">' + ctx.esc(ctx.errorText(e)) + "</div>";
    if (ctx.canJournal && J.needsSync(readDraft(ctx))) push();
  }
}

export function render(ctx, host) {
  st.host = host; st.ctx = ctx;
  host.innerHTML = '<div class="pj-empty">Loading journal…</div>';
  if (!st.wired) {
    st.wired = true;
    host.addEventListener("click", function (e) {
      const t = e.target;
      const ed = t.closest && t.closest("[data-jrn-edit]");
      if (ed) { editEntry(ed.getAttribute("data-jrn-edit")); return; }
      const del = t.closest && t.closest("[data-jrn-del]");
      if (del) { delEntry(del.getAttribute("data-jrn-del")); return; }
      const rm = t.closest && t.closest("[data-prm]");
      if (rm) { removePending(Number(rm.getAttribute("data-prm"))); return; }
      const mine = t.closest && t.closest("[data-mine]");
      if (mine) { useMine(mine.getAttribute("data-mine")); return; }
      const retry = t.closest && t.closest("[data-retry]");
      if (retry) { uploads.retryAll(); return; }
      const open = t.closest && t.closest("[data-open]");
      if (open) {
        const w = window.open("", "_blank");
        filesRepo.signedUrl(open.getAttribute("data-open"), SIGNED_DOC_S * 30).then(function (u) {
          if (u && w) w.location.href = u; else if (w) w.close();
        }, function (err) { if (w) w.close(); ctx.toast(ctx.errorText(err), "error"); });
      }
    });
    const capTimers = {};
    host.addEventListener("input", function (e) {
      const t = e.target;
      if (t.hasAttribute && t.hasAttribute("data-pcap")) {
        const m = st.pending[Number(t.getAttribute("data-pcap"))];
        if (!m) return;
        m.desc = t.value;
        writeDraft(ctx, formDraft(ctx));
        if (m.landed && m.fileId != null) {             // its row exists: the caption goes onto it
          const k = "p" + m.fileId;
          clearTimeout(capTimers[k]);
          capTimers[k] = setTimeout(function () {
            filesRepo.setCaption({ fileId: m.fileId, version: m.fileVersion }, m.desc).then(function (r) {
              m.fileVersion = r.version; t.classList.remove("err");
            }, function (err) { t.classList.add("err"); ctx.toast(ctx.errorText(err), "error"); });
          }, 800);
        }
        return;
      }
      if (t.hasAttribute && t.hasAttribute("data-cap")) {
        const id = t.getAttribute("data-cap");
        clearTimeout(capTimers[id]);
        capTimers[id] = setTimeout(async function () {
          let media = null;
          st.rows.forEach(function (r) { r.media.forEach(function (m) { if (String(m.fileId) === String(id)) media = m; }); });
          if (!media) return;
          try {
            const row = await filesRepo.setCaption(media, t.value);
            media.version = row.version; media.desc = row.description || "";
            t.classList.remove("err");
          } catch (err) {
            t.classList.add("err");
            ctx.toast(ctx.errorText(err), "error");
          }
        }, 800);
      }
    });
    if (ctx.canFiles) {
      uploads.onProgress(function (items, evt) {
        st.progress = {};
        items.forEach(function (it) { st.progress[it.id] = it; });
        st.pending.forEach(function (m) { const it = m.qid && st.progress[m.qid]; if (it && it.name) m.name = it.name; });
        if (evt && evt.type === "done") onLanded(evt);
        else renderPending();
      });
    }
    window.addEventListener("online", function () { if (ctx.canJournal && J.needsSync(readDraft(ctx))) push(); });
  }
  return load(ctx);
}

/** A change arrived (live): read again, once per burst; never under someone's typing. */
export function reload(ctx) {
  if (!st.host) return;
  clearTimeout(st.reloadTimer);
  st.reloadTimer = setTimeout(function () { load(ctx); }, 400);
}
