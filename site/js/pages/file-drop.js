/* One file picker for the money files (the Books program, release A; design-portal §4.1, the contract §4.1): the
   expense dialog's receipts, the bill page's paperwork, a project's and the ledger's rows, the payment panel.

   mountFileDrop(host, opts) -> {files(), clear(), destroy(), busy(), add(list), say(text)}
     opts: {accept: ACCEPT, max: 20, maxBytes: 25 MB, label, hint, camera: "auto" | true | false,
            problem(file) -> "" | the sentence (the page's own check; the receipts' by default),
            onChange(files) - "form" mode: the files are kept as tiles (✕ takes one off) until the page saves them;
            onFiles(files)  - "instant" mode: every accepted batch is handed over at once and nothing is kept,
            pasteOn: an element to listen for Ctrl+V on (else the host's dialog, else the box itself)}
   * Pick: <input type="file" multiple>, and on a touch device a "Take a photo" input (capture="environment").
   * Drop: on the box; a dropped FOLDER is refused (webkitGetAsEntry, as the Files tab does).
   * Paste: Ctrl+V while the box or its dialog has focus - the listener is on the dialog (or the box), never on
     document, so two pickers never fight - and a [Paste] button (navigator.clipboard.read(); where that is missing
     or refused the hint says "Press Ctrl+V here"). Only clipboardData.files and image items become files: pasted
     text or HTML is never an upload, and a paste of text into a text field is left alone.
   * Names: a pasted image, or a camera's generic name (image.jpg, IMG_4412.jpg: cameraName, map/cost-form.js genericName), is
     handed on WITHOUT a name (uploadName -> undefined), so the queue names it "<Receipt|Bill|Payment> <time>[-n]";
     a real name ("INV-4101.pdf") is kept, and the database makes a clash "INV-4101 (2).pdf".
   * Checks before anything is queued: the type and size (pictureOrPdf - the receipts' rule of map/cost-form.js receiptProblem,
     the same words; this module never imports the cost dialog's rules, so a page that mounts it carries none of them),
     at most `max` at once, the same file twice (name + size + last modified) ignored.
   * Tiles (form mode): a blob: preview for a picture (the policy's img-src allows blob:), a PDF's mark and name, a
     HEIC photo said ("preview on iPhone only": Chrome cannot draw one), ✕ to take one off before saving.
   Every name is put on the page with textContent, never as markup. Its look is its own (.fd-*, on the theme's
   tokens), added once to the page, so every page that mounts one looks the same.
   The pure helpers are exported for the node tests: acceptable, dedupe, fileKey, filesFromTransfer, pasteFiles,
   limitText, uploadName, wasPasted, queueAll. */

export const MAX_FILES = 20;
export const MAX_BYTES = 25 * 1024 * 1024;
/** The pickers' accept list: photos and scans (an iPhone's HEIC too) and PDFs (map/cost-form.js RECEIPT_ACCEPT). */
export const ACCEPT = "image/jpeg,image/png,image/heic,image/heif,image/webp,image/gif,image/tiff,application/pdf";
const pasted = new WeakSet();

/** "IMG_4412.jpg", "image.jpg", "photo.png": a camera's own name says nothing (map/cost-form.js genericName). */
export function cameraName(name) {
  return /^(image|img_?\d+|photo|scan|document)(\s*\(\d+\))?\.\w+$/i.test(String(name == null ? "" : name).trim());
}

/** A picture or a PDF, at most 25 MB -> "" or the sentence (map/cost-form.js receiptProblem's rule and words). */
export function pictureOrPdf(file) {
  if (!file || !file.size) return "That file is empty.";
  if (file.size > MAX_BYTES) return "A receipt can be at most 25 MB.";
  const t = String(file.type || "").toLowerCase();
  const n = String(file.name || "").toLowerCase();
  if (t === "image/svg+xml" || /\.svgz?$/.test(n)) return "A receipt is a photo, a scan or a PDF.";
  if (t.indexOf("image/") === 0 || t === "application/pdf" || /\.(pdf|jpe?g|png|heic|heif|webp|gif|tiff?)$/.test(n)) return "";
  return "A receipt is a photo, a scan or a PDF.";
}

/* ── pure helpers ─────────────────────────────────────────────────────── */

/** "" when the file may go, else the sentence (o.problem: the page's own rule; o.maxBytes: the size limit). */
export function acceptable(file, opts) {
  const o = opts || {};
  if (!file || !file.size) return "That file is empty.";
  const max = Number(o.maxBytes) || MAX_BYTES;
  if (file.size > max) return "A file can be at most " + Math.round(max / (1024 * 1024)) + " MB.";
  return typeof o.problem === "function" ? String(o.problem(file) || "") : pictureOrPdf(file);
}

/** name + size + last modified: the same file dropped twice is one. */
export function fileKey(f) {
  return [String((f && f.name) || ""), Number((f && f.size) || 0), Number((f && f.lastModified) || 0)].join("|");
}

/** The list without a file seen before (in it, or in `held`), the first kept. */
export function dedupe(list, held) {
  const seen = new Set((held || []).map(fileKey));
  const out = [];
  for (const f of list || []) {
    const k = fileKey(f);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  return out;
}

/** The sentence for files beyond the limit ("" when none are). */
export function limitText(over, max) {
  const n = Number(over) || 0;
  const m = Number(max) || MAX_FILES;
  return n > 0 ? "At most " + m + " files at a time: " + n + (n === 1 ? " was" : " were") + " left out." : "";
}

const IMG_EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp", "image/heic": ".heic",
  "image/heif": ".heif", "image/tiff": ".tiff", "image/bmp": ".bmp", "application/pdf": ".pdf" };
const GOOD_EXT = /\.(pdf|jpe?g|jfif|png|gif|webp|heic|heif|tiff?|bmp)$/i;

/** Was this file pasted (Ctrl+V or the Paste button)? */
export function wasPasted(file) { return !!file && typeof file === "object" && pasted.has(file); }

/** The name to hand the queue: undefined for a paste or a camera's own name (the queue names it); otherwise the
    name with no control character, and with its type's extension when it has none the database would take. */
export function uploadName(file) {
  if (!file || wasPasted(file)) return undefined;
  const raw = String(file.name || "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  if (!raw || cameraName(raw)) return undefined;
  if (GOOD_EXT.test(raw)) return raw;
  const ext = IMG_EXT[String(file.type || "").toLowerCase()];
  return ext ? raw + ext : undefined;
}

function itemEntry(it) {
  try { return it && typeof it.webkitGetAsEntry === "function" ? it.webkitGetAsEntry() : null; } catch (e) { return null; }
}

/** A paste's or a drop's DataTransfer -> {files, folder}: its files (a drop's folders left out and said); for a paste
    with no files, its image items. Never text or HTML. Pasted files are remembered as pasted (uploadName). */
export function filesFromTransfer(dt, isPaste) {
  if (!dt) return { files: [], folder: false };
  const items = dt.items ? Array.prototype.slice.call(dt.items) : [];
  let folder = false;
  let files = Array.prototype.slice.call(dt.files || []).filter(function (f, i) {
    const en = itemEntry(items[i]);
    if (en && en.isDirectory) { folder = true; return false; }
    return !!f;
  });
  if (!files.length) {
    files = items.filter(function (it) { return it && it.kind === "file" && /^image\//i.test(String(it.type || "")); })
      .map(function (it) { return it.getAsFile ? it.getAsFile() : null; }).filter(Boolean);
  }
  if (isPaste) files.forEach(function (f) { try { pasted.add(f); } catch (e) { /* a stub */ } });
  return { files, folder };
}

/** navigator.clipboard.read()'s items -> the images on it, as files (each remembered as pasted). */
export async function pasteFiles(items) {
  const out = [];
  for (const it of items || []) {
    const type = (it && it.types ? Array.prototype.slice.call(it.types) : []).find(function (t) { return /^image\//i.test(t); });
    if (!type) continue;
    const blob = await it.getType(type);
    if (!blob) continue;
    const ext = IMG_EXT[type.toLowerCase()] || ".png";
    const f = typeof File === "function" ? new File([blob], "image" + ext, { type, lastModified: Date.now() }) : blob;
    try { pasted.add(f); } catch (e) { /* */ }
    out.push(f);
  }
  return out;
}

/** Hand `files` to the queue one by one: enqueue(job) per file, job = jobFor(file) (its name: uploadName). ->
    {queued: n, failed: [{file, error}]} - one refusal never stops the others. */
export async function queueAll(files, enqueue, jobFor) {
  let queued = 0;
  const failed = [];
  for (const f of files || []) {
    try { await enqueue(Object.assign({ file: f, name: uploadName(f) }, jobFor ? jobFor(f) : {})); queued++; }
    catch (e) { failed.push({ file: f, error: e }); }
  }
  return { queued, failed };
}

/* ── the look (added to the page once) ────────────────────────────────── */

const STYLE = [
  ".fd{border:1.5px dashed var(--border,#dfe3e8);border-radius:10px;padding:10px 12px;background:var(--surface,#fff);color:var(--text,#1b2733);outline:none;min-width:0}",
  ".fd:focus-within,.fd:focus{border-color:var(--p2,#0f8b7d)}",
  ".fd.fd-over{border-color:var(--p2,#0f8b7d);background:var(--p2-tint,rgba(15,139,125,.12))}",
  ".fd-zone{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;font-size:13px}",
  ".fd-label{font-weight:600;flex:1 1 180px;min-width:0;overflow-wrap:anywhere}",
  ".fd-b{border:1px solid var(--border,#dfe3e8);background:var(--surface-2,#f0f2f5);color:var(--text,#1b2733);border-radius:8px;padding:5px 10px;font:inherit;font-size:12.5px;cursor:pointer}",
  ".fd-b:hover{border-color:var(--p2,#0f8b7d)}",
  ".fd-hint{color:var(--text-muted,#61738a);font-size:12px;flex-basis:100%}",
  ".fd-tiles{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}",
  ".fd-tiles:empty{display:none}",
  ".fd-t{position:relative;width:92px;border:1px solid var(--border,#dfe3e8);border-radius:8px;background:var(--surface-2,#f0f2f5);overflow:hidden;font-size:11px}",
  ".fd-t .pv{height:64px;display:flex;align-items:center;justify-content:center;font-weight:800;color:var(--text-muted,#61738a);font-size:12px;text-align:center;padding:2px}",
  ".fd-t .pv img{max-width:100%;max-height:64px;display:block}",
  ".fd-t .nm{padding:3px 5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".fd-t .x{position:absolute;top:2px;right:2px;border:0;border-radius:50%;width:20px;height:20px;line-height:18px;padding:0;background:rgba(0,0,0,.55);color:#fff;cursor:pointer;font-size:12px}",
  ".fd-msg{font-size:12.5px;color:var(--danger,#c8371f);margin-top:6px}",
  ".fd-msg:empty{display:none}",
  ".fd-msg.ok{color:var(--text-muted,#61738a)}",
  // a record's files already there (the expense dialog's receipts): the name and its ✕
  ".fd-have{display:inline-flex;align-items:center;gap:2px;margin:4px 8px 2px 0;max-width:100%}",
  ".fd-have button:first-child{max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  // a row that takes a dropped or pasted file (the ledger, a project's expenses)
  "tr.fd-row-over>td{background:var(--p2-tint,rgba(15,139,125,.12))!important}",
  "tr.fd-row-sel>td{box-shadow:inset 0 2px 0 var(--p2,#0f8b7d),inset 0 -2px 0 var(--p2,#0f8b7d)}",
  "tr[data-drop]:focus{outline:2px solid var(--p2,#0f8b7d);outline-offset:-2px}",
].join("\n");

export function ensureStyle() {
  if (typeof document === "undefined" || document.getElementById("fdStyle")) return;
  const s = document.createElement("style");
  s.id = "fdStyle";
  s.textContent = STYLE;
  (document.head || document.documentElement).appendChild(s);
}

/* ── the box ──────────────────────────────────────────────────────────── */

function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function touch() {
  try { return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches; } catch (e) { return false; }
}

const isHeic = (f) => /^image\/hei[cf]$/i.test(String(f.type || "")) || /\.hei[cf]$/i.test(String(f.name || ""));
const isPic = (f) => /^image\//i.test(String(f.type || "")) && !isHeic(f) && !/tiff/i.test(String(f.type || ""));
const isPdf = (f) => /pdf/i.test(String(f.type || "")) || /\.pdf$/i.test(String(f.name || ""));

/** A drop target on a table row (the ledger, a project's expenses): drag a file over it, drop it, or select the row
    and press Ctrl+V (the paste is heard on `scope`, the table's box: never document). onFiles(rowEl, files);
    rowSel: the rows' selector (each carries data-drop). -> () => remove the listeners. */
export function rowDrops(scope, rowSel, onFiles, onRefused) {
  ensureStyle();
  const sel = rowSel || "tr[data-drop]";
  const rowOf = (e) => (e.target && e.target.closest ? e.target.closest(sel) : null);
  const hasFiles = (e) => !!(e.dataTransfer && Array.prototype.slice.call(e.dataTransfer.types || []).indexOf("Files") !== -1);
  function over(e) {
    const r = rowOf(e);
    if (!r || !hasFiles(e)) return;
    e.preventDefault();
    scope.querySelectorAll("tr.fd-row-over").forEach((x) => { if (x !== r) x.classList.remove("fd-row-over"); });
    r.classList.add("fd-row-over");
  }
  function leave(e) {
    const r = rowOf(e);
    if (r && !r.contains(e.relatedTarget)) r.classList.remove("fd-row-over");
  }
  function drop(e) {
    const r = rowOf(e);
    if (!r) return;
    e.preventDefault();
    r.classList.remove("fd-row-over");
    const got = filesFromTransfer(e.dataTransfer, false);
    if (got.folder && onRefused) onRefused("A folder can't be dropped here: drop the files themselves.");
    if (got.files.length) onFiles(r, got.files);
  }
  function pick(e) {
    const r = rowOf(e);
    if (!r || (e.target && e.target.closest && e.target.closest("button, a, input, select, textarea, label"))) return;
    scope.querySelectorAll("tr.fd-row-sel").forEach((x) => x.classList.remove("fd-row-sel"));
    r.classList.add("fd-row-sel");
  }
  function paste(e) {
    const t = e.target;
    if (t && t.closest && t.closest("input, textarea, [contenteditable]")) return;   // typing: left alone
    const r = (t && t.closest ? t.closest(sel) : null) || scope.querySelector("tr.fd-row-sel");
    if (!r) return;
    const got = filesFromTransfer(e.clipboardData, true);
    if (!got.files.length) return;
    e.preventDefault();
    onFiles(r, got.files);
  }
  scope.addEventListener("dragover", over);
  scope.addEventListener("dragleave", leave);
  scope.addEventListener("drop", drop);
  scope.addEventListener("click", pick);
  scope.addEventListener("focusin", pick);
  scope.addEventListener("paste", paste);
  return function off() {
    scope.removeEventListener("dragover", over);
    scope.removeEventListener("dragleave", leave);
    scope.removeEventListener("drop", drop);
    scope.removeEventListener("click", pick);
    scope.removeEventListener("focusin", pick);
    scope.removeEventListener("paste", paste);
  };
}

export function mountFileDrop(host, opts) {
  const o = Object.assign({ accept: ACCEPT, max: MAX_FILES, maxBytes: MAX_BYTES, camera: "auto" }, opts || {});
  ensureStyle();
  let held = [];
  const urls = new Map();
  let working = 0;

  const box = node("div", "fd");
  box.tabIndex = 0;
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", o.label || "Files");
  const zone = node("div", "fd-zone");
  zone.appendChild(node("span", "fd-label", o.label || "Files: drop, paste or choose"));
  const pickBtn = node("button", "fd-b fd-pick", "Choose files");
  pickBtn.type = "button";
  zone.appendChild(pickBtn);
  let camBtn = null;
  if (o.camera === true || (o.camera === "auto" && touch())) {
    camBtn = node("button", "fd-b fd-cam", "Take a photo");
    camBtn.type = "button";
    zone.appendChild(camBtn);
  }
  const pasteBtn = node("button", "fd-b fd-paste", "Paste");
  pasteBtn.type = "button";
  zone.appendChild(pasteBtn);
  const hint = node("span", "fd-hint", o.hint || "or drop them here, or press Ctrl+V here (a screenshot, a photo, a PDF)");
  zone.appendChild(hint);
  box.appendChild(zone);
  const input = node("input", "fd-in");
  input.type = "file";
  input.multiple = true;
  input.accept = o.accept;
  input.hidden = true;
  box.appendChild(input);
  let cam = null;
  if (camBtn) {
    cam = node("input", "fd-camin");
    cam.type = "file";
    cam.accept = "image/*";
    cam.setAttribute("capture", "environment");
    cam.hidden = true;
    box.appendChild(cam);
  }
  const tiles = node("div", "fd-tiles");
  box.appendChild(tiles);
  const msg = node("div", "fd-msg");
  msg.setAttribute("role", "status");
  box.appendChild(msg);
  host.appendChild(box);

  function say(text, quiet) {
    msg.textContent = text || "";
    msg.classList.toggle("ok", !!quiet);
  }

  function drawTiles() {
    tiles.textContent = "";
    held.forEach(function (f, i) {
      const t = node("div", "fd-t");
      const pv = node("div", "pv");
      if (isPic(f) && typeof URL !== "undefined" && URL.createObjectURL) {
        if (!urls.has(f)) urls.set(f, URL.createObjectURL(f));
        const img = node("img");
        img.alt = "";
        img.src = urls.get(f);
        pv.appendChild(img);
      } else if (isHeic(f)) {
        pv.textContent = "HEIC photo — preview on iPhone only";
      } else {
        pv.textContent = isPdf(f) ? "PDF" : "FILE";
      }
      t.appendChild(pv);
      // a paste is named by the queue ("Receipt <time>"): its clipboard name ("image.png") is not shown as its name
      const nm = node("div", "nm", wasPasted(f) || !f.name ? "Pasted picture" : f.name);
      nm.title = wasPasted(f) ? "A pasted picture: it is named by the time it is saved" : f.name || "";
      t.appendChild(nm);
      const x = node("button", "x", "✕");
      x.type = "button";
      x.title = "Take this one off";
      x.setAttribute("aria-label", "Take " + (f.name || "this file") + " off");
      x.setAttribute("data-fd-i", String(i));
      t.appendChild(x);
      tiles.appendChild(t);
    });
  }

  function forget(f) {
    const u = urls.get(f);
    if (u) { try { URL.revokeObjectURL(u); } catch (e) { /* */ } urls.delete(f); }
  }

  /** Take files in (picked, dropped or pasted): checked, de-duplicated, limited; then kept or handed on. */
  function add(list, folder) {
    const all = Array.prototype.slice.call(list || []).filter(Boolean);
    const problems = [];
    const ok = [];
    all.forEach(function (f) {
      const p = acceptable(f, o);
      if (p) problems.push((f.name ? f.name + ": " : "") + p);
      else ok.push(f);
    });
    let fresh = dedupe(ok, o.onFiles ? [] : held);
    const room = Math.max(0, Number(o.max) - (o.onFiles ? 0 : held.length));
    const over = Math.max(0, fresh.length - room);
    fresh = fresh.slice(0, room);
    const words = [];
    if (folder) words.push("A folder can't be dropped here: drop the files themselves.");
    if (problems.length) words.push(problems.length === 1 ? problems[0] : problems.length + " files were not taken: " + problems[0]);
    if (over) words.push(limitText(over, o.max));
    say(words.join(" "));
    if (!fresh.length) return [];
    if (o.onFiles) {
      Promise.resolve().then(function () { return o.onFiles(fresh); }).catch(function () { /* the page says it */ });
      return fresh;
    }
    held = held.concat(fresh);
    drawTiles();
    if (o.onChange) o.onChange(held.slice());
    return fresh;
  }

  function onPick() { add(input.files); input.value = ""; }
  function onCam() { add(cam.files); cam.value = ""; }
  function onOver(e) {
    if (!e.dataTransfer || Array.prototype.slice.call(e.dataTransfer.types || []).indexOf("Files") === -1) return;
    e.preventDefault();
    box.classList.add("fd-over");
  }
  function onLeave(e) { if (!box.contains(e.relatedTarget)) box.classList.remove("fd-over"); }
  function onDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    box.classList.remove("fd-over");
    const got = filesFromTransfer(e.dataTransfer, false);
    add(got.files, got.folder);
  }
  function onPaste(e) {
    if (!box.isConnected) return;
    const got = filesFromTransfer(e.clipboardData, true);
    if (!got.files.length) return;                  // text into a text field: left alone
    e.preventDefault();
    e.stopPropagation();
    add(got.files);
  }
  async function onPasteBtn() {
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.read !== "function") throw new Error("no clipboard");
      working++;
      const got = await pasteFiles(await navigator.clipboard.read());
      if (!got.length) { say("Nothing to paste: copy a screenshot or a photo first, then press Paste (or Ctrl+V here).", true); return; }
      add(got);
    } catch (e) {
      say("Press Ctrl+V here to paste (this browser does not let the button read the clipboard).", true);
      try { box.focus(); } catch (x) { /* */ }
    } finally {
      working = Math.max(0, working - 1);
    }
  }
  function onTiles(e) {
    const b = e.target && e.target.closest ? e.target.closest("[data-fd-i]") : null;
    if (!b) return;
    const i = Number(b.getAttribute("data-fd-i"));
    const f = held[i];
    if (!f) return;
    forget(f);
    held = held.filter(function (_x, j) { return j !== i; });
    drawTiles();
    if (o.onChange) o.onChange(held.slice());
  }
  function onKey(e) {
    if (e.target === box && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); input.click(); }
  }

  const pasteHost = o.pasteOn || (host.closest ? host.closest('[role="dialog"], dialog') : null) || box;
  pickBtn.addEventListener("click", function () { input.click(); });
  if (camBtn) camBtn.addEventListener("click", function () { cam.click(); });
  pasteBtn.addEventListener("click", onPasteBtn);
  input.addEventListener("change", onPick);
  if (cam) cam.addEventListener("change", onCam);
  box.addEventListener("dragover", onOver);
  box.addEventListener("dragleave", onLeave);
  box.addEventListener("drop", onDrop);
  box.addEventListener("keydown", onKey);
  tiles.addEventListener("click", onTiles);
  pasteHost.addEventListener("paste", onPaste);

  return {
    el: box,
    files: function () { return held.slice(); },
    add: function (list) { return add(list); },
    clear: function () { held.forEach(forget); held = []; drawTiles(); say(""); if (o.onChange) o.onChange([]); },
    busy: function () { return working > 0; },
    say: say,
    destroy: function () {
      pasteHost.removeEventListener("paste", onPaste);
      held.forEach(forget);
      held = [];
      if (box.parentNode) box.parentNode.removeChild(box);
    },
  };
}
