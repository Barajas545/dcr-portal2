/* The project's OneDrive folder, through the Edge Function "onedrive" (DCR Desktop 2 supabase/functions/onedrive;
   owner decision 2026-10-24 D9). The function holds the only Microsoft secret and acts with the caller's own
   sign-in (never the service role): the database decides who may do what (public.onedrive_context), the function
   only carries it out in OneDrive.

   Today Portal 2 asks it one thing:
   * ensureFolder(projectId)   op "ensure_folder": the project's folder in OneDrive /Projects (with Floor Plans,
                               Photos and Documents), made when there is none; never a second folder when /Projects
                               already holds one for that project number (answer "other_folder"). It never throws:
                               -> {state, message}
                                    made | exists        the folder is there now;
                                    not_deployed         the function is not deployed yet (the gateway's own 404):
                                                         nothing to say, Portal 2 works as before;
                                    not_configured       deployed, the Microsoft side not set up yet (503);
                                    other_folder         another folder already has this project number (an admin
                                                         links it in DCR Desktop 2);
                                    forbidden | offline | failed   with a plain sentence.
   The Files tab's OneDrive part (list, download, upload) is added to this module with it.

   Pages never call functions themselves (tests/pages-guard.test.mjs): only through here. */

import { db, idOf } from "./_db.js";

export const FUNCTION = "onedrive";
// the broker's own error codes (a 404 whose body carries one of them is the broker's answer, not the gateway's)
const CONTRACT = ["invalid", "unauthorized", "forbidden", "not_openable", "not_found", "other_folder", "not_a_folder",
  "too_large", "cannot_record", "onedrive_failed", "onedrive_not_configured", "onedrive_not_authorized", "busy",
  "projects_root_missing", "onedrive_full", "server_error"];

function failure(message, code, status, info) {
  const e = new Error(message);
  e.code = code;
  e.status = status;
  e.info = info || null;
  return e;
}

/** POST {op, ...} with this person's sign-in -> the answer's data; errors are {code, status, message}: the
    gateway's 404 (no such function) is code "not_deployed", a 503 "not_configured", no answer "offline". */
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
  if (status === 503) throw failure("The OneDrive connection is not set up yet.", "not_configured", 503, info);
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
    if (code === "not_configured") return { state: "not_configured", message: "The OneDrive connection is not set up yet." };
    if (code === "other_folder") {
      return { state: "other_folder", message: "OneDrive already has another folder with this project number: an admin links it in DCR Desktop 2." };
    }
    if (code === "offline" || code === "auth" || code === "forbidden") return { state: code === "auth" ? "failed" : code, message: e.message };
    return { state: "failed", message: e && e.message ? e.message : "OneDrive could not make the folder just now." };
  }
}
