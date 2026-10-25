/* The project's OneDrive folder, through the Edge Function "onedrive" (DCR Desktop 2 supabase/functions/onedrive;
   owner decision 2026-10-24 D9). The function holds the only Microsoft secret and acts with the caller's own
   sign-in (never the service role): the database decides who may do what (public.onedrive_context), the function
   only carries it out in OneDrive.

   LIVE: false until the Files tab's OneDrive part ships (deploy order: the Microsoft setup, migration
   20261028000200_onedrive, the function and its secrets, its status check — then the release that sets LIVE to true
   with that tab). While it is false the pages make no OneDrive call and say nothing about OneDrive folders: a
   function that is not deployed cannot be told apart from "offline" in a browser (functions.invoke sends its
   headers, so the browser asks CORS first; the missing function's 404 to that question is a network error).

   Today Portal 2 asks it one thing:
   * ensureFolder(projectId)   op "ensure_folder": the project's folder in OneDrive /Projects (with Floor Plans,
                               Photos and Documents), made when there is none; never a second folder when /Projects
                               already holds one for that project number (answer "other_folder"). It never throws:
                               -> {state, message}
                                    made | exists        the folder is there now;
                                    not_deployed         the gateway's own 404 (a readable one: the demo, a test);
                                    not_configured | not_authorized | busy | projects_root_missing
                                                         the broker's 503s, each with its own sentence;
                                    other_folder         another folder already has this project number (an admin
                                                         links it in DCR Desktop 2);
                                    forbidden | offline | failed   with a plain sentence.
   The Files tab's OneDrive part (list, download, upload) is added to this module with it.

   Pages never call functions themselves (tests/pages-guard.test.mjs): only through here. */

import { db, idOf } from "./_db.js";

export const FUNCTION = "onedrive";
/** The pages call the function only when this is true (see the header): set with the Files tab's OneDrive release. */
export const LIVE = false;
// the broker's own error codes (a 404 whose body carries one of them is the broker's answer, not the gateway's)
const CONTRACT = ["invalid", "unauthorized", "forbidden", "not_openable", "not_downloadable", "not_found", "method_not_allowed",
  "other_folder", "not_a_folder", "not_this_upload", "too_large", "file_type", "cannot_record", "onedrive_failed",
  "onedrive_not_configured", "onedrive_not_authorized", "busy", "projects_root_missing", "onedrive_full", "server_error"];
// the broker's 503s: [code here, the sentence] (the broker's own message may name settings: never shown)
const UNAVAILABLE = {
  onedrive_not_configured: ["not_configured", "The OneDrive connection is not set up yet."],
  onedrive_not_authorized: ["not_authorized", "The OneDrive connection is not allowed in just now: an admin checks it."],
  busy: ["busy", "OneDrive is busy just now: try again in a minute."],
  projects_root_missing: ["projects_root_missing", "OneDrive's Projects folder is not where it was set up: an admin checks the OneDrive settings."],
};

function failure(message, code, status, info) {
  const e = new Error(message);
  e.code = code;
  e.status = status;
  e.info = info || null;
  return e;
}

/** POST {op, ...} with this person's sign-in -> the answer's data; errors are {code, status, message}: the
    gateway's 404 (no such function) is code "not_deployed", the broker's 503s their own codes (UNAVAILABLE; a 503
    without one "unavailable"), no answer "offline". */
export async function call(body) {
  let res;
  try {
    const c = await db();
    res = await c.functions.invoke(FUNCTION, { body });
  } catch (e) {
    throw failure("No connection to DCR just now.", "offline", 0);
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
  if (!status) throw failure("No connection to DCR just now.", "offline", 0);
  if (status === 404 && !code) throw failure("The OneDrive connection is not set up yet.", "not_deployed", 404);
  if (status === 503) {
    const u = UNAVAILABLE[code];
    throw u ? failure(u[1], u[0], 503, info) : failure("The OneDrive connection is not answering just now.", "unavailable", 503, info);
  }
  if (status === 401) throw failure("Your sign-in has expired. Please sign in again.", "auth", 401);
  if (status === 403) throw failure("This account cannot do that in OneDrive.", "forbidden", 403);
  throw failure("OneDrive could not do that just now.", code || "failed", status, info);
}

/** The project's OneDrive folder, made when missing (see the header): never throws -> {state, message}. */
export async function ensureFolder(projectId) {
  const pid = idOf(String(projectId == null ? "" : projectId));
  if (typeof pid !== "number" || !(pid > 0)) return { state: "failed", message: "Which project?" };
  try {
    const d = (await call({ op: "ensure_folder", project_id: pid })) || {};
    const made = Array.isArray(d.created) ? d.created.length > 0 : !!d.created;
    return { state: made ? "made" : "exists", message: "" };
  } catch (e) {
    const code = String((e && e.code) || "failed");
    if (code === "not_deployed") return { state: "not_deployed", message: "" };
    if (["not_configured", "not_authorized", "busy", "projects_root_missing"].indexOf(code) !== -1) return { state: code, message: e.message };
    if (code === "other_folder") {
      return { state: "other_folder", message: "OneDrive already has another folder with this project number: an admin links it in DCR Desktop 2." };
    }
    if (code === "offline" || code === "auth" || code === "forbidden") return { state: code === "auth" ? "failed" : code, message: e.message };
    return { state: "failed", message: e && e.message ? e.message : "OneDrive could not make the folder just now." };
  }
}
