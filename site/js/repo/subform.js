/* The public subcontractor form's only connection (submit.html; BLUEPRINT 2.2.7, 3.3.11, P5 5c).

   Somebody without an account uses this page, so it never touches the staff sign-in: it has its OWN supabase-js
   client that keeps no session at all (persistSession off, a memory store under its own key "dcr2-subform"), so
   even on an office computer where someone is signed in to Portal 2, nothing of that sign-in is sent or changed.
   It talks to exactly two things:
   * the Edge Function "subform" (DCR Desktop 2 supabase/functions/subform; no sign-in, verify_jwt = false):
     op "projects" (the open jobs, a fixed projection: id, number, name, address, city), op "submit" (a Pending
     submission - never a bill - with a reference, and ONE signed upload for the paperwork), op "attached";
   * that one signed upload (Storage, uploadToSignedUrl): the bucket, the path and the file name are the function's -
     the private inbox subform-inbox (Storage itself refuses more than 25 MB or anything but a photo, a scan or a PDF;
     nobody can read it), at f/{project}/receipts/...; "attached" checks it and copies it into project-files, where
     only people with the financials switch can open it.
   Errors come back as plain sentences (err.message), with err.errors = every problem the function found, and
   err.status (0 = no connection). */

export const FUNCTION = "subform";
/** Where the anonymous upload lands (migration M5c): never project-files directly. */
export const INBOX = "subform-inbox";
const STORE_KEY = "dcr2-subform";
const OFFLINE = "Could not reach DCR just now. Check your connection and try again.";

let client = null;
let override = null;

/** Tests hand a stub client (functions.invoke, storage.from(...).uploadToSignedUrl). */
export function useSubformClient(c) { override = c || null; client = null; }

function memoryStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
}

function api() {
  if (override) return override;
  if (client) return client;
  const lib = globalThis.supabase;
  if (!lib || typeof lib.createClient !== "function") throw failure(OFFLINE, "offline", 0);
  const c = globalThis.DCR2_CONFIG || {};
  client = lib.createClient(c.SUPABASE_URL, c.SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: STORE_KEY, storage: memoryStore() },
  });
  return client;
}

function failure(message, code, status, errors) {
  const e = new Error(message);
  e.code = code;
  e.status = status;
  e.errors = errors && errors.length ? errors : [message];
  return e;
}

/** POST {op, ...} to the function. The answer's data, or a plain-sentence error. */
export async function call(body) {
  let res;
  try {
    res = await api().functions.invoke(FUNCTION, { body });
  } catch (e) {
    if (e && e.code === "offline") throw e;
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
  if (!status) throw failure(OFFLINE, "offline", 0);
  const message = (info && typeof info.message === "string" && info.message) ||
    (status === 429 ? "Too many tries from this connection. Wait a while and try again." : "That could not be sent. Try again in a few minutes.");
  throw failure(message, (info && info.error) || "error", status, info && Array.isArray(info.errors) ? info.errors.map(String) : null);
}

/** The open jobs matching what was typed: {projects: [{id, number, name, address, city}], more, min}. */
export async function searchProjects(q) {
  const d = await call({ op: "projects", q: String(q || "") });
  return { projects: Array.isArray(d && d.projects) ? d.projects : [], more: Number((d && d.more) || 0), min: Number((d && d.min) || 3) };
}

/** The submission (see map/submissions.js payloadFor): {reference, upload: {bucket, path, token, name, size} | null}. */
export async function submit(payload) {
  const d = await call(Object.assign({}, payload, { op: "submit" }));
  return { reference: String((d && d.reference) || ""), upload: (d && d.upload) || null, message: (d && d.message) || "" };
}

/** The paperwork to the one signed upload the function minted, then "attached". true when both went through. */
export async function sendDocument(reference, upload, file, type) {
  if (!upload || !upload.path || !upload.token || !file) return false;
  // re-typed so the stored type is the one the function was told (a phone's HEIC sometimes carries none)
  const blob = file.type === type ? file : new Blob([file], { type });
  // the inbox the function named (only that one: a signed URL of another bucket is not ours to use)
  const bucket = upload.bucket === INBOX || !upload.bucket ? INBOX : null;
  if (!bucket) return false;
  const up = await api().storage.from(bucket).uploadToSignedUrl(upload.path, upload.token, blob, { contentType: type, upsert: false });
  if (!up || up.error) return false;
  await call({ op: "attached", reference, path: upload.path });
  return true;
}
