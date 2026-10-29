/* A contact's round picture, or its initials on a steady colour (the Books program, release A3: "contacts get a
   picture"; Books plan §4.2). The same initials and the same colour for a name as DCR Desktop 2 draws them
   (dcrdesk/ui/widgets/avatar.py initials / tone_for: crc32 of the trimmed lower-case name over its eight tones), so a
   contact looks the same on every screen and PC.

   * initials(name)              up to two letters: "Sam Rivera" -> "SR", "office@x.example" -> "O", "" -> "?";
   * toneFor(name)               the colour behind the initials;
   * avatarHtml(contact, opts)   the markup of one avatar: a <span>, or a <button> when opts.edit and there is a live
                                 contact to open. contact: a contacts row ({id, name, company, picture_path,
                                 deleted_at}) or null (a payee nobody linked: initials only); opts: {size (px, 32),
                                 name (the words when there is no contact), edit, title}. The picture is only NAMED
                                 here (data-av-path, and only a key of the database's own shape): paintAvatars draws it;
   * paintAvatars(root, opts)    signs the pictures of every avatar in root (repo/contacts.js pictureUrls: one call)
                                 and draws each as an <img> (never markup); one that can't be read keeps its initials.
                                 An editable avatar opens the contact card (opts: {me, onSaved}; opts.open(id) instead
                                 when a page wants its own); its click and keys never reach the row around it;
   * openCard(contactId, opts)   the contact card (pages/contact-card.js, fetched when first opened);
   * ensureStyle()               the avatars' look, once per page.
   initials, toneFor and avatarHtml are pure (node tests import them); the rest needs a page. */

import { pictureUrls, picturePathOk } from "../repo/contacts.js";

// Desktop 2's daylight chart1..chart6, laneSent and laneApproved: white initials read on each of them
export const TONES = Object.freeze(["#16A34A", "#2563EB", "#D97706", "#7C3AED", "#0891B2", "#C026D3", "#2563EB", "#059669"]);

const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const txt = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();

let CRC = null;
/** zlib's crc32 of a string's UTF-8 bytes (Python's zlib.crc32, as Desktop 2 uses it). */
export function crc32(s) {
  if (!CRC) {
    CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC[n] = c >>> 0;
    }
  }
  const bytes = new TextEncoder().encode(String(s == null ? "" : s));
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Up to two initials (Desktop 2's rule). */
export function initials(name) {
  let n = txt(name);
  if (n.indexOf("@") !== -1 && n.indexOf(" ") === -1) n = n.split("@")[0].replace(/[._]/g, " ");
  const parts = n.replace(/-/g, " ").split(" ").filter((p) => p && /^[\p{L}\p{N}]/u.test(p));
  if (!parts.length) return "?";
  const first = (p) => Array.from(p)[0].toUpperCase();
  return parts.length === 1 ? first(parts[0]) : first(parts[0]) + first(parts[parts.length - 1]);
}

/** The colour behind a name's initials: the same on every page and in DCR Desktop 2. */
export function toneFor(name) {
  return TONES[crc32(txt(name).toLowerCase()) % TONES.length];
}

/** The words an avatar stands for: the contact's own name, else its company, else opts.name. */
export function avatarName(contact, fallback) {
  return contact ? txt(contact.name) || txt(contact.company) || txt(fallback) : txt(fallback);
}

/** One avatar's markup (see the header). */
export function avatarHtml(contact, opts) {
  const o = opts || {};
  const size = Math.max(16, Math.min(160, Math.round(Number(o.size) || 32)));
  const name = avatarName(contact, o.name);
  const path = contact && picturePathOk(contact.picture_path) ? contact.picture_path : "";
  const id = contact && contact.id !== null && contact.id !== undefined && /^[1-9][0-9]{0,17}$/.test(String(contact.id)) ? String(contact.id) : "";
  const edit = !!o.edit && !!id && !(contact && contact.deleted_at);
  const attrs = ' class="av' + (edit ? " av-edit" : "") + '" style="--av:' + size + "px;background:" + toneFor(name) + '"' +
    (path ? ' data-av-path="' + esc(path) + '"' : "") + (id ? ' data-av-id="' + id + '"' : "");
  const inner = '<span class="av-i" aria-hidden="true">' + esc(initials(name)) + "</span>";
  if (edit) {
    const title = o.title || "Picture, phone and e-mail of " + (name || "this contact");
    return '<button type="button"' + attrs + ' data-av-contact="' + id + '" title="' + esc(title) + '" aria-label="' + esc(title) + '">' + inner + "</button>";
  }
  return "<span" + attrs + ' aria-hidden="true">' + inner + "</span>";
}

export const AVATAR_CSS =
  ".av{--av:32px;width:var(--av);height:var(--av);min-width:var(--av);border-radius:50%;display:inline-grid;place-items:center;" +
  "position:relative;overflow:hidden;vertical-align:middle;flex-shrink:0;color:#fff;font-weight:800;font-size:calc(var(--av) * .38);" +
  "line-height:1;letter-spacing:.02em;border:0;padding:0;margin:0;user-select:none;font-family:inherit;}" +
  ".av .av-i{pointer-events:none;}" +
  ".av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;border-radius:50%;background:#fff;}" +
  "button.av{cursor:pointer;box-shadow:0 0 0 1px rgba(0,0,0,.06);}" +
  "button.av:hover,button.av:focus-visible{outline:2px solid var(--accent,#1f6fc8);outline-offset:2px;}" +
  "button.av::after{content:\"\\270E\";position:absolute;right:0;bottom:0;width:42%;height:42%;border-radius:50%;display:none;" +
  "place-items:center;font-size:calc(var(--av) * .24);background:var(--surface,#fff);color:var(--text,#1b2733);z-index:1;}" +
  "button.av:hover::after,button.av:focus-visible::after{display:grid;}" +
  ".av-name{display:inline-flex;align-items:center;gap:8px;min-width:0;max-width:100%;vertical-align:middle;}" +
  ".av-name > .av-t{min-width:0;overflow-wrap:anywhere;}";

export function ensureStyle() {
  if (typeof document === "undefined" || document.getElementById("avStyle")) return;
  const st = document.createElement("style");
  st.id = "avStyle";
  st.textContent = AVATAR_CSS;
  (document.head || document.documentElement).appendChild(st);
}

/** The contact card for `contactId` (fetched when first opened). opts: {me, onSaved(row)}. */
export async function openCard(contactId, opts) {
  const m = await import("./contact-card.js");
  return m.openContactCard(contactId, opts || {});
}

/** Draw the pictures of every avatar in `root`, and open the card from the editable ones. -> the number drawn. */
export async function paintAvatars(root, opts) {
  if (!root || typeof root.querySelectorAll !== "function") return 0;
  ensureStyle();
  const o = opts || {};
  root.querySelectorAll("button.av[data-av-contact]").forEach((b) => {
    if (b.getAttribute("data-av-bound")) return;
    b.setAttribute("data-av-bound", "1");
    // the avatar sits in clickable rows (the check desk): its click and keys are its own
    b.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") e.stopPropagation(); });
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = b.getAttribute("data-av-contact");
      if (typeof o.open === "function") o.open(id);
      else openCard(id, o).catch(() => null);
    });
  });
  const boxes = Array.prototype.slice.call(root.querySelectorAll(".av[data-av-path]"));
  if (!boxes.length) return 0;
  let urls = {};
  try { urls = await pictureUrls(boxes.map((b) => b.getAttribute("data-av-path"))); } catch (e) { return 0; }
  let n = 0;
  boxes.forEach((b) => {
    const url = urls[b.getAttribute("data-av-path")];
    const had = b.querySelector("img");
    if (!url || (had && had.getAttribute("src") === url)) return;
    if (had) had.remove();
    const img = document.createElement("img");
    img.alt = "";
    img.decoding = "async";
    img.addEventListener("error", () => img.remove());       // initials again
    img.src = url;
    b.appendChild(img);
    n++;
  });
  return n;
}
