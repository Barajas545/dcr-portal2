/* The photo files' reads and writes for the phone (the photographer screen program, P5, the OneDrive edition - DCR
   Desktop 2 migrations 20261111000100_photo_files and 20261114000100_photo_files_onedrive and the Edge Function
   photo-files; the contract DCR Desktop 2 docs/PHOTO-FILES-ONEDRIVE.md §3.3, §4, §5.6, §5.7, cited OD).

   Portal 2 reads NO photo files table: every name, path and link it shows comes from an RPC that scrubs it, and a
   Realtime event is only a "read again" trigger (its ids, state and ready_at - never shown). An upload address the
   function hands out stays in the caller's memory: it is never written anywhere by this module (OD §3.6).

   Not available (OD §5.7): the OneDrive edition's status always answers `mode`; a status without it (the Google edition,
   after the OneDrive roll back) reads null here, as a database without the photo files does, and a NEW-only RPC that is
   not there (42883 / PGRST202: photo_upload_beat, the six-argument photo_upload_begin) throws a PhotoError whose
   `notAvailable` is true - either way the page hides its Files section and sends nothing.

   Reads:
   * status(shootId)            rpc photo_drive_status(p_shoot) - the Files section's one read; null on a database
                                without the photo files (42883 / PGRST202 / 42P01 / PGRST205) or without the OneDrive
                                edition (no mode);
   * readyList(view)            rpc photo_ready_list(p_view 'open' | 'done') - the Ready tab's one read; null without P5;
   * overview()                 rpc photo_drive_overview() (an admin's): the share list for the Access tab's lines
                                {company_domains, share_list, share_todo}; null without the OneDrive edition;
   * rows(shootId)              rpc photo_shoot_files_page(p_shoot, p_filter, p_after, p_limit), every page: the shoot's
                                rows [{id, path, size, md5, state, counted}] the phone plans a pick against (names
                                taken, a file matched by name and size, its stopped hand-in's rows - OD §3.3 steps 2, 9).
   Writes (the phone's hand-in, OD §3.3, §5.6):
   * begin(shootId, o)          rpc photo_upload_begin(p_shoot, p_client_key, p_device_key, p_device_label, p_source
                                'phone', p_replaces) -> {upload, replaced, again, closed};
   * record(uploadId, files)    rpc photo_upload_files(p_upload, p_files) -> its answer, plus byIndex: {i -> {file_id,
                                path, verdict, send}} (the ids every sessions / done / find names);
   * beat(uploadId, o)          rpc photo_upload_beat(p_upload, p_state, p_bytes_sent, p_sent_files, p_rate_bps) every
                                30 s while it sends (OD §3.2.8);
   * seal(uploadId, n, bytes)   rpc photo_upload_seal; cancel(uploadId) rpc photo_upload_cancel;
   * act(id, action, state, o)  rpc photo_marketing_act: a compare-and-set on the state the screen showed;
   * check(shootId)             photo-files {op: "check", shoot_id} - never automatically: every call counts toward the
                                person's 30 in 10 minutes; its answer IS a status (plus complete, cached, code,
                                became_ready);
   * sessions(uploadId, deviceKey, files)   photo-files sessions: one upload session per file (1-20), just in time;
   * done(uploadId, deviceKey, items)       photo-files done: each item read back by id, its verdict;
   * find(uploadId, deviceKey, fileId)      photo-files find: a lost last answer looked for -> item id | null;
   * drain()                    push {op: "drain"} - fire and forget: who heard a Ready row arrive asks the push function
                                to send its notices; the claim makes every extra drain harmless.
   The function's refusals are FilesError {code, status, info, retryAfter}.
   Realtime: watchFiles(onRead, o) watches photo_marketing, photo_drive_folders and photo_shoot_uploads on the usual
   private channels; drains a Ready row's notices once per (id, ready_at) (Drainer: the memory rule). */

import { db } from "./_db.js";
import { photoError, isMissing } from "./photo.js";
import { ONEDRIVE_HOST, ITEM_ID } from "./onedrive.js";

export const RPC = Object.freeze({ status: "photo_drive_status", readyList: "photo_ready_list", act: "photo_marketing_act",
  overview: "photo_drive_overview", begin: "photo_upload_begin", record: "photo_upload_files", beat: "photo_upload_beat",
  seal: "photo_upload_seal", cancel: "photo_upload_cancel", filesPage: "photo_shoot_files_page" });
// the arguments each RPC is sent, by name and in order (OD §5.6; tests/p10-photo-files-repo.test.mjs compares them with
// the migrations' own signatures when DCR_DESKTOP2_DIR names DCR Desktop 2)
export const RPC_ARGS = Object.freeze({
  photo_drive_status: ["p_shoot"],
  photo_ready_list: ["p_view"],
  photo_marketing_act: ["p_id", "p_action", "p_state", "p_note", "p_where", "p_link", "p_take_over"],
  photo_drive_overview: [],
  photo_upload_begin: ["p_shoot", "p_client_key", "p_device_key", "p_device_label", "p_source", "p_replaces"],
  photo_upload_files: ["p_upload", "p_files"],
  photo_upload_beat: ["p_upload", "p_state", "p_bytes_sent", "p_sent_files", "p_rate_bps"],
  photo_upload_seal: ["p_upload", "p_files", "p_bytes"],
  photo_upload_cancel: ["p_upload"],
  photo_shoot_files_page: ["p_shoot", "p_filter", "p_after", "p_limit"],
});
/** The RPCs only the OneDrive edition has (OD §5.7): their 42883 / PGRST202 is "not available", never "no P5". */
export const NEW_ONLY = Object.freeze(["photo_upload_beat", "photo_upload_begin"]);
export const ACTIONS = Object.freeze(["claim", "release", "posted", "pass", "reopen"]);
export const TABLES = Object.freeze(["photo_marketing", "photo_drive_folders", "photo_shoot_uploads"]);
export const FUNCTION = "photo-files";
export const DRAIN_MINUTES = 10;           // an UPDATE's new ready_at under 10 minutes old drains
/** A hand-in's sending states as its beat writes them (OD §3.1, §3.2.8; waiting_turn: a PC's own, for a hand-in behind
    the one it sends - review round 4; disk_full: a PC's own, its disk full while it sends - review round 10). */
export const SEND_STATES = Object.freeze(["sending", "waiting_net", "busy", "onedrive_full", "onedrive_stopped", "paused", "lost", "outbox_away",
  "disk_full", "waiting_turn", "done"]);
/** At most this many files a sessions or done call (OD §4.5). */
export const BATCH = 20;
/** The device key of photo_upload_begin (OD §5.6). */
export const DEVICE_KEY = /^pk_[A-Za-z0-9_-]{22}$/;
/** A phone's device label: never a person's name (OD §3.3 step 3). */
export const PHONE_LABELS = Object.freeze(["iPhone", "Android phone", "phone"]);

const one = (r) => (Array.isArray(r) ? r[0] || null : r);

async function call(name, args) {
  const c = await db();
  let res;
  try { res = await c.rpc(name, args || {}); } catch (e) { throw photoError(Object.assign({ code: "NETWORK", status: 0, message: String(e && e.message) }, e)); }
  if (res && res.error) {
    const e = photoError(res.error);
    // a NEW-only RPC that is not there: the OneDrive edition is not (any more) in this database
    if (NEW_ONLY.indexOf(name) !== -1 && (e.code === "42883" || e.code === "PGRST202")) { e.notAvailable = true; e.reason = "not_available"; }
    throw e;
  }
  return one(res ? res.data : null);
}

const bad = (message) => photoError({ code: "22023", hint: "bad_args", message });
const idArg = (v, what) => {
  const id = Number(v);
  if (!Number.isSafeInteger(id) || id < 1) throw bad(what);
  return id;
};

/* ── reads ────────────────────────────────────────────────────────────── */

/** One shoot's files, completion and marketing (OD §5.5, §10.6) as the database answers it; null on a database without
    the photo files, and null for a status without `mode` (the Google edition: not available, OD §5.7). */
export async function status(shootId) {
  const id = idArg(shootId, "Which shoot?");
  let st;
  try {
    st = await call(RPC.status, { p_shoot: id });
  } catch (e) {
    if (isMissing(e)) return null;
    throw e;
  }
  return st && typeof st === "object" && st.mode !== null && st.mode !== undefined ? st : null;
}

/** The Ready for marketing list: {me, view, items, counts}; null on a database without P5. */
export async function readyList(view) {
  const v = view === "done" ? "done" : "open";
  try {
    return await call(RPC.readyList, { p_view: v });
  } catch (e) {
    if (isMissing(e)) return null;
    throw e;
  }
}

/** An admin's photo_drive_overview, the part the Access tab reads: {company_domains: [..], share_list: [..], share_todo};
    null on a database without it or without the OneDrive edition (no mode, or no share list - as DCR Desktop 2's
    backend reads it, OD §5.7). 42501 for anyone but an admin. */
export async function overview() {
  let o;
  try {
    o = await call(RPC.overview, {});
  } catch (e) {
    if (isMissing(e)) return null;
    throw e;
  }
  if (!o || typeof o !== "object" || o.mode === null || o.mode === undefined || !Array.isArray(o.share_list)) return null;
  return { company_domains: Array.isArray(o.company_domains) ? o.company_domains.map(String) : [], share_list: o.share_list,
    share_todo: o.share_todo === true };
}

/** At most this many rows a page (photo_shoot_files_page takes 1 - 500), and pages a read (a shoot holds at most
    5,000 files, PF's too_many_files). */
export const PAGE_ROWS = 500;
const PAGES_MAX = 12;

/** The shoot's rows, every page in id order: [{id, path, size, md5 (the quickXorHash the device recorded, or null),
    state, counted}] - what the phone plans a pick against (OD §3.3 steps 2 and 9). Paths come scrubbed (the RPC's
    scrub_money); no item id is ever answered. Refusals are PhotoErrors (42501 forbidden, PT404 no_shoot). */
export async function rows(shootId) {
  const id = idArg(shootId, "Which shoot?");
  const out = [];
  let after = null;
  for (let page = 0; page < PAGES_MAX; page++) {
    const a = (await call(RPC.filesPage, { p_shoot: id, p_filter: null, p_after: after, p_limit: PAGE_ROWS })) || {};
    for (const r of Array.isArray(a.files) ? a.files : []) {
      if (!r || !Number.isSafeInteger(Number(r.id)) || typeof r.path !== "string") continue;
      out.push({ id: Number(r.id), path: r.path, size: Number(r.size) || 0, md5: typeof r.md5 === "string" && r.md5 ? r.md5 : null,
        state: String(r.state || ""), counted: r.counted === true });
    }
    if (a.next === null || a.next === undefined || !Number.isSafeInteger(Number(a.next))) return out;
    after = Number(a.next);
  }
  return out;
}

/* ── the phone's hand-in (OD §3.3, §5.6) ──────────────────────────────── */

/** photo_upload_begin with p_source 'phone'. o: {clientKey, deviceKey (^pk_…{22}$), label (iPhone | Android phone |
    phone), replaces (a hand-in id or null)}. -> {upload: {id, state, folder_id, source, device_id, recorded_files,
    recorded_bytes}, replaced, again, closed}. Refusals (PT409 uploads_off / uploads_test / phone_off / not_connected /
    root_lost / folder_gone / open_elsewhere / stopped_elsewhere, …) are PhotoErrors; notAvailable on a database without
    the OneDrive edition. */
export async function begin(shootId, o) {
  const opt = o || {};
  const id = idArg(shootId, "Which shoot?");
  if (typeof opt.clientKey !== "string" || !opt.clientKey) throw bad("No client key.");
  if (!DEVICE_KEY.test(String(opt.deviceKey || ""))) throw bad("That isn't a device key.");
  const label = PHONE_LABELS.indexOf(opt.label) !== -1 ? opt.label : "phone";
  const replaces = opt.replaces === undefined || opt.replaces === null ? null : idArg(opt.replaces, "Which hand-in?");
  return (await call(RPC.begin, { p_shoot: id, p_client_key: opt.clientKey, p_device_key: opt.deviceKey, p_device_label: label,
    p_source: "phone", p_replaces: replaces })) || {};
}

/** photo_upload_files: the picked files recorded, with NO hash on a phone (OD §3.3 step 4). files: [{path, size,
    modified?, md5?, replace?}]. -> the answer {added, same, replaced, restored, recopied, copies, refused, recorded_files,
    recorded_bytes, files: [{i, file_id, path, verdict, send}]} plus byIndex: {i: {file_id, path, verdict, send}} - an
    entry with send false is not this hand-in's to send (the same as a row already in). */
export async function record(uploadId, files) {
  const id = idArg(uploadId, "Which hand-in?");
  if (!Array.isArray(files) || !files.length) throw bad("No files.");
  const items = files.map((f) => {
    const x = f || {};
    const size = Number(x.size);
    if (typeof x.path !== "string" || !x.path || !Number.isSafeInteger(size) || size < 0) throw bad("A file without a path or size.");
    const out = { path: x.path, size };
    if (x.modified) out.modified = String(x.modified);
    if (x.md5) out.md5 = String(x.md5);
    if (x.replace === true) out.replace = true;
    return out;
  });
  const a = (await call(RPC.record, { p_upload: id, p_files: items })) || {};
  const byIndex = {};
  for (const e of Array.isArray(a.files) ? a.files : []) {
    if (!e || !Number.isSafeInteger(Number(e.i)) || e.file_id === null || e.file_id === undefined) continue;
    byIndex[Number(e.i)] = { file_id: Number(e.file_id), path: e.path === undefined ? null : e.path, verdict: e.verdict || null, send: e.send === true };
  }
  return Object.assign({}, a, { byIndex });
}

/** photo_upload_beat (OD §3.2.8, §5.6): every 30 s while the hand-in sends. o: {state (SEND_STATES), bytesSent,
    sentFiles, rateBps}. -> its answer. 22023 bad_state, PT429 at 600 an hour; notAvailable without the OneDrive
    edition. */
export async function beat(uploadId, o) {
  const opt = o || {};
  const id = idArg(uploadId, "Which hand-in?");
  if (SEND_STATES.indexOf(opt.state) === -1) throw photoError({ code: "22023", hint: "bad_state", message: "Not a sending state." });
  const n = (v) => { const x = Math.trunc(Number(v)); return Number.isFinite(x) && x > 0 ? x : 0; };
  const rate = opt.rateBps === undefined || opt.rateBps === null ? null : n(opt.rateBps);
  return (await call(RPC.beat, { p_upload: id, p_state: opt.state, p_bytes_sent: n(opt.bytesSent), p_sent_files: n(opt.sentFiles),
    p_rate_bps: rate })) || {};
}

/** photo_upload_seal: the counts of the rows that have a hash (OD §3.3 step 8). */
export async function seal(uploadId, filesCount, bytes) {
  const id = idArg(uploadId, "Which hand-in?");
  return (await call(RPC.seal, { p_upload: id, p_files: Math.max(0, Math.trunc(Number(filesCount) || 0)),
    p_bytes: Math.max(0, Math.trunc(Number(bytes) || 0)) })) || {};
}

/** photo_upload_cancel (PF's cancel). */
export async function cancel(uploadId) {
  return (await call(RPC.cancel, { p_upload: idArg(uploadId, "Which hand-in?") })) || {};
}

/* ── the Ready list's acts ────────────────────────────────────────────── */

/** photo_marketing_act: action claim | release | posted | pass | reopen, `state` the state the card showed.
    o: {note, where: [..], link, takeOver}. -> {id, state, version, claimed_by_name, posted_by_name, passed_by_name, at,
    again?}. Refusals are PhotoErrors (hint: changed, taken {by, at}, not_yours, too_late, withdrawn, no_item, ...). */
export async function act(id, action, state, o) {
  const opt = o || {};
  const note = opt.note === undefined || opt.note === null || String(opt.note).trim() === "" ? null : String(opt.note).trim();
  const link = opt.link === undefined || opt.link === null || String(opt.link).trim() === "" ? null : String(opt.link).trim();
  const where = Array.isArray(opt.where) && opt.where.length ? opt.where.map(String) : null;
  return (await call(RPC.act, { p_id: Number(id), p_action: String(action || ""), p_state: String(state || ""), p_note: note,
    p_where: where, p_link: link, p_take_over: opt.takeOver === true })) || {};
}

/* ── the photo-files function (OD §4.5, §4.7) ─────────────────────────── */

// the function's own codes: an answer naming one is the function's; a gateway's never does
export const CODES = Object.freeze(["invalid", "unauthorized", "forbidden", "not_yours", "no_shoot", "no_upload", "no_folder", "root_lost", "root_changed",
  "not_connected", "folder_gone", "upload_closed", "bad_files", "too_large", "rate", "server_error", "onedrive_failed", "not_configured", "not_authorized",
  "too_wide", "busy", "uploads_off", "uploads_test", "onedrive_full", "not_this_device", "method_not_allowed"]);

/** A photo-files refusal: code (the function's, else offline / not_deployed / failed), status, info (its body),
    retryAfter (seconds, from the Retry-After header the function exposes to this site; null when none). */
export class FilesError extends Error {
  constructor(message, code, status, info, retryAfter) {
    super(message);
    this.name = "FilesError";
    this.code = code;
    this.status = status;
    this.info = info || null;
    this.retryAfter = retryAfter === undefined ? null : retryAfter;
  }
}

async function invoke(name, body) {
  let res;
  try {
    const c = await db();
    res = await c.functions.invoke(name, { body });
  } catch (e) {
    throw new FilesError("offline", "offline", 0);
  }
  const { data, error } = res || {};
  if (!error) return data;
  const ctx = error.context;
  let st = 0, info = null;
  if (ctx && typeof ctx.status === "number") {
    st = ctx.status;
    try { info = await (ctx.clone ? ctx.clone() : ctx).json(); } catch (e) { info = null; }
  }
  if (!st) throw new FilesError("offline", "offline", 0);
  const code = info && typeof info.error === "string" && CODES.indexOf(info.error) !== -1 ? info.error : "";
  let retryAfter = null;
  try {
    const ra = ctx && ctx.headers && typeof ctx.headers.get === "function" ? Number(ctx.headers.get("Retry-After")) : NaN;
    if (Number.isFinite(ra) && ra > 0) retryAfter = Math.min(ra, 900);
  } catch (e) { /* no header to read */ }
  if (st === 404 && !code) throw new FilesError("not deployed", "not_deployed", 404, info, retryAfter);
  throw new FilesError(code || "failed", code || "failed", st, info, retryAfter);
}

/** photo-files check {shoot_id}: the status as this person sees it now, plus {complete, cached, code, became_ready} -
    at most once per 20 s per shoot (cached: true within that). */
export async function check(shootId) {
  return invoke(FUNCTION, { op: "check", shoot_id: idArg(shootId, "Which shoot?") });
}

function batch(list, what) {
  if (!Array.isArray(list) || !list.length || list.length > BATCH) throw bad("1 to " + BATCH + " " + what + " at a time.");
}
const fileIdOf = (v) => idArg(v, "Which file?");
const deviceOf = (k) => { if (!DEVICE_KEY.test(String(k || ""))) throw bad("That isn't a device key."); return String(k); };

/** An upload address the function handed out, as the phone may use it: https on the one OneDrive host Portal 2's pages
    already name (repo/onedrive.js ONEDRIVE_HOST; shoots.html's connect-src) - anything else is never used. */
export function uploadUrlOk(url) {
  if (typeof url !== "string" || url.length > 4096) return false;
  let u;
  try { u = new URL(url); } catch (e) { return false; }
  return u.protocol === "https:" && u.hostname === ONEDRIVE_HOST && !u.username && !u.password && (u.port === "" || u.port === "443");
}

/** photo-files sessions {upload_id, device_key, files: [{file_id, md5?}]} (1-20; OD §4.5): one session per file, just in
    time. -> {chunk_multiple, chunk_bytes, max_chunk_bytes, files: [{file_id, upload_url, expires_at, path} |
    {file_id, code: "name_taken", path, upload_url, expires_at} | {file_id, code: "found", item_id} |
    {file_id, code, retry_after?, max_bytes?}]}. An address not on the OneDrive host is never handed on: that file reads
    {code: "onedrive_failed"}. 503 uploads_off / uploads_test for the whole call (FilesError). */
export async function sessions(uploadId, deviceKey, files) {
  batch(files, "files");
  const body = { op: "sessions", upload_id: idArg(uploadId, "Which hand-in?"), device_key: deviceOf(deviceKey),
    files: files.map((f) => { const x = f || {}; const o = { file_id: fileIdOf(x.file_id) }; if (x.md5) o.md5 = String(x.md5); return o; }) };
  const a = (await invoke(FUNCTION, body)) || {};
  const out = Object.assign({}, a, { files: [] });
  for (const f of Array.isArray(a.files) ? a.files : []) {
    if (!f || typeof f !== "object") continue;
    if (f.upload_url !== undefined && !uploadUrlOk(f.upload_url)) { out.files.push({ file_id: f.file_id, code: "onedrive_failed" }); continue; }
    if (f.code === "found" && !ITEM_ID.test(String(f.item_id || ""))) { out.files.push({ file_id: f.file_id, code: "onedrive_failed" }); continue; }
    out.files.push(f);
  }
  return out;
}

/** photo-files done {upload_id, device_key, items: [{file_id, item_id, md5?}]} (1-20): each item read by id and judged.
    A phone's item carries the quickXorHash it computed while sending (md5). -> {items: [{file_id, state: confirmed |
    checking, retry_after?} | {file_id, code}], folder: {files_state}}. */
export async function done(uploadId, deviceKey, items) {
  batch(items, "items");
  const body = { op: "done", upload_id: idArg(uploadId, "Which hand-in?"), device_key: deviceOf(deviceKey),
    items: items.map((x) => {
      const it = x || {};
      if (!ITEM_ID.test(String(it.item_id || ""))) throw bad("That isn't a OneDrive item.");
      const o = { file_id: fileIdOf(it.file_id), item_id: String(it.item_id) };
      if (it.md5) o.md5 = String(it.md5);
      return o;
    }) };
  return (await invoke(FUNCTION, body)) || {};
}

/** photo-files find {upload_id, device_key, file_id} (OD §3.5): a last chunk's lost answer looked for. -> the item id, or
    null (nothing there: a new session from byte 0). */
export async function find(uploadId, deviceKey, fileId) {
  const a = (await invoke(FUNCTION, { op: "find", upload_id: idArg(uploadId, "Which hand-in?"), device_key: deviceOf(deviceKey),
    file_id: fileIdOf(fileId) })) || {};
  return typeof a.item_id === "string" && ITEM_ID.test(a.item_id) ? a.item_id : null;
}

/** push drain: fire and forget (never thrown, never shown). */
export function drain() {
  return invoke("push", { op: "drain" }).then(() => true, () => false);
}

/* ── Realtime and the drain's memory ──────────────────────────────────── */

/** The memory rule: the ready_at last seen per Ready row (from the list or a status read); a Realtime INSERT, or an
    UPDATE whose new ready_at differs from it and is under 10 minutes old, drains once per (row id, ready_at). Under row
    level security an UPDATE carries the OLD record's primary key only, so the page's own memory decides. */
export class Drainer {
  constructor(o) {
    const opt = o || {};
    this.seenAt = new Map();
    this.drained = new Set();
    this.now = typeof opt.now === "function" ? opt.now : () => Date.now();
    this.drain = typeof opt.drain === "function" ? opt.drain : drain;
  }
  /** A read saw row `id` with this ready_at. */
  saw(id, readyAt) {
    if (id === null || id === undefined) return;
    this.seenAt.set(String(id), readyAt ? String(readyAt) : "");
  }
  /** A photo_marketing Realtime event -> whether it drained. */
  event(evt) {
    if (!evt || (evt.type !== "INSERT" && evt.type !== "UPDATE")) return false;
    const row = evt.new || {};
    if (row.id === null || row.id === undefined || !row.ready_at) return false;
    const id = String(row.id);
    const at = String(row.ready_at);
    const t = Date.parse(at);
    const fresh = Number.isFinite(t) && this.now() - t < DRAIN_MINUTES * 60e3;
    const before = this.seenAt.get(id);
    this.seenAt.set(id, at);
    if (!fresh) return false;
    if (evt.type === "UPDATE" && before === at) return false;      // a told-trigger or check update: the same ready_at
    const key = id + "@" + at;
    if (this.drained.has(key)) return false;
    this.drained.add(key);
    try { this.drain(); } catch (e) { /* fire and forget */ }
    return true;
  }
}

/** Watch the three tables; onRead({tables, join, events}) runs after every join and after changes, coalesced (o.wait ms,
    500) and never two at a time. o.drainer: a Drainer fed every photo_marketing event; o.onLost(evt): a channel went;
    o.live: a stand-in for live.js (tests). -> stop() */
export async function watchFiles(onRead, o) {
  const opt = o || {};
  const live = opt.live || (await import("../live.js"));
  const wait = Number.isFinite(Number(opt.wait)) ? Number(opt.wait) : 500;
  let stopped = false, timer = null, busy = false, again = false;
  let seen = new Set(), joined = false;
  function kick() {
    if (stopped || timer) return;
    timer = setTimeout(run, wait);
  }
  async function run() {
    timer = null;
    if (stopped) return;
    if (busy) { again = true; return; }
    busy = true;
    const what = { tables: Array.from(seen), join: joined };
    seen = new Set();
    joined = false;
    try { await onRead(what); } catch (e) { /* the page's own read reports its error */ }
    busy = false;
    if (again) { again = false; kick(); }
  }
  const offs = TABLES.map((t) => live.watch(t, "", (evt) => {
    if (stopped || !evt) return;
    if (evt.type === "LOST") { if (typeof opt.onLost === "function") { try { opt.onLost(evt); } catch (e) { /* */ } } return; }
    if (t === "photo_marketing" && opt.drainer) opt.drainer.event(evt);
    seen.add(t);
    if (evt.type === "SUBSCRIBED") joined = true;
    kick();
  }, { lost: true }));
  return function stop() {
    stopped = true;
    clearTimeout(timer);
    for (const off of offs) { try { off(); } catch (e) { /* */ } }
  };
}
