/* The project's OneDrive folder, through the Edge Function "onedrive" (DCR Desktop 2 supabase/functions/onedrive; its
   docs/ONEDRIVE.md §15 is the contract; owner decisions 2026-10-24 D9 / D10). The function holds the only Microsoft
   secret and acts with the caller's own sign-in (never the service role): the database decides who may do what
   (public.onedrive_context), the function carries it out in OneDrive, inside /Projects/<the project's folder>/ only.

   LIVE: false until the Files tab's OneDrive part goes live (deploy order: the Microsoft setup, migration
   20261028000200_onedrive, the function and its secrets, the probe and the admin's self-test - then the release that
   sets LIVE to true). While it is false the pages make no OneDrive call (a function that is not deployed cannot be
   told apart from "offline" in a browser: functions.invoke sends its headers, so the browser asks CORS first, and a
   missing function's 404 to that question is a network error) - except the admin's self-test project A000T2
   (SELF_TEST_PROJECT), where an admin sees the OneDrive part and its self-test before anybody else does.

   * list(projectId, path, cursor)   op "list": one page (at most 200) of a folder below the project's folder, folders
                                     first -> {folderExists, path, entries: [{id, name, folder, size, modified,
                                     children}], next, canUpload, canMakeFolder}; a malformed entry is left out;
   * findFile(projectId, path, name, size)  the entries of that folder named `name` (or OneDrive's "name 1.ext" for
                                     it) with that size, newest first (an upload whose last answer was lost);
   * download(projectId, itemId)     op "download" -> {url, name, size}: a pre-authenticated link (https on
                                     ONEDRIVE_HOST - or this page's own blob: in the local demo), good for minutes:
                                     the page opens it at once and keeps it nowhere;
   * uploadSession(o)                op "upload_session" {folder, relDir, name, size, modified} -> {uploadUrl, ticket,
                                     name, chunkBytes, expiresAt, maxBytes}: the upload URL (https on ONEDRIVE_HOST,
                                     checked) is kept in memory only (js/onedrive-upload.js);
   * uploadDone(projectId, itemId, ticket)  op "upload_done" -> {recorded, already, renamed, name, size, file, reason,
                                     message}: recorded false = in OneDrive, no row in the file list (message says why);
   * ensureFolder(projectId)         op "ensure_folder": the project's folder (and Floor Plans, Photos, Documents),
                                     never a second one beside another folder with the project's number. Never throws:
                                     -> {state: made | exists | other_folder | not_deployed | not_configured |
                                     not_authorized | busy | projects_root_missing | forbidden | offline | failed,
                                     message, created, existed, blocked, count, folders};
   * status()                        op "status" (admins): {ok, grant, checks: [{name, ok, code}]};
   * call(body)                      any op; errors are {code, status, message, field, info, retryAfter}: the
                                     broker's own codes (its messages are a fixed map), "not_deployed" (the gateway's
                                     own 404: no such function), the 503s by name, "offline" (no answer).

   ONEDRIVE_HOST is named here and in project.html's security policy only (tests/core-site-guard.test.mjs): never the
   tenant, the app, the drive or any secret. Pages never call functions themselves (tests/pages-guard.test.mjs). */

import { db, idOf } from "./_db.js";
import { sameName, renamedFrom } from "../map/onedrive.js";

export const FUNCTION = "onedrive";
/** The pages call the function only when this is true (see the header): set by the Files tab's OneDrive go-live. */
export const LIVE = false;
/** The owner's OneDrive host: where every upload and download link must point (docs/ONEDRIVE.md ONEDRIVE_HOST). */
export const ONEDRIVE_HOST = "netorgft10120038-my.sharepoint.com";
/** The test project of the admin's self-test (docs/ONEDRIVE.md §13: never a real project). */
export const SELF_TEST_PROJECT = "A000T2";
/** A OneDrive item id as the broker accepts one. */
export const ITEM_ID = /^[A-Za-z0-9!_.-]{8,128}$/;

// the broker's own error codes (handler.ts ERRORS): a 404 whose body carries one is the broker's answer, not the gateway's
export const CONTRACT = Object.freeze(["invalid", "unauthorized", "forbidden", "not_downloadable", "not_found", "method_not_allowed",
  "other_folder", "not_a_folder", "not_this_upload", "too_large", "file_type", "server_error", "onedrive_failed",
  "onedrive_not_configured", "onedrive_not_authorized", "busy", "projects_root_missing", "onedrive_full"]);
// the broker's 503s: [code here, the sentence] (its own message may name settings: never shown)
const UNAVAILABLE = {
  onedrive_not_configured: ["not_configured", "The OneDrive connection is not set up yet."],
  onedrive_not_authorized: ["not_authorized", "The OneDrive connection is not allowed in just now: an admin checks it."],
  busy: ["busy", "OneDrive is busy just now: try again in a minute."],
  projects_root_missing: ["projects_root_missing", "OneDrive's Projects folder is not where it was set up: an admin checks the OneDrive settings."],
};
const OFFLINE = "No connection to DCR just now.";
const FALLBACK = {
  400: "That request was not accepted.", 403: "This account cannot do that in OneDrive.", 404: "That file or folder was not found.",
  409: "OneDrive has something in the way.", 413: "That file is too large to upload here.", 415: "That kind of file cannot be uploaded here.",
  507: "The OneDrive is full.",
};

function failure(message, code, status, info, extra) {
  const e = new Error(message);
  e.code = code;
  e.status = status;
  e.info = info || null;
  if (extra) Object.assign(e, extra);
  return e;
}

/** The broker's own sentence when it is one of its fixed answers (never for a 503: those may name settings). */
function brokerText(info, status) {
  const m = info && typeof info.message === "string" ? info.message.trim() : "";
  return m && m.length <= 400 && status !== 503 ? m : FALLBACK[status] || "OneDrive could not do that just now.";
}

/** POST {op, ...} with this person's sign-in -> the answer's data (see the header for the errors). */
export async function call(body) {
  let res;
  try {
    const c = await db();
    res = await c.functions.invoke(FUNCTION, { body });
  } catch (e) {
    throw failure(OFFLINE, "offline", 0);
  }
  const { data, error } = res || {};
  if (!error) return data;
  const ctx = error.context;
  let status = 0, info = null;
  if (ctx && typeof ctx.status === "number") {
    status = ctx.status;
    try { info = await (ctx.clone ? ctx.clone() : ctx).json(); } catch (e) { info = null; }
  }
  const code = info && typeof info.error === "string" && CONTRACT.indexOf(info.error) !== -1 ? info.error : "";
  // the broker exposes Retry-After to this site (Access-Control-Expose-Headers); a gateway answer without it: null
  let retryAfter = null;
  try {
    const ra = ctx && ctx.headers && typeof ctx.headers.get === "function" ? Number(ctx.headers.get("Retry-After")) : NaN;
    if (Number.isFinite(ra) && ra > 0) retryAfter = Math.min(ra, 300);
  } catch (e) { /* no header to read: the caller waits its own while */ }
  if (!status) throw failure(OFFLINE, "offline", 0);
  if (status === 404 && !code) throw failure("The OneDrive connection is not set up yet.", "not_deployed", 404);
  if (status === 503) {
    const u = UNAVAILABLE[code];
    throw u ? failure(u[1], u[0], 503, info, { retryAfter }) : failure("The OneDrive connection is not answering just now.", "unavailable", 503, info, { retryAfter });
  }
  if (status === 401) throw failure("Your sign-in has expired. Please sign in again.", "auth", 401);
  if (status >= 500 && !code) throw failure("OneDrive could not do that just now. Try again in a few minutes.", "failed", status, info);
  const field = info && typeof info.field === "string" ? info.field : null;
  throw failure(brokerText(info, status), code || (status === 403 ? "forbidden" : "failed"), status, info, { field, retryAfter });
}

function pidOf(projectId) {
  const pid = idOf(String(projectId == null ? "" : projectId));
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) throw failure("Which project?", "invalid", 400);
  return pid;
}

function pathText(path) {
  if (path === undefined || path === null || path === "") return "";
  return Array.isArray(path) ? path.map(String).join("/") : String(path);
}

/** One entry as the broker sends it, or null when it is not one (never drawn). */
function entryOf(x) {
  if (!x || typeof x !== "object" || typeof x.id !== "string" || !ITEM_ID.test(x.id)) return null;
  if (typeof x.name !== "string" || !x.name || Array.from(x.name).length > 255 || x.name.indexOf("/") !== -1) return null;
  const folder = x.folder === true;
  const size = !folder && typeof x.size === "number" && Number.isFinite(x.size) && x.size >= 0 ? x.size : null;
  const out = { id: x.id, name: x.name, folder, size, modified: typeof x.modified === "string" ? x.modified : null };
  if (folder && typeof x.children === "number" && Number.isFinite(x.children)) out.children = x.children;
  return out;
}

/** One page of a folder below the project's folder (path: "Floor Plans/Level 1" or its segments; "" = the folder). */
export async function list(projectId, path, cursor) {
  const body = { op: "list", project_id: pidOf(projectId) };
  const p = pathText(path);
  if (p) body.path = p;
  if (cursor) body.cursor = String(cursor);
  const d = (await call(body)) || {};
  const entries = (Array.isArray(d.entries) ? d.entries : []).map(entryOf).filter(Boolean);
  return {
    folderExists: d.folder_exists === true,
    path: typeof d.path === "string" ? d.path : p,
    entries,
    next: typeof d.next === "string" && d.next ? d.next : null,
    canUpload: d.can_upload === true,
    canMakeFolder: d.can_make_folder === true,
  };
}

/** The files of `path` named `name` (or "name N.ext") with exactly `size` bytes, newest first; at most `pages` pages. */
export async function findFile(projectId, path, name, size, pages) {
  const found = [];
  let cursor = null;
  for (let i = 0; i < (pages || 10); i++) {
    const page = await list(projectId, path, cursor);
    if (!page.folderExists) break;
    page.entries.forEach(function (e) { if (!e.folder && e.size === Number(size) && renamedFrom(e.name, name)) found.push(e); });
    cursor = page.next;
    if (!cursor) break;
  }
  return found.sort(function (a, b) {
    return String(b.modified || "").localeCompare(String(a.modified || "")) || (sameName(a.name, name) ? -1 : sameName(b.name, name) ? 1 : 0);
  });
}

/** A link is used only when it points at the owner's OneDrive host (or, in the local demo, is this page's own blob:). */
export function linkOk(url) {
  let u;
  try { u = new URL(String(url)); } catch (e) { return false; }
  if (u.username || u.password) return false;
  if (u.protocol === "https:") return u.hostname.toLowerCase() === ONEDRIVE_HOST && (!u.port || u.port === "443");
  if (u.protocol === "blob:") {
    const here = typeof location !== "undefined" && location && location.origin ? location.origin : null;
    return !!here && here !== "null" && u.origin === here;
  }
  return false;
}

export async function download(projectId, itemId) {
  if (typeof itemId !== "string" || !ITEM_ID.test(itemId)) throw failure("That file was not found.", "not_found", 404);
  const d = (await call({ op: "download", project_id: pidOf(projectId), item_id: itemId })) || {};
  if (!linkOk(d.url)) throw failure("OneDrive sent a link this page does not open.", "bad_link", 502);
  return { url: String(d.url), name: typeof d.name === "string" ? d.name : "", size: typeof d.size === "number" ? d.size : null };
}

/** {projectId, folder: "Documents" | "Floor Plans", relDir?: "Permits/2026", name, size, modified?: Date | ISO}. */
export async function uploadSession(o) {
  const body = { op: "upload_session", project_id: pidOf(o.projectId), folder: String(o.folder || ""), name: String(o.name || ""), size: Number(o.size) };
  if (o.relDir) body.rel_dir = String(o.relDir);
  if (o.modified) {
    const t = o.modified instanceof Date ? o.modified : new Date(o.modified);
    if (!isNaN(t.getTime())) body.modified = t.toISOString();
  }
  const d = (await call(body)) || {};
  if (!linkOk(d.upload_url) || !/^https:/.test(String(d.upload_url))) throw failure("OneDrive sent an upload address this page does not use.", "bad_link", 502);
  if (typeof d.ticket !== "string" || !d.ticket) throw failure("OneDrive could not do that just now.", "failed", 502);
  return {
    uploadUrl: String(d.upload_url),
    ticket: d.ticket,
    name: typeof d.name === "string" && d.name ? d.name : body.name,
    chunkBytes: Number(d.chunk_bytes) || 0,
    chunkMultiple: Number(d.chunk_multiple) || 0,
    maxChunkBytes: Number(d.max_chunk_bytes) || 0,
    maxBytes: Number(d.max_bytes) || 0,
    expiresAt: typeof d.expires_at === "string" ? d.expires_at : null,
  };
}

export async function uploadDone(projectId, itemId, ticket) {
  if (typeof itemId !== "string" || !ITEM_ID.test(itemId)) throw failure("OneDrive did not say which file it made.", "failed", 502);
  const d = (await call({ op: "upload_done", project_id: pidOf(projectId), item_id: itemId, ticket: String(ticket || "") })) || {};
  return {
    recorded: d.recorded === true,
    already: d.already === true,
    renamed: d.renamed === true,
    name: typeof d.name === "string" ? d.name : "",
    size: typeof d.size === "number" ? d.size : null,
    file: d.file && typeof d.file === "object" ? { id: d.file.id, versionNo: Number(d.file.version_no) || 1 } : null,
    reason: typeof d.reason === "string" ? d.reason : null,
    message: typeof d.message === "string" ? d.message : "",
  };
}

const OTHER_FOLDER = "OneDrive already has another folder with this project's number, so a second one is not made: an admin picks or renames it in DCR Desktop 2 (the project's Files tab).";

/** The project's OneDrive folder, made when missing (see the header): never throws. */
export async function ensureFolder(projectId) {
  let pid;
  try { pid = pidOf(projectId); } catch (e) { return { state: "failed", message: "Which project?" }; }
  try {
    const d = (await call({ op: "ensure_folder", project_id: pid })) || {};
    const created = Array.isArray(d.created) ? d.created.map(String) : [];
    const made = d.made_project_folder === true || created.length > 0;
    return { state: made ? "made" : "exists", message: "", madeProjectFolder: d.made_project_folder === true, created,
      existed: Array.isArray(d.existed) ? d.existed.map(String) : [], blocked: Array.isArray(d.blocked) ? d.blocked.map(String) : [] };
  } catch (e) {
    const code = String((e && e.code) || "failed");
    if (code === "not_deployed") return { state: "not_deployed", message: "" };
    if (["not_configured", "not_authorized", "busy", "projects_root_missing"].indexOf(code) !== -1) return { state: code, message: e.message };
    if (code === "other_folder") {
      const info = e.info || {};
      return { state: "other_folder", message: OTHER_FOLDER, count: Number(info.count) || 0,
        folders: Array.isArray(info.folders) ? info.folders.map(String) : [] };
    }
    if (code === "offline" || code === "forbidden") return { state: code, message: e.message };
    return { state: "failed", message: e && e.message ? e.message : "OneDrive could not make the folder just now." };
  }
}

/** The broker's own check (admins only): the settings, the token, the grant, the Projects folder, the narrow grant. */
export async function status() {
  const d = (await call({ op: "status" })) || {};
  return {
    ok: d.ok === true,
    grant: d.grant === "folder" || d.grant === "site" ? d.grant : null,
    checks: (Array.isArray(d.checks) ? d.checks : []).filter(function (c) { return c && typeof c.name === "string"; })
      .map(function (c) { return { name: c.name, ok: c.ok === true, code: typeof c.code === "string" ? c.code : "" }; }),
  };
}

/** Whether a page shows the OneDrive part to `me` on `project` (LIVE, or an admin on the self-test project). */
export function shownFor(me, project) {
  if (!me || me.active === false || me.role === "agents") return false;
  if (LIVE) return true;
  return selfTestFor(me, project);
}

/** The admin's self-test belongs to the test project only (docs/ONEDRIVE.md §13). */
export function selfTestFor(me, project) {
  const number = project && (project.internalIDNumber || project.number);
  return !!me && me.active !== false && me.role === "admin" && String(number || "") === SELF_TEST_PROJECT;
}
