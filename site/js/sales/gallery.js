/* The picture gallery of the sales pages (port of the old gallery.js; BLUEPRINT 3.3.11 "Sales estimates and
   materials library": images in the private bucket sales-media, opened with signed URLs).

   One engine for every sales screen that manages pictures (Materials Library, Reference Projects, the deck
   estimate's photos and drawings). An entry is {path, name, mime?, size?, ann?, cme?, cad?}: `path` is the
   object in sales-media (repo/sales.js uploadMedia), opened through a signed URL (an hour: an open gallery). Index
   0 is the COVER.

   What changed from the old widget:
   * bytes go to Supabase Storage (the sales-media bucket, readable only with the Sales estimates switch) instead
     of a base64 POST to the old server; a picture is shown through a signed URL, never a public one;
   * the "URL" intake is gone: the site's security policy shows no picture from another site (img-src is the
     site, blob:, data: and the database's storage only), so a pasted https link could never be shown. An old
     entry that is a link ({url}) is kept and drawn as a link tile that opens it in a new tab;
   * a drawing made by the old portal's sketch tool ({cad}) is kept untouched and never overwritten; a CME
     drawing lives under `cme` (cme-launcher.js).

   API:
     useStore({url(entry) -> Promise<string>, upload(blob, name) -> Promise<entry>})   once, by the page
     parse(row)                    -> entries[] (row.pictures, a JSON string, or the old single-picture fields)
     srcInto(img, entry)           loads an <img> (signed URL; a link entry is not loaded)
     mount(container, {initial, onChange, tileAction, readOnly}) -> handle
       handle.get() / add(entry) / refresh() / uploading() / destroy()
   Intake: multi-file upload, camera capture, clipboard paste (button or Ctrl+V), drag & drop. Photos over 3 MB
   are downscaled in the browser first. Browser-only module. */

const MAX_BYTES = 3 * 1024 * 1024;
let store = null;

export function useStore(s) { store = s || null; }

function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function dcr2() { return (typeof window !== "undefined" && window.DCR2) || {}; }
async function confirmBox(message, opts) {
  const c = dcr2().confirm;
  if (typeof c === "function") return !!(await c(message, opts || {}));
  return typeof window !== "undefined" && window.confirm ? window.confirm(message) : false;
}

/** https links only (a "javascript:" value would run on click) */
export function safeUrl(u) { return /^https:\/\//i.test(String(u || "").trim()) ? String(u).trim() : ""; }

/** A row's pictures: row.pictures (an array, or the JSON text of one), else the old single-picture fields. */
export function parse(row) {
  if (!row) return [];
  let g = row.pictures !== undefined ? row.pictures : row.picturesJson;
  if (typeof g === "string") { try { g = JSON.parse(g); } catch (e) { g = null; } }
  if (Array.isArray(g) && g.length) return g.filter((e) => e && typeof e === "object");
  if (row.picturePath) return [{ path: row.picturePath, name: "photo" }];
  if (row.pictureUrl && safeUrl(row.pictureUrl)) return [{ url: row.pictureUrl, name: "photo" }];
  return [];
}

/** true when the entry has bytes this site can show (a stored object) */
export function showable(entry) { return !!(entry && entry.path); }

export function srcInto(img, entry) {
  if (!img || !entry || !entry.path || !store) return;
  store.url(entry).then((u) => { if (u) img.src = u; }).catch(() => { /* the tile keeps its placeholder */ });
}

function injectStyles() {
  if (document.getElementById("dcr2GalleryCss")) return;
  const css = document.createElement("style");
  css.id = "dcr2GalleryCss";
  css.textContent =
    ".dg-wrap{border:2px dashed var(--border,#ccc);border-radius:12px;padding:12px;transition:border-color .12s,background .12s}" +
    ".dg-wrap.drag{border-color:var(--accent,#1f6fc8);background:rgba(47,128,216,.12)}" +
    ".dg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:10px}" +
    ".dg-tile{position:relative;border:1px solid var(--border,#ccc);border-radius:10px;overflow:hidden;aspect-ratio:1;background:var(--surface-2,#eee);display:flex;align-items:center;justify-content:center}" +
    ".dg-tile img{width:100%;height:100%;object-fit:cover}" +
    ".dg-tile .dg-x{position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:50%;border:none;background:rgba(0,0,0,.6);color:#fff;font-size:12px;cursor:pointer;line-height:1}" +
    ".dg-tile .dg-star{position:absolute;top:4px;left:4px;width:22px;height:22px;border-radius:50%;border:none;background:rgba(0,0,0,.6);color:#ffd47f;font-size:12px;cursor:pointer;line-height:1}" +
    ".dg-tile.dg-cover{outline:3px solid #d6a13a;outline-offset:-3px}" +
    ".dg-cover-tag{position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.6);color:#ffd47f;font-size:9.5px;font-weight:700;text-align:center;padding:2px 0;letter-spacing:.05em}" +
    ".dg-act{position:absolute;bottom:4px;right:4px;min-width:22px;height:22px;border-radius:11px;border:none;background:rgba(0,0,0,.65);color:#fff;font-size:11px;cursor:pointer;line-height:1;padding:0 6px}" +
    ".dg-act:hover{background:rgba(47,128,216,.9)}" +
    ".dg-link{font-size:11px;text-align:center;padding:8px;color:var(--text-muted,#777);word-break:break-all}" +
    ".dg-link a{color:var(--acc,#1f6fc8);font-weight:600}" +
    ".dg-legacy{font-size:10.5px;text-align:center;padding:8px;color:var(--text-muted,#777)}" +
    ".dg-add{display:flex;flex-direction:column;gap:5px;align-items:stretch;justify-content:center;padding:8px}" +
    ".dg-add button{font-size:11px;padding:5px 6px;border-radius:7px;border:1px solid var(--border,#ccc);background:var(--surface,#fff);color:var(--text,#111);cursor:pointer;white-space:nowrap}" +
    ".dg-add button:hover{border-color:var(--accent,#1f6fc8);color:var(--accent,#1f6fc8)}" +
    ".dg-hint{font-size:11px;color:var(--text-muted,#777);margin-top:8px}";
  document.head.appendChild(css);
}

/* Downscale / compress anything big into a <= 3 MB JPEG (keeps camera photos usable). -> {blob, name} */
function normalizeImage(file) {
  return new Promise((resolve, reject) => {
    if (file.size <= MAX_BYTES) { resolve({ blob: file, name: file.name || "photo.jpg" }); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = function () {
      URL.revokeObjectURL(url);
      const maxDim = 1600;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * scale);
      cv.height = Math.round(img.height * scale);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      let q = 0.85;
      const tryAt = () => cv.toBlob((b) => {
        if (b && b.size > MAX_BYTES && q > 0.4) { q -= 0.1; tryAt(); return; }
        if (!b) { reject(new Error("Could not read that image.")); return; }
        resolve({ blob: b, name: String(file.name || "photo").replace(/\.[^.]+$/, "") + ".jpg" });
      }, "image/jpeg", q);
      tryAt();
    };
    img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("Could not read that image.")); };
    img.src = url;
  });
}

function tileFor(p, i, opts) {
  let act = "";
  if (opts.tileAction && (!opts.tileAction.show || opts.tileAction.show(p))) {
    const label = opts.tileAction.badge ? opts.tileAction.badge(p) : "";
    act = '<button type="button" class="dg-act" data-act="' + i + '" title="' + esc(opts.tileAction.title || "") + '">' +
      esc(label || opts.tileAction.icon || "…") + "</button>";
  }
  let body;
  if (p.path) body = '<img style="display:none" data-i="' + i + '" alt="' + esc(p.name || "") + '">';
  else if (p.url && safeUrl(p.url)) {
    body = '<div class="dg-link">&#128279; A picture link<br><a href="' + esc(safeUrl(p.url)) + '" target="_blank" rel="noopener noreferrer">open it &#8599;</a></div>';
  } else if (p.cad) body = '<div class="dg-legacy">&#128208; A drawing from the old portal (open it there)</div>';
  else body = '<div class="dg-legacy">' + esc(p.name || "picture") + "</div>";
  const ro = !!opts.readOnly;
  return '<div class="dg-tile' + (i === 0 ? " dg-cover" : "") + '">' + body +
    (i === 0 ? '<span class="dg-cover-tag">COVER</span>'
      : ro ? "" : '<button type="button" class="dg-star" data-star="' + i + '" title="Make cover">★</button>') +
    (ro ? "" : '<button type="button" class="dg-x" data-del="' + i + '" title="Remove">✕</button>') +
    act + "</div>";
}

export function mount(container, opts) {
  opts = opts || {};
  injectStyles();
  const entries = (opts.initial || []).slice();
  let busy = 0;
  const ro = !!opts.readOnly;
  function changed() { if (opts.onChange) { try { opts.onChange(entries.slice()); } catch (e) { /* */ } } }

  container.innerHTML =
    '<div class="dg-wrap">' +
    '<div class="dg-grid"></div>' +
    '<div class="dg-hint"></div>' +
    "</div>" +
    '<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden class="dg-file">' +
    '<input type="file" accept="image/*" capture="environment" hidden class="dg-cam">';
  const wrap = container.querySelector(".dg-wrap");
  const grid = container.querySelector(".dg-grid");
  const hint = container.querySelector(".dg-hint");
  const fileInput = container.querySelector(".dg-file");
  const camInput = container.querySelector(".dg-cam");

  function setHint(t, isErr) {
    hint.style.color = isErr ? "var(--danger,#c8371f)" : "var(--text-muted,#777)";
    hint.textContent = t || (ro ? "" : "📥 Drag & drop images here · paste a screenshot with Ctrl+V · big photos are resized automatically");
  }

  function render() {
    let html = entries.map((p, i) => tileFor(p, i, opts)).join("");
    if (!ro) {
      html += '<div class="dg-tile dg-add">' +
        '<button type="button" class="dg-bfile">📁 Upload</button>' +
        '<button type="button" class="dg-bcam">📷 Camera</button>' +
        '<button type="button" class="dg-bpaste">📋 Paste</button>' +
        "</div>";
    }
    grid.innerHTML = html;
    entries.forEach((p, i) => {
      const img = grid.querySelector('img[data-i="' + i + '"]');
      if (!img) return;
      img.addEventListener("load", () => { img.style.display = ""; });
      srcInto(img, p);
    });
    grid.querySelectorAll("[data-del]").forEach((b) => {
      b.addEventListener("click", async () => {
        // never silently discard work: say exactly what would be lost
        const i = Number(b.dataset.del), e = entries[i] || {};
        const what = e.cme
          ? "Delete this DRAWING?\n\nIts lines, dimensions and takeoff will be lost from this estimate and cannot be undone."
          : e.cad
            ? "Remove this drawing from the old portal?\n\nIt cannot be opened here, and removing it cannot be undone."
            : (e.ann && e.ann.items && e.ann.items.length)
              ? "Delete this photo?\n\nIt has " + e.ann.items.length + " markup item" +
                (e.ann.items.length === 1 ? "" : "s") + " (arrows/notes/measurements) that will be lost."
              : "Delete this photo?\n\nThis cannot be undone.";
        if (!(await confirmBox(what, { title: "Delete photo", danger: true, okText: "Delete" }))) return;
        entries.splice(i, 1);
        render();
        changed();
      });
    });
    grid.querySelectorAll("[data-star]").forEach((b) => {
      b.addEventListener("click", () => {
        const it = entries.splice(Number(b.dataset.star), 1)[0];
        entries.unshift(it);
        render();
        changed();
      });
    });
    grid.querySelectorAll("[data-act]").forEach((b) => {
      b.addEventListener("click", () => {
        if (opts.tileAction && opts.tileAction.onClick) opts.tileAction.onClick(entries[Number(b.dataset.act)], Number(b.dataset.act), render);
      });
    });
    const bf = grid.querySelector(".dg-bfile"), bc = grid.querySelector(".dg-bcam"), bp = grid.querySelector(".dg-bpaste");
    if (bf) bf.addEventListener("click", () => fileInput.click());
    if (bc) bc.addEventListener("click", () => camInput.click());
    if (bp) bp.addEventListener("click", pasteFromClipboard);
  }

  async function addFiles(fileList) {
    if (ro) return;
    const files = Array.prototype.slice.call(fileList || []).filter((f) => f && (/^image\//.test(f.type) || /\.(png|jpe?g|gif|webp)$/i.test(f.name || "")));
    if (!files.length) { setHint("No image files found.", true); return; }
    if (!store) { setHint("Pictures cannot be saved here.", true); return; }
    for (let i = 0; i < files.length; i++) {
      busy++;
      setHint("Uploading " + (i + 1) + " of " + files.length + "…");
      try {
        const norm = await normalizeImage(files[i]);
        const entry = await store.upload(norm.blob, norm.name || "photo.jpg");
        entries.push(entry);
        render();
        changed();
      } catch (e) {
        setHint((e && e.message) || "Upload failed.", true);
        busy--;
        return;
      }
      busy--;
    }
    setHint("✓ " + files.length + " photo" + (files.length > 1 ? "s" : "") + " added.");
  }

  async function pasteFromClipboard() {
    try {
      if (navigator.clipboard && navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const it of items) {
          const type = it.types.find((t) => t.indexOf("image/") === 0);
          if (type) {
            const blob = await it.getType(type);
            await addFiles([new File([blob], "screenshot.png", { type })]);
            return;
          }
        }
      }
      setHint("Nothing on the clipboard — copy a screenshot, then press Ctrl+V here.", true);
    } catch (e) {
      setHint("Press Ctrl+V inside this window to paste your screenshot.", false);
    }
  }

  function onPaste(e) {
    if (ro || !container.isConnected || container.offsetParent === null) return;
    const items = (e.clipboardData || {}).items || [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf("image/") === 0) {
        e.preventDefault();
        addFiles([items[i].getAsFile()]);
        return;
      }
    }
  }
  document.addEventListener("paste", onPaste);

  fileInput.addEventListener("change", function () { if (this.files.length) { addFiles(this.files); this.value = ""; } });
  camInput.addEventListener("change", function () { if (this.files.length) { addFiles(this.files); this.value = ""; } });
  ["dragenter", "dragover"].forEach((ev) => wrap.addEventListener(ev, (e) => { e.preventDefault(); if (!ro) wrap.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => wrap.addEventListener(ev, (e) => { e.preventDefault(); wrap.classList.remove("drag"); }));
  wrap.addEventListener("drop", (e) => { if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });

  render();
  setHint("");

  return {
    get: () => entries.slice(),
    add(entry) { entries.push(entry); render(); changed(); },
    refresh: render,
    uploading: () => busy > 0,
    destroy() {
      document.removeEventListener("paste", onPaste);
      container.innerHTML = "";
    },
  };
}

export default { useStore, parse, srcInto, mount, showable, safeUrl };
