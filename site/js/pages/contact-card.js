/* The contact card: a contact's picture, phone and e-mail, changed on the web (the Books program, release A3; Books
   plan decision I5 and §4.2; design-portal §5.2). Opened from a payee's picture on The Books, a contact's picture in
   Search, or [Add phone / e-mail]; fetched only then (pages/avatar.js openCard). Its name, company, kind and trades are
   shown, never changed: "The rest of the contact is edited in DCR Desktop 2."

   * openContactCard(contactId, {me, onSaved}) -> a promise of the contact as it was last saved here (null: nothing
     was). Only for a contact editor (can(me, "contacts"): an admin, a manager or an accountant - app.can_edit
     ('contacts'); the database decides every write). The contact is read fresh (its version).
   * The picture: choose one (a phone offers its camera and its library), drop one on the circle, or paste one
     (Ctrl+V while the card is open, or [Paste]: only a picture on the clipboard is taken, never text). It is made here
     (thumb-prep.js prepare with {maxSide: 400, square: true}: the centre square, 400 x 400, a JPEG on white, drawn again
     so no camera data goes with it) and saved at once (repo/contacts.js setPicture: the upload, then the one column).
     [Remove the picture]: initials again.
   * Phone and e-mail: [Save] sends what changed (repo/contacts.js updateReach): the database tidies the phone; another
     contact with that e-mail is said in the database's own terms ("Another contact already has this e-mail.").
   Every word from the database goes in as text (textContent, or escaped). Browser-only module. */

import { can, esc, toast, confirmBox, errorText } from "./shell.js";
import * as repo from "../repo/contacts.js";
import { avatarHtml, paintAvatars, ensureStyle } from "./avatar.js";
import { prepare, ACCEPT } from "../thumb-prep.js";

export const KIND_LABEL = Object.freeze({ client: "Client", subcontractor: "Subcontractor", supplier: "Supplier", service: "Service", other: "Other" });
export const NOT_YOURS = "Only an admin, a manager or an accountant changes contacts.";
const PICTURE_EXT = /\.(jpe?g|png|webp|gif|hei[cf])$/i;

const CSS =
  ".cc-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;z-index:80;padding:14px;}" +
  ".cc-overlay.open{display:flex;}" +
  ".cc-card{background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:14px;width:100%;max-width:440px;" +
  "max-height:calc(100vh - 28px);overflow:auto;padding:18px 18px 14px;box-shadow:0 18px 50px rgba(0,0,0,.35);}" +
  ".cc-card h3{margin:0 0 12px;font-size:16px;}" +
  ".cc-top{display:flex;align-items:center;gap:14px;margin-bottom:10px;}" +
  ".cc-pic{border-radius:50%;flex-shrink:0;}" +
  ".cc-pic.drag{box-shadow:0 0 0 3px var(--accent);}" +
  ".cc-who{min-width:0;}" +
  ".cc-name{font-size:16px;font-weight:700;overflow-wrap:anywhere;}" +
  ".cc-sub{font-size:12.5px;color:var(--text-muted);overflow-wrap:anywhere;}" +
  ".cc-picacts{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 4px;}" +
  ".cc-hint,.cc-note{font-size:12px;color:var(--text-muted);margin:2px 0 10px;}" +
  ".cc-f{margin:0 0 10px;}" +
  ".cc-f label{display:block;font-size:12.5px;font-weight:600;margin-bottom:3px;}" +
  ".cc-f input{width:100%;box-sizing:border-box;padding:9px 10px;font-size:15px;border:1px solid var(--border);border-radius:8px;" +
  "background:var(--surface);color:var(--text);}" +
  ".cc-msg{min-height:18px;font-size:13px;margin:4px 0 8px;overflow-wrap:anywhere;}" +
  ".cc-msg.bad{color:var(--danger);}" +
  ".cc-msg.good{color:var(--ok);}" +
  ".cc-acts{display:flex;justify-content:flex-end;gap:8px;}" +
  "@media (max-width:420px){.cc-card{padding:14px 12px 12px;}.cc-acts .btn{min-height:44px;}}";

const st = { host: null, row: null, pictures: true, busy: false, opts: null, saved: null, resolve: null, lastFocus: null };

function $(id) { return document.getElementById(id); }

function style() {
  if (document.getElementById("ccStyle")) return;
  const s = document.createElement("style");
  s.id = "ccStyle";
  s.textContent = CSS;
  (document.head || document.documentElement).appendChild(s);
}

function host() {
  if (st.host && st.host.isConnected) return st.host;
  const h = document.createElement("div");
  h.id = "ccModal";
  h.className = "cc-overlay";
  h.setAttribute("role", "dialog");
  h.setAttribute("aria-modal", "true");
  h.setAttribute("aria-labelledby", "ccH");
  h.addEventListener("click", (e) => { if (e.target === h && !st.busy) close(); });
  h.addEventListener("keydown", (e) => { if (e.key === "Escape" && !st.busy) { e.preventDefault(); close(); } });
  // Ctrl+V while the card is open: a picture on the clipboard becomes the contact's picture (text is left alone)
  h.addEventListener("paste", (e) => {
    const files = pictureFiles(e.clipboardData);
    if (!files.length) return;
    e.preventDefault();
    takeFile(files[0]);
  });
  document.body.appendChild(h);
  st.host = h;
  return h;
}

/** The picture files of a paste or a drop (DataTransfer): its files, or its items that are image files. */
export function pictureFiles(dt) {
  if (!dt) return [];
  const out = [];
  const isPic = (f) => !!f && (/^image\//i.test(String(f.type || "")) || PICTURE_EXT.test(String(f.name || "")));
  Array.prototype.forEach.call(dt.files || [], (f) => { if (isPic(f)) out.push(f); });
  if (!out.length) {
    Array.prototype.forEach.call(dt.items || [], (it) => {
      if (it && it.kind === "file" && /^image\//i.test(String(it.type || ""))) {
        const f = typeof it.getAsFile === "function" ? it.getAsFile() : null;
        if (f) out.push(f);
      }
    });
  }
  return out;
}

function say(text, kind) {
  const m = $("ccMsg");
  if (!m) return;
  m.textContent = text || "";
  m.className = "cc-msg" + (kind ? " " + kind : "");
}

function busy(on) {
  st.busy = !!on;
  const card = st.host && st.host.querySelector(".cc-card");
  if (!card) return;
  card.querySelectorAll("button, input").forEach((n) => { if (n.type !== "file") n.disabled = st.busy; });
  card.setAttribute("aria-busy", st.busy ? "true" : "false");
}

function close() {
  st.busy = false;
  if (!st.host) return;
  st.host.classList.remove("open");
  st.host.innerHTML = "";
  const done = st.resolve;
  st.resolve = null;
  try { if (st.lastFocus && st.lastFocus.focus && st.lastFocus.isConnected) st.lastFocus.focus(); } catch (e) { /* */ }
  if (done) done(st.saved);
}

function subLine(r) {
  const company = String(r.company || "").trim();
  const name = String(r.name || "").trim();
  return [company && company !== name ? company : "", KIND_LABEL[r.kind] || ""].filter(Boolean).join(" · ");
}

function paintPicture() {
  const box = $("ccPic");
  if (!box || !st.row) return;
  box.innerHTML = avatarHtml(st.row, { size: 96 });
  paintAvatars(box);
  const has = repo.picturePathOk(st.row.picture_path);
  const rm = $("ccRemove");
  if (rm) rm.hidden = !has;
}

function draw() {
  const r = st.row;
  const h = host();
  const live = !r.deleted_at;
  const pics = st.pictures && live;
  const paste = typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.read === "function";
  h.innerHTML = '<div class="cc-card">' +
    '<h3 id="ccH">Contact</h3>' +
    '<div class="cc-top"><div class="cc-pic" id="ccPic"></div><div class="cc-who"><div class="cc-name" id="ccName"></div>' +
      '<div class="cc-sub" id="ccSub"></div></div></div>' +
    (pics
      ? '<div class="cc-picacts"><button type="button" class="btn btn-ghost btn-sm" id="ccChoose">Choose a picture…</button>' +
        '<input type="file" id="ccFile" accept="' + esc(ACCEPT.join(",")) + '" hidden>' +
        (paste ? '<button type="button" class="btn btn-ghost btn-sm" id="ccPaste">Paste a picture</button>' : "") +
        '<button type="button" class="btn btn-ghost btn-sm" id="ccRemove" hidden>Remove the picture</button></div>' +
        '<div class="cc-hint">Or drop a picture on the circle, or paste one here (Ctrl+V). It is cut to a square, 400 × 400.</div>'
      : '<div class="cc-hint">' + (live ? "Contact pictures arrive with the next database update."
        : "This contact is deleted: it is restored in DCR Desktop 2 first.") + "</div>") +
    '<form id="ccForm" novalidate autocomplete="off">' +
      '<div class="cc-f"><label for="ccPhone">Phone</label><input id="ccPhone" type="tel" inputmode="tel" maxlength="' + repo.PHONE_MAX + '"></div>' +
      '<div class="cc-f"><label for="ccEmail">E-mail</label><input id="ccEmail" type="email" inputmode="email" maxlength="' + repo.EMAIL_MAX + '"></div>' +
    "</form>" +
    '<div class="cc-note">The rest of the contact is edited in DCR Desktop 2.</div>' +
    '<div class="cc-msg" id="ccMsg" role="status" aria-live="polite"></div>' +
    '<div class="cc-acts"><button type="button" class="btn btn-ghost btn-sm" id="ccClose">Close</button>' +
      (live ? '<button type="button" class="btn btn-sm" id="ccSave">Save</button>' : "") + "</div></div>";
  $("ccName").textContent = String(r.name || r.company || "(no name)");
  $("ccSub").textContent = subLine(r);
  $("ccPhone").value = r.phone || "";
  $("ccEmail").value = r.email || "";
  if (!live) { $("ccPhone").readOnly = true; $("ccEmail").readOnly = true; }
  paintPicture();
  $("ccClose").addEventListener("click", () => { if (!st.busy) close(); });
  if (live) {
    $("ccSave").addEventListener("click", saveReach);
    $("ccForm").addEventListener("submit", (e) => { e.preventDefault(); saveReach(); });
    ["ccPhone", "ccEmail"].forEach((id) => $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); saveReach(); } }));
  }
  if (pics) {
    const file = $("ccFile");
    $("ccChoose").addEventListener("click", () => { if (!st.busy) file.click(); });
    file.addEventListener("change", () => { const f = file.files && file.files[0]; file.value = ""; if (f) takeFile(f); });
    if ($("ccPaste")) $("ccPaste").addEventListener("click", pasteButton);
    $("ccRemove").addEventListener("click", removePicture);
    const pic = $("ccPic");
    pic.addEventListener("dragover", (e) => { e.preventDefault(); pic.classList.add("drag"); });
    pic.addEventListener("dragleave", () => pic.classList.remove("drag"));
    pic.addEventListener("drop", (e) => {
      e.preventDefault();
      pic.classList.remove("drag");
      const files = pictureFiles(e.dataTransfer);
      if (files.length) takeFile(files[0]);
      else say("That is not a picture: drop a JPEG, PNG, WebP or HEIC photo.", "bad");
    });
  }
}

function saved(row) {
  st.row = Object.assign({}, st.row, row || {});
  st.saved = st.row;
  const cb = st.opts && st.opts.onSaved;
  if (typeof cb === "function") { try { cb(st.row); } catch (e) { /* the page's own redraw */ } }
}

async function takeFile(file) {
  if (st.busy || !st.row || !st.pictures || st.row.deleted_at) return;
  if (!file || !(/^image\//i.test(String(file.type || "")) || PICTURE_EXT.test(String(file.name || "")))) {
    say("That is not a picture: pick a JPEG, PNG, WebP or HEIC photo.", "bad");
    return;
  }
  busy(true);
  say("Making the picture…");
  try {
    const pic = await prepare(file, { maxSide: repo.PICTURE_SIDE, square: true });
    say("Saving the picture…");
    saved(await repo.setPicture(st.row, pic));
    paintPicture();
    say("Picture saved.", "good");
  } catch (e) {
    say(errorText(e), "bad");
  } finally {
    busy(false);
    paintPicture();
  }
}

async function pasteButton() {
  if (st.busy) return;
  try {
    const items = await navigator.clipboard.read();
    for (const it of items || []) {
      const type = (it.types || []).find((t) => /^image\//i.test(t));
      if (!type) continue;
      const blob = await it.getType(type);
      const ext = type.split("/")[1].replace(/[^a-z0-9]/gi, "").slice(0, 5) || "png";
      takeFile(new File([blob], "pasted." + ext, { type }));
      return;
    }
    say("There is no picture on the clipboard: copy one first.", "bad");
  } catch (e) {
    say("The clipboard can't be read here: press Ctrl+V instead, or choose a picture.", "bad");
  }
}

async function removePicture() {
  if (st.busy || !st.row || !repo.picturePathOk(st.row.picture_path)) return;
  const ok = await confirmBox("Remove the picture of " + (st.row.name || st.row.company || "this contact") + "? Their initials show again.",
    { okText: "Remove it", danger: true });
  if (!ok) return;
  busy(true);
  say("Removing the picture…");
  try {
    saved(await repo.clearPicture(st.row));
    say("Picture removed.", "good");
  } catch (e) {
    say(errorText(e), "bad");
  } finally {
    busy(false);
    paintPicture();
  }
}

async function saveReach() {
  if (st.busy || !st.row || st.row.deleted_at) return;
  const phone = $("ccPhone").value, email = $("ccEmail").value;
  const norm = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  const change = {};
  if (norm(phone) !== norm(st.row.phone)) change.phone = phone;
  if (norm(email) !== norm(st.row.email)) change.email = email;
  if (!Object.keys(change).length) { say("Nothing changed."); return; }
  const problem = repo.reachProblem(change);
  if (problem) { say(problem, "bad"); return; }
  busy(true);
  say("Saving…");
  try {
    saved(await repo.updateReach(st.row, change));
    const who = st.row.name || st.row.company || "the contact";
    close();
    toast("Saved: the phone and e-mail of " + who + ".", "ok");
  } catch (e) {
    busy(false);
    if (e && (e.code === "PT409" || e.status === 409) && e.current) {
      // someone else changed the phone or e-mail meanwhile: theirs is shown, nothing of theirs is written over
      st.row = Object.assign({}, st.row, e.current);
      $("ccPhone").value = st.row.phone || "";
      $("ccEmail").value = st.row.email || "";
      paintPicture();
      say("Someone else changed this contact meanwhile: their phone and e-mail are shown now. Type yours again if it should change.", "bad");
      return;
    }
    say(errorText(e), "bad");
  }
}

/** Open the card for `contactId` (see the header). */
export async function openContactCard(contactId, opts) {
  const o = opts || {};
  if (!can(o.me, "contacts")) { toast(NOT_YOURS, "error"); return null; }
  if (st.resolve) close();                                    // one card at a time
  style();
  ensureStyle();
  st.opts = o;
  st.busy = false;
  st.saved = null;
  st.row = null;
  st.lastFocus = document.activeElement;
  const h = host();
  h.innerHTML = '<div class="cc-card"><h3 id="ccH">Contact</h3><div class="cc-msg" id="ccMsg" role="status">Loading…</div>' +
    '<div class="cc-acts"><button type="button" class="btn btn-ghost btn-sm" id="ccClose">Close</button></div></div>';
  $("ccClose").addEventListener("click", () => close());
  h.classList.add("open");
  const result = new Promise((resolve) => { st.resolve = resolve; });
  try {
    const got = await repo.getContact(contactId);
    if (!st.resolve) return result;                           // closed meanwhile
    if (!got) { say("That contact was not found: it may have been deleted.", "bad"); return result; }
    st.row = got.row;
    st.pictures = got.pictures;
    draw();
    const first = $("ccChoose") || $("ccPhone");
    setTimeout(() => { try { if (first) first.focus(); } catch (e) { /* */ } }, 20);
  } catch (e) {
    say(errorText(e), "bad");
  }
  return result;
}
