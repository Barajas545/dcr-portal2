/* The project's OneDrive folder in the Files tab (owner decisions 2026-10-24, D9 / D10): the rules the page checks
   before it asks the broker, and the shapes the tab draws.

   The broker (DCR Desktop 2 supabase/functions/onedrive, paths.ts) is the one that decides - with the database's own
   answer about the person (onedrive_context) - what is listed, opened and written. These are its rules repeated, so a
   person reads the reason before a byte is sent, and so a name the broker would hide is never drawn here either:

   * the project's folder is /Projects/<folder_name>/ (the database's name, never typed); a path is the segments BELOW
     it ("Floor Plans/Level 1"); Floor Plans, Photos and Documents are DCR Desktop 2's three; "Old portal documents"
     (the retirement copy) is read only;
   * uploads only into Documents or Floor Plans and their folders (never Documents/Items - an estimate item's files are
     added from the item in DCR Desktop 2): photos and voice notes keep the capture bar (cloud, kept on the device);
   * only the allowed types (PDFs, pictures, videos, Office files without macros, text, CAD; .takeoff with prices),
     never a lock or system name (~$..., desktop.ini ...); without prices no name about estimates, quotes, bids,
     contracts or money and none that quotes an amount (it would be hidden from its own uploader at once);
   * the row the upload becomes must fit the project's file list (app.rel_path_ok and files_subpath_shape);
   * hidden from everyone: lock, temporary and system files; without prices: .takeoff / .pdfnotes (D8), names about
     prices or money, names that quote an amount; without financials: the money names;
   * downloads: any visible file but programs and shortcuts.

   Pure module (no look-behind: older iPhones refuse a module that has one). */

import { maskAmounts } from "../money-mask.js";
import { scrubMoney } from "../scrub-money.js";

/** DCR Desktop 2's three (local_files.py STANDARD_FOLDERS), the two the portal adds files to, the read-only copy. */
export const STANDARD_FOLDERS = Object.freeze(["Floor Plans", "Photos", "Documents"]);
export const UPLOAD_FOLDERS = Object.freeze(["Documents", "Floor Plans"]);
export const OLD_FOLDER = "Old portal documents";
export const ITEMS_FOLDER = "Items";
export const FOLDER_ICONS = Object.freeze({ "floor plans": "📐", photos: "🖼️", documents: "📄", "old portal documents": "🗄️" });

/** The broker's limits (paths.ts): a path sent, a project path, names, the files table's sub-folders. */
export const MAX_PATH_TEXT = 400;
export const MAX_PROJECT_PATH = 340;
export const MAX_NAME = 255;
export const MAX_NEW_FILE_NAME = 200;
export const MAX_FOLDER_NAME = 120;
export const MAX_SUBPATH = 500;
export const MAX_SUBPATH_PARTS = 12;
/** The largest upload the page tries (the broker's own default, ONEDRIVE_MAX_UPLOAD_MB 2048; its answer may say less). */
export const MAX_UPLOAD_BYTES = 2048 * 1024 * 1024;

export const UPLOAD_EXTS = Object.freeze(["pdf", "jpg", "jpeg", "png", "heic", "heif", "webp", "gif", "tif", "tiff",
  "mp4", "mov", "m4v", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "rtf", "dwg", "dxf", "takeoff"]);
export const PRICED_UPLOAD_EXTS = Object.freeze(["takeoff"]);
export const BLOCKED_DOWNLOAD_EXTS = Object.freeze(["exe", "bat", "cmd", "ps1", "lnk", "url", "scf", "hta", "js", "vbs", "msi",
  "library-ms", "com", "scr", "pif", "jse", "vbe", "wsf", "wsh", "reg", "cpl", "msp"]);
const SKIP_NAMES = ["thumbs.db", "desktop.ini", ".ds_store", "ehthumbs.db", "ehthumbs_vista.db"];

export const MESSAGES = Object.freeze({
  fileType: "That kind of file cannot be uploaded here (PDFs, pictures, videos, Office files, text and CAD files can).",
  takeoff: "Takeoff files are added by someone who sees prices (they stay in the Plans Archive and takeoff-web).",
  priced: "Files named for estimates, quotes, bids, contracts or money, or with an amount in the name, are uploaded by someone who sees prices.",
  system: "Lock, temporary and system files are not uploaded.",
  tooLong: "That path is too long for OneDrive and the project's file list: use a shorter name or fewer folders.",
  tooLarge: "That file is too large to upload here.",
  empty: "That file is empty.",
  where: "Files from the portal go into Documents or Floor Plans (photos and voice notes: the buttons above).",
  items: "An estimate item's files are added from the item in DCR Desktop 2.",
  folder: "Drop the files themselves, not a folder.",
});

/* ── names ─────────────────────────────────────────────────────────────── */

/** Unicode code points, the way the database counts characters. */
export function chars(s) { return Array.from(String(s == null ? "" : s)).length; }
export function nfc(s) { return String(s == null ? "" : s).normalize("NFC"); }
function folded(s) { return String(s == null ? "" : s).normalize("NFKC").toLowerCase(); }
/** Two names OneDrive treats as one (any case; NFC and NFD alike). */
export function sameName(a, b) { return nfc(a).toLowerCase() === nfc(b).toLowerCase(); }

// \ / : * ? " < > |, C0 and C1 controls, bidi controls, zero-width characters (paths.ts BAD_CHARS)
const BAD_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/;
const LOOK_ALIKE = /[∕⁄⧸]/;
// app.is_reserved_name
const RESERVED = /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³]) *(\.[\s\S]*)?$/;

export function isReservedName(s) { return RESERVED.test(String(s == null ? "" : s).toLowerCase()); }

/** A half of a surrogate pair on its own (no look-behind: walked by hand). */
function brokenChar(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = s.charCodeAt(i + 1);
      if (!(n >= 0xdc00 && n <= 0xdfff)) return true;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) return true;
  }
  return false;
}

/** Why one segment of a path cannot be used, or null (paths.ts segmentProblem). */
export function segmentProblem(seg, max) {
  const limit = max || MAX_NAME;
  if (typeof seg !== "string" || seg === "") return "an empty name";
  if (brokenChar(seg)) return "a broken character";
  if (chars(seg) > limit) return "a name longer than " + limit + " characters";
  if (BAD_CHARS.test(seg)) return "a character that cannot be in a file name";
  if (seg === "." || seg === "..") return "a name that means another folder";
  if (seg.charAt(0) === " ") return "a name that starts with a space";
  if (/[ .]$/.test(seg)) return "a name that ends with a space or a dot";
  if (isReservedName(seg)) return "a name Windows keeps for itself";
  const k = seg.normalize("NFKC");
  if (k === "." || k === ".." || BAD_CHARS.test(k) || LOOK_ALIKE.test(seg)) return "a character that looks like a path separator";
  if (isReservedName(k)) return "a name Windows keeps for itself";
  return null;
}

/** Lock, temporary and system files, dot names, FrontPage leftovers: nobody sees them (paths.ts alwaysHidden). */
export function alwaysHidden(name) {
  const k = folded(name);
  return SKIP_NAMES.indexOf(k) !== -1 || k.indexOf("~$") === 0 || (k.indexOf(".~lock.") === 0 && k.slice(-1) === "#") ||
    /\.(tmp|part)$/.test(k) || k.charAt(0) === "." || k.indexOf("_vti_") !== -1;
}

// app.onedrive_stem: word stems where a word starts, on the NFKC form in lower case
const PRICED_STEM = /(^|[^a-z0-9])(estimat|change[ _-]*order|quote|quotation|proposal|bid|contract|subcontract)/;
const MONEY_STEM = /(^|[^a-z0-9])(invoice|receipt|bill|payment|purchase[ _-]*order|money[ _-]*record|old[ _-]*portal[ _-]*record)/;

/** "priced" | "money" | null: a name about prices or about money (D9). */
export function stemOf(name) {
  const k = folded(name);
  if (PRICED_STEM.test(k)) return "priced";
  if (MONEY_STEM.test(k)) return "money";
  return null;
}

/** The name quotes an amount: the screens' mask or the database's scrubber changes it (as typed or NFKC). */
export function quotesAmount(name) {
  const s = String(name == null ? "" : name);
  const k = s.normalize("NFKC");
  return maskAmounts(s) !== s || scrubMoney(s) !== s || maskAmounts(k) !== k || scrubMoney(k) !== k;
}

/** A takeoff or plan-notes file (D8: priced work). */
export function isTakeoff(name) { return /\.(takeoff|pdfnotes)$/.test(folded(name)); }

/** {prices, financials} of a signed-in person (an admin holds both). */
export function viewerOf(me) {
  const admin = !!me && me.role === "admin";
  return { prices: admin || !!(me && me.can_see_prices), financials: admin || !!(me && me.can_see_financials) };
}

/** Hidden from this person (paths.ts nameHidden): the broker leaves such items out; the page never draws one either. */
export function nameHidden(name, viewer) {
  const v = viewer || { prices: false, financials: false };
  if (alwaysHidden(name)) return true;
  const stem = stemOf(name);
  if (!v.prices && (stem !== null || quotesAmount(name) || isTakeoff(name))) return true;
  return !v.financials && stem === "money";
}

/** "plan.PDF" -> "pdf"; "" without one ("README", ".env"). */
export function extOf(name) {
  const s = folded(name);
  const i = s.lastIndexOf(".");
  return i <= 0 || i === s.length - 1 ? "" : s.slice(i + 1);
}

/** May be opened from the portal (any visible file but programs and shortcuts). */
export function downloadable(name) { return BLOCKED_DOWNLOAD_EXTS.indexOf(extOf(name)) === -1; }

/** The file picker's accept list for this person (.takeoff with prices only). */
export function acceptFor(viewer) {
  return UPLOAD_EXTS.filter(function (e) { return PRICED_UPLOAD_EXTS.indexOf(e) === -1 || (viewer && viewer.prices); })
    .map(function (e) { return "." + e; }).join(",");
}

/** Why this person cannot upload a file of this name, or null (paths.ts uploadName): {code, message}. */
export function uploadProblem(raw, viewer) {
  const v = viewer || { prices: false, financials: false };
  if (typeof raw !== "string") return { code: "invalid", message: "That file has no name." };
  const name = nfc(raw);
  const p = segmentProblem(name, MAX_NEW_FILE_NAME);
  if (p) return { code: "invalid", message: "The file name has " + p + "." };
  if (alwaysHidden(name)) return { code: "invalid", message: MESSAGES.system };
  const ext = extOf(name);
  if (UPLOAD_EXTS.indexOf(ext) === -1) return { code: "file_type", message: MESSAGES.fileType };
  if (PRICED_UPLOAD_EXTS.indexOf(ext) !== -1 && !v.prices) return { code: "file_type", message: MESSAGES.takeoff };
  if (!v.prices && (stemOf(name) !== null || quotesAmount(name))) return { code: "invalid", message: MESSAGES.priced };
  return null;
}

/** A folder an upload goes through (below Documents or Floor Plans), or why not (paths.ts folderSegmentProblem). */
export function folderProblem(seg, viewer) {
  const v = viewer || { prices: false, financials: false };
  const p = segmentProblem(seg, MAX_FOLDER_NAME);
  if (p) return "a folder with " + p;
  if (alwaysHidden(seg)) return "a hidden or system folder";
  if (!v.prices && (stemOf(seg) !== null || quotesAmount(seg))) return "a folder named for prices or money (someone who sees prices uploads there)";
  if (!v.financials && stemOf(seg) === "money") return "a folder named for money (someone who sees financials uploads there)";
  return null;
}

/* ── what the files table keeps (the database's checks) ──────────────────── */

const ROW_BAD = /[\u0000-\u001f\u007f\\<>:"|?*‎‏‪-‮⁦-⁩]/;

/** app.rel_path_ok: 2-32 parts, 3-1,024 characters, each part 1-255, no leading space, no trailing space or dot. */
export function relPathOk(p) {
  if (typeof p !== "string") return false;
  const n = chars(p);
  if (n < 3 || n > 1024 || ROW_BAD.test(p)) return false;
  const parts = p.split("/");
  if (parts.length < 2 || parts.length > 32) return false;
  return parts.every(function (s) { return s !== "" && chars(s) <= 255 && !/^ |[ .]$/.test(s) && !isReservedName(s); });
}

/** files_subpath_shape: '' or at most 500 characters, 12 folders of at most 120, no empty part, no space at the ends. */
export function subpathOk(s) {
  if (typeof s !== "string") return false;
  if (s === "") return true;
  if (chars(s) > MAX_SUBPATH || /^\/|\/$|\/\//.test(s) || ROW_BAD.test(s) || /(^|\/) |[ .](\/|$)/.test(s)) return false;
  const parts = s.split("/");
  return parts.length <= MAX_SUBPATH_PARTS && parts.every(function (x) { return chars(x) <= MAX_FOLDER_NAME; });
}

/* ── where an upload goes ─────────────────────────────────────────────── */

function canonicalTop(seg) {
  for (let i = 0; i < UPLOAD_FOLDERS.length; i++) if (sameName(UPLOAD_FOLDERS[i], seg)) return UPLOAD_FOLDERS[i];
  return null;
}

/** The upload place of a browsed folder (path below the project's folder): {folder, relDir} under Documents or Floor
    Plans, or null (the project's folder itself, Photos, Old portal documents, Documents/Items...). */
export function uploadPlace(path) {
  const segs = (path || []).map(String);
  if (!segs.length) return null;
  const top = canonicalTop(segs[0]);
  if (!top) return null;
  if (top === "Documents" && segs.length > 1 && sameName(segs[1], ITEMS_FOLDER)) return null;
  return { folder: top, relDir: segs.slice(1).join("/") };
}

/** The "add to" choices while browsing `path`: the folder open now (when it is below Documents or Floor Plans), then the
    two top folders. value "here" | "Documents" | "Floor Plans". */
export function targetChoices(path) {
  const here = uploadPlace(path);
  const out = [];
  if (here && here.relDir) out.push({ value: "here", folder: here.folder, relDir: here.relDir, label: [here.folder].concat(here.relDir.split("/")).join(" / ") });
  UPLOAD_FOLDERS.forEach(function (f) { out.push({ value: f, folder: f, relDir: "", label: f }); });
  return out;
}

/** The choice made first: the folder open now when files can go there, else Documents. */
export function defaultTarget(path) {
  const here = uploadPlace(path);
  if (!here) return "Documents";
  return here.relDir ? "here" : here.folder;
}

/** Why a file cannot go to {folder, relDir} for this person, or null: every check the broker makes before it opens an
    upload session (the type, the name, the folders, the files table's shape, the size). folderName: the project's
    folder (the path's length counts it); size in bytes; maxBytes the largest upload. */
export function sessionProblem(o) {
  const v = o.viewer || { prices: false, financials: false };
  const top = canonicalTop(o.folder);
  if (!top) return MESSAGES.where;
  const dir = o.relDir ? String(o.relDir).split("/") : [];
  if (top === "Documents" && dir.length && sameName(dir[0], ITEMS_FOLDER)) return MESSAGES.items;
  for (let i = 0; i < dir.length; i++) {
    const p = folderProblem(dir[i], v);
    if (p) return "That folder has " + p + ".";
  }
  if (1 + dir.length > MAX_SUBPATH_PARTS) return "At most " + (MAX_SUBPATH_PARTS - 1) + " folders below " + top + ".";
  const bad = uploadProblem(o.name, v);
  if (bad) return bad.message;
  if (!(Number(o.size) >= 1)) return MESSAGES.empty;
  if (Number(o.size) > (o.maxBytes || MAX_UPLOAD_BYTES)) return MESSAGES.tooLarge;
  const sub = [top].concat(dir.map(nfc));
  if (o.folderName) {
    const rel = [o.folderName].concat(sub, [nfc(o.name)]).join("/");
    if (chars(rel) > MAX_PROJECT_PATH || !relPathOk(rel)) return MESSAGES.tooLong;
  }
  if (!subpathOk(sub.join("/"))) return MESSAGES.tooLong;
  return null;
}

/* ── the browser's shapes ─────────────────────────────────────────────── */

/** The breadcrumb of `path`: [{name, path}] from the project's folder. */
export function crumbs(path) {
  const out = [{ name: "Project folder", path: [] }];
  (path || []).forEach(function (p, i) { out.push({ name: String(p), path: path.slice(0, i + 1) }); });
  return out;
}

/** Inside the retirement copy (read only: nothing is added there from the portal). */
export function isOldCopy(path) { return !!(path && path.length && sameName(path[0], OLD_FOLDER)); }

export function folderIcon(path, name) {
  if (path && path.length) return "📁";
  return FOLDER_ICONS[nfc(name).toLowerCase()] || "📁";
}

/** A local files row's path below its project's folder ("A267 - x/Floor Plans/A1.pdf" -> "Floor Plans/A1.pdf"). */
export function belowProject(relPath) {
  const s = String(relPath || "");
  const i = s.indexOf("/");
  return i === -1 ? "" : s.slice(i + 1);
}

/** The OneDrive entries of `path` with what the project's file list knows of them: the caption, the version and the
    row of the local row at that path (any case; the newest version). Folders are left as they are. */
export function mergeLocal(entries, items, path) {
  const key = function (s) { return nfc(s).toLowerCase(); };
  const byPath = new Map();
  (items || []).forEach(function (f) {
    if (!f || f.cloud || !f.relPath) return;
    const k = key(belowProject(f.relPath));
    const prev = byPath.get(k);
    if (!prev || Number(f.versionNo || 1) > Number(prev.versionNo || 1)) byPath.set(k, f);
  });
  const base = (path || []).join("/");
  return (entries || []).map(function (e) {
    if (!e || e.folder) return e;
    const f = byPath.get(key((base ? base + "/" : "") + e.name));
    return f ? Object.assign({}, e, { caption: f.description || "", versionNo: Number(f.versionNo || 1), fileId: f.id }) : e;
  });
}

/* ── the upload's arithmetic (Microsoft's upload sessions) ─────────────────── */

/** Every chunk but the last is a multiple of 320 KiB, and below 60 MiB: at most 191 of them (D10). */
export const CHUNK_UNIT = 327680;
export const MAX_CHUNK_UNITS = 191;
export const MAX_CHUNK = MAX_CHUNK_UNITS * CHUNK_UNIT;
export const DEFAULT_CHUNK = 32 * CHUNK_UNIT;

/** The chunk size for a session the broker opened: its chunk_bytes, clamped to a multiple of 320 KiB, at most
    max_chunk_bytes and 191 x 320 KiB. */
export function chunkBytes(session) {
  const s = session || {};
  const cap = Math.min(MAX_CHUNK, Number(s.max_chunk_bytes) > 0 ? Number(s.max_chunk_bytes) : MAX_CHUNK);
  let want = Math.min(Number(s.chunk_bytes) > 0 ? Number(s.chunk_bytes) : DEFAULT_CHUNK, cap);
  want = Math.floor(want / CHUNK_UNIT) * CHUNK_UNIT;
  return want >= CHUNK_UNIT ? want : CHUNK_UNIT;
}

/** The next chunk from `offset`: {start, end (exclusive), last, range: "bytes a-b/size"}, or null when all is sent. */
export function chunkPlan(size, offset, chunk) {
  const total = Number(size);
  const start = Math.max(0, Math.floor(Number(offset) || 0));
  if (!(total > 0) || start >= total) return null;
  const end = Math.min(total, start + Math.max(1, Number(chunk) || DEFAULT_CHUNK));
  return { start, end, last: end >= total, range: "bytes " + start + "-" + (end - 1) + "/" + total };
}

/** The first byte Microsoft still wants (nextExpectedRanges ["327680-"] -> 327680), or null. */
export function parseNext(ranges) {
  if (!Array.isArray(ranges) || !ranges.length) return null;
  const m = /^(\d+)-(\d*)$/.exec(String(ranges[0]).trim());
  return m ? Number(m[1]) : null;
}

/** OneDrive's name for a file uploaded with "rename": "plan.pdf" -> "plan 1.pdf" (paths.ts renamedFrom). */
export function renamedFrom(actual, requested) {
  const a = nfc(actual).toLowerCase(), r = nfc(requested).toLowerCase();
  if (a === r) return true;
  const dot = r.lastIndexOf(".");
  const base = dot > 0 ? r.slice(0, dot) : r, ext = dot > 0 ? r.slice(dot) : "";
  if (a.indexOf(base + " ") !== 0 || a.slice(a.length - ext.length) !== ext) return false;
  return /^[1-9][0-9]{0,3}$/.test(a.slice(base.length + 1, a.length - ext.length));
}
