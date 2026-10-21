/* Realtime for Portal 2: database changes and presence (BLUEPRINT 2.2.3 "Realtime").

   - Private channels only ({config: {private: true}}), topics "dcr-<table>-<n>" for changes and
     "presence:dcr" for presence: the topics the realtime.messages policies of DCR Desktop 2 allow.
   - After EVERY "SUBSCRIBED" (the first join and each re-join) the callback gets {type:
     "SUBSCRIBED"} and the page reads again: changes made before a join are never delivered.
   - A soft delete reaches people as an INSERT on "deletions" {table_name, row_id, project_id}
     (the UPDATE that hid the row is not delivered to people who may not see deleted rows), so
     watch() of a soft-delete table also listens there and hands it on as a DELETE.
   - A channel that fails (refused, timed out, closed) is dropped and subscribed again on a fresh
     topic, with back-off. A page that paces its own reads by whether the channel is live passes
     {lost: true} and hears {type: "LOST", table, status} each time it goes (then SUBSCRIBED again
     when it is back), so it never keeps a slow "Realtime is live" pace on a dead channel.
   - Presence uses DCR Desktop 2's payload {user_id, name, color, view, editing, project, since}
     so office and web users see each other. Phones track presence only while a project page is
     open (the pages decide when to call presence()).                                           */

import { sb, me } from "./sb.js";

export const PRESENCE_TOPIC = "presence:dcr";
export const SOFT_DELETE_TABLES = new Set(["contacts", "projects", "estimates", "estimate_items", "bills",
  "invoices", "journal_entries", "files", "email_templates", "item_library", "mail_notes"]);
/* Tables whose tombstones in "deletions" are handed on as a DELETE: the soft-delete tables, and tasks —
   a task handed AWAY from a field or view-only person leaves a "no longer yours" tombstone that only
   they read (migration M1, deletions.for_user): Realtime never sends them the UPDATE that took it away. */
export const TOMBSTONE_TABLES = new Set(Array.from(SOFT_DELETE_TABLES).concat(["tasks"]));

let topicN = 0;

/* Realtime's own filter takes one condition ("col=op.value"); the rest is checked here. */
export function parseFilter(f) {
  if (!f) return [];
  return String(f).split(",").map((part) => {
    const m = /^([a-z_][a-z0-9_]*)=(not\.)?(eq|neq|lt|lte|gt|gte|in|is)\.(.*)$/i.exec(part.trim());
    return m ? { col: m[1], neg: !!m[2], op: m[3].toLowerCase(), val: m[4] } : null;
  }).filter(Boolean);
}

export function matchFilter(row, f) {
  for (const c of parseFilter(f)) {
    const v = row ? row[c.col] : undefined;
    const sv = v === null || v === undefined ? "null" : String(v);
    let ok;
    if (c.op === "eq") ok = sv === c.val;
    else if (c.op === "neq") ok = sv !== c.val;
    else if (c.op === "in") ok = c.val.replace(/^\(|\)$/g, "").split(",").map((x) => x.trim()).indexOf(sv) !== -1;
    else if (c.op === "is") ok = sv === c.val;
    else {
      const a = Number(sv), b = Number(c.val);
      const [x, y] = Number.isFinite(a) && Number.isFinite(b) ? [a, b] : [sv, c.val];
      ok = c.op === "lt" ? x < y : c.op === "lte" ? x <= y : c.op === "gt" ? x > y : x >= y;
    }
    if (ok === c.neg) return false;
  }
  return true;
}

function serverFilter(f) {
  const first = parseFilter(f).find((c) => !c.neg && ["eq", "neq", "lt", "lte", "gt", "gte", "in"].includes(c.op));
  return first ? first.col + "=" + first.op + "." + first.val : null;
}

/** watch("projects", "status=eq.in_progress", cb, opts) -> unsubscribe.
    cb({type: "SUBSCRIBED"}) after every join (read again then);
    cb({type: "INSERT"|"UPDATE"|"DELETE", table, new, old}) for each change the person may see;
    with opts.lost, cb({type: "LOST", table, status}) whenever the channel stops being live (refused,
    timed out, closed) - the page goes back to its own pace until the next SUBSCRIBED. */
export function watch(table, filter, cb, opts) {
  const tellLost = !!(opts && opts.lost);
  let stopped = false;
  let ch = null;
  let tries = 0;
  let timer = null;
  const server = serverFilter(filter);

  function deliver(evt) {
    if (stopped) return;
    try { cb(evt); } catch (e) { /* a page's handler never breaks the channel */ }
  }

  function drop() {
    const old = ch;
    ch = null;
    if (old) { try { sb().removeChannel(old); } catch (e) { /* */ } }
  }

  function retry() {
    if (stopped || timer) return;
    drop();
    const wait = Math.min(30000, 1000 * Math.pow(2, tries++));
    timer = setTimeout(() => { timer = null; subscribe(); }, wait);
  }

  function subscribe() {
    if (stopped) return;
    topicN += 1;
    const mine = sb().channel("dcr-" + table + "-" + topicN, { config: { private: true } });
    ch = mine;
    const binding = { event: "*", schema: "public", table };
    if (server) binding.filter = server;
    mine.on("postgres_changes", binding, (p) => {
      const row = p.eventType === "DELETE" ? p.old : p.new;
      if (filter && !matchFilter(row, filter) && !(p.eventType === "UPDATE" && matchFilter(p.old, filter))) return;
      deliver({ type: p.eventType, table, new: p.new || null, old: p.old || null });
    });
    if (TOMBSTONE_TABLES.has(table)) {
      mine.on("postgres_changes", { event: "INSERT", schema: "public", table: "deletions", filter: "table_name=eq." + table }, (p) => {
        const t = p.new || {};
        const gone = { id: t.row_id, project_id: t.project_id };
        const checkable = parseFilter(filter).every((c) => c.col === "id" || c.col === "project_id");
        if (filter && checkable && !matchFilter(gone, filter)) return;
        deliver({ type: "DELETE", table, new: null, old: gone, soft: true, forMe: !!t.for_user });
      });
    }
    mine.subscribe((status) => {
      if (ch !== mine || stopped) return;
      if (status === "SUBSCRIBED") { tries = 0; deliver({ type: "SUBSCRIBED", table }); }
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        if (tellLost) deliver({ type: "LOST", table, status });
        retry();
      }
    });
  }

  try { subscribe(); } catch (e) { if (tellLost) deliver({ type: "LOST", table, status: "ERROR" }); retry(); }
  return function unsubscribe() {
    stopped = true;
    clearTimeout(timer);
    drop();
  };
}

/* ── presence ──────────────────────────────────────────────────────────── */

/** Realtime presence state {key: [meta, …]} -> {user_id: state}: per person the most recent meta,
    plus sessions (how many devices), views and projects (what each has open) — Desktop 2's
    merge_presence. */
export function mergePresence(raw) {
  const out = {};
  for (const [key, metasIn] of Object.entries(raw || {})) {
    const metas = (metasIn || []).filter((m) => m && typeof m === "object");
    if (!metas.length) continue;
    const clean = metas.map((m) => {
      const c = Object.assign({}, m);
      delete c.presence_ref; delete c.phx_ref; delete c.phx_ref_prev;
      return c;
    });
    const best = clean.reduce((a, b) => (String(b.since || "") > String(a.since || "") ? b : a));
    const uid = String(best.user_id || key);
    const state = Object.assign({}, best);
    state.sessions = clean.length;
    state.views = clean.map((m) => m.view).filter(Boolean);
    state.projects = Array.from(new Set(clean.map((m) => m.project).filter((p) => p !== null && p !== undefined && p !== "").map(String))).sort();
    state.editing = clean.some((m) => !!m.editing && m.view === best.view);
    out[uid] = state;
  }
  return out;
}

let pch = null;           // the presence channel
let pjoined = false;
let pstate = {};
let tracked = null;       // what this device tracks now (JSON)
let desired = null;       // {view, editing, project}
let since = new Date().toISOString();
let who = null;           // {id, name, color}
let ptries = 0;
let ptimer = null;
const listeners = new Set();

function emitPresence() {
  for (const cb of Array.from(listeners)) {
    try { cb(pstate); } catch (e) { /* */ }
  }
}

function payload() {
  if (!who || !desired) return null;
  return {
    user_id: String(who.id), name: who.name || who.email || "", color: who.color || "",
    view: desired.view, editing: !!desired.editing, project: desired.project, since,
    app: "portal2",               // extra key: Desktop 2 keeps it as it is; our top bar names the app
  };
}

async function retrack() {
  if (!pch || !pjoined) return;
  const want = payload();
  const key = want ? JSON.stringify(want) : null;
  if (key === tracked) return;
  try {
    if (!want) await pch.untrack();
    else await pch.track(want);
    tracked = key;
  } catch (e) { /* tried again on the next join */ }
}

async function ensureChannel() {
  if (pch) return;
  let p = null;
  try { p = await me(); } catch (e) { p = null; }
  if (!p || pch) return;
  who = { id: p.id, name: p.name, email: p.email, color: p.color };
  const mine = sb().channel(PRESENCE_TOPIC, { config: { private: true, presence: { key: String(p.id) } } });
  pch = mine;
  pjoined = false;
  tracked = null;
  mine.on("presence", { event: "sync" }, () => {
    if (pch !== mine) return;
    try { pstate = mergePresence(mine.presenceState()); } catch (e) { pstate = {}; }
    emitPresence();
  });
  mine.subscribe((status) => {
    if (pch !== mine) return;
    if (status === "SUBSCRIBED") {
      pjoined = true;
      ptries = 0;
      tracked = null;              // a re-join has forgotten this device: track again
      retrack();
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      pjoined = false;
      pch = null;
      try { sb().removeChannel(mine); } catch (e) { /* */ }
      if ((listeners.size || desired) && !ptimer) {
        ptimer = setTimeout(() => { ptimer = null; ensureChannel(); }, Math.min(30000, 1000 * Math.pow(2, ptries++)));
      }
    }
  });
}

/** Tell the others what this device shows: presence("web:project", {project: 12, editing}).
    presence(null) stops tracking (this device is no longer shown). */
export function presence(view, opts) {
  const o = opts || {};
  const next = view ? { view: String(view), editing: !!o.editing, project: o.project === null || o.project === undefined || o.project === "" ? null : String(o.project) } : null;
  if (next && (!desired || desired.view !== next.view || desired.project !== next.project)) since = new Date().toISOString();
  desired = next;
  if (typeof window !== "undefined" && window.DCR2) window.DCR2.presenceProject = next ? next.project : null;
  ensureChannel().then(retrack);
  return () => presence(null);
}

/** onPresence(states => …) -> unsubscribe. states: {user_id: merged state}, everyone online. */
export function onPresence(cb) {
  listeners.add(cb);
  ensureChannel();
  try { cb(pstate); } catch (e) { /* */ }
  return () => listeners.delete(cb);
}

/** The merged presence state seen last. */
export function presenceState() {
  return pstate;
}
