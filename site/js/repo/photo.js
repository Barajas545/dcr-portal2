/* The shoot schedule's reads and writes (the photographer screen program, P3: the data layer of shoots.html; DCR Desktop 2
   migration 20261110000100_photo_schedule, docs/DATABASE.md §39; the contract is DCR Desktop 2's docs/PHOTO-SCHEDULE.md).

   DCR Agents 2 on the office PC is the ONLY writer of photo plans: it mirrors them into photo_plans / photo_shoots. People
   read that mirror (row level security: admins and the photo team) and ask for changes through three RPCs; the PC takes
   each change, applies it and mirrors the plan again (photo_changes: new -> taken -> applied | refused, or cancelled /
   expired after 7 days). Nothing here writes a table directly: the photo team is written ONLY through set_photo_team
   (the one-default rule lives in that RPC).

   Reads:
   * myAccess()               rpc photo_my_access() -> map toAccess {admin, photographer, marketing, defaultPhotographer,
                              canEdit, canRead, ready}; a database without the photo schedule yet: ready false (nothing);
   * pcStatus()               rpc photo_pc_status() -> {lastSeen, minutesAgo, online, paused, mirroredAt} (no host name);
                              a database without it: null;
   * loadSchedule(o)          photo_plans (archived ones only with o.archived; o.planId: one plan) and their photo_shoots
                              -> {ready, plans, shoots} (map toPlan / toShoot); without the tables yet: ready false;
   * loadPlan(id)             one plan and its shoots, or null;
   * changes(o)               photo_changes (o.planId, o.mine: requested by that profile, o.open: new and taken only,
                              o.days: asked within that many days, 30) -> map toChange, newest first; myChanges(uid, o),
                              planChanges(planId, o);
   * team()                   photo_team with each person's name (profiles) -> map toTeamMember, by name;
   * shootForTask(taskId)     the mirrored shoot of a My Tasks task (photo_shoots.task_id) -> {id, planId} | null.
   Writes:
   * preview(planId, kind, args)                rpc photo_change_preview -> the database's preview (§6.3; the shift rule
                                                is the database's - map previewWords puts it into words);
   * request(planId, kind, args, baseRev, o)    rpc photo_change_request with the plan rev the page read and a client key
                                                that is stable per device and per attempt: the same change asked again
                                                after a dropped connection carries the same key, so the database answers
                                                the row it already has (again: true) instead of a second change;
   * cancel(id)                                 rpc photo_change_cancel -> {ok, status};
   * setTeam(profileId, next, version)          rpc set_photo_team at the row's version (null: no row yet); a "changed"
                                                refusal (PT409) is thrown as it is - never written over.
   Realtime: watchSchedule(onRead, o) watches the four tables on the usual private channels (live.js) and calls onRead
   after every join (changes made before a join are never delivered) and after changes, coalesced.

   Errors: every refusal is a PhotoError with the database's SQLSTATE (code), its short code (hint - the code the page
   switches on: changed, pending, past, firm, forbidden ...), reason (the hint, or what the SQLSTATE means), the detail
   parsed ({table, id, rev | version}, {id}, {retryAfter}) and retryable (no answer: send the same request again). */

import { db, must, idOf, pageAll } from "./_db.js";
import { toPlan, toShoot, toChange, toAccess, toPcStatus, toTeamMember, changeState } from "../map/photo.js";

export const TABLES = Object.freeze(["photo_plans", "photo_shoots", "photo_changes", "photo_team"]);
// the mirror's columns the page reads (never ledger_id, local_id or host: the PC's own)
export const PLAN_COLS = "id, rev, milestones_rev, status, project_id, project_code, project_label, city, title, photographer_name, " +
  "photographer_profile_id, photographer_source, milestones, shoot_days, lead_days, series, open_suggestions, activated_at, mirrored_at, updated_at";
export const SHOOT_COLS = "id, plan_id, key, seq, phase, name, anchor, offset_days, fixed_date, planned_date, window_days, status, auto_skipped, " +
  "pin_day, series, n, announced_for, done_at, done_source, done_note, task_id, brief, history, rev, updated_at";
// a change as its requester and the schedule's editors see it (never the PC's host, the ledger or the client key)
export const CHANGE_COLS = "id, plan_id, kind, args, target_key, base_rev, preview, needs_office, status, requested_by, requested_at, " +
  "requester_admin, taken_at, done_at, result, error, undo_of, undone_by";
export const TEAM_COLS = "profile_id, photographer, marketing, default_photographer, google_email, version, updated_at";
export const TEAM_SELECT = TEAM_COLS + ", profile:profiles(full_name, role, active)";
export const RPC = Object.freeze({ access: "photo_my_access", pc: "photo_pc_status", preview: "photo_change_preview",
  request: "photo_change_request", cancel: "photo_change_cancel", setTeam: "set_photo_team" });
// the arguments each RPC is sent, by name (tools/schema-check-p10-photo.mjs compares them with the migration's)
export const RPC_ARGS = Object.freeze({
  photo_my_access: [], photo_pc_status: [], photo_change_preview: ["p_plan", "p_kind", "p_args"],
  photo_change_request: ["p_plan", "p_kind", "p_args", "p_base_rev", "p_client_key"], photo_change_cancel: ["p_id"],
  set_photo_team: ["p_profile", "p_photographer", "p_marketing", "p_default", "p_google_email", "p_version"],
});
export const DAYS = 30;               // changes(): asked within the last 30 days unless said otherwise
const PAGE_IDS = 150;                 // ids per .in() read

/* ── errors ───────────────────────────────────────────────────────────── */

const SCHEMA = new Set(["42883", "PGRST202", "42P01", "PGRST205", "42703", "PGRST204"]);
const BY_CODE = { "42501": "forbidden", PT404: "not_found", PT409: "changed", PT413: "too_big", PT429: "rate", "22023": "bad_args" };

/** A refusal the page can switch on: code (SQLSTATE), hint (the database's short code), reason (hint, or the SQLSTATE's
    meaning), detail (parsed), retryAfter (seconds, a PT429), retryable (no answer reached us: send it again). */
export class PhotoError extends Error {
  constructor(src) {
    const e = src || {};
    super(e.message || "The shoot schedule could not do that.");
    this.name = "PhotoError";
    this.code = e.code === undefined || e.code === null ? "" : String(e.code);
    this.hint = e.hint ? String(e.hint) : "";
    this.details = e.details === undefined ? null : e.details;
    this.status = Number(e.status || 0) || 0;
    this.detail = parseDetail(e.details);
    this.missing = SCHEMA.has(this.code);
    this.retryable = isRetryable(e);
    this.reason = this.hint || (this.retryable ? "offline" : this.missing ? "not_ready" : BY_CODE[this.code] || "error");
    this.retryAfter = this.detail && Number.isFinite(Number(this.detail.retryAfter)) ? Number(this.detail.retryAfter) : null;
  }
}

function parseDetail(d) {
  if (d && typeof d === "object") return d;
  if (typeof d !== "string" || !d.trim()) return null;
  try { const v = JSON.parse(d); return v && typeof v === "object" ? v : null; } catch (e) { return null; }
}

/** No answer from the database (a dropped connection, a gateway's 5xx): the same request may be sent again. */
export function isRetryable(e) {
  if (!e) return false;
  const code = String(e.code || "");
  if (/^[0-9A-Z]{5}$/.test(code) && !/^(08|57P0|53|XX)/.test(code)) return false;    // the database answered
  if (code === "NETWORK" || code === "offline") return true;
  const st = Number(e.status || 0);
  if (st === 0 && !code) return true;
  if ([408, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530, 544].indexOf(st) !== -1) return true;
  return /failed to fetch|network|load failed|timed? ?out/i.test(String(e.message || ""));
}

/** A database without the photo schedule yet (a missing table, column or function). */
export function isMissing(e) { return !!e && SCHEMA.has(String(e.code || "")); }

export function photoError(e) { return e instanceof PhotoError ? e : new PhotoError(e); }

async function call(name, args) {
  const c = await db();
  let res;
  try { res = await c.rpc(name, args || {}); } catch (e) { throw photoError(Object.assign({ code: "NETWORK", status: 0, message: String(e && e.message) }, e)); }
  try { return must(res); } catch (e) { throw photoError(e); }
}

async function read(fn) {
  try { return await fn(); } catch (e) { throw photoError(e); }
}

const one = (r) => (Array.isArray(r) ? r[0] || null : r);
const ids = (list) => Array.from(new Set((list || []).filter((v) => v !== null && v !== undefined && v !== "").map((v) => idOf(v))));

/* ── reads ────────────────────────────────────────────────────────────── */

/** My photo gates; a database without the photo schedule yet: nobody reads or edits it (ready false). */
export async function myAccess() {
  try {
    return toAccess(one(await call(RPC.access, {})));
  } catch (e) {
    if (e.missing) return toAccess(null);
    throw e;
  }
}

/** The DCR server (the lease holder) as the photo team sees it; null on a database without it. */
export async function pcStatus() {
  try {
    return toPcStatus(one(await call(RPC.pc, {})));
  } catch (e) {
    if (e.missing) return null;
    throw e;
  }
}

async function shootsOf(planIds) {
  const want = ids(planIds);
  const out = [];
  for (let i = 0; i < want.length; i += PAGE_IDS) {
    const part = want.slice(i, i + PAGE_IDS);
    const rows = await pageAll((c) => c.from("photo_shoots").select(SHOOT_COLS).in("plan_id", part)
      .order("plan_id", { ascending: true }).order("seq", { ascending: true }).order("id", { ascending: true }));
    for (const r of rows || []) out.push(r);
  }
  return out;
}

/** The mirror: {ready, plans, shoots}. o: {archived (also the archived plans), planId (one plan)}. Row level security
    gives nothing to someone who is not an admin or on the photo team (map toAccess.canRead says so first). */
export async function loadSchedule(o) {
  const opt = o || {};
  try {
    const plans = await read(() => pageAll((c) => {
      let q = c.from("photo_plans").select(PLAN_COLS);
      if (opt.planId !== undefined && opt.planId !== null) q = q.eq("id", idOf(opt.planId));
      else if (!opt.archived) q = q.neq("status", "archived");
      return q.order("id", { ascending: true });
    }));
    const shoots = plans.length ? await read(() => shootsOf(plans.map((p) => p.id))) : [];
    return { ready: true, plans: plans.map(toPlan), shoots: shoots.map(toShoot) };
  } catch (e) {
    if (e.missing) return { ready: false, plans: [], shoots: [] };
    throw e;
  }
}

/** One plan and its shoots: {plan, shoots} | null (not mirrored, or not readable). */
export async function loadPlan(planId) {
  const r = await loadSchedule({ planId });
  if (!r.ready || !r.plans.length) return null;
  return { plan: r.plans[0], shoots: r.shoots };
}

/** photo_changes, newest first. o: {planId, mine (a profile id), open (new and taken only), days (30; 0 = no limit), now}. */
export async function changes(o) {
  const opt = o || {};
  const now = opt.now instanceof Date ? opt.now : new Date();
  const days = opt.days === 0 ? 0 : Math.max(1, Math.min(400, Number(opt.days) || DAYS));
  try {
    const rows = await read(() => pageAll((c) => {
      let q = c.from("photo_changes").select(CHANGE_COLS);
      if (opt.planId !== undefined && opt.planId !== null) q = q.eq("plan_id", idOf(opt.planId));
      if (opt.mine) q = q.eq("requested_by", String(opt.mine));
      if (opt.open) q = q.in("status", ["new", "taken"]);
      if (days) q = q.gte("requested_at", new Date(now.getTime() - days * 86400000).toISOString());
      return q.order("requested_at", { ascending: false }).order("id", { ascending: false });
    }));
    const list = rows.map((r) => toChange(r, now));
    return opt.open ? list.filter((c) => c.state === "new" || c.state === "taken") : list;
  } catch (e) {
    if (e.missing) return [];
    throw e;
  }
}

/** The mirrored shoot of a My Tasks task (photo_shoots.task_id: the heads-up's task, DCR Agents 2's sp_task_id; no foreign
    key - a stale id finds nothing): {id, planId} | null. Nothing on a database without the photo schedule, or for
    someone who does not read it (row level security). */
export async function shootForTask(taskId) {
  const id = Number(taskId);
  if (!Number.isInteger(id) || id < 1) return null;
  try {
    const rows = await read(async () => must(await (await db()).from("photo_shoots").select("id, plan_id").eq("task_id", id)
      .order("id", { ascending: false }).range(0, 0)));
    const r = Array.isArray(rows) ? rows[0] : null;
    return r ? { id: Number(r.id), planId: Number(r.plan_id) } : null;
  } catch (e) {
    if (e.missing) return null;
    throw e;
  }
}

export function myChanges(uid, o) { return changes(Object.assign({}, o || {}, { mine: uid })); }
export function planChanges(planId, o) { return changes(Object.assign({}, o || {}, { planId })); }

/** The photo team with each person's name, by name (admins and the team read it; anyone else their own row at most). */
export async function team() {
  try {
    const rows = await read(() => pageAll((c) => c.from("photo_team").select(TEAM_SELECT).order("profile_id", { ascending: true })));
    return rows.map(toTeamMember).sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0));
  } catch (e) {
    if (e.missing) return [];
    throw e;
  }
}

/* ── the client key: stable per device and per attempt ────────────────── */

const DEVICE_KEY = "dcr2-photo-device";
const ATTEMPTS_KEY = "dcr2-photo-attempts";
const ATTEMPT_HOURS = 24;            // an attempt nobody settled is forgotten after a day (its base rev is old by then)
const ATTEMPTS_MAX = 30;
const memory = new Map();
let keyStore = null;

/** Tests (and a page in a blocked-storage window) hand a store {getItem, setItem}; null: localStorage, else memory. */
export function useKeyStore(s) { keyStore = s || null; memory.clear(); }

function store() {
  if (keyStore) return keyStore;
  try { if (typeof localStorage !== "undefined" && localStorage) return localStorage; } catch (e) { /* blocked */ }
  return null;
}
function getJson(k) {
  let v = null;
  try { const s = store(); v = s ? s.getItem(k) : null; } catch (e) { v = null; }
  if (v === null || v === undefined) v = memory.has(k) ? memory.get(k) : null;
  try { return v ? JSON.parse(v) : null; } catch (e) { return null; }
}
function putJson(k, value) {
  const t = JSON.stringify(value);
  memory.set(k, t);
  try { const s = store(); if (s) s.setItem(k, t); } catch (e) { /* the memory copy lasts as long as the page */ }
}
function rand(n) {
  const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
  const c = typeof globalThis !== "undefined" && globalThis.crypto;
  let out = "";
  if (c && typeof c.getRandomValues === "function") {
    const b = new Uint8Array(n);
    c.getRandomValues(b);
    for (let i = 0; i < n; i++) out += abc[b[i] % abc.length];
    return out;
  }
  for (let i = 0; i < n; i++) out += abc[Math.floor(Math.random() * abc.length)];
  return out;
}

/** This device's own id (12 letters and digits, kept in localStorage). */
export function deviceId() {
  const v = getJson(DEVICE_KEY);
  if (typeof v === "string" && /^[a-z0-9]{12}$/.test(v)) return v;
  const id = rand(12);
  putJson(DEVICE_KEY, id);
  return id;
}

function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") return Object.keys(v).sort().reduce((o, k) => { if (v[k] !== undefined) o[k] = canon(v[k]); return o; }, {});
  return v;
}

/** What makes two attempts the same change: the plan, the kind, the arguments and the rev the page read. */
export function fingerprint(planId, kind, args, baseRev) {
  return JSON.stringify([String(idOf(planId)), String(kind || ""), canon(args || {}), baseRev === null || baseRev === undefined ? null : Number(baseRev)]);
}

function attempts(now) {
  const list = getJson(ATTEMPTS_KEY);
  const t = now || Date.now();
  return (Array.isArray(list) ? list : []).filter((a) => a && typeof a.fp === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(String(a.key || "")) &&
    Number(a.at) > t - ATTEMPT_HOURS * 3600000);
}

/** The client key of an attempt: the key of the same change still unsettled on this device (a retry), else a new one.
    "p2" + the device id + "-" + 10 random letters and digits (^[A-Za-z0-9_-]{8,64}$, the database's rule). */
export function attemptKey(planId, kind, args, baseRev) {
  const fp = fingerprint(planId, kind, args, baseRev);
  const list = attempts();
  const hit = list.find((a) => a.fp === fp);
  if (hit) return hit.key;
  const key = "p2" + deviceId() + "-" + rand(10);
  list.push({ fp, key, at: Date.now() });
  putJson(ATTEMPTS_KEY, list.slice(-ATTEMPTS_MAX));
  return key;
}

/** The attempt has its answer (or a definite refusal): the next press is a new attempt with a new key. */
export function settleAttempt(planId, kind, args, baseRev) {
  const fp = fingerprint(planId, kind, args, baseRev);
  putJson(ATTEMPTS_KEY, attempts().filter((a) => a.fp !== fp));
}

/** The attempts still waiting for an answer on this device (the page may offer "Send again"). */
export function openAttempts() { return attempts().map((a) => ({ key: a.key, at: a.at })); }

/* ── writes ───────────────────────────────────────────────────────────── */

/** What a change would do - the database's own preview (§6.3): {plan_id, rev, today, kind, args (resolved), moved,
    stays, passed, replan, needs_office, refused (in-band), done?}. 42501 for anyone who may not change the schedule. */
export async function preview(planId, kind, args) {
  return one(await call(RPC.preview, { p_plan: idOf(planId), p_kind: String(kind || ""), p_args: args && typeof args === "object" ? args : {} }));
}

function toAnswer(r, key) {
  const x = r || {};
  const c = { status: String(x.status || ""), requestedAt: x.requested_at || null };
  return { id: x.id === undefined || x.id === null ? null : Number(x.id), status: c.status, state: changeState(c), requestedAt: c.requestedAt,
    again: x.again === true, needsOffice: x.needs_office === true, preview: x.preview || null, result: x.result || null, error: x.error || null, key };
}

/** Ask the DCR server for a change, as the page read the plan (baseRev = the plan's rev). The client key is this device's
    key of this attempt (o.key to give one): a retry after a dropped connection is the same request (again: true), a
    definite answer settles the attempt. -> {id, status, state, requestedAt, again, needsOffice, preview, result, error, key} */
export async function request(planId, kind, args, baseRev, o) {
  const opt = o || {};
  const a = args && typeof args === "object" ? args : {};
  const key = opt.key ? String(opt.key) : attemptKey(planId, kind, a, baseRev);
  try {
    const r = one(await call(RPC.request, { p_plan: idOf(planId), p_kind: String(kind || ""), p_args: a,
      p_base_rev: baseRev === null || baseRev === undefined ? null : Number(baseRev), p_client_key: key }));
    if (!opt.key) settleAttempt(planId, kind, a, baseRev);
    return toAnswer(r, key);
  } catch (e) {
    const err = photoError(e);
    if (!err.retryable && !opt.key) settleAttempt(planId, kind, a, baseRev);
    err.key = key;
    throw err;
  }
}

/** Cancel a change while it is new: {ok, status} ({ok: false, status} once taken or finished). */
export async function cancel(id) {
  const r = one(await call(RPC.cancel, { p_id: idOf(id) })) || {};
  return { ok: r.ok === true, status: String(r.status || "") };
}

/** One person's whole photo team row, at the version the page read (null: they have no row yet). next: {photographer,
    marketing, isDefault, googleEmail}. Both ticks off removes the row. A PT409 "changed" is thrown as it is (the page
    reads the list again; it never sends again at a newer version by itself). */
export async function setTeam(profileId, next, version) {
  const n = next || {};
  const r = one(await call(RPC.setTeam, {
    p_profile: profileId ? String(profileId) : null, p_photographer: !!n.photographer, p_marketing: !!n.marketing, p_default: !!n.isDefault,
    p_google_email: n.googleEmail === undefined || n.googleEmail === null || String(n.googleEmail) === "" ? null : String(n.googleEmail),
    p_version: version === undefined || version === null ? null : Number(version),
  })) || {};
  return { profileId: r.profile_id || null, photographer: r.photographer === true, marketing: r.marketing === true,
    defaultPhotographer: r.default_photographer === true, googleEmail: r.google_email || null,
    version: r.version === undefined || r.version === null ? null : Number(r.version), removed: r.removed === true,
    defaultProfileId: r.default_profile_id || null };
}

/* ── Realtime ─────────────────────────────────────────────────────────── */

/** Watch the four tables (o.tables to name fewer); onRead({tables, join}) runs after every join and after changes,
    coalesced (o.wait ms, 300) and never two at a time. o.onLost(evt) hears a channel going (the page may poll then);
    o.live: a stand-in for live.js (tests). -> stop() */
export async function watchSchedule(onRead, o) {
  const opt = o || {};
  const live = opt.live || (await import("../live.js"));
  const wait = Number.isFinite(Number(opt.wait)) ? Number(opt.wait) : 300;
  const tables = Array.isArray(opt.tables) && opt.tables.length ? opt.tables.filter((t) => TABLES.indexOf(t) !== -1) : TABLES.slice();
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
  const offs = tables.map((t) => live.watch(t, "", (evt) => {
    if (stopped || !evt) return;
    if (evt.type === "LOST") { if (typeof opt.onLost === "function") { try { opt.onLost(evt); } catch (e) { /* */ } } return; }
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
