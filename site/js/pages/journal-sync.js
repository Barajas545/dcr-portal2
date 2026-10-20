/* The journal drafts of this device and their entries (BLUEPRINT 3.3.3 "Offline order", 2.1
   principle 7; Q4: field people write their own entries).

   A draft lives in localStorage dcr2JrnDraft:<profile>:<project> (Appendix C):
     date, cat, wx, crew, hrs, title, body, follow   the form, as typed
     media       [{qid, name, desc, video, landed}]   photos picked in the form, still on their way
     id, version the entry row, once it exists
     base        the row's columns as this device last saved or read them: "what I changed" is every
                 column where the form differs from base
     localKey    photos picked before the row existed wait in the upload queue under this key
                 (pendingEntry) and are released by bindEntry(localKey, id); bound = done
     finishing   "Finish this entry" was pressed: the draft closes as soon as the row is saved
     conflicts   {field: what this person had} — a field someone else changed meanwhile ("Use mine")
     captionsOnly  a closed draft that only keeps captions of photos still on their way

   sync(profile, project, {current}) — one at a time per device (Web Lock "dcr2-journal-drafts":
   the Journal tab, a second tab and the home page's sweep never create the same entry twice):
     * no row yet and worth keeping (text, or photos waiting for it): the row is created and its
       photos released;
     * a row: ONLY the columns this device changed are sent, with the version. On PT409 (or a newer
       row handed in as `current`) the other person's changes are taken: a field only they changed
       is adopted into the draft, a field both changed keeps THEIRS and is reported as a conflict,
       and what is left is sent again — never the whole draft over someone else's correction;
     * finishing and saved: the draft is closed.
   It never throws: {state: "saved" | "empty" | "none" | "offline" | "error" | "refused", id, version,
   adopted: {field: value}, conflicts: {field: mine}, closed, created, error}.

   sweep(profile) — sync every draft of this person on this device that needs it. The home page,
   Site Photos and the project page run it (on load, when the connection comes back, when the app
   comes to the front), so an entry written with no signal is created — and its photos go up — even
   when the app was killed and reopened on another page. */

import * as journalRepo from "../repo/journal.js";
import { fromDraft, worthKeeping } from "../map/journal.js";
import * as uploads from "./uploads.js";

export const PREFIX = "dcr2JrnDraft:";
export const LOCK = "dcr2-journal-drafts";
export const COLS = ["entry_date", "category", "title", "body", "weather", "crew_size", "hours", "follow_up"];
export const FIELD = { entry_date: "date", category: "cat", title: "title", body: "body", weather: "wx",
  crew_size: "crew", hours: "hrs", follow_up: "follow" };
const NUMERIC = { crew_size: true, hours: true };

export function draftKey(profileId, projectId) { return PREFIX + (profileId || "anon") + ":" + projectId; }
export function newLocalKey(projectId) {
  return "jrn:" + projectId + ":" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** One column's value as compared: "" for nothing, numbers as numbers, booleans as "1" / "". */
export function norm(col, v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "1" : "";
  if (NUMERIC[col]) {
    if (String(v).trim() === "") return "";
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : String(v);
  }
  return String(v);
}

/** The journal columns of a database row (or of a toEntry() entry from the list). */
export function colsOfRow(r) {
  r = r || {};
  if ("journalEntry" in r || "journalDate" in r) {
    return { entry_date: r.journalDate || null, category: r.category || "progress", title: r.title || "",
      body: r.journalEntry || null, weather: r.journalWeather || null, crew_size: r.journalCrewSize == null ? null : r.journalCrewSize,
      hours: r.journalHours == null ? null : r.journalHours, follow_up: !!r.journalFollowUp };
  }
  const out = {};
  COLS.forEach(function (c) { out[c] = r[c] === undefined ? null : r[c]; });
  return out;
}

/** Columns -> the form's fields. */
export function fieldsOfCols(c) {
  c = c || {};
  return {
    date: c.entry_date || "", cat: c.category || "progress", title: c.title || "", body: c.body || "",
    wx: c.weather || "", crew: c.crew_size == null ? "" : String(c.crew_size),
    hrs: c.hours == null ? "" : String(Number(c.hours)), follow: !!c.follow_up,
  };
}

/** A draft for an existing entry (✎ Edit): the form filled from the row, base = the row. */
export function draftOfEntry(entryOrRow) {
  const cols = colsOfRow(entryOrRow);
  return Object.assign(fieldsOfCols(cols), { id: entryOrRow.id, version: Number(entryOrRow.version || 1), base: cols, media: [] });
}

export function mediaCount(d) {
  return ((d && d.media) || []).filter(function (m) { return m && !m.landed; }).length;
}

/** The columns this device changed: the form (fromDraft) against base. */
export function changes(d) {
  if (!d || !d.id || !d.base) return {};          // no base: nothing known to be changed here
  const mine = fromDraft(d);
  const base = d.base || {};
  const out = {};
  COLS.forEach(function (c) {
    if (!(c in mine)) return;
    if (norm(c, mine[c]) !== norm(c, base[c])) out[c] = mine[c];
  });
  return out;
}

/** Does this draft have anything to do on the server? */
export function needsSync(d) {
  if (!d || d.captionsOnly) return false;
  if (!d.id) return worthKeeping(d, mediaCount(d));
  return !!(d.finishing || (d.localKey && !d.bound) || Object.keys(changes(d)).length);
}

/** Someone else's row (`cur`, columns) against what this device knew (base): the fields they
    changed are adopted; a field this device also changed (want) keeps theirs and is a conflict. */
export function mergeTheirs(d, cur, want) {
  const base = d.base || {};
  const adopted = {}, conflicts = {};
  const theirsF = fieldsOfCols(cur);
  COLS.forEach(function (c) {
    if (norm(c, cur[c]) === norm(c, base[c])) return;            // they did not change it
    const f = FIELD[c];
    if (c in want) {
      if (norm(c, want[c]) !== norm(c, cur[c])) conflicts[f] = d[f];
      delete want[c];
    }
    adopted[f] = theirsF[f];
  });
  return { adopted, conflicts };
}

/** The fields of the stored draft `now` that `adopted` may overwrite: the ones nobody typed in since
    the sync read `seen`. */
function adoptInto(now, seen, adopted) {
  Object.keys(adopted).forEach(function (f) {
    if (String(now[f] == null ? "" : now[f]) === String(seen[f] == null ? "" : seen[f])) now[f] = adopted[f];
  });
}

/** A finished draft closes: only captions of photos still on their way stay (applied when they land),
    its own and those an earlier closed draft handed on (carried). */
export function closedDraft(d) {
  const own = ((d && d.media) || []).filter(function (x) { return x && x.desc && !x.landed; });
  const left = own.concat(((d && d.carried) || []).filter(function (x) { return x && x.desc; }));
  return left.length ? { captionsOnly: true, media: left.map(function (x) { return { qid: x.qid, name: x.name, desc: x.desc }; }) } : null;
}

function offline() { return typeof navigator !== "undefined" && navigator.onLine === false; }

function isNetwork(e) {
  if (!e) return false;
  if (e.status === 0 || e.code === "NETWORK" || e.code === "NO_LIBRARY") return true;
  return /fetch|network|Load failed|NetworkError|offline/i.test(String(e.message || ""));
}

/** The engine, with what it needs handed in (the node tests give their own). */
export function createSync(parts) {
  const d0 = Object.assign({
    repo: journalRepo,
    bindEntry: uploads.bindEntry,
    storage: browserStorage(),
    lock: browserLock,
    online: function () { return !offline(); },
  }, parts || {});

  function read(profileId, projectId) {
    try { return JSON.parse(d0.storage.get(draftKey(profileId, projectId)) || "null") || null; } catch (e) { return null; }
  }
  function write(profileId, projectId, d) {
    d0.storage.set(draftKey(profileId, projectId), d ? JSON.stringify(d) : null);
  }

  async function syncNow(profileId, projectId, opts) {
    const o = opts || {};
    let d = read(profileId, projectId);
    if (!d || d.captionsOnly) return { state: "none" };
    const seen = Object.assign({}, d);
    // a row created elsewhere meanwhile (another tab) was written back before we got the lock
    if (!d.id) {
      if (!worthKeeping(d, mediaCount(d))) return { state: "empty" };
      if (!d0.online()) return { state: "offline" };
      let row;
      try {
        row = await d0.repo.createRow(projectId, fromDraft(d));
      } catch (e) {
        return failed(e);
      }
      const now = read(profileId, projectId) || d;
      now.id = row.id; now.version = Number(row.version || 1); now.base = colsOfRow(row);
      delete now.refused;
      write(profileId, projectId, now);
      await release(profileId, projectId, now);
      return finishIfDone(profileId, projectId, { state: "saved", created: true, id: row.id, version: now.version, adopted: {}, conflicts: {} });
    }

    const want = changes(d);
    let adopted = {}, conflicts = {};
    let version = Number(d.version || 1);
    // a newer row seen by the page (the list, a live change): take what others changed first
    if (o.current && Number(o.current.version || 0) > version) {
      const cur = colsOfRow(o.current);
      const m = mergeTheirs(d, cur, want);
      adopted = m.adopted; conflicts = m.conflicts;
      d.base = cur; version = Number(o.current.version);
    }
    await release(profileId, projectId, d);
    let row = null;
    if (Object.keys(want).length) {
      if (!d0.online()) return { state: "offline", id: d.id };
      for (let attempt = 0; attempt < 4 && Object.keys(want).length; attempt++) {
        try {
          row = await d0.repo.patchRow(d.id, version, Object.assign({}, want));
          break;
        } catch (e) {
          if (e && e.code === "PT409" && e.current) {
            const cur = colsOfRow(e.current);
            const m = mergeTheirs(d, cur, want);
            Object.assign(adopted, m.adopted); Object.assign(conflicts, m.conflicts);
            d.base = cur; version = Number(e.current.version);
            row = e.current;
            continue;
          }
          if (e && e.code === "PT404") {
            // the entry was deleted elsewhere: the text is kept here and becomes a new entry
            const now = read(profileId, projectId) || d;
            delete now.id; delete now.version; delete now.base; delete now.bound;
            write(profileId, projectId, now);
            return { state: "gone" };
          }
          return failed(e);
        }
      }
    } else if (d.base && (Object.keys(adopted).length || Object.keys(conflicts).length)) {
      row = Object.assign({ id: d.id, version: version }, d.base);
    }
    const now = read(profileId, projectId) || d;
    if (row) {
      now.version = Number(row.version || version);
      now.base = colsOfRow(row);
    } else if (version !== Number(d.version || 1)) {
      now.version = version; now.base = d.base;
    }
    adoptInto(now, seen, adopted);
    if (Object.keys(conflicts).length) now.conflicts = Object.assign({}, now.conflicts || {}, conflicts);
    delete now.refused;
    write(profileId, projectId, now);
    return finishIfDone(profileId, projectId, { state: "saved", id: now.id, version: now.version, adopted, conflicts });
  }

  async function release(profileId, projectId, d) {
    if (!d.id || !d.localKey || d.bound) return;
    try { await d0.bindEntry(d.localKey, d.id); } catch (e) { return; }
    const now = read(profileId, projectId) || d;
    if (String(now.id) === String(d.id)) { now.bound = true; write(profileId, projectId, now); }
  }

  function finishIfDone(profileId, projectId, res) {
    const now = read(profileId, projectId);
    // never while photos still wait under its local key: closing would strand them
    if (now && now.finishing && now.id && !(now.localKey && !now.bound) && !Object.keys(changes(now)).length) {
      write(profileId, projectId, closedDraft(now));
      res.closed = true;
    }
    return res;
  }

  function failed(e) {
    const refused = !!e && (e.code === "42501" || e.status === 403);
    return { state: refused ? "refused" : isNetwork(e) || !d0.online() ? "offline" : "error", error: e };
  }

  function sync(profileId, projectId, opts) {
    return d0.lock(function () { return syncNow(profileId, projectId, opts); }).then(function (r) {
      return r || { state: "none" };
    }, function (e) { return { state: "error", error: e }; });
  }

  /** Every draft of this person on this device that has work to do (but `skip`: the project whose
      Journal tab is open does its own). -> [{project, result}] */
  async function sweep(profileId, skip) {
    if (!profileId) return [];
    const out = [];
    const keys = d0.storage.keys().filter(function (k) { return k.indexOf(PREFIX + profileId + ":") === 0; });
    for (const k of keys) {
      const projectId = k.slice((PREFIX + profileId + ":").length);
      if (!/^\d{1,18}$/.test(projectId) || (skip != null && String(skip) === projectId)) continue;
      const d = read(profileId, projectId);
      if (!needsSync(d) || (d && d.refused)) continue;
      const r = await sync(profileId, projectId);
      if (r.state === "refused") {
        const now = read(profileId, projectId);
        if (now) { now.refused = true; write(profileId, projectId, now); }
      }
      out.push({ project: projectId, result: r });
    }
    return out;
  }

  return { read, write, sync, sweep };
}

/* ── the browser's storage and lock ─────────────────────────────────── */

function browserStorage() {
  return {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, String(v)); } catch (e) { /* page-only */ } },
    keys: function () {
      const out = [];
      try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k) out.push(k); } } catch (e) { /* none */ }
      return out;
    },
  };
}

let chain = Promise.resolve();
function browserLock(fn) {
  if (typeof navigator !== "undefined" && navigator.locks && typeof navigator.locks.request === "function") {
    return navigator.locks.request(LOCK, fn);
  }
  const run = chain.then(fn, fn);
  chain = run.then(function () {}, function () {});
  return run;
}

let engine = null;
function shared() { return engine || (engine = createSync()); }

export function read(profileId, projectId) { return shared().read(profileId, projectId); }
export function write(profileId, projectId, d) { return shared().write(profileId, projectId, d); }
export function sync(profileId, projectId, opts) { return shared().sync(profileId, projectId, opts); }
export function sweep(profileId, skip) { return shared().sweep(profileId, skip); }

/** The pages without a Journal tab open (the project page: every OTHER project): sweep now, when the
    connection comes back and when the app comes to the front again. */
export function startSweeper(me, opts) {
  if (!me || !me.id || typeof window === "undefined") return;
  const skip = opts && opts.skip != null ? String(opts.skip) : null;
  let busy = false;
  const go = function () {
    if (busy) return;
    busy = true;
    sweep(String(me.id), skip).then(function () { busy = false; }, function () { busy = false; });
  };
  go();
  window.addEventListener("online", go);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) go(); });
}
