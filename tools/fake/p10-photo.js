/* DCR Portal 2 — DEMO MODE ONLY: the shoot schedule (the photographer screen program, P3; DCR Desktop 2 migration
   20261110000100_photo_schedule, docs/DATABASE.md §39; the contract is DCR Desktop 2's docs/PHOTO-SCHEDULE.md) in the
   in-memory database, read and written by site/js/repo/photo.js. Loaded BEFORE engine.js (its tables are read when the
   engine loads: tools/devserve.mjs FAKE_PARTS, tests/pages-engine.mjs); installed into each engine (NS.extInstall); its
   made-up rows join the seed (NS.extSeed). Never published (tools/ is not part of the site).

   The same names, rules, SQLSTATEs, hints and sentences as the migration:
   * public.photo_team (the photo team: admins and the team read it, each person their own row; written ONLY through
     set_photo_team - the one default photographer, the Google e-mail tidied, PT409 changed at a moved version);
   * public.photo_plans / public.photo_shoots (the mirror: admins and the photo team read it; nobody writes it but the
     agents account through agents_photo_mirror*, and the demo's own DCR server below);
   * public.photo_changes (the queue: the requester and the schedule's editors read it; the agents account the new and
     taken ones; photo_change_request with the contract's checks in order, idempotent per person and client key;
     photo_change_cancel; a new change older than 7 days reads as expired);
   * photo_my_access, photo_pc_status, photo_change_preview - THE SHIFT RULE ported from app.photo_shift (NS.p10PhotoShift;
     tests/p10-photo-repo.test.mjs holds it to the shared case file photo_shift_cases.json, and
     tools/schema-check-p10-photo.mjs holds the demo's previews to the real function's over the same plan);
   * DCR Agents 2's RPCs for the agents account (the team, the mirror and its drop / sync / adopt, the feed, take, done,
     error, purge), 42501 for everyone else.
   The demo's DCR server (pc below; in the browser it runs by itself a moment after each request, unless the demo's PC is
   switched off): it takes the oldest change (new -> taken), checks it against the mirror as DCR Agents 2 would (gone,
   not_active, forbidden, changed, not_open, past), applies it (the moves pinned with a history entry, a Firm job date
   moved by a non-admin answered "suggested", passed shoots skipped by the schedule), mirrors the plan again with a new
   rev and answers (taken -> applied | refused). Its dev hook: engine.exts.find((x) => x.name === "p10-photo").__dev.
   Made-up people (the seed's demo accounts), jobs (A000T6..A000T9) and shoots only; no amount anywhere. */
(function (root) {
  "use strict";
  const NS = (root.DCR2Fake = root.DCR2Fake || {});

  const MS = ["framing_start", "delivery", "framing_complete", "house_complete"];
  const MS_LABEL = { framing_start: "Framing start", delivery: "Delivery", framing_complete: "Framing complete", house_complete: "House complete" };
  const KINDS = ["move_one", "move_later", "milestone", "done", "undo"];
  const OPEN = ["planned", "announced"];
  const HOST = "DCR-OFFICE-PC#agents2";
  const LEDGER = "d10a0000-0000-4000-8000-0000000000a1";

  // every argument of the migration's RPCs, by name and in order (tools/schema-check-p10-photo.mjs compares them)
  const SIGS = {
    set_photo_team: ["p_profile", "p_photographer", "p_marketing", "p_default", "p_google_email", "p_version"],
    photo_my_access: [],
    photo_pc_status: [],
    photo_change_preview: ["p_plan", "p_kind", "p_args"],
    photo_change_request: ["p_plan", "p_kind", "p_args", "p_base_rev", "p_client_key"],
    photo_change_cancel: ["p_id"],
    agents_photo_team: [],
    agents_photo_mirror: ["p_host", "p_ledger", "p_plan", "p_shoots", "p_rev"],
    agents_photo_mirror_drop: ["p_host", "p_ledger", "p_local_id"],
    agents_photo_mirror_sync: ["p_host", "p_ledger", "p_keep"],
    agents_photo_adopt: ["p_host", "p_ledger"],
    agents_photo_changes_feed: ["p_ledger"],
    agents_photo_change_take: ["p_id", "p_host", "p_ledger"],
    agents_photo_change_done: ["p_id", "p_host", "p_result"],
    agents_photo_change_error: ["p_id", "p_host", "p_error"],
    agents_photo_changes_purge: ["p_host"],
  };
  const OPTIONAL = { set_photo_team: ["p_default", "p_google_email", "p_version"] };
  // every short code (HINT) the demo raises, and the codes it writes into rows or previews (the schema check compares
  // them with the migration's)
  const CODES = ["agents", "bad_args", "bad_email", "bad_host", "bad_key", "bad_kind", "bad_milestone", "bad_plan", "bad_request",
    "bad_result", "bad_rev", "bad_shoot", "cancelled", "changed", "default_needs_photographer", "expired", "firm", "foreign_ledger",
    "forbidden", "gone", "inactive", "key_reused", "no_change", "no_original", "no_person", "no_plan", "no_request", "no_shoot",
    "not_anchored", "not_open", "not_server", "not_undoable", "not_yours", "past", "pending", "pick_default_first", "plan_not_active",
    "rate", "stale_rev", "taken", "too_big", "too_far", "too_many", "undated", "unknown_shoot"];
  NS.p10PhotoSigs = SIGS;
  NS.p10PhotoCodes = CODES;

  const AUDIT = { created_at: null, created_by: null, updated_at: null, updated_by: null, version: 1 };
  const COLS = {
    photo_team: Object.assign({ profile_id: null, photographer: false, marketing: false, default_photographer: false, google_email: null }, AUDIT),
    photo_plans: Object.assign({ id: null, ledger_id: null, local_id: null, rev: null, milestones_rev: null, status: null, project_id: null,
      project_code: null, project_label: null, city: null, title: null, photographer_name: "", photographer_profile_id: null,
      photographer_source: "none", milestones: null, shoot_days: [], lead_days: 0, series: [], open_suggestions: 0, activated_at: null,
      mirrored_at: null, host: null }, AUDIT),
    photo_shoots: Object.assign({ id: null, plan_id: null, local_id: null, key: null, seq: 0, phase: null, name: null, anchor: null, offset_days: 0,
      fixed_date: null, planned_date: null, window_days: 0, status: null, auto_skipped: false, pin_day: null, series: null, n: 0,
      announced_for: null, done_at: null, done_source: null, done_note: null, task_id: null, brief: {}, history: [], rev: null }, AUDIT),
    photo_changes: Object.assign({ id: null, plan_id: null, ledger_id: null, plan_local_id: null, kind: null, args: null, target_key: null,
      target_local_id: null, base_rev: null, expect: null, preview: null, needs_office: false, client_key: null, status: "new",
      requested_by: null, requested_at: null, requester_admin: null, requester_photographer: null, requester_is_plan_photographer: null,
      taken_at: null, host: null, done_at: null, result: null, error: null, undo_of: null, undone_by: null }, AUDIT),
  };
  NS.p10PhotoCols = COLS;
  const TABLES = Object.keys(COLS);

  (NS.extTables = NS.extTables || []).push({
    tables: TABLES,
    cols: COLS,
    pk: { photo_team: "profile_id" },
    uuid: [],
    noAudit: [],
    fks: [["photo_team", "profile_id", "profiles"], ["photo_plans", "photographer_profile_id", "profiles"], ["photo_plans", "project_id", "projects"],
      ["photo_shoots", "plan_id", "photo_plans"], ["photo_changes", "plan_id", "photo_plans"], ["photo_changes", "requested_by", "profiles"]],
  });

  /* ── the lenient JSON readers and the days (the migration's app.photo_j*, app.agents_real_day) ── */

  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const has = (o, k) => isObj(o) && Object.prototype.hasOwnProperty.call(o, k);
  const jtext = (v) => (typeof v === "string" ? v : null);
  const jint = (v) => (typeof v === "number" && Number.isInteger(v) && /^-?[0-9]{1,15}$/.test(String(v)) ? v : null);
  const jbool = (v) => (typeof v === "boolean" ? v : null);
  const jgiven = (v) => v !== undefined && v !== null;
  function realDay(s) {
    if (typeof s !== "string") return null;
    const t = s.replace(/^ +| +$/g, "");
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(t)) return null;
    const d = new Date(t + "T00:00:00Z");
    return isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t ? null : t;
  }
  const jday = (v) => (typeof v === "string" ? realDay(v) : null);
  function addDays(d, n) {
    if (d === null || d === undefined || n === null || n === undefined) return null;
    const t = new Date(d + "T00:00:00Z");
    t.setUTCDate(t.getUTCDate() + Number(n));
    return t.toISOString().slice(0, 10);
  }
  const diff = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
  const weekday = (d) => (new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7;      // extract(isodow) - 1: Mon = 0 ... Sun = 6
  const lt = (a, b) => a !== null && b !== null && a < b;
  const gt = (a, b) => a !== null && b !== null && a > b;
  const same = (a, b) => a !== null && b !== null && a === b;
  const cmpC = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  /** app.photo_days_of */
  function daysOf(v) {
    if (!Array.isArray(v)) return [];
    const ok = v.every((e) => (typeof e === "number" && /^-?[0-9]{1,6}$/.test(String(e))) || (typeof e === "string" && /^[+-]?[0-9]{1,6}$/.test(e.replace(/^ +| +$/g, ""))));
    if (!ok) return [];
    return Array.from(new Set(v.map((e) => parseInt(String(e).replace(/^ +| +$/g, ""), 10)).filter((d) => d >= 0 && d <= 6))).sort((a, b) => a - b);
  }
  /** app.photo_next_shoot_day */
  function nextShootDay(d, days) {
    if (d === null || !days || !days.length) return d;
    let v = d;
    for (let i = 1; i <= 7; i++) {
      if (days.indexOf(weekday(v)) !== -1) return v;
      v = addDays(v, 1);
    }
    return v;
  }
  /** app.photo_shoot_rows */
  function shootRows(list) {
    const out = [];
    (Array.isArray(list) ? list : []).forEach((e, i) => {
      if (!isObj(e) || jtext(e.key) === null || (jtext(e.status) || "") === "cancelled") return;
      const n = (v) => { const x = jint(v); return x === null ? 0 : x; };
      out.push({ key: jtext(e.key), seq: n(e.seq), name: jtext(e.name), anchor: jtext(e.anchor), offset_days: n(e.offset_days),
        fixed_date: jday(e.fixed_date), planned_date: jday(e.planned_date), window_days: n(e.window_days), status: jtext(e.status),
        auto_skipped: jbool(e.auto_skipped) === true, pin_day: jday(e.pin_day), series: jtext(e.series), n: n(e.n), ord: i + 1 });
    });
    return out;
  }
  const byFrom = (x, y) => (x.from !== y.from ? (x.from === null ? 1 : y.from === null ? -1 : x.from < y.from ? -1 : 1) : x.seq - y.seq || cmpC(x.key, y.key));

  class ShiftError extends Error {
    constructor(message) { super(message); this.code = "22023"; this.hint = "bad_args"; }
  }

  /** THE SHIFT RULE (app.photo_shift, docs/PHOTO-SCHEDULE.md §7): {today, shoot_days, actor, milestones, series, shoots,
      change} -> {moved, stays, passed, replan, needs_office, refused}. Pure. */
  function shift(input) {
    const inp = isObj(input) ? input : {};
    const ch = isObj(inp.change) ? inp.change : {};
    const kind = jtext(ch.kind);
    const today = jday(inp.today);
    const days = daysOf(inp.shoot_days);
    const admin = isObj(inp.actor) && jbool(inp.actor.admin) === true;
    const ms = isObj(inp.milestones) ? inp.milestones : {};
    const rows = shootRows(inp.shoots);
    const empty = (code) => ({ moved: [], stays: [], passed: [], replan: [], needs_office: false, refused: code });
    if (today === null) throw new ShiftError("The shift needs today's date.");
    const last = (want) => { let t = null; for (const r of rows) if (want !== null && r.key === want) t = r; return t; };

    if (kind === "move_one" || kind === "move_later") {
      const T = last(jtext(ch.shoot));
      if (!T) return empty("unknown_shoot");
      if (OPEN.indexOf(T.status || "") === -1) return empty("not_open");
      if (kind === "move_later" && T.planned_date === null) return empty("undated");
      const to = jday(ch.to);
      if (to === null) throw new ShiftError("A move needs the day it goes to.");
      if (to < today) return empty("past");
      if (to > addDays(today, 365)) return empty("too_far");
      if (same(T.planned_date, to)) return empty("no_change");
      const m = T.anchor === null ? undefined : ms[T.anchor];
      const notes = [];
      if (days.length && days.indexOf(weekday(to)) === -1) notes.push("not_shoot_day");
      if (T.fixed_date === null && MS.indexOf(T.anchor) !== -1 && jday(isObj(m) ? m.date : null) === null) notes.push("stops_following");
      if (T.status === "announced") notes.push("heads_up_sent");
      const delta = T.planned_date === null ? null : diff(T.planned_date, to);
      const moved = [{ key: T.key, seq: T.seq, from: T.planned_date, to, notes }];
      const stays = [];
      if (kind === "move_later") {
        for (const x of rows) {
          if (x.ord === T.ord) continue;
          const later = x.planned_date === null || gt(x.planned_date, T.planned_date) ||
            (same(x.planned_date, T.planned_date) && (x.seq > T.seq || (x.seq === T.seq && x.key > T.key)));
          if (!later) continue;
          const raw = x.planned_date === null ? null : addDays(x.planned_date, delta);
          const nd = nextShootDay(raw, days);
          const reason = ["done", "skipped", "missed"].indexOf(x.status || "") !== -1 ? x.status
            : x.planned_date === null ? "undated" : x.fixed_date !== null || x.anchor === "fixed" ? "fixed" : same(nd, x.planned_date) ? "same_day" : null;
          if (reason) { stays.push({ key: x.key, seq: x.seq, from: x.planned_date, reason }); continue; }
          const n2 = [];
          if (nd !== raw) n2.push("rolled");
          if (x.status === "announced") n2.push("heads_up_sent");
          moved.push({ key: x.key, seq: x.seq, from: x.planned_date, to: nd, notes: n2 });
        }
      }
      return { moved: moved.sort(byFrom).map((r) => ({ key: r.key, from: r.from, to: r.to, notes: r.notes })),
        stays: stays.sort(byFrom).map((r) => ({ key: r.key, reason: r.reason })), passed: [], replan: [], needs_office: false, refused: null };
    }

    if (kind === "milestone") {
      let key, date;
      if (jgiven(ch.shoot)) {
        const T = last(jtext(ch.shoot));
        if (!T) return empty("unknown_shoot");
        if (T.fixed_date !== null || T.anchor === null || MS.indexOf(T.anchor) === -1) return empty("not_anchored");
        key = T.anchor;
        const to = jday(ch.to);
        if (to === null) throw new ShiftError("A job date move needs the day the shoot goes to.");
        date = addDays(to, -T.offset_days);
      } else {
        key = jtext(ch.milestone);
        if (key === null || MS.indexOf(key) === -1) return empty("bad_milestone");
        date = jday(ch.date);
        if (date === null) throw new ShiftError("A job date move needs the new date.");
      }
      if (date < addDays(today, -60) || date > addDays(today, 365)) return empty("too_far");
      const m = isObj(ms[key]) ? ms[key] : {};
      const cur = jday(m.date);
      if (same(cur, date)) return empty("no_change");
      const moved = [], stays = [], passed = [];
      for (const x of rows) {
        if (x.anchor !== key) continue;
        const raw = addDays(date, x.offset_days);
        const auto = (x.status || "") === "skipped" && x.auto_skipped;
        const nd = x.pin_day !== null && raw === x.pin_day ? raw : nextShootDay(raw, days);
        const behind = addDays(nd, x.window_days) < today;
        const notes = [];
        if (!auto && x.planned_date === null) notes.push("gets_date");
        if (auto) notes.push("comes_back");
        if (nd !== raw) notes.push("rolled");
        if (!auto && x.status === "announced") notes.push("heads_up_sent");
        const st = x.status || "";
        const item = { key: x.key, seq: x.seq, from: x.planned_date };
        if (st === "done" || st === "missed" || (st === "skipped" && !auto)) stays.push(Object.assign(item, { reason: x.status }));
        else if (x.fixed_date !== null) stays.push(Object.assign(item, { reason: "fixed" }));
        else if (auto && behind) stays.push(Object.assign(item, { reason: "skipped" }));
        else if (auto) moved.push(Object.assign(item, { to: nd, notes }));
        else if (same(nd, x.planned_date)) stays.push(Object.assign(item, { reason: "same_day" }));
        else if (behind) passed.push(Object.assign(item, { to: nd }));
        else moved.push(Object.assign(item, { to: nd, notes }));
      }
      const conf = jbool(m.confirmed) === true;
      const src = jtext(m.source);
      const needs = cur === null || !conf || admin ? false : src === null ? null : src === "admin";
      const replan = (Array.isArray(inp.series) ? inp.series : []).filter((e) => isObj(e) && (jtext(e.anchor) === key || key === "framing_complete"))
        .map((e) => (e.key === undefined ? null : e.key));
      return { moved: moved.sort(byFrom).map((r) => ({ key: r.key, from: r.from, to: r.to, notes: r.notes })),
        stays: stays.sort(byFrom).map((r) => ({ key: r.key, reason: r.reason })),
        passed: passed.sort(byFrom).map((r) => ({ key: r.key, from: r.from, to: r.to })), replan, needs_office: needs, refused: null };
    }
    return empty("bad_kind");
  }
  NS.p10PhotoShift = shift;
  NS.p10PhotoNextShootDay = nextShootDay;

  /* ── text (app.clean_line, app.scrub_money) ── */
  const CTRL = new RegExp("[\\u0001-\\u001f\\u007f-\\u009f\\u2028\\u2029]", "g");
  const WS = "\\t\\n\\r\\f\\v \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff";
  const SPACES = new RegExp("[" + WS + "]+", "g");
  const cleanLine = (v) => String(v === null || v === undefined ? "" : v).replace(CTRL, " ").replace(SPACES, " ").replace(/^ | $/g, "");
  const scrub = (v) => (NS.p6ScrubMoney ? NS.p6ScrubMoney(v) : String(v === null || v === undefined ? "" : v).replace(/\$\s?\d[\d,]*(\.\d+)?/g, "[amount]"));
  const line = (v, max) => scrub(cleanLine(v)).slice(0, max);
  const EDGE = new RegExp("^[" + WS + "]+|[" + WS + "]+$", "g");
  const INSIDE = new RegExp("[" + WS + "\\u0001-\\u001f\\u007f]");
  const firstName = (n) => { const m = /^\s*(\S+)/.exec(String(n || "")); return m ? m[1] : ""; };
  const canon = (v) => (Array.isArray(v) ? v.map(canon) : isObj(v) ? Object.keys(v).sort().reduce((o, k) => { o[k] = canon(v[k]); return o; }, {}) : v);
  const jsonEq = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

  /** app.photo_args_clean: a change's arguments checked and tidied without reading a row (22023 bad_kind / bad_args) */
  function argsClean(kind, args, admin, PgErr) {
    const bad = (hint, message) => new PgErr("22023", message, 400, null, hint);
    if (KINDS.indexOf(kind) === -1) throw bad("bad_kind", "That is not a change the shoot schedule knows.");
    if (!isObj(args)) throw bad("bad_args", "The change's details are missing.");
    const allowed = { move_one: ["shoot", "to", "reason"], move_later: ["shoot", "to", "reason"], milestone: ["milestone", "date", "shoot", "to", "reason", "firm"],
      done: ["shoot", "note"], undo: ["change"] }[kind];
    if (Object.keys(args).some((k) => allowed.indexOf(k) === -1)) throw bad("bad_args", "The change has a detail the shoot schedule does not know.");
    let out = {};
    let wrong = false;
    const byShoot = has(args, "shoot");
    if (["move_one", "move_later", "done"].indexOf(kind) !== -1 || (kind === "milestone" && byShoot)) {
      const t = jtext(args.shoot);
      wrong = wrong || t === null || t.length < 1 || t.length > 60;
      out.shoot = t;
    }
    if (kind === "move_one" || kind === "move_later" || (kind === "milestone" && byShoot)) {
      wrong = wrong || jday(args.to) === null;
      out.to = jday(args.to);
    }
    if (kind === "milestone") {
      if (byShoot) wrong = wrong || has(args, "milestone") || has(args, "date");
      else {
        const t = jtext(args.milestone);
        wrong = wrong || t === null || t.length < 1 || t.length > 40 || jday(args.date) === null || has(args, "to");
        out.milestone = t;
        out.date = jday(args.date);
      }
      if (jgiven(args.firm)) {
        wrong = wrong || jbool(args.firm) === null;
        if (admin) out.firm = jbool(args.firm);
      }
    }
    if (["move_one", "move_later", "milestone"].indexOf(kind) !== -1 && jgiven(args.reason)) {
      let t = cleanLine(jtext(args.reason));
      wrong = wrong || typeof args.reason !== "string" || t.length > 200;
      t = scrub(t).slice(0, 200);
      if (t !== "") out.reason = t;
    }
    if (kind === "done" && jgiven(args.note)) {
      let t = cleanLine(jtext(args.note));
      wrong = wrong || typeof args.note !== "string" || t.length > 500;
      t = scrub(t).slice(0, 500);
      if (t !== "") out.note = t;
    }
    if (kind === "undo") {
      const c = jint(args.change);
      wrong = wrong || c === null || c < 1;
      out = { change: c };
    }
    if (wrong) throw bad("bad_args", "The change's details are not right.");
    return out;
  }
  /** app.photo_args_same */
  function argsSame(kind, stored, clean) {
    const s = Object.assign({}, stored || {});
    if (kind === "milestone") for (const k of ["milestone", "date", "firm"]) if (has(s, k) && !has(clean, k)) delete s[k];
    return jsonEq(s, clean);
  }

  (NS.extInstall = NS.extInstall || []).push(function install(E) {
    const { rows, PgErr, nowIso, today, clone, auditInsert, auditUpdate, commitInsert, commitUpdate, commitDelete, nextId } = E;
    if (!rows.photo_team || !rows.photo_plans || !rows.photo_shoots || !rows.photo_changes) return null;
    const STATUS = { "22023": 400, "42501": 403, PT404: 404, PT409: 409, PT413: 413, PT429: 429 };
    const err = (code, hint, message, detail) => new PgErr(code, message, STATUS[code] || 400, detail === undefined || detail === null ? null : JSON.stringify(detail), hint);
    const refuse = (status, code, message) => err(status === 400 ? "22023" : status === 403 ? "42501" : "PT" + status, code, message);
    // app.photo_mirror: the seed's plans were mirrored by the demo's ledger (read when first needed: the rows are loaded after
    // this install runs)
    const mirror = { ledger_id: null, host: HOST, since: null, last_at: null, seen: false };
    function mirrorRow() {
      if (!mirror.seen && rows.photo_plans.length) {
        mirror.seen = true;
        if (!mirror.ledger_id) mirror.ledger_id = rows.photo_plans[0].ledger_id;
        if (!mirror.last_at) mirror.last_at = rows.photo_plans.reduce((m, x) => (x.mirrored_at && (!m || x.mirrored_at > m) ? x.mirrored_at : m), null);
      }
      return mirror;
    }
    const beats = [];
    const dev = { offline: false, offlineMinutes: 120, paused: false, auto: true };
    const iso = (v) => (v ? new Date(v).toISOString() : null);
    const nowMs = () => Date.parse(nowIso());

    /* who: the gates of §3.2 (an active person, never the agents account) */
    const teamRow = (uid) => rows.photo_team.find((t) => t.profile_id === uid) || null;
    const profile = (uid) => rows.profiles.find((p) => p.id === uid) || null;
    const isPhotographer = (w) => !!(w && w.active && (teamRow(w.uid) || {}).photographer);
    const isMarketing = (w) => !!(w && w.active && (teamRow(w.uid) || {}).marketing);
    const canPhoto = (w) => !!(w && (w.admin || isPhotographer(w)));
    const canPhotoRead = (w) => !!(w && (w.admin || isPhotographer(w) || isMarketing(w)));
    const whoOf = (uid) => E.who({ uid });
    const AGENTS = () => (rows.profiles.find((p) => p.role === "agents") || {}).id || null;
    const rosterName = (uid) => {
      const e = (rows.employees || []).find((x) => x.profile_id === uid && x.active !== false);
      const p = profile(uid);
      return (e && String(e.full_name || "").trim()) || (p && String(p.full_name || "").trim()) || "";
    };

    /* the change's state now (app.photo_change_state / _open) */
    const fresh = (r) => Date.parse(r.requested_at || "") > nowMs() - 7 * 86400000;
    const state = (r) => (r.status === "new" && !fresh(r) ? "expired" : r.status);
    const isOpen = (r) => r.status === "taken" || (r.status === "new" && fresh(r));

    function write(w, table, old, patch) {
      const r = Object.assign(clone(old), patch);
      auditUpdate(w, table, r, old);
      commitUpdate(table, old, r);
      return r;
    }
    function add(w, table, r) {
      auditInsert(w, table, r);
      commitInsert(table, r);
      return r;
    }
    const planOf = (id) => rows.photo_plans.find((p) => p.id === Number(id)) || null;
    const shootsOf = (pid) => rows.photo_shoots.filter((s) => s.plan_id === pid);
    const shootOf = (pid, key) => rows.photo_shoots.find((s) => s.plan_id === pid && s.key === key) || null;
    const changeOf = (id) => rows.photo_changes.find((c) => c.id === Number(id)) || null;

    /* app.photo_plan_input */
    function planInput(plan, admin) {
      const list = shootsOf(plan.id).slice().sort((a, b) => a.seq - b.seq || cmpC(a.key, b.key) || a.id - b.id);
      return { today: today(), shoot_days: (plan.shoot_days || []).slice(), actor: { admin: !!admin }, milestones: clone(plan.milestones), series: clone(plan.series || []),
        shoots: list.map((s) => ({ key: s.key, seq: s.seq, phase: s.phase, name: s.name, anchor: s.anchor, offset_days: s.offset_days, fixed_date: s.fixed_date,
          planned_date: s.planned_date, window_days: s.window_days, status: s.status, auto_skipped: s.auto_skipped, pin_day: s.pin_day, series: s.series, n: s.n })) };
    }
    const enrich = (pid, list) => (list || []).map((e) => { const s = shootOf(pid, e.key); return Object.assign({}, e, { id: s ? s.id : null, name: s ? s.name : null }); });
    function runShift(input) {
      try { return shift(input); } catch (e) { if (e instanceof ShiftError) throw err("22023", "bad_args", e.message); throw e; }
    }

    /* app.photo_undo_check */
    function undoCheck(pid, changeId, admin, me, self) {
      const o = rows.photo_changes.find((c) => c.id === changeId && c.plan_id === pid);
      if (!o) return { code: "no_original" };
      if (!(admin || o.requested_by === me)) return { code: "forbidden" };
      const outcome = o.result && o.result.outcome;
      if (o.status !== "applied" || outcome !== "applied" || ["move_one", "move_later", "milestone"].indexOf(o.kind) === -1 || o.undone_by !== null ||
        !o.done_at || Date.parse(o.done_at) < nowMs() - 7 * 86400000 ||
        rows.photo_changes.some((u) => u.undo_of === o.id && u.kind === "undo" && u.id !== self && isOpen(u))) return { code: "not_undoable" };
      const plan = planOf(pid);
      if (o.kind !== "milestone") {
        const moved = (Array.isArray(o.result.moved) ? o.result.moved : []).map((m) => {
          const s = shootOf(pid, m && m.key);
          const to = jday(m && m.to);
          return { key: m && m.key, local_id: s ? s.local_id : null, id: s ? s.id : null, name: s ? s.name : null, from: jday(m && m.from), to,
            ok: !!s && OPEN.indexOf(s.status) !== -1 && s.planned_date === to && to !== null };
        });
        if (!moved.length) return { code: "not_undoable" };
        const badOne = moved.find((m) => !m.ok);
        if (badOne) return { code: "changed", detail: { table: "photo_shoots", id: badOne.id, rev: badOne.id ? (rows.photo_shoots.find((s) => s.id === badOne.id) || {}).rev : null } };
        if (moved.some((m) => m.from === null)) return { code: "not_undoable" };
        if (moved.some((m) => m.from < today())) return { code: "past" };
        return { code: null, moved: moved.map((m) => { const c = Object.assign({}, m); delete c.ok; return c; }) };
      }
      const key = o.args && o.args.milestone;
      const cur = plan.milestones && plan.milestones[key] ? plan.milestones[key] : {};
      let day, src, conf;
      if (isObj(o.result.milestone_after)) {
        day = jday(o.result.milestone_after.date) || jday(o.args.date);
        src = jtext(o.result.milestone_after.source);
        conf = jbool(o.result.milestone_after.confirmed) === true;
      } else {
        day = jday(o.args.date);
        src = o.requester_admin ? "admin" : "photographer";
        conf = !o.requester_admin || jbool(o.args.firm) === true;
      }
      const detail = { table: "photo_plans", id: pid, rev: plan.milestones_rev };
      if (day === null || jday(cur.date) !== day || jtext(cur.source) !== src || (jbool(cur.confirmed) === true) !== conf) return { code: "changed", detail };
      const before = o.result.milestone_before;
      if (!isObj(before) || jday(before.date) === null) return { code: "not_undoable" };
      if (!admin && (jbool(cur.firm) === true || (jbool(before.confirmed) === true && jtext(before.source) === "admin"))) return { code: "firm", detail };
      return { code: null, moved: [], milestone: { key, date: day, source: src, confirmed: conf, before } };
    }

    /* app.photo_preview */
    function preview(plan, kind, args, admin, me) {
      let a = clone(args);
      if (kind === "milestone") {
        if (has(a, "shoot")) {
          const s = shootOf(plan.id, a.shoot);
          if (s && s.fixed_date === null && MS.indexOf(s.anchor) !== -1) a = Object.assign(a, { milestone: s.anchor, date: addDays(jday(a.to), -s.offset_days) });
        }
        const key = a.milestone;
        if (admin && MS.indexOf(key) !== -1 && !has(a, "firm")) a.firm = !!(plan.milestones && plan.milestones[key] && plan.milestones[key].firm === true);
      }
      const head = { plan_id: plan.id, rev: plan.rev, today: today(), kind, args: a };
      const empty = { moved: [], stays: [], passed: [], replan: [], needs_office: false, refused: null };
      const input = planInput(plan, admin);
      if (kind === "move_one" || kind === "move_later" || kind === "milestone") {
        const change = kind === "milestone" && has(args, "shoot") ? { kind, shoot: args.shoot, to: args.to }
          : kind === "milestone" ? { kind, milestone: args.milestone, date: args.date } : { kind, shoot: args.shoot, to: args.to };
        const sh = runShift(Object.assign(input, { change }));
        return Object.assign({}, head, sh, { moved: enrich(plan.id, sh.moved), stays: enrich(plan.id, sh.stays), passed: enrich(plan.id, sh.passed) });
      }
      if (kind === "done") {
        const s = shootOf(plan.id, args.shoot);
        if (!s) return Object.assign({}, head, empty, { refused: "unknown_shoot", done: null });
        return Object.assign({}, head, empty, { refused: OPEN.indexOf(s.status) === -1 ? "not_open" : null, done: { key: s.key, id: s.id, name: s.name } });
      }
      const u = undoCheck(plan.id, args.change, admin, me);
      if (u.code === "forbidden") throw err("42501", "forbidden", "Only the person who made a change, or an admin, can undo it.");
      if (u.code) return Object.assign({}, head, empty, { refused: u.code });
      if (u.milestone) {
        const sh = runShift(Object.assign(input, { change: { kind: "milestone", milestone: u.milestone.key, date: u.milestone.before.date } }));
        return Object.assign({}, head, sh, { moved: enrich(plan.id, sh.moved), stays: enrich(plan.id, sh.stays), passed: enrich(plan.id, sh.passed) });
      }
      return Object.assign({}, head, empty, { moved: u.moved.map((m) => ({ key: m.key, id: m.id, name: m.name, from: m.to, to: m.from, notes: [] })) });
    }

    const answer = (r, again) => ({ id: r.id, status: state(r), requested_at: iso(r.requested_at), again: !!again, needs_office: r.needs_office,
      preview: clone(r.preview), result: clone(r.result), error: clone(r.error) });

    /* the change as the PC receives it (app.photo_change_item) */
    function item(r) {
      const p = profile(r.requested_by);
      const roster = rosterName(r.requested_by);
      const plan = planOf(r.plan_id);
      return { id: r.id, kind: r.kind, args: clone(r.args), base_rev: r.base_rev, expect: clone(r.expect), preview: clone(r.preview), needs_office: r.needs_office,
        status: r.status, requested_at: iso(r.requested_at), plan: { id: r.plan_id, local_id: r.plan_local_id },
        target: r.target_key !== null ? { key: r.target_key, local_id: r.target_local_id } : null,
        requester: p ? { profile_id: p.id, name: roster, first_name: firstName(roster), admin: !!(p.active && p.role === "admin"),
          photographer: !!(p.active && p.role !== "agents" && (teamRow(p.id) || {}).photographer), plan_photographer: !!plan && plan.photographer_profile_id === r.requested_by } : null,
        undo_of: r.undo_of };
    }

    /* ── the agents account's side (the lease holder, the ledger) ── */
    function agentsOnly(w, reader) {
      if (!(w.agents || (reader && w.admin))) {
        throw refuse(403, "forbidden", reader ? "Only the DCR Agents 2 account or an admin can read the agents feeds." : "Only the DCR Agents 2 account can do that.");
      }
    }
    function hostOf(p) {
      const v = String(p === null || p === undefined ? "" : p).replace(/^\s+|\s+$/g, "");
      if (!v) throw refuse(400, "bad_host", "host must name the computer that is asking.");
      if (v.length > 60) throw refuse(400, "bad_request", "host must name the computer (at most 60 characters).");
      return v;
    }
    function leaseHolder(p) {
      const h = hostOf(p);
      const s = E.server();
      if (!s || !s.host_id) throw refuse(409, "not_server", "No computer holds the DCR server lease yet.");
      if (h !== s.host_id) throw refuse(409, "not_server", s.host_id + " holds the lease");
      return h;
    }
    function ledger(p, claim, host) {
      if (!p) throw refuse(400, "bad_request", "ledger must be this computer's ledger id.");
      if (!mirrorRow().ledger_id) {
        if (!claim) return "unclaimed";
        Object.assign(mirror, { ledger_id: p, host, since: nowIso() });
        return "claimed";
      }
      if (mirrorRow().ledger_id !== p) throw refuse(409, "foreign_ledger", "The shoot schedule is published from another DCR Agents 2 ledger.");
      return "ok";
    }
    function beat() {
      const t = nowMs();
      while (beats.length && beats[0] < t - 60000) beats.shift();
      if (beats.length >= 120) {
        throw err("PT429", "rate", "That is a lot of schedule updates in a short time - wait a moment.", { retryAfter: Math.max(1, Math.ceil((beats[0] + 60000 - t) / 1000)) });
      }
      beats.push(t);
    }
    function gone(planIds) {
      let n = 0;
      for (const c of rows.photo_changes.slice()) {
        if (planIds.indexOf(c.plan_id) === -1 || (c.status !== "new" && c.status !== "taken")) continue;
        write({ uid: null }, "photo_changes", c, { status: "refused", done_at: nowIso(), error: { code: "gone", message: "That shoot or plan is no longer in the plan." } });
        n += 1;
      }
      return n;
    }
    function dropPlan(p) {
      for (const c of rows.photo_changes.filter((x) => x.plan_id === p.id)) write({ uid: null }, "photo_changes", c, { plan_id: null });
      for (const s of shootsOf(p.id)) commitDelete("photo_shoots", s);
      commitDelete("photo_plans", p);
    }
    const revKeys = ["planned_date", "status", "anchor", "offset_days", "fixed_date", "pin_day", "window_days", "auto_skipped"];
    const W = () => ({ uid: AGENTS() });

    /** agents_photo_mirror's write (also the demo PC's re-mirror): the plan row and all its shoots, a full replace */
    function mirrorWrite(plan, shoots, rev, host) {
      const old = rows.photo_plans.find((p) => p.ledger_id === mirrorRow().ledger_id && p.local_id === Number(plan.local_id)) || null;
      if (old && rev === Number(old.rev)) return { ok: true, plan_id: old.id, rev: old.rev, same: true, shoots: shootsOf(old.id).map((s) => ({ local_id: s.local_id, id: s.id })).sort((a, b) => a.local_id - b.local_id) };
      if (old && rev < Number(old.rev)) throw err("PT409", "stale_rev", "A newer version of that plan is mirrored already.", { rev: old.rev });
      const ms = {};
      for (const k of MS) {
        const m = isObj(plan.milestones) && isObj(plan.milestones[k]) ? plan.milestones[k] : {};
        const date = jday(m.date), conf = jbool(m.confirmed) === true, src = line(jtext(m.source), 40);
        ms[k] = { date, source: src, confirmed: conf, firm: date !== null && conf && src === "admin" };
      }
      const photographer = line(jtext(plan.photographer), 120);
      const match = photographer ? rows.profiles.find((p) => p.role !== "agents" && rosterName(p.id).toLowerCase() === photographer.toLowerCase()) : null;
      const fields = { rev, status: plan.status, project_id: (rows.projects || []).some((p) => p.id === Number(plan.project_id)) ? Number(plan.project_id) : null,
        project_code: line(jtext(plan.project_code), 20) || null, project_label: line(jtext(plan.project_label), 200) || null, city: line(jtext(plan.city), 100) || null,
        title: line(jtext(plan.title), 120) || null, photographer_name: photographer, photographer_profile_id: match ? match.id : null,
        photographer_source: jtext(plan.photographer_source) || "none", milestones: ms, shoot_days: daysOf(plan.shoot_days), lead_days: jint(plan.lead_days) || 0,
        series: (Array.isArray(plan.series) ? plan.series : []).filter((e) => isObj(e) && jtext(e.key) && jint(e.every) !== null &&
          MS.concat(["fixed"]).indexOf(jtext(e.anchor) || "") !== -1).map((e) => ({ key: e.key, name: line(jtext(e.name), 80), phase: e.phase || null,
          anchor: e.anchor, every: Math.max(1, Math.min(365, e.every)) })),
        open_suggestions: jint(plan.open_suggestions) || 0, activated_at: plan.activated_at || null, mirrored_at: nowIso(), host };
      let p;
      if (!old) {
        p = add(W(), "photo_plans", Object.assign(clone(COLS.photo_plans), fields, { id: nextId("photo_plans"), ledger_id: mirrorRow().ledger_id,
          local_id: Number(plan.local_id), milestones_rev: rev }));
      } else {
        p = write(W(), "photo_plans", old, Object.assign(fields, { milestones_rev: jsonEq(old.milestones, ms) ? old.milestones_rev : rev }));
      }
      const keep = shoots.map((s) => Number(s.local_id));
      for (const s of shootsOf(p.id).filter((x) => keep.indexOf(x.local_id) === -1)) commitDelete("photo_shoots", s);
      for (const s of shoots) {
        const f = { key: s.key, seq: jint(s.seq) || 0, phase: s.phase, name: line(jtext(s.name), 80), anchor: s.anchor, offset_days: jint(s.offset_days) || 0,
          fixed_date: jday(s.fixed_date), planned_date: jday(s.planned_date), window_days: jint(s.window_days) || 0, status: s.status,
          auto_skipped: jbool(s.auto_skipped) === true, pin_day: jday(s.pin_day), series: jtext(s.series), n: jint(s.n) || 0, announced_for: jday(s.announced_for),
          done_at: s.done_at || null, done_source: s.done_source ? line(s.done_source, 40) : null, done_note: s.done_note ? scrub(String(s.done_note)).slice(0, 300) : null,
          task_id: jint(s.task_id), brief: isObj(s.brief) ? clone(s.brief) : {}, history: (Array.isArray(s.history) ? s.history : []).slice(-10) };
        const o = rows.photo_shoots.find((x) => x.plan_id === p.id && x.local_id === Number(s.local_id));
        if (!o) add(W(), "photo_shoots", Object.assign(clone(COLS.photo_shoots), f, { id: nextId("photo_shoots"), plan_id: p.id, local_id: Number(s.local_id), rev }));
        else if (!jsonEq(Object.keys(f).reduce((x, k) => { x[k] = o[k]; return x; }, {}), f)) {
          write(W(), "photo_shoots", o, Object.assign(f, { rev: revKeys.some((k) => !jsonEq(o[k], f[k])) ? rev : o.rev }));
        }
      }
      mirrorRow().last_at = nowIso();
      return { ok: true, plan_id: p.id, rev, same: false, shoots: shootsOf(p.id).map((s) => ({ local_id: s.local_id, id: s.id })).sort((a, b) => a.local_id - b.local_id) };
    }

    function takeChange(id, host, led) {
      if (!led || mirrorRow().ledger_id !== led) throw refuse(409, "foreign_ledger", "The shoot schedule is published from another DCR Agents 2 ledger.");
      const r = changeOf(id);
      const mine = (x) => !!x && !!planOf(x.plan_id) && planOf(x.plan_id).ledger_id === led;
      if (r && r.status === "new" && fresh(r) && mine(r)) {
        return { ok: true, change: item(write(W(), "photo_changes", r, { status: "taken", taken_at: nowIso(), host })) };
      }
      if (r && r.status === "taken" && mine(r)) {
        if (r.host === host || Date.parse(r.taken_at) < nowMs() - 15 * 60000) {
          return { ok: true, again: true, change: item(write(W(), "photo_changes", r, { taken_at: nowIso(), host })) };
        }
        throw refuse(409, "taken", "Another computer took that change first.");
      }
      throw refuse(409, "gone", "That change is no longer waiting.");
    }
    function scrubJson(v) {
      if (typeof v === "string") return scrub(v);
      if (Array.isArray(v)) return v.map(scrubJson);
      if (isObj(v)) return Object.keys(v).reduce((o, k) => { o[k] = scrubJson(v[k]); return o; }, {});
      return v;
    }
    function doneChange(id, host, result) {
      if (!isObj(result) || ["applied", "suggested"].indexOf(result.outcome) === -1) throw refuse(400, "bad_result", "result must be the answer object with outcome applied or suggested.");
      if (JSON.stringify(result).length > 20000) throw refuse(413, "too_big", "That answer is too big to send back through the portal.");
      const h = hostOf(host);
      const r = changeOf(id);
      if (r && r.status === "applied" && r.host === h) return { ok: true, again: true };
      if (!r || r.status !== "taken" || r.host !== h) throw refuse(409, "not_yours", "That change is not being worked on by this computer.");
      write(W(), "photo_changes", r, { status: "applied", result: scrubJson(result), done_at: nowIso() });
      if (r.kind === "undo" && r.undo_of !== null) {
        const o = changeOf(r.undo_of);
        if (o && o.undone_by === null) write(W(), "photo_changes", o, { undone_by: r.id });
      }
      return { ok: true };
    }
    function errorChange(id, host, e) {
      const code = String(jtext(e && e.code) || "").replace(/^\s+|\s+$/g, "");
      if (!/^[a-z_]{2,20}$/.test(code)) throw refuse(400, "bad_request", "code must be a short error code such as changed.");
      const h = hostOf(host);
      const r = changeOf(id);
      if (r && r.status === "refused" && r.host === h) return { ok: true, again: true };
      if (!r || r.status !== "taken" || r.host !== h) throw refuse(409, "not_yours", "That change is not being worked on by this computer.");
      write(W(), "photo_changes", r, { status: "refused", error: { code, message: line(jtext(e.message), 500) }, done_at: nowIso() });
      return { ok: true };
    }

    /* ── the people's RPCs ── */
    function setTeam(w, a) {
      if (!w.admin) throw err("42501", "forbidden", "Only an admin can change the photo team.");
      if (!a.p_profile || a.p_photographer === null || a.p_photographer === undefined || a.p_marketing === null || a.p_marketing === undefined) {
        throw err("22023", "bad_args", "Say who, and whether they are a photographer and on marketing.");
      }
      const person = profile(a.p_profile);
      if (!person) throw err("PT404", "no_person", "There is no such person.", { table: "profiles", id: a.p_profile });
      if (person.role === "agents") throw err("22023", "agents", "The DCR Agents 2 account is not a person on the photo team.");
      const email = String(a.p_google_email === null || a.p_google_email === undefined ? "" : a.p_google_email).replace(EDGE, "").toLowerCase() || null;
      if (email !== null && !(email.length <= 254 && /^.+@.+$/.test(email) && !INSIDE.test(email))) throw err("22023", "bad_email", "That is not an e-mail address.");
      const row = teamRow(a.p_profile);
      const v = a.p_version === null || a.p_version === undefined ? null : Number(a.p_version);
      if ((v === null && row) || (v !== null && (!row || Number(row.version) !== v))) {
        throw err("PT409", "changed", "Someone changed the photo team meanwhile - look again.", { table: "photo_team", id: a.p_profile, version: row ? row.version : null });
      }
      const ph = !!a.p_photographer, mk = !!a.p_marketing, dflt = !!a.p_default;
      if (dflt && !ph) throw err("22023", "default_needs_photographer", "The default photographer must be a photographer.");
      if (!row && (ph || mk) && person.active === false) throw err("22023", "inactive", "A turned-off person cannot be added to the photo team.");
      const others = rows.photo_team.filter((t) => t.photographer && t.profile_id !== a.p_profile).length;
      if (row && row.default_photographer && !ph && others > 0) throw err("22023", "pick_default_first", "Pick another default photographer first.");
      const isDefault = ph && (dflt || others === 0 || (!!row && row.default_photographer));
      if (isDefault) for (const t of rows.photo_team.filter((x) => x.default_photographer && x.profile_id !== a.p_profile)) write(w, "photo_team", t, { default_photographer: false });
      const defaultId = () => (rows.photo_team.find((t) => t.default_photographer) || {}).profile_id || null;
      if (!ph && !mk) {
        if (row) commitDelete("photo_team", row);
        return { profile_id: a.p_profile, photographer: false, marketing: false, default_photographer: false, google_email: null, version: null, removed: true,
          default_profile_id: defaultId() };
      }
      const patch = { photographer: ph, marketing: mk, default_photographer: isDefault, google_email: email };
      const r = row ? write(w, "photo_team", row, patch) : add(w, "photo_team", Object.assign(clone(COLS.photo_team), patch, { profile_id: a.p_profile }));
      return { profile_id: r.profile_id, photographer: r.photographer, marketing: r.marketing, default_photographer: r.default_photographer,
        google_email: r.google_email, version: r.version, removed: false, default_profile_id: defaultId() };
    }

    function pcOff() {
      try { return typeof sessionStorage !== "undefined" && sessionStorage.getItem("dcr2-demo-pc-off") === "1"; } catch (e) { return false; }
    }
    function pcStatus(w) {
      if (!canPhotoRead(w)) throw err("42501", "forbidden", "Only an admin or the photo team reads the shoot schedule.");
      const s = E.server();
      if (!s) return { lastSeen: null, minutesAgo: null, online: false, paused: false, mirroredAt: iso(mirrorRow().last_at) };
      if (dev.offline || pcOff()) {
        const at = new Date(nowMs() - dev.offlineMinutes * 60000).toISOString();
        return { lastSeen: at, minutesAgo: dev.offlineMinutes, online: false, paused: !!dev.paused, mirroredAt: iso(mirrorRow().last_at) };
      }
      E.beat();                                    // the demo's DCR server is "seen just now" while it is on
      const minutes = Math.round((nowMs() - Date.parse(s.at)) / 60000);
      return { lastSeen: iso(s.at), minutesAgo: minutes, online: minutes <= 3 && !s.standby,
        paused: !!dev.paused || ["true", "t", "1"].indexOf(String((s.payload && s.payload.paused) === undefined ? "" : s.payload.paused).toLowerCase()) !== -1,
        mirroredAt: iso(mirrorRow().last_at) };
    }

    function request(w, a) {
      if (!canPhoto(w)) throw err("42501", "forbidden", "Only an admin or a photographer can change the shoot schedule.");
      const key = a.p_client_key;
      if (typeof key !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(key)) throw err("22023", "bad_key", "The change needs a key of 8 to 64 letters, digits, - or _.");
      const admin = w.admin;
      const prev = rows.photo_changes.find((c) => c.requested_by === w.uid && c.client_key === key);
      if (prev) {
        let clean = null;
        try { clean = argsClean(a.p_kind, a.p_args, admin, PgErr); } catch (e) { clean = null; }
        if (prev.kind === a.p_kind && clean && (prev.plan_id === null || prev.plan_id === Number(a.p_plan)) && a.p_base_rev !== null && a.p_base_rev !== undefined &&
          Number(prev.base_rev) === Number(a.p_base_rev) && argsSame(prev.kind, prev.args, clean)) return answer(prev, true);
        throw err("PT409", "key_reused", "That key was used for another change.", { table: "photo_changes", id: prev.id });
      }
      const plan = planOf(a.p_plan);
      if (!plan) throw err("PT404", "no_plan", "That plan is not on the shoot schedule.", { table: "photo_plans", id: a.p_plan });
      if (["active", "paused"].indexOf(plan.status) === -1) throw err("22023", "plan_not_active", "Only an active or paused plan's shoots can change.");
      const clean = argsClean(a.p_kind, a.p_args, admin, PgErr);
      const base = a.p_base_rev === null || a.p_base_rev === undefined ? null : Number(a.p_base_rev);
      if (base === null || base < 1 || base > Number(plan.rev)) throw err("22023", "bad_rev", "The schedule this change was made on is not known.");
      const mine = rows.photo_changes.filter((c) => c.requested_by === w.uid);
      const hour = mine.filter((c) => Date.parse(c.requested_at) > nowMs() - 3600000).sort((x, y) => Date.parse(y.requested_at) - Date.parse(x.requested_at));
      if (hour.length >= 60) {
        throw err("PT429", "rate", "That is a lot of changes in a short time - wait a moment and try again.",
          { retryAfter: Math.max(1, Math.ceil((Date.parse(hour[59].requested_at) + 3600000 - nowMs()) / 1000)) });
      }
      if (mine.filter(isOpen).length >= 20) throw err("PT429", "too_many", "You have 20 changes waiting for the DCR server - wait for them first.");
      let shoot = null;
      if (has(clean, "shoot")) {
        shoot = shootOf(plan.id, clean.shoot);
        if (!shoot) throw err("PT404", "no_shoot", "That shoot is not in the plan.", { table: "photo_shoots", plan_id: plan.id, key: clean.shoot });
      }
      const pv = preview(plan, a.p_kind, clean, admin, w.uid);
      const args = pv.args;
      const msKey = args.milestone;
      if (a.p_kind === "milestone" && Number(plan.milestones_rev) > base) {
        throw err("PT409", "changed", "The job dates changed meanwhile - look again.", { table: "photo_plans", id: plan.id, rev: plan.milestones_rev });
      }
      if (shoot && Number(shoot.rev) > base) throw err("PT409", "changed", "The shoot changed meanwhile - look again.", { table: "photo_shoots", id: shoot.id, rev: shoot.rev });
      let open = shoot ? rows.photo_changes.filter((c) => c.plan_id === plan.id && c.target_key === shoot.key && isOpen(c)).sort((x, y) => x.id - y.id)[0] : null;
      if (!open && a.p_kind === "milestone" && msKey) {
        open = rows.photo_changes.filter((c) => c.plan_id === plan.id && c.kind === "milestone" && c.args && c.args.milestone === msKey && isOpen(c)).sort((x, y) => x.id - y.id)[0];
      }
      if (open) throw err("PT409", "pending", "A change of that shoot is already waiting for the DCR server.", { id: open.id });
      let u = null;
      if (a.p_kind === "undo") {
        u = undoCheck(plan.id, clean.change, admin, w.uid);
        if (u.code === "no_original") throw err("PT404", "no_original", "That change is not in this plan.", { table: "photo_changes", id: clean.change });
        if (u.code === "forbidden") throw err("42501", "forbidden", "Only the person who made a change, or an admin, can undo it.");
        if (u.code === "not_undoable") throw err("22023", "not_undoable", "That change cannot be undone any more.");
        if (u.code === "past") throw err("22023", "past", "A shoot would go back to a day that has passed.");
        if (u.code === "changed") throw err("PT409", "changed", "The schedule changed since - look again.", u.detail);
        if (u.code === "firm") throw err("42501", "firm", "That job date is Firm - only an admin can set it back.", u.detail);
      }
      if (pv.refused) {
        const words = { past: "That day has passed.", too_far: "That day is too far away.", no_change: "It is already on that day.",
          not_open: "That shoot is done, skipped or missed.", undated: "That shoot has no date to move from yet.",
          not_anchored: "That shoot has a day of its own - it follows no job date.", bad_milestone: "That is not one of the job dates.",
          unknown_shoot: "That shoot is not in the plan." };
        throw err("22023", pv.refused, words[pv.refused] || "The shoot schedule cannot make that change.");
      }
      if (JSON.stringify(pv).length > 20000) throw err("PT413", "too_big", "That change moves too many shoots at once.");
      const shootExpect = shoot ? { key: shoot.key, local_id: shoot.local_id, planned_date: shoot.planned_date, status: shoot.status } : null;
      let expect;
      if (["move_one", "move_later", "done"].indexOf(a.p_kind) !== -1) expect = { shoot: shootExpect };
      else if (a.p_kind === "milestone") {
        const m = plan.milestones[msKey] || {};
        expect = Object.assign({ milestone: { key: msKey, date: jday(m.date), firm: m.firm === true } }, shoot ? { shoot: shootExpect } : {});
      } else {
        expect = { undo: Object.assign({ change: clean.change, moved: (u.moved || []).map((m) => ({ key: m.key, local_id: m.local_id, to: m.to })) },
          u.milestone ? { milestone: { key: u.milestone.key, date: u.milestone.date, source: u.milestone.source, confirmed: u.milestone.confirmed } } : {}) };
      }
      const r = add(w, "photo_changes", Object.assign(clone(COLS.photo_changes), {
        id: nextId("photo_changes"), plan_id: plan.id, ledger_id: plan.ledger_id, plan_local_id: plan.local_id, kind: a.p_kind, args,
        target_key: shoot ? shoot.key : null, target_local_id: shoot ? shoot.local_id : null, base_rev: base, expect, preview: pv,
        needs_office: (a.p_kind === "milestone" || a.p_kind === "undo") && pv.needs_office === true, client_key: key, status: "new",
        requested_by: w.uid, requested_at: nowIso(), requester_admin: admin, requester_photographer: isPhotographer(w),
        requester_is_plan_photographer: plan.photographer_profile_id === w.uid, undo_of: a.p_kind === "undo" ? clean.change : null }));
      soon(1100);
      return answer(r, false);
    }

    function cancel(w, a) {
      if (!w.active) throw err("42501", "forbidden", "Sign in with an active account first.");
      const r = rows.photo_changes.find((c) => c.id === Number(a.p_id) && (c.requested_by === w.uid || canPhoto(w)));
      if (!r) throw err("PT404", "no_request", "There is no such change.", { table: "photo_changes", id: a.p_id });
      if (!(w.admin || (r.requested_by === w.uid && canPhoto(w)))) throw err("42501", "forbidden", "Only the person who asked, or an admin, can cancel a change.");
      const st = state(r);
      if (st !== "new") return { ok: false, status: st };
      write(w, "photo_changes", r, { status: "cancelled", done_at: nowIso(), error: { code: "cancelled", message: "Cancelled before the DCR server took it." } });
      return { ok: true, status: "cancelled" };
    }

    /* ── the demo's DCR server ── */
    // in a browser only (a test with a stand-in window drives pc itself); a timer never keeps a Node process open
    const browser = () => typeof window !== "undefined" && typeof document !== "undefined" && typeof setTimeout === "function";
    const loose = (t) => { if (t && typeof t.unref === "function") t.unref(); return t; };
    let timer = null;
    function soon(ms) {
      if (!browser() || !dev.auto || timer) return;
      timer = loose(setTimeout(() => {
        timer = null;
        let did = null;
        try { did = pc.step(); } catch (e) { console.error("demo photo PC:", e); }
        if (did) soon(900 + Math.floor(Math.random() * 600));
      }, ms || 1000));
    }
    const nextRev = () => rows.photo_plans.reduce((m, p) => Math.max(m, Number(p.rev) || 0), 100) + 1;
    function remirror(plan, patches, planPatch) {
      // the PC's ledger written (the patches), then mirrored again with a new rev (§9.3: a shoot's rev moves with its dates)
      const rev = nextRev();
      for (const [s, patch] of patches) {
        const cur = rows.photo_shoots.find((x) => x.id === s.id);
        if (!cur) continue;
        const next = Object.assign(clone(cur), patch);
        write(W(), "photo_shoots", cur, Object.assign(patch, { rev: revKeys.some((k) => !jsonEq(cur[k], next[k])) ? rev : cur.rev }));
      }
      const p = planOf(plan.id);
      const pp = Object.assign({ rev, mirrored_at: nowIso(), host: HOST }, planPatch || {});
      if (pp.milestones && !jsonEq(pp.milestones, p.milestones)) pp.milestones_rev = rev;
      write(W(), "photo_plans", p, pp);
      mirrorRow().last_at = nowIso();
      return rev;
    }
    function historyOf(s, entry) { return (Array.isArray(s.history) ? s.history : []).concat([entry]).slice(-10); }

    function applyChange(c) {
      const plan = planOf(c.plan_id);
      const fail = (code, message) => ({ error: { code, message } });
      if (!plan) return fail("gone", "That shoot or plan is no longer in the plan");
      if (["active", "paused"].indexOf(plan.status) === -1) return fail("not_active", "The plan is in review, done or archived");
      const who = whoOf(c.requested_by);
      if (!canPhoto(who)) return fail("forbidden", "The person who asked may not change the schedule any more");
      const admin = who.admin;
      const by = firstName(rosterName(c.requested_by)) || "Someone";
      const own = plan.photographer_profile_id === c.requested_by;
      const a = c.args || {};
      const exp = c.expect || {};
      const at = nowIso();
      if (exp.shoot) {
        const s = shootOf(plan.id, exp.shoot.key);
        if (!s) return fail("gone", "That shoot or plan is no longer in the plan");
        if (OPEN.indexOf(s.status) === -1) return fail("not_open", "That shoot is done, skipped or missed");
        if (s.planned_date !== exp.shoot.planned_date || s.status !== exp.shoot.status) return fail("changed", "The shoot changed meanwhile - look again");
      }
      if (exp.milestone && jday((plan.milestones[exp.milestone.key] || {}).date) !== exp.milestone.date) return fail("changed", "The shoot changed meanwhile - look again");
      if ((c.kind === "move_one" || c.kind === "move_later") && a.to < today()) return fail("past", "That day has passed");
      const movedOut = (list) => list.map((m) => { const s = shootOf(plan.id, m.key); return { key: m.key, local_id: s ? s.local_id : null, name: s ? s.name : m.key, from: m.from, to: m.to }; });
      const words = (n) => (n === 1 ? "1 shoot moved" : n + " shoots moved");
      const differs = (moved) => !jsonEq((c.preview && c.preview.moved || []).map((m) => [m.key, m.to]), moved.map((m) => [m.key, m.to]));

      if (c.kind === "move_one" || c.kind === "move_later") {
        const sh = shift(Object.assign(planInput(plan, admin), { change: { kind: c.kind, shoot: a.shoot, to: a.to } }));
        if (sh.refused) return fail(sh.refused, "The DCR server could not make that change");
        const target = shootOf(plan.id, a.shoot);
        const patches = sh.moved.map((m) => {
          const s = shootOf(plan.id, m.key);
          const ms = plan.milestones[s.anchor];
          const patch = { planned_date: m.to, pin_day: m.to,
            history: historyOf(s, { at, from: m.from, to: m.to, reason: m.key === a.shoot ? a.reason || null : "moved with " + target.name, source: "shoot page",
              manual: true, by, change: c.id }) };
          if (MS.indexOf(s.anchor) !== -1 && s.fixed_date === null) {
            if (ms && ms.date) patch.offset_days = diff(ms.date, m.to);
            else patch.fixed_date = m.to;
          } else if (s.fixed_date !== null || s.anchor === "fixed") patch.fixed_date = m.to;
          if (s.status === "announced" && own) patch.announced_for = m.to;
          return [s, patch];
        });
        const rev = remirror(plan, patches);
        const moved = movedOut(sh.moved);
        return { result: { outcome: "applied", moved, passed: [], added: [], cancelled: [], milestone_before: null, suggestion: null,
          differs_from_preview: differs(moved), words: words(moved.length), rev } };
      }
      if (c.kind === "milestone") {
        const key = a.milestone;
        const m = plan.milestones[key] || {};
        const before = { key, date: m.date || null, source: m.source || null, confirmed: m.confirmed === true };
        if (m.firm && !admin) {
          const rev = remirror(plan, [], { open_suggestions: (Number(plan.open_suggestions) || 0) + 1 });
          return { result: { outcome: "suggested", moved: [], passed: [], added: [], cancelled: [], milestone_before: before, suggestion: { local_id: 900 + c.id },
            differs_from_preview: false, words: "Sent to the office: " + MS_LABEL[key] + " is Firm", rev } };
        }
        const sh = shift(Object.assign(planInput(plan, admin), { change: { kind: "milestone", milestone: key, date: a.date } }));
        if (sh.refused) return fail(sh.refused, "The DCR server could not make that change");
        const after = { key, date: a.date, source: admin ? "admin" : "photographer", confirmed: admin ? a.firm === true : true };
        const patches = sh.moved.map((x) => {
          const s = shootOf(plan.id, x.key);
          const patch = { planned_date: x.to };
          if (s.status === "skipped" && s.auto_skipped) Object.assign(patch, { status: "planned", auto_skipped: false, done_source: null, done_note: null, done_at: null });
          if (s.status === "announced" && own) patch.announced_for = x.to;
          return [s, patch];
        }).concat(sh.passed.map((x) => [shootOf(plan.id, x.key), { status: "skipped", auto_skipped: true, done_source: "schedule", done_note: "phase already passed", done_at: at }]));
        const ms = clone(plan.milestones);
        ms[key] = { date: after.date, source: after.source, confirmed: after.confirmed, firm: after.source === "admin" && after.confirmed };
        const rev = remirror(plan, patches, { milestones: ms });
        const moved = movedOut(sh.moved);
        return { result: { outcome: "applied", moved, passed: movedOut(sh.passed), added: [], cancelled: [], milestone_before: before, milestone_after: after,
          suggestion: null, differs_from_preview: differs(moved), words: MS_LABEL[key] + " moved - " + words(moved.length), rev } };
      }
      if (c.kind === "done") {
        const s = shootOf(plan.id, a.shoot);
        const rev = remirror(plan, [[s, { status: "done", done_at: at, done_source: "shoot page", done_note: a.note || null }]]);
        return { result: { outcome: "applied", moved: [], passed: [], added: [], cancelled: [], milestone_before: null, suggestion: null,
          differs_from_preview: false, words: s.name + " marked done", rev } };
      }
      // undo
      const u = undoCheck(plan.id, a.change, admin, c.requested_by, c.id);    // (the undo being applied is not "an undo waiting")
      if (u.code) return fail(u.code === "no_original" ? "not_undoable" : u.code, "That change cannot be undone any more");
      const o = changeOf(a.change);
      if (u.milestone) {
        const b = u.milestone.before;
        const sh = shift(Object.assign(planInput(plan, admin), { change: { kind: "milestone", milestone: u.milestone.key, date: b.date } }));
        const ms = clone(plan.milestones);
        ms[u.milestone.key] = { date: b.date, source: b.source, confirmed: b.confirmed === true, firm: b.source === "admin" && b.confirmed === true };
        const rev = remirror(plan, sh.moved.map((x) => [shootOf(plan.id, x.key), { planned_date: x.to }]), { milestones: ms });
        return { result: { outcome: "applied", moved: movedOut(sh.moved), passed: [], added: [], cancelled: [],
          milestone_before: { key: u.milestone.key, date: u.milestone.date, source: u.milestone.source, confirmed: u.milestone.confirmed },
          milestone_after: { key: u.milestone.key, date: b.date, source: b.source, confirmed: b.confirmed === true },
          suggestion: null, differs_from_preview: false, words: "Undone", rev } };
      }
      const back = u.moved.map((m) => ({ key: m.key, from: m.to, to: m.from }));
      const why = "undo: " + String((o && o.args && o.args.reason) || "").trim();
      const rev = remirror(plan, back.map((m) => {
        const s = shootOf(plan.id, m.key);
        return [s, { planned_date: m.to, pin_day: m.to, history: historyOf(s, { at, from: m.from, to: m.to, reason: why.trim(), source: "shoot page", manual: true, by, change: c.id }) }];
      }));
      return { result: { outcome: "applied", moved: movedOut(back), passed: [], added: [], cancelled: [], milestone_before: null, suggestion: null,
        differs_from_preview: false, words: "Undone - " + words(back.length), rev } };
    }

    const pc = {
      /** one step: answer the change this PC took, else take the oldest waiting one -> {id, did} | null */
      step() {
        if (dev.offline || dev.paused || pcOff() || !mirrorRow().ledger_id) return null;
        E.beat();
        const mine = rows.photo_changes.filter((c) => c.status === "taken" && c.host === HOST).sort((x, y) => x.id - y.id)[0];
        if (mine) return pc.apply(mine.id);
        const next = rows.photo_changes.filter((c) => c.status === "new" && fresh(c) && planOf(c.plan_id) && planOf(c.plan_id).ledger_id === mirrorRow().ledger_id)
          .sort((x, y) => Date.parse(x.requested_at) - Date.parse(y.requested_at) || x.id - y.id)[0];
        if (!next) return null;
        takeChange(next.id, HOST, mirrorRow().ledger_id);
        return { id: next.id, did: "taken" };
      },
      /** take and answer every waiting change (node tests) -> how many were answered */
      run() {
        let n = 0;
        for (let i = 0; i < 200; i++) {
          const s = pc.step();
          if (!s) break;
          if (s.did !== "taken") n += 1;
        }
        return n;
      },
      apply(id) {
        const c = changeOf(id);
        if (!c || c.status !== "taken") return null;
        const out = applyChange(c);
        if (out.error) { errorChange(id, HOST, out.error); return { id, did: "refused", code: out.error.code }; }
        doneChange(id, HOST, out.result);
        return { id, did: out.result.outcome };
      },
      take(id) { return takeChange(id, HOST, mirrorRow().ledger_id); },
      refuse(id, code, message) {
        const c = changeOf(id);
        if (c && c.status === "new") takeChange(id, HOST, mirrorRow().ledger_id);
        return errorChange(id, HOST, { code, message: message || "" });
      },
      state(o) { if (o) Object.assign(dev, o); return Object.assign({}, dev); },
    };

    function checkArgs(name, args) {
      const keys = Object.keys(args || {});
      const want = SIGS[name];
      const opt = OPTIONAL[name] || [];
      if (keys.some((k) => want.indexOf(k) === -1) || want.some((k) => keys.indexOf(k) === -1 && opt.indexOf(k) === -1)) {
        throw new PgErr("PGRST202", "Could not find the function public." + name + "(" + keys.join(", ") + ") in the schema cache", 404);
      }
    }

    function rpc(w, name, a) {
      switch (name) {
        case "photo_my_access": {
          if (!w.active) throw err("42501", "forbidden", "Sign in with an active account first.");
          const t = teamRow(w.uid);
          return { admin: w.admin, photographer: isPhotographer(w), marketing: isMarketing(w), default_photographer: isPhotographer(w) && !!(t && t.default_photographer),
            can_edit: canPhoto(w), can_read: canPhotoRead(w) };
        }
        case "photo_pc_status": return pcStatus(w);
        case "set_photo_team": return setTeam(w, a);
        case "photo_change_preview": {
          if (!canPhoto(w)) throw err("42501", "forbidden", "Only an admin or a photographer can change the shoot schedule.");
          const plan = planOf(a.p_plan);
          if (!plan) throw err("PT404", "no_plan", "That plan is not on the shoot schedule.", { table: "photo_plans", id: a.p_plan });
          return preview(plan, a.p_kind, argsClean(a.p_kind, a.p_args, w.admin, PgErr), w.admin, w.uid);
        }
        case "photo_change_request": return request(w, a);
        case "photo_change_cancel": return cancel(w, a);
        case "agents_photo_team": {
          agentsOnly(w, true);
          const list = rows.photo_team.map((t) => {
            const p = profile(t.profile_id) || {};
            const n = rosterName(t.profile_id);
            return { profile_id: t.profile_id, name: n, first_name: firstName(n), on_roster: !!n, active: p.active !== false, photographer: t.photographer,
              marketing: t.marketing, default_photographer: t.default_photographer };
          }).sort((x, y) => (x.on_roster ? 0 : 1) - (y.on_roster ? 0 : 1) || cmpC(x.name.toLowerCase(), y.name.toLowerCase()) || cmpC(x.profile_id, y.profile_id));
          const d = list.find((x) => x.default_photographer);
          return { team: list, default_photographer: d ? { profile_id: d.profile_id, name: d.name } : null, generatedAt: nowIso() };
        }
        case "agents_photo_mirror": {
          agentsOnly(w);
          const host = leaseHolder(a.p_host);
          const led = ledger(a.p_ledger, true, host);
          beat();
          if (JSON.stringify(a.p_plan || "").length > 20000) throw refuse(413, "too_big", "That plan is too big to mirror.");
          if (!Array.isArray(a.p_shoots)) throw err("22023", "bad_shoot", "A value of a shoot cannot be mirrored.", { local_id: null, field: "shoots" });
          if (a.p_shoots.length > 400) throw refuse(413, "too_big", "A plan has at most 400 shoots.");
          if (a.p_rev === null || a.p_rev === undefined || Number(a.p_rev) < 1) throw refuse(400, "bad_rev", "rev must be a whole number of at least 1.");
          const p = isObj(a.p_plan) ? a.p_plan : null;
          if (!p || !(jint(p.local_id) >= 1)) throw err("22023", "bad_plan", "A value of the plan cannot be mirrored.", { local_id: null, field: p ? "local_id" : "plan" });
          if (["review", "active", "paused", "done", "archived"].indexOf(p.status) === -1) {
            throw err("22023", "bad_plan", "A value of the plan cannot be mirrored.", { local_id: p.local_id, field: "status" });
          }
          for (const s of a.p_shoots) {
            if (!isObj(s) || ["planned", "announced", "done", "skipped", "missed"].indexOf(s.status) === -1) {
              throw err("22023", "bad_shoot", "A value of a shoot cannot be mirrored.", { local_id: isObj(s) ? s.local_id : null, field: isObj(s) ? "status" : "shoot" });
            }
          }
          return Object.assign(mirrorWrite(p, a.p_shoots, Number(a.p_rev), host), { ledger: led });
        }
        case "agents_photo_mirror_drop": {
          agentsOnly(w);
          const host = leaseHolder(a.p_host);
          if (ledger(a.p_ledger, false, host) === "unclaimed") return { ok: true, dropped: false };
          beat();
          const p = rows.photo_plans.find((x) => x.ledger_id === a.p_ledger && x.local_id === Number(a.p_local_id));
          if (!p) return { ok: true, dropped: false };
          gone([p.id]);
          dropPlan(p);
          mirrorRow().last_at = nowIso();
          return { ok: true, dropped: true };
        }
        case "agents_photo_mirror_sync": {
          agentsOnly(w);
          const host = leaseHolder(a.p_host);
          if (!Array.isArray(a.p_keep)) throw refuse(400, "bad_request", "keep must list the plans to keep (an empty list drops them all).");
          const led = ledger(a.p_ledger, true, host);
          beat();
          const keep = a.p_keep.map(Number);
          const out = rows.photo_plans.filter((p) => p.ledger_id === a.p_ledger && keep.indexOf(p.local_id) === -1);
          gone(out.map((p) => p.id));
          out.forEach(dropPlan);
          mirrorRow().last_at = nowIso();
          return { ok: true, ledger: led, dropped: out.length, plans: rows.photo_plans.filter((p) => p.ledger_id === a.p_ledger).sort((x, y) => x.local_id - y.local_id)
            .map((p) => ({ local_id: p.local_id, id: p.id, rev: p.rev })) };
        }
        case "agents_photo_adopt": {
          agentsOnly(w);
          const host = leaseHolder(a.p_host);
          if (!a.p_ledger) throw refuse(400, "bad_request", "ledger must be this computer's ledger id.");
          const out = rows.photo_plans.filter((p) => p.ledger_id !== a.p_ledger);
          const n = gone(out.map((p) => p.id));
          out.forEach(dropPlan);
          Object.assign(mirror, { ledger_id: a.p_ledger, host, since: nowIso(), last_at: nowIso() });
          return { ok: true, dropped_plans: out.length, refused_changes: n };
        }
        case "agents_photo_changes_feed": {
          agentsOnly(w);
          const st = !mirrorRow().ledger_id ? "unclaimed" : mirrorRow().ledger_id === a.p_ledger ? "ok" : "foreign";
          const list = st === "foreign" ? [] : rows.photo_changes.filter((c) => {
            const p = planOf(c.plan_id);
            return p && p.ledger_id === a.p_ledger && ((c.status === "new" && fresh(c)) || (c.status === "taken" && Date.parse(c.taken_at) < nowMs() - 15 * 60000));
          }).sort((x, y) => Date.parse(x.requested_at) - Date.parse(y.requested_at) || x.id - y.id).slice(0, 50).map(item);
          return { feed: "photo_changes", ledger: st, changes: list, now: nowIso(), generatedAt: nowIso() };
        }
        case "agents_photo_change_take": { agentsOnly(w); return takeChange(Number(a.p_id), leaseHolder(a.p_host), a.p_ledger); }
        case "agents_photo_change_done": { agentsOnly(w); return doneChange(Number(a.p_id), a.p_host, a.p_result); }
        case "agents_photo_change_error": { agentsOnly(w); return errorChange(Number(a.p_id), a.p_host, a.p_error); }
        case "agents_photo_changes_purge": {
          agentsOnly(w);
          leaseHolder(a.p_host);
          let expired = 0, deleted = 0;
          for (const c of rows.photo_changes.slice()) {
            if (c.status === "new" && !fresh(c)) {
              write(W(), "photo_changes", c, { status: "expired", done_at: nowIso(), error: { code: "expired", message: "The DCR server did not take this change within 7 days." } });
              expired += 1;
            }
          }
          const old = rows.photo_changes.filter((c) => ["applied", "refused", "expired", "cancelled"].indexOf(c.status) !== -1 &&
            Date.parse(c.done_at || c.requested_at) < nowMs() - 60 * 86400000).slice(0, 200);
          for (const c of old) { commitDelete("photo_changes", c); deleted += 1; }
          return { ok: true, expired, deleted };
        }
        default: throw new PgErr("PGRST202", "Could not find the function public." + name, 404);
      }
    }

    if (browser() && typeof setInterval === "function") {
      // the demo's DCR server looks for waiting changes now and then (a change asked while it was "off")
      loose(setInterval(() => { if (rows.photo_changes.some((c) => c.status === "new" || c.status === "taken")) soon(300); }, 20000));
    }

    return {
      name: "p10-photo", tables: new Set(TABLES),
      canRead(w, table, r) {
        if (table === "photo_team") return !!(w.active && (w.admin || r.profile_id === w.uid || canPhotoRead(w)));
        if (table === "photo_plans" || table === "photo_shoots") return canPhotoRead(w);
        if (table === "photo_changes") return !!((w.active && (r.requested_by === w.uid || canPhoto(w))) || (w.agents && (r.status === "new" || r.status === "taken")));
        return false;
      },
      // nobody writes these tables directly here: the team through set_photo_team, the mirror and the queue through RPCs
      canInsert: () => false, canUpdate: () => false, canDelete: () => false,
      handles: (n) => Object.prototype.hasOwnProperty.call(SIGS, n), checkArgs, rpc,
      __dev: { pc, mirror: () => Object.assign({}, mirrorRow()), shift, ledger: LEDGER, host: HOST },
    };
  });

  /* ── made-up data: four plans of made-up jobs, their shoots, three changes, a team of two demo accounts ── */
  (NS.extSeed = NS.extSeed || []).push(function seedPhoto(out, h) {
    const P = h.P;
    if (!P || !P.field || !P.viewer || !P.admin) return;
    const T = h.today;
    const now = h.now instanceof Date ? h.now : new Date(h.now || Date.now());
    const day = (n) => addDays(T, n);
    const at = (daysAgo, hour) => {
      const t = new Date(Date.UTC(+T.slice(0, 4), +T.slice(5, 7) - 1, +T.slice(8, 10) - daysAgo, 16 + (hour || 0), 20, 0));
      return t.getTime() > now.getTime() ? new Date(now.getTime() - 60000 * (daysAgo + 5)).toISOString() : t.toISOString();
    };
    const agents = (out.profiles || []).find((p) => p.role === "agents");
    const AG = agents ? agents.id : null;
    const audit = (when, by) => ({ created_at: when, created_by: by || null, updated_at: when, updated_by: null, version: 1 });
    out.photo_team = [
      Object.assign({ profile_id: P.field, photographer: true, marketing: false, default_photographer: true, google_email: null }, audit(at(30), P.admin)),
      Object.assign({ profile_id: P.viewer, photographer: false, marketing: true, default_photographer: false, google_email: "taylor.viewer.demo@example.com" }, audit(at(30), P.admin)),
    ];
    out.photo_plans = [];
    out.photo_shoots = [];
    out.photo_changes = [];
    const DAYS = [0, 1, 2, 3, 4, 5];                 // Monday to Saturday
    let rev = 100, sid = 0;
    const ms = (d, src, conf) => ({ date: d, source: src, confirmed: conf, firm: !!d && conf && src === "admin" });
    function plan(local, f) {
      rev += 1;
      const row = Object.assign({}, COLS.photo_plans, { id: local, ledger_id: LEDGER, local_id: local, rev, milestones_rev: rev, project_id: null,
        photographer_name: "Jordan Field", photographer_profile_id: P.field, photographer_source: "team", shoot_days: DAYS.slice(), lead_days: 3,
        series: [{ key: "framing-progress", name: "Framing progress", phase: "framing_progress", anchor: "framing_start", every: 7 }], open_suggestions: 0,
        activated_at: at(20), mirrored_at: at(0), host: HOST }, f, audit(at(20), AG));
      out.photo_plans.push(row);
      return row;
    }
    function shoot(p, local, f) {
      const m = p.milestones[f.anchor];
      const planned = f.planned_date !== undefined ? f.planned_date : f.fixed_date ? f.fixed_date : m && m.date ? nextShootDay(addDays(m.date, f.offset_days || 0), p.shoot_days) : null;
      const row = Object.assign({}, COLS.photo_shoots, { id: ++sid, plan_id: p.id, local_id: local, seq: local * 100, offset_days: 0, window_days: 1, status: "planned",
        brief: {}, history: [], rev: p.rev }, f, { planned_date: planned }, audit(at(20), AG));
      out.photo_shoots.push(row);
      return row;
    }
    const brief = (purpose, shots) => ({ purpose, time_of_day: "Morning light", shots: shots.map((t) => ({ title: t, kind: "photo", priority: "must" })),
      tips: ["Shoot from the street first"], equipment: ["Wide lens"], safety: ["Hard hat on site"] });

    // A000T9: the live plan - Firm framing start, an estimate delivery, a progress series, a late shoot, one today
    const a = plan(1, { status: "active", project_code: "A000T9", project_label: "A000T9 Sample house", city: "Sandbox", title: "Sample house photo plan",
      milestones: { framing_start: ms(day(10), "admin", true), delivery: ms(day(7), "estimate", false), framing_complete: ms(day(40), "estimate", false),
        house_complete: ms(null, "estimate", false) } });
    shoot(a, 1, { key: "site-walk", phase: "special", name: "Site walk", anchor: "delivery", offset_days: -10, planned_date: day(-3), status: "done",
      done_at: at(3), done_source: "shoot page", done_note: "Walked the lot with the crew", window_days: 0 });
    shoot(a, 2, { key: "permit-board", phase: "special", name: "Permit board photo", anchor: "fixed", fixed_date: day(-4), window_days: 1 });
    shoot(a, 3, { key: "lot-before", phase: "before_framing", name: "Lot before work", anchor: "fixed", fixed_date: day(0), status: "announced",
      announced_for: day(0), task_id: 9101, brief: brief("The empty lot before any work", ["Street view", "Corner to corner"]) });
    shoot(a, 4, { key: "delivery", phase: "delivery", name: "Delivery day", anchor: "delivery", status: "announced", task_id: 9102, window_days: 0 });
    shoot(a, 5, { key: "before-framing", phase: "before_framing", name: "Before framing", anchor: "framing_start", offset_days: -2 });
    shoot(a, 6, { key: "progress-1", phase: "framing_progress", name: "Framing progress #1", anchor: "framing_start", offset_days: 7, window_days: 2,
      series: "framing-progress", n: 1 });
    shoot(a, 7, { key: "progress-2", phase: "framing_progress", name: "Framing progress #2", anchor: "framing_start", offset_days: 14, window_days: 2,
      series: "framing-progress", n: 2 });
    shoot(a, 8, { key: "progress-3", phase: "framing_progress", name: "Framing progress #3", anchor: "framing_start", offset_days: 21, window_days: 2,
      series: "framing-progress", n: 3 });
    shoot(a, 9, { key: "framing-complete", phase: "framing_complete", name: "Framing complete", anchor: "framing_complete", offset_days: 1, window_days: 2 });
    shoot(a, 10, { key: "house-complete", phase: "house_complete", name: "House complete", anchor: "house_complete", offset_days: 3, window_days: 5 });
    shoot(a, 11, { key: "drone-check", phase: "special", name: "Drone airspace check", anchor: "fixed", fixed_date: day(12), window_days: 0 });
    // the delivery's heads-up went out for the day before it moved: "Moved - not told yet"
    const dl = out.photo_shoots.find((s) => s.plan_id === a.id && s.key === "delivery");
    dl.announced_for = addDays(dl.planned_date, -1);

    // A000T8: a plan in the middle of framing - every job date Firm but house complete; its history of changes
    const b = plan(2, { status: "active", project_code: "A000T8", project_label: "A000T8 Made-up garage", city: "Cedar Flats", title: "Garage photo plan",
      photographer_source: "plan", open_suggestions: 1,
      milestones: { framing_start: ms(day(-20), "admin", true), delivery: ms(day(-22), "admin", true), framing_complete: ms(day(5), "admin", true),
        house_complete: ms(day(60), "estimate", false) } });
    shoot(b, 1, { key: "delivery", phase: "delivery", name: "Delivery day", anchor: "delivery", status: "done", done_at: at(22), done_source: "my tasks", window_days: 0 });
    shoot(b, 2, { key: "progress-1", phase: "framing_progress", name: "Framing progress #1", anchor: "framing_start", offset_days: 7, status: "done",
      done_at: at(13), done_source: "shoot page", series: "framing-progress", n: 1, window_days: 2 });
    shoot(b, 3, { key: "progress-2", phase: "framing_progress", name: "Framing progress #2", anchor: "framing_start", offset_days: 14, status: "skipped",
      auto_skipped: true, done_source: "schedule", done_note: "phase already passed", series: "framing-progress", n: 2, window_days: 2 });
    shoot(b, 4, { key: "progress-3", phase: "framing_progress", name: "Framing progress #3", anchor: "framing_start", offset_days: 21, status: "missed",
      series: "framing-progress", n: 3, window_days: 2 });
    const fc = shoot(b, 5, { key: "framing-complete", phase: "framing_complete", name: "Framing complete", anchor: "framing_complete", offset_days: 2, window_days: 2 });
    shoot(b, 6, { key: "house-complete", phase: "house_complete", name: "House complete", anchor: "house_complete", offset_days: 3, window_days: 5 });
    // change 1: Jordan moved framing complete's shoot by a day two days ago (applied: undoable for five more days)
    const from = addDays(fc.planned_date, -1);
    fc.pin_day = fc.planned_date;
    fc.history = [{ at: at(2, 1), from, to: fc.planned_date, reason: "Crew asked for a day more", source: "shoot page", manual: true, by: "Jordan", change: 1 }];
    const chg = (id, f) => out.photo_changes.push(Object.assign({}, COLS.photo_changes, { id, plan_id: b.id, ledger_id: LEDGER, plan_local_id: b.local_id,
      client_key: "seed-change-" + id, requested_by: P.field, requester_admin: false, requester_photographer: true, requester_is_plan_photographer: true,
      host: HOST }, f, audit(f.requested_at, P.field)));
    chg(1, { kind: "move_one", args: { shoot: "framing-complete", to: fc.planned_date, reason: "Crew asked for a day more" }, target_key: "framing-complete",
      target_local_id: 5, base_rev: b.rev, expect: { shoot: { key: "framing-complete", local_id: 5, planned_date: from, status: "planned" } },
      preview: { plan_id: b.id, rev: b.rev, today: day(-2), kind: "move_one", args: { shoot: "framing-complete", to: fc.planned_date },
        moved: [{ key: "framing-complete", id: fc.id, name: "Framing complete", from, to: fc.planned_date, notes: [] }], stays: [], passed: [], replan: [],
        needs_office: false, refused: null },
      status: "applied", requested_at: at(2), taken_at: at(2, 1), done_at: at(2, 1),
      result: { outcome: "applied", moved: [{ key: "framing-complete", local_id: 5, name: "Framing complete", from, to: fc.planned_date }], passed: [], added: [],
        cancelled: [], milestone_before: null, suggestion: null, differs_from_preview: false, words: "1 shoot moved", rev: b.rev } });
    // change 2: a move the DCR server refused (the shoot had moved meanwhile)
    chg(2, { kind: "move_one", args: { shoot: "house-complete", to: day(58) }, target_key: "house-complete", target_local_id: 6, base_rev: b.rev,
      expect: { shoot: { key: "house-complete", local_id: 6, planned_date: day(60), status: "planned" } }, preview: { plan_id: b.id, rev: b.rev, today: day(-1),
        kind: "move_one", args: { shoot: "house-complete", to: day(58) }, moved: [], stays: [], passed: [], replan: [], needs_office: false, refused: null },
      status: "refused", requested_at: at(1), taken_at: at(1, 1), done_at: at(1, 1), error: { code: "changed", message: "The shoot changed meanwhile - look again" } });
    // change 3: Jordan said framing complete slips three days - it is Firm, so it went to the office
    chg(3, { kind: "milestone", args: { milestone: "framing_complete", date: day(8), reason: "Lumber came late" }, target_key: null, base_rev: b.rev,
      expect: { milestone: { key: "framing_complete", date: day(5), firm: true } }, needs_office: true,
      preview: { plan_id: b.id, rev: b.rev, today: day(-1), kind: "milestone", args: { milestone: "framing_complete", date: day(8) }, moved: [], stays: [], passed: [],
        replan: ["framing-progress"], needs_office: true, refused: null },
      status: "applied", requested_at: at(1, 2), taken_at: at(1, 3), done_at: at(1, 3),
      result: { outcome: "suggested", moved: [], passed: [], added: [], cancelled: [], milestone_before: { key: "framing_complete", date: day(5), source: "admin", confirmed: true },
        suggestion: { local_id: 903 }, differs_from_preview: false, words: "Sent to the office: Framing complete is Firm", rev: b.rev } });

    // A000T7: an archived plan (hidden unless asked); A000T6: a plan still in review (no change is taken for it)
    const c = plan(3, { status: "archived", project_code: "A000T7", project_label: "A000T7 Old sample deck", city: "Oak Vista", title: "Deck photo plan",
      milestones: { framing_start: ms(day(-90), "admin", true), delivery: ms(day(-92), "admin", true), framing_complete: ms(day(-60), "admin", true),
        house_complete: ms(day(-30), "admin", true) } });
    shoot(c, 1, { key: "house-complete", phase: "house_complete", name: "House complete", anchor: "house_complete", offset_days: 0, status: "done", done_at: at(30) });
    const d = plan(4, { status: "review", project_code: "A000T6", project_label: "A000T6 Sample porch", city: "Sage Valley", title: "Porch photo plan",
      photographer_name: "", photographer_profile_id: null, photographer_source: "none", series: [],
      milestones: { framing_start: ms(day(21), "estimate", false), delivery: ms(day(19), "estimate", false), framing_complete: ms(day(30), "estimate", false),
        house_complete: ms(null, "estimate", false) } });
    shoot(d, 1, { key: "delivery", phase: "delivery", name: "Delivery day", anchor: "delivery", window_days: 0 });
    shoot(d, 2, { key: "framing-complete", phase: "framing_complete", name: "Framing complete", anchor: "framing_complete", offset_days: 1 });
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
