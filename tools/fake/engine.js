/* DCR Portal 2 — DEMO MODE ONLY: an in-memory imitation of the DCR Desktop 2 database.

   Never published: tools/ is not part of the site, and tools/devserve.mjs injects it into pages only
   on 127.0.0.1. It answers the supabase-js calls the Portal 2 modules make (fake-supabase.js turns
   them into calls here) with PostgREST's semantics as far as the pages can tell:
   - select with columns, aliases and embeds ("*, prices:project_prices(*)", "projects(number,name)",
     hints "files!thumbnail_file_id(*)", "!inner"), filters (eq neq gt gte lt lte like ilike is in
     cs cd ov not or match), order (nulls last ascending, first descending), range / limit,
     single / maybeSingle, count "exact"; ambiguous embeds fail with PGRST201 as the real one does;
   - insert / update / upsert / delete with row level security in the spirit of Desktop 2 + M1:
     an UPDATE the policy does not let through matches nothing ([]), an INSERT it refuses is 42501,
     soft-delete tables are never really deleted, versions move by one on every update;
   - the triggers the pages notice: project numbers, folder names, the prices row, activity lines
     ("Project A306 created", "Status: New Request → In Progress", "Journal entry: …",
     "Files uploaded to <folder>" once per person, folder and hour), file version chains, tombstones;
   - the RPCs: create_project, search, soft_delete, set_project_location, password_changed,
     next_project_number;
   - phase 2 (M2, BLUEPRINT 3.3.5 / 3.3.6): employees (phone_e164 by trigger, one active name),
     crew_members, timesheets under the crew scope (admin and manager all; the accountant reads all,
     writes own; a lead self and crew; field self; a viewer reads own; WITH CHECK on the new
     employee), timesheet_confirmations (no direct access) and the RPCs my_roster,
     update_my_contact, confirm_timesheet_week (md5 fingerprint, PT409), unconfirm_timesheet_week,
     timesheet_weeks;
   - phase 3 (M3, BLUEPRINT 3.3.7): tasks (sub_category, due_time, the import's legacy_sp_id and
     author_name, the agents' agent_kind / agent_ref / agent_date — set by no person), task_notes (via,
     on_behalf_of, source_key, author_name — a person writes desktop or portal only), the Q3 read scope,
     the M1 handover tombstone (deletions.for_user), notifications_outbox (a new assignment for someone
     else: the Access wording and the Portal 2 link; admin reads, nobody writes) and the RPCs my_tasks
     (mine | crew | everyone with the project, the notes and app.task_clock), my_tasks_summary,
     add_task_note (one line, 2,000 characters, "already complete", the client key once) and
     complete_task (status and closing note together, versioned, done already is done);
   - phase 4 (M4, BLUEPRINT 2.3.5): agents_server_status — an admin's only (42501 for anyone else) — from the
     DCR Agents 2 PC's last heartbeat the seed made up (data.agents_server), with the database's rules
     (online within 3 minutes, 12 for an older build; the lease holder is the server);
   - Storage: simple uploads, TUS resumable uploads (6 MiB chunks), signed URLs, with the
     project-files rules (p/{project}/{folder}/{uuid}/{name}, no overwrite, who may read).
   Works in Node (the tests) and in the browser (fake-supabase.js). Nothing here touches a network. */
(function (root) {
  "use strict";
  const NS = (root.DCR2Fake = root.DCR2Fake || {});

  const STATUSES = ["new_request", "estimating", "sent", "approved", "in_progress", "on_hold", "completed", "closed", "follow_up"];
  const JOURNAL_CATS = ["progress", "delay", "issue", "safety", "inspection", "delivery", "visitor", "weather", "change_order", "other"];
  const FOLDERS = ["plans", "photos", "documents", "estimates", "invoices", "receipts", "item", "journal", "thumbnail"];
  const ROLES = ["admin", "manager", "lead", "accountant", "field", "viewer", "agents"];
  const SOFT = new Set(["contacts", "projects", "journal_entries", "files"]);
  const TABLES = ["profiles", "settings", "settings_prices", "contacts", "projects", "project_prices", "activity",
    "journal_entries", "files", "tasks", "task_notes", "deletions",
    "employees", "crew_members", "timesheets", "timesheet_confirmations", "notifications_outbox", "push_subscriptions"];
  const TS_KINDS = ["work", "holiday", "vacation", "sick", "day_off"];
  const TS_SOURCES = ["portal", "desktop", "agents_sms", "agents_email", "agents_whatsapp", "agents_app", "import"];
  const NO_DIRECT = new Set(["timesheet_confirmations"]);     // RLS on, no policies: RPCs only
  const NOTE_VIA = ["desktop", "portal", "email", "sms", "whatsapp", "assistant", "agent", "import"];
  const PEOPLE_VIA = ["desktop", "portal"];                    // M3: only the agents role files a channel's words
  const TASK_DAYS = 5;                                         // app.task_clock: needs an update after MORE than 5 days
  const VIEWS = { current_files: "files" };
  const PK = { project_prices: "project_id" };
  const UUID_PK = new Set(["profiles"]);
  const NO_AUDIT = new Set(["deletions", "notifications_outbox"]);
  const LOCAL_CITIES = ["Pine Hollow", "Cedar Flats", "Oak Vista", "Sage Valley", "Sandbox"];
  const TZ = "America/Los_Angeles";
  const CHUNK = 6 * 1024 * 1024;
  const BUCKET = "project-files";

  const AUDIT = { created_at: null, created_by: null, updated_at: null, updated_by: null, version: 1 };
  const COLS = {
    profiles: Object.assign({ id: null, full_name: "", email: null, phone: null, role: "viewer", can_see_prices: false,
      can_see_financials: false, can_approve_payments: false, active: true, color: null, must_change_password: false }, AUDIT),
    settings: Object.assign({ id: 1, company_name: "DCR Framing LLC", address: null, phone: null, email: null, license: null,
      tax_rate: 8, next_project_number: 291, invoice_terms: null, agents_checks_enabled: false, task_email_enabled: false }, AUDIT),
    settings_prices: Object.assign({ id: 1, default_labor_rate: 110, local_labor_rate: 90, out_of_area_labor_rate: 110 }, AUDIT),
    contacts: Object.assign({ id: null, name: null, company: null, kind: "client", trade: null, phone: null, email: null,
      address: null, city: null, notes: null, deleted_at: null }, AUDIT),
    projects: Object.assign({ id: null, number: null, name: null, address: null, city: null, state: "CA", zip: null,
      client_contact_id: null, client_name: null, client_phone: null, client_email: null, status: "new_request",
      status_note: null, scope: null, tags: [], plans_url: null, start_date: null, completed_date: null, lat: null, lng: null,
      location_source: null, thumbnail_file_id: null, folder_name: null, legacy_sp_id: null, deleted_at: null }, AUDIT),
    project_prices: Object.assign({ project_id: null, labor_rate: null, rate_source: null }, AUDIT),
    activity: Object.assign({ id: null, project_id: null, kind: "note", text: null, from_status: null, to_status: null,
      author_name: null, legacy_sp_id: null }, AUDIT),
    journal_entries: Object.assign({ id: null, project_id: null, entry_date: null, category: "progress", title: "", body: null,
      weather: null, crew_size: null, hours: null, follow_up: false, deleted_at: null }, AUDIT),
    files: Object.assign({ id: null, project_id: null, estimate_item_id: null, journal_entry_id: null, bill_id: null, folder: null,
      subpath: "", name: null, storage_path: null, size: null, mime: null, version_no: 1, previous_id: null, is_financial: false,
      storage: "cloud", rel_path: null, modified_at: null, description: null, preview_path: null, source: null, deleted_at: null }, AUDIT),
    tasks: Object.assign({ id: null, project_id: null, estimate_item_id: null, title: null, description: null, category: null,
      sub_category: null, priority: "normal", assigned_to: null, due_date: null, due_time: null, status: "open", completed_at: null,
      completed_by: null, legacy_sp_id: null, author_name: null, agent_kind: null, agent_ref: null, agent_date: null }, AUDIT),
    task_notes: Object.assign({ id: null, task_id: null, text: null, via: "desktop", on_behalf_of: null, source_key: null, author_name: null }, AUDIT),
    deletions: { id: null, table_name: null, row_id: null, project_id: null, deleted_at: null, deleted_by: null, for_user: null },
    notifications_outbox: { id: null, kind: "task_new", task_id: null, to_profile_id: null, to_email: null, subject: null, body: null,
      created_at: null, claimed_at: null, sent_at: null, attempts: 0, error: null, sent_by: null, push_sent_at: null, push_result: null,
      email_wanted: false },
    employees: Object.assign({ id: null, profile_id: null, contact_id: null, full_name: null, employee_no: null, phone: null,
      phone_e164: null, email: null, address: null, normal_start1: null, normal_end1: null, normal_start2: null, normal_end2: null,
      normal_lunch_hours: 1, active: true, notes: null, legacy_sp_id: null }, AUDIT),
    crew_members: Object.assign({ id: null, lead_profile_id: null, employee_id: null }, AUDIT),
    timesheets: Object.assign({ id: null, employee_id: null, work_date: null, kind: "work", project_id: null, legacy_project_text: null,
      hours: null, work_completed: null, start1: null, end1: null, start2: null, end2: null, lunch_hours: null, calculated_hours: null,
      notes: null, source: "portal", source_key: null, legacy_sp_id: null }, AUDIT),
    timesheet_confirmations: Object.assign({ id: null, employee_id: null, week_start: null, confirmed_by: null, confirmed_at: null,
      hours_at_confirm: null, fingerprint: null }, AUDIT),
    // M3 (BLUEPRINT 3.3.8): one browser's push subscription, own rows only; read by the push function
    push_subscriptions: Object.assign({ id: null, profile_id: null, endpoint: null, p256dh: null, auth: null, device: null, last_ok_at: null }, AUDIT),
  };
  COLS.current_files = COLS.files;

  const FKS = [
    ["projects", "client_contact_id", "contacts"],
    ["projects", "thumbnail_file_id", "files"],
    ["project_prices", "project_id", "projects", true],
    ["activity", "project_id", "projects"],
    ["journal_entries", "project_id", "projects"],
    ["files", "project_id", "projects"],
    ["files", "journal_entry_id", "journal_entries"],
    ["files", "previous_id", "files"],
    ["current_files", "project_id", "projects"],
    ["current_files", "journal_entry_id", "journal_entries"],
    ["tasks", "project_id", "projects"],
    ["tasks", "assigned_to", "profiles"],
    ["tasks", "completed_by", "profiles"],
    ["task_notes", "task_id", "tasks"],
    ["notifications_outbox", "task_id", "tasks"],
    ["employees", "profile_id", "profiles", true],
    ["employees", "contact_id", "contacts"],
    ["crew_members", "lead_profile_id", "profiles"],
    ["crew_members", "employee_id", "employees"],
    ["timesheets", "employee_id", "employees"],
    ["timesheets", "project_id", "projects"],
    ["timesheet_confirmations", "employee_id", "employees"],
  ].map(([table, column, ref, one]) => ({ table, column, ref, one: !!one }));

  /* ── errors ─────────────────────────────────────────────────────────── */
  const STATUS_OF = { "42501": 403, PT404: 404, PT409: 409, "23505": 409, PGRST116: 406, PGRST202: 404, PGRST201: 300,
    PGRST200: 400, PGRST204: 400, PGRST100: 400, "42703": 400, "42P01": 404 };
  class PgErr extends Error {
    constructor(code, message, status, details, hint) {
      super(message);
      this.code = code;
      this.status = status || STATUS_OF[code] || 400;
      this.details = details === undefined ? null : details;
      this.hint = hint === undefined ? null : hint;
    }
    toJSON() { return { code: this.code, message: this.message, details: this.details, hint: this.hint }; }
  }
  const deny = (msg) => new PgErr("42501", msg || "permission denied", 403);
  const rule = (code, msg) => new PgErr(code, msg, 400);

  /* ── time ───────────────────────────────────────────────────────────── */
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  function companyDay(d) { return dayFmt.format(d instanceof Date ? d : new Date(d)); }

  /* ── small helpers ──────────────────────────────────────────────────── */
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const pkOf = (t) => PK[t] || "id";
  const statusLabel = (s) => String(s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  function numberParts(n) {
    const m = /^([A-Z])([0-9]+)(.*)$/.exec(String(n || ""));
    return m ? { letter: m[1], value: Number(m[2]), suffix: m[3] || "" } : { letter: "~", value: 0, suffix: String(n || "") };
  }
  /** app.project_number_sort: natural order (A999 before A1000, A024-B right after A024). */
  function numberCmp(a, b) {
    const x = numberParts(a), y = numberParts(b);
    if (x.letter !== y.letter) return x.letter < y.letter ? -1 : 1;
    if (x.value !== y.value) return x.value - y.value;
    if (x.suffix === y.suffix) return 0;
    if (!x.suffix) return -1;
    if (!y.suffix) return 1;
    return x.suffix < y.suffix ? -1 : 1;
  }

  /* md5 (RFC 1321) of a string's UTF-8 bytes: the week fingerprint of the sign-off (M2) */
  const MD5S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  const MD5K = Array.from({ length: 64 }, (_, i) => (Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296)) | 0);
  function md5(str) {
    const bytes = Array.from(new TextEncoder().encode(String(str)));
    const n = bytes.length;
    const w = new Array((((n + 8) >>> 6) << 4) + 16).fill(0);
    for (let i = 0; i < n; i++) w[i >> 2] |= bytes[i] << ((i % 4) * 8);
    w[n >> 2] |= 0x80 << ((n % 4) * 8);
    w[w.length - 2] = (n * 8) >>> 0;
    w[w.length - 1] = Math.floor(n / 0x20000000) >>> 0;
    let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
    for (let i = 0; i < w.length; i += 16) {
      const aa = a, bb = b, cc = c, dd = d;
      for (let j = 0; j < 64; j++) {
        let f, g;
        if (j < 16) { f = (b & c) | (~b & d); g = j; }
        else if (j < 32) { f = (d & b) | (~d & c); g = (5 * j + 1) % 16; }
        else if (j < 48) { f = b ^ c ^ d; g = (3 * j + 5) % 16; }
        else { f = c ^ (b | ~d); g = (7 * j) % 16; }
        const t = d; d = c; c = b;
        const x = (a + f + MD5K[j] + w[i + g]) | 0;
        b = (b + ((x << MD5S[j]) | (x >>> (32 - MD5S[j])))) | 0;
        a = t;
      }
      a = (a + aa) | 0; b = (b + bb) | 0; c = (c + cc) | 0; d = (d + dd) | 0;
    }
    return [a, b, c, d].map((v) => [0, 1, 2, 3].map((k) => ((v >>> (k * 8)) & 0xff).toString(16).padStart(2, "0")).join("")).join("");
  }
  /** the week fingerprint (app.timesheet_week_state): md5 over the rows ordered by id of
      "id|YYYY-MM-DD|hours (2 decimals)|project id, or the kind without one", joined by a line feed,
      then "-<count>" */
  function tsFingerprint(list) {
    const rows = list.slice().sort((x, y) => x.id - y.id);
    return md5(rows.map((r) => r.id + "|" + r.work_date + "|" + Number(r.hours || 0).toFixed(2) + "|" +
      (r.project_id == null ? r.kind || "work" : r.project_id)).join("\n")) + "-" + rows.length;
  }
  function addDaysYmd(t, n) {
    const [y, m, d] = String(t).split("-").map(Number);
    const x = new Date(Date.UTC(y, m - 1, d + n));
    return x.getUTCFullYear() + "-" + String(x.getUTCMonth() + 1).padStart(2, "0") + "-" + String(x.getUTCDate()).padStart(2, "0");
  }
  function saturdayOfYmd(t) {
    const [y, m, d] = String(t).split("-").map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return addDaysYmd(t, -(dow === 6 ? 0 : dow + 1));
  }
  /** phone_e164 (M2 trigger): US numbers; the first number that parses when several were typed */
  function e164(phone) {
    for (const part of String(phone || "").split(/[\/,;|]|\bor\b|\band\b/i)) {
      let dg = part.replace(/[^0-9]/g, "");
      if (dg.length === 11 && dg[0] === "1") dg = dg.slice(1);
      if (dg.length === 10 && /^[2-9]/.test(dg)) return "+1" + dg;
    }
    return null;
  }
  const TIME_OK = /^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/;

  function folderName(p) {
    const parts = [p.number, p.address, p.city, p.name].map((s) => String(s || "").replace(/[\u0000-\u001f\\/<>:"|?*]/g, "").trim()).filter(Boolean);
    return parts.join(" - ").slice(0, 120).replace(/[ .]+$/, "");
  }

  /* ── values and comparisons (PostgREST reads every filter value as text) ── */
  const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
  function coerce(rowVal, v) {
    if (v === null || v === undefined) return v;
    if (typeof rowVal === "number" && typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
    if (typeof rowVal === "boolean" && typeof v === "string") return v === "true" ? true : v === "false" ? false : v;
    return v;
  }
  function cmp(a, b) {
    if (a === b) return 0;
    if (typeof a === "string" && typeof b === "string" && ISO_TS.test(a) && ISO_TS.test(b)) {
      const x = Date.parse(a), y = Date.parse(b);
      if (!isNaN(x) && !isNaN(y)) return x < y ? -1 : x > y ? 1 : 0;
    }
    if (typeof a === "number" && typeof b === "number") return a < b ? -1 : a > b ? 1 : 0;
    const x = String(a), y = String(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  /* LIKE: % (or * in a URL) any run, _ one character, \x the character x itself */
  function likeRe(pat, ci) {
    let src = "";
    const s = String(pat);
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === "\\" && i + 1 < s.length) { src += s[++i].replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"); continue; }
      if (ch === "%" || ch === "*") src += ".*";
      else if (ch === "_") src += ".";
      else src += ch.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    }
    return new RegExp("^" + src + "$", ci ? "is" : "s");
  }
  function asList(v) {
    if (Array.isArray(v)) return v;
    const s = String(v).trim().replace(/^\(|\)$/g, "").replace(/^\{|\}$/g, "");
    return s ? s.split(",").map((x) => x.trim().replace(/^"|"$/g, "")) : [];
  }
  function test(op, val, arg) {
    switch (op) {
      case "eq": return val !== null && val !== undefined && cmp(val, coerce(val, arg)) === 0;
      case "neq": return val !== null && val !== undefined && cmp(val, coerce(val, arg)) !== 0;
      case "gt": return val !== null && val !== undefined && cmp(val, coerce(val, arg)) > 0;
      case "gte": return val !== null && val !== undefined && cmp(val, coerce(val, arg)) >= 0;
      case "lt": return val !== null && val !== undefined && cmp(val, coerce(val, arg)) < 0;
      case "lte": return val !== null && val !== undefined && cmp(val, coerce(val, arg)) <= 0;
      case "like": return val !== null && val !== undefined && likeRe(arg, false).test(String(val));
      case "ilike": return val !== null && val !== undefined && likeRe(arg, true).test(String(val));
      case "is": {
        const a = String(arg).toLowerCase();
        if (a === "null") return val === null || val === undefined;
        if (a === "true") return val === true;
        if (a === "false") return val === false;
        return false;
      }
      case "in": return val !== null && val !== undefined && asList(arg).some((x) => cmp(val, coerce(val, x)) === 0);
      case "cs": { const have = Array.isArray(val) ? val : []; return asList(arg).every((x) => have.map(String).includes(String(x))); }
      case "cd": { const have = Array.isArray(val) ? val : []; const allow = asList(arg).map(String); return have.every((x) => allow.includes(String(x))); }
      case "ov": { const have = Array.isArray(val) ? val.map(String) : []; return asList(arg).some((x) => have.includes(String(x))); }
      case "fts": case "plfts": case "phfts": case "wfts":
        return val !== null && val !== undefined && String(val).toLowerCase().includes(String(arg).toLowerCase());
      default: throw new PgErr("PGRST100", "unknown operator " + op, 400);
    }
  }

  /* "a.eq.1,and(b.gt.2,c.is.null),d.not.ilike.*x*" -> tree */
  function splitTop(s) {
    const out = [];
    let depth = 0, cur = "", quote = false;
    for (const ch of s) {
      if (ch === '"') quote = !quote;
      if (!quote && ch === "(") depth++;
      if (!quote && ch === ")") depth--;
      if (!quote && ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
      cur += ch;
    }
    if (cur !== "") out.push(cur);
    return out;
  }
  function parseLogic(s) {
    return splitTop(s).map((part) => {
      const g = /^(not\.)?(and|or)\((.*)\)$/.exec(part.trim());
      if (g) return { group: g[2], neg: !!g[1], items: parseLogic(g[3]) };
      const m = /^([^.]+)\.(not\.)?([a-z]+)\.(.*)$/s.exec(part.trim());
      if (!m) throw new PgErr("PGRST100", "failed to parse logic tree (" + part + ")", 400);
      return { col: m[1], neg: !!m[2], op: m[3], val: m[4].replace(/^"|"$/g, "") };
    });
  }
  function evalNode(row, n) {
    const v = n.group
      ? (n.group === "and" ? n.items.every((x) => evalNode(row, x)) : n.items.some((x) => evalNode(row, x)))
      : test(n.op, row[n.col], n.val);
    return n.neg ? !v : v;
  }

  /* ── select parsing ─────────────────────────────────────────────────── */
  function parseSelect(str) {
    const s = String(str === undefined || str === null || str === "" ? "*" : str).replace(/\s+/g, "");
    return splitTop(s).filter(Boolean).map(parseItem);
  }
  function parseItem(tokIn) {
    let tok = tokIn;
    let alias = null;
    if (tok.startsWith("...")) tok = tok.slice(3);
    const a = /^([A-Za-z_][A-Za-z0-9_]*):(?!:)(.*)$/s.exec(tok);
    if (a) { alias = a[1]; tok = a[2]; }
    const p = tok.indexOf("(");
    if (p !== -1 && tok.endsWith(")")) {
      const head = tok.slice(0, p);
      const parts = head.split("!");
      const target = parts[0];
      const flags = parts.slice(1);
      const children = splitTop(tok.slice(p + 1, -1)).filter(Boolean).map(parseItem);
      return { type: "embed", alias: alias || target, target, hint: flags.filter((f) => f !== "inner" && f !== "left")[0] || null,
        inner: flags.includes("inner"), children };
    }
    if (tok === "*") return { type: "star" };
    const col = tok.split("::")[0].split("->")[0];
    return { type: "col", name: col, alias: alias || col };
  }

  /* ── the engine ─────────────────────────────────────────────────────── */
  function createEngine(options) {
    const opt = options || {};
    const clock = opt.clock || (() => new Date());
    const rows = {};
    const seq = {};
    for (const t of TABLES) { rows[t] = []; seq[t] = 0; }
    const objects = new Map();    // key -> {size, mime, owner, created_at}
    const blobs = new Map();      // key -> Blob (this process only)
    const tus = new Map();        // id -> {key, length, offset, mime, chunks: [], owner}
    let tusN = 0;
    const listeners = new Set();
    const opListeners = new Set();
    let quiet = 0;
    let agentsServer = null;      // M4: the DCR Agents 2 PC's last heartbeat (demo: made up by the seed)

    const nowIso = () => clock().toISOString();
    const today = () => companyDay(clock());

    function emitChange(evt) {
      if (quiet) return;
      for (const cb of Array.from(listeners)) { try { cb(evt); } catch (e) { /* */ } }
    }
    function emitOp(op) {
      if (quiet) return;
      for (const cb of Array.from(opListeners)) { try { cb(op); } catch (e) { /* */ } }
    }

    /* who is asking */
    function profileOf(uid) { return uid ? rows.profiles.find((p) => p.id === uid) || null : null; }
    function who(ctx) {
      const uid = ctx && ctx.uid;
      const p = profileOf(uid);
      const active = !!(p && p.active && p.role !== "agents");
      const role = active ? p.role : null;
      const admin = role === "admin";
      return {
        uid, p, active, role, admin,
        prices: active && (admin || !!p.can_see_prices),
        financials: active && (admin || !!p.can_see_financials),
        agents: !!(p && p.active && p.role === "agents"),
      };
    }
    function canEdit(w, area) {
      if (!w.active) return false;
      const r = w.role;
      switch (area) {
        case "projects": case "estimates": case "catalog": case "all_files": return r === "admin" || r === "manager";
        case "contacts": return ["admin", "manager", "accountant"].includes(r);
        case "takeoffs": case "tasks": case "all_journal": return ["admin", "manager", "lead"].includes(r);
        case "activity": return ["admin", "manager", "accountant", "lead"].includes(r);
        case "own_tasks": return ["admin", "manager", "lead", "accountant", "field"].includes(r);
        case "journal": return ["admin", "manager", "lead", "field"].includes(r);
        case "files": return r !== "viewer";
        case "money": return r === "admin" || ((r === "manager" || r === "accountant") && w.financials);
        case "people": case "timesheets_all": return r === "admin" || r === "manager";
        case "settings": case "users": return r === "admin";
        default: return false;
      }
    }

    function projectVisible(w, pid) {
      if (pid === null || pid === undefined) return true;
      const p = rows.projects.find((x) => x.id === Number(pid));
      return !!p && (!p.deleted_at || w.admin);
    }
    function isCurrent(f) {
      return !f.deleted_at && !rows.files.some((n) => n.previous_id === f.id && !n.deleted_at);
    }

    /* the crew scope (M2): app.my_employee_id(), app.in_my_crew(employee_id) */
    function myEmployeeId(w) {
      if (!w.uid) return null;
      const e = rows.employees.find((x) => x.profile_id === w.uid);
      return e ? e.id : null;
    }
    // an ACTIVE LEAD's crew only (a crew row of someone who is no longer a lead gives nothing)
    function inMyCrew(w, empId) {
      return !!w.uid && w.role === "lead" && rows.crew_members.some((c) => c.lead_profile_id === w.uid && c.employee_id === Number(empId));
    }
    function tsReads(w, empId) {
      if (!w.active) return false;
      if (["admin", "manager", "accountant"].includes(w.role)) return true;
      const mine = myEmployeeId(w);
      return (mine !== null && mine === Number(empId)) || inMyCrew(w, empId);
    }
    function tsWrites(w, empId) {
      if (!w.active || w.role === "viewer") return false;
      if (w.role === "admin" || w.role === "manager") return true;
      const mine = myEmployeeId(w);
      return (mine !== null && mine === Number(empId)) || inMyCrew(w, empId);
    }
    function employeeReads(w, e) {
      if (!w.active) return false;
      if (["admin", "manager", "accountant"].includes(w.role)) return true;
      return e.profile_id === w.uid || inMyCrew(w, e.id);
    }

    /* row level security: may this person read this row? */
    function canRead(w, table, r) {
      if (table === "profiles") return r.id === w.uid || w.active;
      if (!w.active) return false;
      switch (table) {
        case "settings": return true;
        case "settings_prices": return w.prices;
        case "contacts": return !r.deleted_at || w.admin;
        case "projects": return !r.deleted_at || w.admin;
        case "project_prices": return w.prices && projectVisible(w, r.project_id);
        case "activity": return projectVisible(w, r.project_id);
        case "journal_entries": return (!r.deleted_at || w.admin) && projectVisible(w, r.project_id);
        case "files": case "current_files":
          return (!r.deleted_at || w.admin) && projectVisible(w, r.project_id) && (!r.is_financial || w.financials) &&
            (r.folder !== "estimates" || w.prices) && (r.folder !== "invoices" || w.financials);
        case "tasks":   // Q3: field and view-only people see their own tasks and the ones they created
          if (w.role === "field" || w.role === "viewer") return projectVisible(w, r.project_id) && (r.assigned_to === w.uid || r.created_by === w.uid);
          return projectVisible(w, r.project_id);
        case "task_notes": { const t = rows.tasks.find((x) => x.id === r.task_id); return !!t && canRead(w, "tasks", t); }
        case "deletions": return r.for_user === null || r.for_user === undefined || r.for_user === w.uid;   // M1 7b: "no longer yours" for one person
        case "notifications_outbox": return w.admin;                                                          // M3: admin reads, nobody writes
        case "push_subscriptions": return r.profile_id === w.uid;                                             // M3: own rows only, admins too
        case "employees": return employeeReads(w, r);
        case "crew_members":
          if (["admin", "manager", "accountant"].includes(w.role)) return true;
          return r.lead_profile_id === w.uid || (myEmployeeId(w) !== null && r.employee_id === myEmployeeId(w));
        case "timesheets": return tsReads(w, r.employee_id);
        default: return false;
      }
    }

    function source(table) {
      if (VIEWS[table]) return rows[VIEWS[table]].filter(isCurrent);
      if (!rows[table]) throw new PgErr("42P01", 'relation "public.' + table + '" does not exist', 404);
      if (NO_DIRECT.has(table)) throw new PgErr("42501", "permission denied for table " + table, 403);
      return rows[table];
    }
    function readable(w, table) {
      return source(table).filter((r) => canRead(w, table, r));
    }

    /* embeds */
    function relation(from, target, hint) {
      const cands = [];
      for (const fk of FKS) {
        if (fk.table === from && fk.ref === target) cands.push({ kind: "m2o", fk });
        if (fk.table === target && fk.ref === from && fk.table !== fk.ref) cands.push({ kind: fk.one ? "o2o" : "o2m", fk });
        if (fk.table === target && fk.ref === from && fk.table === fk.ref && fk.table === from) cands.push({ kind: "o2m", fk });
      }
      let list = cands;
      if (hint) list = cands.filter((c) => c.fk.column === hint || hint === c.fk.table + "_" + c.fk.column + "_fkey");
      if (!list.length) {
        throw new PgErr("PGRST200", "Could not find a relationship between '" + from + "' and '" + target + "' in the schema cache", 400);
      }
      if (list.length > 1) {
        throw new PgErr("PGRST201", "Could not embed because more than one relationship was found for '" + from + "' and '" + target + "'", 300,
          list.map((c) => ({ cardinality: c.kind, relationship: c.fk.table + "_" + c.fk.column + "_fkey" })),
          "Try changing '" + target + "' to one of the following: " + list.map((c) => "'" + target + "!" + c.fk.table + "_" + c.fk.column + "_fkey'").join(", "));
      }
      return list[0];
    }

    function project(w, table, row, items, q, path) {
      const outRow = {};
      const cols = COLS[table] || {};
      for (const it of items) {
        if (it.type === "star") Object.assign(outRow, clone(row));
        else if (it.type === "col") {
          if (!(it.name in cols) && !(it.name in row)) {
            throw new PgErr("42703", "column " + table + "." + it.name + " does not exist", 400);
          }
          outRow[it.alias] = clone(row[it.name] === undefined ? null : row[it.name]);
        }
      }
      for (const it of items) {
        if (it.type !== "embed") continue;
        const rel = relation(table, it.target, it.hint);
        const subPath = path ? path + "." + it.alias : it.alias;
        const pool = readable(w, it.target);
        let val;
        if (rel.kind === "m2o") {
          const v = row[rel.fk.column];
          const hit = v === null || v === undefined ? null : pool.find((t) => t[pkOf(it.target)] === v);
          val = hit && passes(hit, q, subPath) ? project(w, it.target, hit, it.children, q, subPath) : null;
        } else if (rel.kind === "o2o") {
          const hit = pool.find((t) => t[rel.fk.column] === row[pkOf(table)]);
          val = hit && passes(hit, q, subPath) ? project(w, it.target, hit, it.children, q, subPath) : null;
        } else {
          let arr = pool.filter((t) => t[rel.fk.column] === row[pkOf(table)] && passes(t, q, subPath));
          arr = order(arr, (q.orders || []).filter((o) => o.foreign === subPath));
          const lim = (q.foreignLimits || {})[subPath];
          if (lim) arr = arr.slice(lim.offset || 0, (lim.offset || 0) + lim.limit);
          val = arr.map((t) => project(w, it.target, t, it.children, q, subPath));
        }
        outRow[it.alias] = val;
      }
      return outRow;
    }

    function innerOk(row, items) {
      for (const it of items) {
        if (it.type !== "embed") continue;
        const v = row[it.alias];
        if (it.inner && (v === null || (Array.isArray(v) && !v.length))) return false;
        if (v && !Array.isArray(v) && !innerOk(v, it.children)) return false;
      }
      return true;
    }

    function passes(row, q, path) {
      for (const f of q.filters || []) {
        const dot = f.col.lastIndexOf(".");
        const fpath = dot === -1 ? "" : f.col.slice(0, dot);
        const col = dot === -1 ? f.col : f.col.slice(dot + 1);
        if (fpath !== (path || "")) continue;
        if (f.op === "or" || f.op === "and") {
          if (!evalNode(row, { group: f.op, items: parseLogic(f.val), neg: !!f.neg })) return false;
          continue;
        }
        if (test(f.op, row[col], f.val) === !!f.neg) return false;
      }
      return true;
    }

    function order(arr, orders) {
      if (!orders.length) return arr;
      return arr.slice().sort((a, b) => {
        for (const o of orders) {
          const x = a[o.col], y = b[o.col];
          const xn = x === null || x === undefined, yn = y === null || y === undefined;
          const nullsFirst = o.nullsFirst === undefined ? !o.asc : o.nullsFirst;
          if (xn || yn) {
            if (xn && yn) continue;
            return (xn ? -1 : 1) * (nullsFirst ? 1 : -1);
          }
          const c = cmp(x, y);           // text order, as PostgREST (no natural number sort over REST)
          if (c) return o.asc ? c : -c;
        }
        return 0;
      });
    }

    function checkColumns(table, obj) {
      const cols = COLS[table] || {};
      for (const k of Object.keys(obj)) {
        if (!(k in cols)) throw new PgErr("PGRST204", "Could not find the '" + k + "' column of '" + table + "' in the schema cache", 400);
      }
    }

    /** SELECT */
    function select(ctx, table, q) {
      const w = who(ctx);
      if (!w.uid) throw new PgErr("42501", "permission denied for table " + table, 401);
      const items = parseSelect(q.columns);
      let base = readable(w, table).filter((r) => passes(r, q, ""));
      base = order(base, (q.orders || []).filter((o) => !o.foreign));
      let shaped = base.map((r) => ({ src: r, out: project(w, table, r, items, q, "") })).filter((x) => innerOk(x.out, items));
      const count = shaped.length;
      const from = q.offset || 0;
      if (q.limit !== undefined && q.limit !== null) shaped = shaped.slice(from, from + q.limit);
      else if (from) shaped = shaped.slice(from);
      return { data: shaped.map((x) => x.out), count };
    }

    /* the audit trigger */
    function auditInsert(w, table, r) {
      if (NO_AUDIT.has(table)) return;
      const t = nowIso();
      r.created_at = r.created_at && quiet ? r.created_at : t;
      r.created_by = quiet && r.created_by !== undefined ? r.created_by : (w.uid || null);
      r.updated_at = r.created_at;
      r.updated_by = null;
      r.version = 1;
    }
    function auditUpdate(w, table, r, old) {
      if (NO_AUDIT.has(table)) return;
      r.created_at = old.created_at;
      r.created_by = old.created_by;
      r.updated_at = nowIso();
      r.updated_by = w.uid || null;
      r.version = (old.version || 1) + 1;
    }

    function nextId(table) { seq[table] += 1; return seq[table]; }

    function commitInsert(table, r) {
      rows[table].push(r);
      emitOp({ k: "row", t: table, row: clone(r), seq: seq[table] });
      emitChange({ table, type: "INSERT", new: clone(r), old: null });
    }
    function commitUpdate(table, old, r) {
      const i = rows[table].indexOf(old);
      rows[table][i] = r;
      emitOp({ k: "row", t: table, row: clone(r), seq: seq[table] });
      emitChange({ table, type: "UPDATE", new: clone(r), old: clone(old) });
    }
    function commitDelete(table, old) {
      const i = rows[table].indexOf(old);
      if (i !== -1) rows[table].splice(i, 1);
      emitOp({ k: "del", t: table, id: old[pkOf(table)] });
      emitChange({ table, type: "DELETE", new: null, old: clone(old) });
    }

    function logActivity(w, pid, kind, text, from, to) {
      const r = Object.assign(clone(COLS.activity), { id: nextId("activity"), project_id: pid, kind, text, from_status: from || null, to_status: to || null });
      auditInsert(w, "activity", r);
      commitInsert("activity", r);
      return r;
    }

    /* constraints and BEFORE triggers; return the row to store */
    function beforeInsert(w, table, r, viaRpc) {
      switch (table) {
        case "projects": {
          if (!r.name || !String(r.name).trim()) throw rule("23514", 'new row for relation "projects" violates check constraint "projects_name_check"');
          if (!STATUSES.includes(r.status)) throw rule("23514", 'new row for relation "projects" violates check constraint "projects_status_check"');
          if ((r.legacy_sp_id !== null && r.legacy_sp_id !== undefined) && !quiet) throw deny("only the import may set legacy columns");
          if (!r.number || !w.admin) r.number = takeNumber();
          if (rows.projects.some((p) => p.number === r.number)) throw new PgErr("23505", 'duplicate key value violates unique constraint "projects_number_key"', 409);
          if (!r.folder_name || !w.admin) r.folder_name = folderName(r);
          if (r.status === "completed" && !r.completed_date) r.completed_date = today();
          if (!Array.isArray(r.tags)) r.tags = [];
          // t14_projects_location: a new project's point comes from its address unless said otherwise
          if (r.lat === null || r.lat === undefined || r.lng === null || r.lng === undefined) r.location_source = null;
          else if (!quiet) r.location_source = r.location_source || "geocode";
          break;
        }
        case "activity": {
          const len = String(r.text || "").length;
          if (len < 1 || (len > 4000 && !(quiet && r.author_name))) throw rule("23514", 'new row for relation "activity" violates check constraint "activity_text_check"');
          if (!quiet && r.kind !== "note") throw deny("only notes are written by people");
          if (!quiet && (r.author_name || r.legacy_sp_id)) throw deny("only the import may set legacy columns");
          if (r.project_id !== null && !rows.projects.some((p) => p.id === r.project_id)) throw rule("23503", 'insert or update on table "activity" violates foreign key constraint "activity_project_id_fkey"');
          break;
        }
        case "journal_entries": {
          if (r.project_id === null || r.project_id === undefined) throw rule("23502", 'null value in column "project_id" of relation "journal_entries" violates not-null constraint');
          if (!rows.projects.some((p) => p.id === r.project_id)) throw rule("23503", 'insert or update on table "journal_entries" violates foreign key constraint "journal_entries_project_id_fkey"');
          if (!JOURNAL_CATS.includes(r.category)) throw rule("23514", 'new row for relation "journal_entries" violates check constraint "journal_entries_category_check"');
          if (!r.entry_date) r.entry_date = today();
          break;
        }
        case "files": filesBeforeInsert(w, r); break;
        case "tasks": {
          tasksCheck(w, r, null);
          if (r.status === "done") { r.completed_at = nowIso(); r.completed_by = w.uid; }
          break;
        }
        case "task_notes": taskNotesCheck(w, r, null); break;
        case "contacts": {
          if (!r.name || !String(r.name).trim()) throw rule("23514", 'new row for relation "contacts" violates check constraint "contacts_name_check"');
          break;
        }
        case "employees": employeesCheck(r, null); break;
        case "crew_members": {
          if (!rows.profiles.some((p) => p.id === r.lead_profile_id)) throw rule("23503", 'insert or update on table "crew_members" violates foreign key constraint "crew_members_lead_profile_id_fkey"');
          if (!rows.employees.some((e) => e.id === Number(r.employee_id))) throw rule("23503", 'insert or update on table "crew_members" violates foreign key constraint "crew_members_employee_id_fkey"');
          r.employee_id = Number(r.employee_id);
          const leadP = profileOf(r.lead_profile_id);
          if (!leadP || leadP.role !== "lead") throw rule("23514", "only a lead has a crew");
          if (rows.employees.some((e) => e.id === r.employee_id && e.profile_id === r.lead_profile_id)) throw rule("23514", "a lead is not in their own crew");
          if (rows.crew_members.some((c) => c.lead_profile_id === r.lead_profile_id && c.employee_id === r.employee_id)) {
            throw new PgErr("23505", 'duplicate key value violates unique constraint "crew_members_pair_key"', 409);
          }
          break;
        }
        case "timesheets": timesheetsCheck(r, null); break;
        case "push_subscriptions": pushSubCheck(r); break;
        default: break;
      }
      return r;
    }

    function employeesCheck(r, old) {
      if (!r.full_name || !String(r.full_name).trim()) throw rule("23514", 'new row for relation "employees" violates check constraint "employees_full_name_check"');
      r.full_name = String(r.full_name).trim().replace(/\s+/g, " ");
      if (r.email) r.email = String(r.email).trim().toLowerCase() || null;
      if (r.email && !/^[^@\s]+@[^@\s]+$/.test(r.email)) throw rule("23514", 'new row for relation "employees" violates check constraint "employees_email_check"');
      if (r.profile_id && (!old || r.profile_id !== old.profile_id)) {
        const pp = profileOf(r.profile_id);
        if (pp && pp.role === "agents") throw rule("23514", "the DCR Agents 2 account is not an employee");
      }
      if (r.normal_lunch_hours !== null && r.normal_lunch_hours !== undefined && (Number(r.normal_lunch_hours) < 0 || Number(r.normal_lunch_hours) > 8)) {
        throw rule("23514", 'new row for relation "employees" violates check constraint "employees_normal_lunch_hours_check"');
      }
      for (const k of ["normal_start1", "normal_end1", "normal_start2", "normal_end2"]) {
        if (r[k] !== null && r[k] !== undefined && !TIME_OK.test(String(r[k]))) throw rule("22007", 'invalid input syntax for type time: "' + r[k] + '"');
        if (r[k]) r[k] = String(r[k]).length === 5 ? r[k] + ":00" : String(r[k]);
      }
      if (r.active && rows.employees.some((e) => e.active && e.id !== r.id && e.full_name.toLowerCase() === r.full_name.toLowerCase())) {
        throw new PgErr("23505", 'duplicate key value violates unique constraint "employees_active_name_key"', 409);
      }
      if (r.profile_id && rows.employees.some((e) => e.id !== r.id && e.profile_id === r.profile_id)) {
        throw new PgErr("23505", 'duplicate key value violates unique constraint "employees_profile_id_key"', 409);
      }
      if (r.profile_id && !rows.profiles.some((p) => p.id === r.profile_id)) {
        throw rule("23503", 'insert or update on table "employees" violates foreign key constraint "employees_profile_id_fkey"');
      }
      if (!old || r.phone !== old.phone) r.phone_e164 = e164(r.phone);
    }

    function timesheetsCheck(r, old) {
      const bad = (c) => rule("23514", 'new row for relation "timesheets" violates check constraint "' + c + '"');
      if (r.employee_id === null || r.employee_id === undefined) throw rule("23502", 'null value in column "employee_id" of relation "timesheets" violates not-null constraint');
      r.employee_id = Number(r.employee_id);
      if (!rows.employees.some((e) => e.id === r.employee_id)) throw rule("23503", 'insert or update on table "timesheets" violates foreign key constraint "timesheets_employee_id_fkey"');
      if (!r.work_date || !/^\d{4}-\d{2}-\d{2}$/.test(String(r.work_date))) throw rule("23502", 'null value in column "work_date" of relation "timesheets" violates not-null constraint');
      if (!TS_KINDS.includes(r.kind)) throw bad("timesheets_kind_check");
      if (r.hours === null || r.hours === undefined || !(Number(r.hours) >= 0 && Number(r.hours) <= 24)) throw bad("timesheets_hours_check");
      r.hours = Math.round(Number(r.hours) * 100) / 100;
      if (r.kind === "work" && !(r.hours > 0)) throw bad("timesheets_work_hours_check");
      if (r.project_id !== null && r.project_id !== undefined) {
        r.project_id = Number(r.project_id);
        if (!rows.projects.some((p) => p.id === r.project_id)) throw rule("23503", 'insert or update on table "timesheets" violates foreign key constraint "timesheets_project_id_fkey"');
      }
      if (r.kind === "work" && (r.project_id === null || r.project_id === undefined) && !r.legacy_project_text) throw bad("timesheets_project_check");
      if (r.work_completed !== null && r.work_completed !== undefined && String(r.work_completed).length > 2000) throw bad("timesheets_work_completed_check");
      if (!TS_SOURCES.includes(r.source)) throw bad("timesheets_source_check");
      for (const k of ["start1", "end1", "start2", "end2"]) {
        if (r[k] !== null && r[k] !== undefined && !TIME_OK.test(String(r[k]))) throw rule("22007", 'invalid input syntax for type time: "' + r[k] + '"');
        if (r[k]) r[k] = String(r[k]).length === 5 ? r[k] + ":00" : String(r[k]);
      }
      if (r.source_key && rows.timesheets.some((t) => t.id !== r.id && t.source_key === r.source_key)) {
        throw new PgErr("23505", 'duplicate key value violates unique constraint "timesheets_source_key_key"', 409);
      }
      if (r.kind !== "work" && r.project_id !== null && r.project_id !== undefined) throw bad("timesheets_leave_no_project");
      if (!quiet) {
        // what a person may write (app.tg_timesheets_before)
        if (old === null) {
          if ((r.legacy_sp_id !== null && r.legacy_sp_id !== undefined) || r.legacy_project_text) throw deny("the old portal's columns are written by the import only");
          if (!["portal", "desktop"].includes(r.source)) throw deny("a person files a timesheet from Portal 2 or DCR Desktop 2 (source portal or desktop)");
          if (r.source_key && !/^(portal|desktop):/.test(r.source_key)) throw deny("a person's source key starts with portal: or desktop:");
        } else {
          if (r.legacy_sp_id !== old.legacy_sp_id || (r.legacy_project_text && r.legacy_project_text !== old.legacy_project_text)) {
            throw deny("the old portal's columns are written by the import only");
          }
          if (r.source !== old.source || (r.source_key || null) !== (old.source_key || null)) throw deny("where a timesheet came from does not change");
        }
        if (r.project_id !== null && r.project_id !== undefined && (old === null || r.project_id !== old.project_id)) {
          const pj = rows.projects.find((x) => x.id === r.project_id);
          if (!pj || pj.deleted_at) throw rule("23503", "that project does not exist (or was deleted)");
        }
      }
    }

    /* ── tasks and notes (M3, BLUEPRINT 3.3.7) ─────────────────────────── */
    const AGENT_COLS = ["agent_kind", "agent_ref", "agent_date"];
    function tasksCheck(w, r, old) {
      const bad = (c) => rule("23514", 'new row for relation "tasks" violates check constraint "' + c + '"');
      if (!r.title || !String(r.title).trim()) throw bad("tasks_title_check");
      if (!["low", "normal", "high", "urgent"].includes(r.priority)) throw bad("tasks_priority_check");
      if (!["open", "done"].includes(r.status)) throw bad("tasks_status_check");
      if (r.project_id !== null && r.project_id !== undefined) {
        r.project_id = Number(r.project_id);
        if (!rows.projects.some((p) => p.id === r.project_id)) throw rule("23503", 'insert or update on table "tasks" violates foreign key constraint "tasks_project_id_fkey"');
      }
      if (r.assigned_to && !rows.profiles.some((p) => p.id === r.assigned_to)) {
        throw rule("23503", 'insert or update on table "tasks" violates foreign key constraint "tasks_assigned_to_fkey"');
      }
      if (r.due_time !== null && r.due_time !== undefined && r.due_time !== "") {
        if (!TIME_OK.test(String(r.due_time))) throw rule("22007", 'invalid input syntax for type time: "' + r.due_time + '"');
        if (String(r.due_time).length === 5) r.due_time += ":00";
      } else r.due_time = null;
      if (r.agent_kind !== null && r.agent_kind !== undefined && !["photo", "recurring"].includes(r.agent_kind)) throw bad("tasks_agent_kind_check");
      if (!quiet && !w.agents) {
        // the guard trigger: only the agents role (or the import, the table owner with no JWT) sets these
        const changed = (k) => (old ? (r[k] ?? null) !== (old[k] ?? null) : r[k] !== null && r[k] !== undefined);
        if (AGENT_COLS.some(changed)) throw deny("agent_kind, agent_ref and agent_date are set by DCR Agents 2 only");
        if (changed("legacy_sp_id") || changed("author_name")) throw deny("only the import may set legacy columns");
      }
      if (r.agent_kind && rows.tasks.some((t) => t.id !== r.id && t.agent_kind === r.agent_kind && t.agent_ref === r.agent_ref && t.agent_date === r.agent_date)) {
        throw new PgErr("23505", 'duplicate key value violates unique constraint "tasks_agent_key"', 409);
      }
      if (r.legacy_sp_id !== null && r.legacy_sp_id !== undefined && rows.tasks.some((t) => t.id !== r.id && t.legacy_sp_id === r.legacy_sp_id)) {
        throw new PgErr("23505", 'duplicate key value violates unique constraint "tasks_legacy_sp_id_key"', 409);
      }
    }
    function taskNotesCheck(w, r, old) {
      const len = String(r.text || "").length;
      if (len < 1 || len > 4000) throw rule("23514", 'new row for relation "task_notes" violates check constraint "task_notes_text_check"');
      if (!r.via) r.via = "desktop";
      if (!NOTE_VIA.includes(r.via)) throw rule("23514", 'new row for relation "task_notes" violates check constraint "task_notes_via_check"');
      if (!quiet && !w.agents) {
        if (!PEOPLE_VIA.includes(r.via) || (r.on_behalf_of !== null && r.on_behalf_of !== undefined)) {
          throw deny("only DCR Agents 2 files a note from a channel or on someone's behalf");
        }
        if ((r.author_name || null) !== ((old && old.author_name) || null)) throw deny("only the import may set legacy columns");
      }
      if (r.source_key && rows.task_notes.some((n) => n.id !== r.id && n.task_id === r.task_id && n.source_key === r.source_key)) {
        throw new PgErr("23505", 'duplicate key value violates unique constraint "task_notes_source_key"', 409);
      }
    }
    const RULE39 = "=".repeat(39), SEP39 = "-".repeat(39);
    /** t97_tasks_notice: a task given to someone other than the person saving it (a new open task, or a
        reassignment; never to oneself, never by the import, never for an inactive person or the agents
        account) -> one outbox row: the Access wording, CRLF lines, the Portal 2 link */
    function taskOutbox(w, t, old) {
      if (!t.assigned_to || t.status !== "open") return;
      if (old && old.assigned_to === t.assigned_to) return;
      if (!w.uid || t.assigned_to === w.uid) return;
      const to = profileOf(t.assigned_to);
      if (!to || !to.active || to.role === "agents") return;
      const p = t.project_id === null ? null : rows.projects.find((x) => x.id === t.project_id);
      const emp = rows.employees.find((e) => e.profile_id === to.id);
      const link = "https://portal.dcrframing.com/my-tasks.html?task=" + t.id;
      const body = ["", (String(to.full_name || "").trim() || to.email) + ",", "",
        "This is an automated E-Mail from the DCR Framing Database. The following task has been assigned to you: ", "",
        RULE39, "PROJECT:", "Project ID: #" + (p ? p.number : ""), "Name: " + (p ? p.name || "" : ""),
        "Address: " + (p ? p.address || "" : "") + " - " + (p ? p.city || "" : ""), RULE39, "", "TASK:",
        "Category: " + (t.category || "") + ", " + (t.sub_category || ""), "Priority: " + statusLabel(t.priority), "",
        "Name: " + t.title, "Description: " + (t.description || ""), "", SEP39, "", "",
        "Please visit " + link + " to view your currently assigned tasks."].join("\r\n");
      const r = Object.assign(clone(COLS.notifications_outbox), { id: nextId("notifications_outbox"), task_id: t.id, to_profile_id: t.assigned_to,
        to_email: (emp && String(emp.email || "").trim()) || to.email, subject: ("New Request - " + (t.category || "") + " - " + (t.sub_category || "") + " - " + t.title).slice(0, 1000),
        body, created_at: nowIso(), email_wanted: !!(rows.settings[0] && rows.settings[0].task_email_enabled) });
      commitInsert("notifications_outbox", r);
    }
    /** M1 7b: a task handed AWAY from a field / view-only person (who did not create it) leaves a
        "no longer yours" tombstone only they read */
    function taskHandover(w, old, r) {
      if (!old.assigned_to || r.assigned_to === old.assigned_to || old.assigned_to === r.created_by) return;
      const p = profileOf(old.assigned_to);
      if (!p || !["field", "viewer"].includes(p.role)) return;
      commitInsert("deletions", { id: nextId("deletions"), table_name: "tasks", row_id: r.id, project_id: r.project_id,
        deleted_at: nowIso(), deleted_by: w.uid || null, for_user: old.assigned_to });
    }
    /** app.task_clock(task, now): the newest of the newest note (dated no later than today) and the
        task's created_at (a tie says note); Pacific calendar days, never below 0; needs_update: an open
        task, MORE than 5 days, a photo task never through its agent_date */
    function taskClock(t) {
      const day = today();
      const notes = rows.task_notes.filter((n) => n.task_id === t.id && companyDay(new Date(n.created_at)) <= day);
      let newest = null;
      for (const n of notes) if (!newest || cmp(n.created_at, newest.created_at) > 0 || (cmp(n.created_at, newest.created_at) === 0 && n.id > newest.id)) newest = n;
      const useNote = !!newest && (!t.created_at || cmp(newest.created_at, t.created_at) >= 0);
      const last = useNote ? newest.created_at : t.created_at;
      const days = last ? Math.max(0, Math.round((Date.parse(day + "T12:00:00Z") - Date.parse(companyDay(new Date(last)) + "T12:00:00Z")) / 86400000)) : 0;
      const shootAhead = t.agent_kind === "photo" && !!t.agent_date && day <= t.agent_date;
      return { last_update: last, last_update_source: useNote ? "note" : "created", days_since_update: days,
        last_note: newest ? newest.text : null, needs_update: (t.status || "open") === "open" && days > TASK_DAYS && !shootAhead };
    }
    /** app.my_crew_profiles(): the accounts of the active lead's crew */
    function crewProfiles(w) {
      if (w.role !== "lead") return [];
      const emps = rows.crew_members.filter((c) => c.lead_profile_id === w.uid).map((c) => c.employee_id);
      return rows.employees.filter((e) => emps.includes(e.id) && e.profile_id).map((e) => e.profile_id);
    }
    const PRI_ORDER = { urgent: 0, high: 1, normal: 2, low: 3 };
    /** rpc my_tasks(p_view): mine (assigned to the caller, or unassigned and made by them) | crew (a lead:
        mine and the crew's) | everyone (admin, manager, lead, accountant: every task they read); the OPEN
        tasks with the project, the names, `mine`, the notes (oldest first) and the clock — the columns of
        migration M3 */
    function myTasks(w, view) {
      const v = String(view === null || view === undefined ? "mine" : view).trim().toLowerCase();
      if (!["mine", "crew", "everyone"].includes(v)) throw rule("22023", "p_view is mine, crew or everyone");
      if (v === "everyone" && !["admin", "manager", "lead", "accountant"].includes(w.role)) throw deny("Only the office sees everyone's tasks.");
      if (v === "crew" && w.role !== "lead") throw deny("Only a lead has a crew.");
      const crew = v === "crew" ? crewProfiles(w) : [];
      const list = readable(w, "tasks").filter((t) => t.status === "open" && (
        v === "everyone" || t.assigned_to === w.uid || (!t.assigned_to && t.created_by === w.uid) || (v === "crew" && crew.includes(t.assigned_to))));
      const nm = (id) => { const p = profileOf(id); return p && String(p.full_name || "").trim() ? String(p.full_name).trim() : null; };
      return list.sort((x, y) => (PRI_ORDER[x.priority] - PRI_ORDER[y.priority]) ||
        ((x.due_date === null) - (y.due_date === null)) || cmp(x.due_date || "", y.due_date || "") ||
        ((x.due_time === null) - (y.due_time === null)) || cmp(x.due_time || "", y.due_time || "") || cmp(x.created_at, y.created_at) || x.id - y.id)
        .map((t) => {
          const p = t.project_id === null ? null : rows.projects.find((x) => x.id === t.project_id);
          const notes = rows.task_notes.filter((n) => n.task_id === t.id).sort((x, y) => cmp(x.created_at, y.created_at) || x.id - y.id)
            .map((n) => ({ id: n.id, text: n.text, created_at: n.created_at, created_by: n.created_by, author: nm(n.created_by) || n.author_name,
              via: n.via, on_behalf_of: n.on_behalf_of, on_behalf_of_name: n.on_behalf_of ? nm(n.on_behalf_of) : null, version: n.version }));
          return Object.assign({
            id: t.id, project_id: t.project_id, estimate_item_id: t.estimate_item_id, title: t.title, description: t.description, category: t.category,
            sub_category: t.sub_category, priority: t.priority, assigned_to: t.assigned_to, due_date: t.due_date, due_time: t.due_time, status: t.status,
            created_at: t.created_at, created_by: t.created_by, updated_at: t.updated_at, updated_by: t.updated_by, version: t.version,
            agent_kind: t.agent_kind, agent_ref: t.agent_ref, agent_date: t.agent_date, author_name: t.author_name,
            project_number: p ? p.number : null, project_name: p ? p.name : null, project_address: p ? p.address : null, project_city: p ? p.city : null,
            project_lat: p ? p.lat : null, project_lng: p ? p.lng : null, assignee_name: nm(t.assigned_to), created_by_name: nm(t.created_by) || t.author_name,
            mine: t.assigned_to === w.uid || (!t.assigned_to && t.created_by === w.uid), notes,
          }, taskClock(t));
        });
    }
    /** app.note_line: every line break (and tab, NEL, LS, PS, no-break space) a space, runs of spaces one, trimmed */
    const oneLine = (s) => String(s === null || s === undefined ? "" : s).replace(/[\r\n\t\u000b\f\u0085\u2028\u2029 ]/g, " ").replace(/ {2,}/g, " ").trim();

    function filesBeforeInsert(w, r) {
      if (!FOLDERS.includes(r.folder)) throw rule("23514", 'new row for relation "files" violates check constraint "files_folder_check"');
      if (!r.name || !String(r.name).trim() || String(r.name).length > 255 || String(r.name).includes("/")) {
        throw rule("23514", 'new row for relation "files" violates check constraint "files_name_check"');
      }
      r.is_financial = r.folder === "receipts" || (r.bill_id !== null && r.bill_id !== undefined);
      if (r.storage === "cloud") {
        const m = /^([pf])\/([0-9]+)\/([a-z]+)\/[^/]+\/[^/]+$/.exec(String(r.storage_path || ""));
        if (!m || m[1] !== (r.is_financial ? "f" : "p") || Number(m[2]) !== Number(r.project_id) || m[3] !== r.folder) {
          throw rule("23514", 'new row for relation "files" violates check constraint "files_storage_path_shape"');
        }
        if (rows.files.some((f) => f.storage_path === r.storage_path)) {
          throw new PgErr("23505", 'duplicate key value violates unique constraint "files_storage_path_key"', 409);
        }
      }
      if (r.subpath && (/^\/|\/$|\/\//.test(r.subpath) || /[\u0001-\u001f\u007f\\<>:"|?*]/.test(r.subpath))) {
        throw rule("23514", 'new row for relation "files" violates check constraint "files_subpath_shape"');
      }
      if (r.journal_entry_id !== null && r.journal_entry_id !== undefined) {
        const j = rows.journal_entries.find((x) => x.id === Number(r.journal_entry_id));
        if (!j || j.project_id !== Number(r.project_id) || j.deleted_at) throw rule("23514", "the journal entry belongs to another project");
      }
      if (r.source === undefined || r.source === null) r.source = "desktop";        // the column default (M1)
      if (!["desktop", "portal2", "agents", "import"].includes(r.source)) {
        throw rule("23514", 'new row for relation "files" violates check constraint "files_source_check"');
      }
      if (r.description !== null && r.description !== undefined && String(r.description).length > 2000) {
        throw rule("23514", 'new row for relation "files" violates check constraint "files_description_check"');
      }
      if (r.preview_path !== null && r.preview_path !== undefined) {
        // files_preview_path_shape: same "<p|f>/<project>/<folder>/<uuid>/" place as the file, another
        // name, a picture's extension, a cloud row; t11_files_preview: never another row's object
        const pv = String(r.preview_path), sp = String(r.storage_path || "");
        const same4 = pv.split("/").slice(0, 4).join("/") === sp.split("/").slice(0, 4).join("/");
        if (r.storage !== "cloud" || !sp || pv === sp || !same4 || !/^[pf]\/[0-9]+\/[a-z]+\/[^/]+\/[^/]+\.(jpe?g|png|webp)$/i.test(pv)) {
          throw rule("23514", 'new row for relation "files" violates check constraint "files_preview_path_shape"');
        }
        if (rows.files.some((f) => f.preview_path === pv)) {
          throw new PgErr("23505", 'duplicate key value violates unique constraint "files_preview_path_key"', 409);
        }
        if (rows.files.some((f) => f.storage_path === pv)) throw rule("23514", "a preview is a picture of its own, not another file");
      }
      if (r.storage_path && rows.files.some((f) => f.preview_path === r.storage_path)) {
        throw rule("23514", "that object is another file's preview");
      }
      // the version chain: same project, folder, sub-folder, links and name (any case)
      const same = rows.files.filter((f) => !f.deleted_at && f.project_id === Number(r.project_id) && f.folder === r.folder &&
        String(f.subpath || "").toLowerCase() === String(r.subpath || "").toLowerCase() &&
        (f.journal_entry_id ?? null) === (r.journal_entry_id ?? null) && (f.estimate_item_id ?? null) === (r.estimate_item_id ?? null) &&
        (f.bill_id ?? null) === (r.bill_id ?? null) && String(f.name).toLowerCase() === String(r.name).toLowerCase() && isCurrent(f));
      if (same.length) {
        const prev = same.sort((a, b) => b.version_no - a.version_no)[0];
        r.previous_id = prev.id;
        r.version_no = prev.version_no + 1;
      } else {
        r.previous_id = null;
        r.version_no = 1;
      }
    }

    function afterInsert(w, table, r, extra) {
      if (table === "push_subscriptions") pushSubKeep(r);
      if (table === "tasks" && !quiet) taskOutbox(w, r, null);
      if (table === "projects") {
        const x = extra || {};
        const city = String(r.city || "");
        const local = LOCAL_CITIES.some((c) => c.toLowerCase() === city.toLowerCase());
        const sp = rows.settings_prices[0] || COLS.settings_prices;
        const pr = Object.assign(clone(COLS.project_prices), { project_id: r.id,
          labor_rate: x.labor_rate !== undefined ? x.labor_rate : (local ? sp.local_labor_rate : sp.out_of_area_labor_rate),
          rate_source: x.labor_rate !== undefined ? x.rate_source || "custom" : (local ? "local" : "out_of_area") });
        auditInsert(w, "project_prices", pr);
        commitInsert("project_prices", pr);
        logActivity(w, r.id, "system", "Project " + r.number + " created");
      }
      if (table === "journal_entries") {
        logActivity(w, r.project_id, "system", "Journal entry: " + (String(r.title || "").trim() || statusLabel(r.category)));
      }
      if (table === "files") {
        if (r.is_financial || ["estimates", "invoices", "thumbnail"].includes(r.folder)) return;
        if (!r.subpath) {
          logActivity(w, r.project_id, "system", r.version_no > 1 ? "New version of " + r.name + " (v" + r.version_no + ")" : "File uploaded: " + r.name);
          return;
        }
        const top = String(r.subpath).split("/")[0];
        const text = "Files uploaded to " + top;
        const hourAgo = clock().getTime() - 3600000;
        const exists = rows.activity.some((a) => a.project_id === r.project_id && a.kind === "system" &&
          a.text.toLowerCase() === text.toLowerCase() && a.created_by === (w.uid || null) && Date.parse(a.created_at) > hourAgo);
        if (!exists) logActivity(w, r.project_id, "system", text);
      }
    }

    function takeNumber() {
      const s = rows.settings[0];
      for (;;) {
        const n = s.next_project_number;
        s.next_project_number += 1;
        const num = "A" + (n < 1000 ? String(n).padStart(3, "0") : String(n));
        if (!rows.projects.some((p) => p.number === num)) {
          emitOp({ k: "row", t: "settings", row: clone(s), seq: seq.settings });
          return num;
        }
      }
    }

    function canInsert(w, table, r) {
      switch (table) {
        case "projects": return canEdit(w, "projects");
        case "project_prices": return w.prices && canEdit(w, "projects");
        case "activity": return canEdit(w, "activity");
        case "journal_entries": return canEdit(w, "journal");
        case "files": {
          if (!canEdit(w, "files")) return false;
          if (r.folder === "estimates" && !w.prices) return false;
          if ((r.folder === "invoices" || r.folder === "receipts" || (r.bill_id !== null && r.bill_id !== undefined)) && !canEdit(w, "money")) return false;
          if (r.folder === "thumbnail" && !canEdit(w, "projects")) return false;
          return projectVisible(w, r.project_id);
        }
        case "contacts": return canEdit(w, "contacts");
        case "tasks": return canEdit(w, "tasks") || (canEdit(w, "own_tasks") && (r.assigned_to === null || r.assigned_to === undefined || r.assigned_to === w.uid));
        case "task_notes": { const t = rows.tasks.find((x) => x.id === r.task_id); return !!t && canUpdate(w, "tasks", t); }
        case "settings": return w.admin;
        case "employees": case "crew_members": return canEdit(w, "people");
        case "timesheets": return tsWrites(w, r.employee_id);
        case "push_subscriptions":            // profile_id default auth.uid(); WITH CHECK own row
          if (r.profile_id === null || r.profile_id === undefined) r.profile_id = w.uid;
          return w.active && r.profile_id === w.uid;      // app.is_active(): never the agents account
        default: return false;
      }
    }
    function canUpdate(w, table, r) {
      if (table === "profiles") return r.id === w.uid || w.admin;
      if (!w.active) return false;
      switch (table) {
        case "projects": return canEdit(w, "projects") && (!r.deleted_at || w.admin);
        case "project_prices": return w.prices && canEdit(w, "projects");
        case "activity": return r.kind === "note" && (r.created_by === w.uid && canEdit(w, "activity") || w.admin);
        case "journal_entries": return (!r.deleted_at || w.admin) && (canEdit(w, "all_journal") || (canEdit(w, "journal") && r.created_by === w.uid));
        case "files": return canRead(w, "files", r) && (canEdit(w, "all_files") || (canEdit(w, "files") && r.created_by === w.uid));
        case "contacts": return canEdit(w, "contacts");
        case "tasks": return canEdit(w, "tasks") || (canEdit(w, "own_tasks") && (r.assigned_to === w.uid || r.created_by === w.uid));
        case "task_notes": return r.created_by === w.uid || w.admin;
        case "settings": case "settings_prices": return w.admin;
        case "employees": return canEdit(w, "people");
        case "timesheets": return tsWrites(w, r.employee_id);
        case "push_subscriptions": return r.profile_id === w.uid;
        default: return false;
      }
    }

    function guardUpdate(w, table, old, r, patch) {
      if (table === "profiles" && !w.admin) {
        const allowed = ["full_name", "phone", "color"];
        for (const k of Object.keys(patch)) {
          if (!allowed.includes(k) && JSON.stringify(patch[k]) !== JSON.stringify(old[k])) {
            throw deny("only an admin can change role, switches, e-mail or active");
          }
        }
        if (r.color && !/^#[0-9A-Fa-f]{6}$/.test(r.color)) throw rule("23514", 'new row for relation "profiles" violates check constraint "profiles_color_check"');
        if (r.full_name && r.full_name.length > 120) throw rule("23514", 'new row for relation "profiles" violates check constraint "profiles_full_name_check"');
      }
      if (table === "projects") {
        if (r.number !== old.number && !w.admin) throw deny("only an admin can change a project number");
        if ("legacy_sp_id" in patch && patch.legacy_sp_id !== old.legacy_sp_id) throw deny("only the import may set legacy columns");
        if (!r.name || !String(r.name).trim()) throw rule("23514", 'new row for relation "projects" violates check constraint "projects_name_check"');
        if (!STATUSES.includes(r.status)) throw rule("23514", 'new row for relation "projects" violates check constraint "projects_status_check"');
        if (r.lat !== null && (r.lat < -90 || r.lat > 90)) throw rule("23514", 'new row for relation "projects" violates check constraint "projects_lat_check"');
        if (r.lng !== null && (r.lng < -180 || r.lng > 180)) throw rule("23514", 'new row for relation "projects" violates check constraint "projects_lng_check"');
        if (r.status === "completed" && old.status !== "completed" && r.completed_date === old.completed_date) r.completed_date = today();
        if (r.lat === null || r.lng === null || r.lat === undefined || r.lng === undefined) r.location_source = null;
        else if ((r.lat !== old.lat || r.lng !== old.lng) && r.location_source === old.location_source) r.location_source = "manual";
      }
      if (table === "activity") {
        if (r.kind !== old.kind || r.project_id !== old.project_id) throw deny("a log line keeps its kind and project");
        const len = String(r.text || "").length;
        if (len < 1 || len > 4000) throw rule("23514", 'new row for relation "activity" violates check constraint "activity_text_check"');
      }
      if (table === "journal_entries") {
        if (r.project_id !== old.project_id) throw rule("23514", "a journal entry cannot move to another project");
        if (!JOURNAL_CATS.includes(r.category)) throw rule("23514", 'new row for relation "journal_entries" violates check constraint "journal_entries_category_check"');
      }
      if (table === "files") {
        for (const k of ["project_id", "folder", "storage_path", "storage"]) {
          if (k in patch && patch[k] !== old[k]) throw deny("a file keeps its project, folder and object");
        }
        if ("source" in patch && patch.source !== old.source) throw deny("where a file came from does not change");
        if (old.preview_path && "preview_path" in patch && patch.preview_path !== old.preview_path) throw deny("a file's preview is set once");
        if (r.description !== null && r.description !== undefined && String(r.description).length > 2000) {
          throw rule("23514", 'new row for relation "files" violates check constraint "files_description_check"');
        }
      }
      if (table === "tasks") {
        tasksCheck(w, r, old);
        if (r.status === "done" && old.status !== "done") { r.completed_at = nowIso(); r.completed_by = w.uid; }
        else if (r.status !== "done") { r.completed_at = null; r.completed_by = null; }
        else { r.completed_at = old.completed_at; r.completed_by = old.completed_by; }
      }
      if (table === "task_notes") {
        if (r.task_id !== old.task_id) throw rule("23514", "a note cannot move to another task");
        taskNotesCheck(w, r, old);
      }
      if (table === "employees") {
        if ("legacy_sp_id" in patch && patch.legacy_sp_id !== old.legacy_sp_id) throw deny("only the import may set legacy columns");
        employeesCheck(r, old);
      }
      if (table === "crew_members") throw deny("a crew row is added or removed, never changed");
      if (table === "push_subscriptions" && (r.profile_id !== old.profile_id || r.endpoint !== old.endpoint)) {
        throw deny("a subscription's person and endpoint do not change");
      }
      if (table === "timesheets") {
        timesheetsCheck(r, old);
        // WITH CHECK: the row as it will be must still be in the writer's scope
        if (!tsWrites(w, r.employee_id)) throw new PgErr("42501", 'new row violates row-level security policy for table "timesheets"', 403);
      }
    }

    function afterUpdate(w, table, old, r) {
      if (table === "tasks" && r.assigned_to !== old.assigned_to) {
        taskHandover(w, old, r);
        if (!quiet) taskOutbox(w, r, old);
      }
      if (table === "projects" && r.status !== old.status) {
        const note = r.status_note !== old.status_note && String(r.status_note || "").trim() ? " \u2014 " + r.status_note : "";
        logActivity(w, r.id, "status", "Status: " + statusLabel(old.status) + " \u2192 " + statusLabel(r.status) + note, old.status, r.status);
      }
    }

    function softDelete(w, table, old) {
      const r = clone(old);
      r.deleted_at = nowIso();
      auditUpdate(w, table, r, old);
      commitUpdate(table, old, r);
      const tomb = { id: nextId("deletions"), table_name: table, row_id: r.id,
        project_id: table === "projects" ? r.id : (r.project_id ?? null), deleted_at: r.deleted_at, deleted_by: w.uid };
      commitInsert("deletions", tomb);
      return r;
    }

    /** INSERT (rows already shaped by the client) */
    function insert(ctx, table, input, q) {
      const w = who(ctx);
      if (!w.uid) throw new PgErr("42501", "permission denied for table " + table, 401);
      if (VIEWS[table]) throw new PgErr("42501", "cannot insert into view " + table, 403);
      const list = Array.isArray(input) ? input : [input];
      const made = [];
      const pk = pkOf(table);
      for (const raw of list) {
        checkColumns(table, raw);
        const r = Object.assign(clone(COLS[table]), clone(raw));
        if (table === "push_subscriptions" && canInsert(w, table, r)) pushSubTakeover(r);   // M3 t10: before the conflict check
        if (q && q.upsert) {
          const keys = q.onConflict ? String(q.onConflict).split(",").map((s) => s.trim()) : [pk];
          const hit = keys.every((k) => r[k] !== null && r[k] !== undefined) ? rows[table].find((x) => keys.every((k) => cmp(x[k], r[k]) === 0)) : null;
          if (hit) {
            if (q.ignoreDuplicates) continue;
            const patch = clone(raw);
            delete patch[pk];
            const done = update(ctx, table, patch, { filters: [{ col: pk, op: "eq", val: hit[pk] }] });
            if (!done.length) throw new PgErr("42501", 'new row violates row-level security policy (USING expression) for table "' + table + '"', 403);
            made.push(done[0]);
            continue;
          }
        }
        if (!canInsert(w, table, r)) throw new PgErr("42501", 'new row violates row-level security policy for table "' + table + '"', 403);
        if (UUID_PK.has(table)) { if (!r.id) throw rule("23502", 'null value in column "id"'); }
        else if (pk === "id") r.id = nextId(table);
        else if (rows[table].some((x) => x[pk] === r[pk])) {
          throw new PgErr("23505", 'duplicate key value violates unique constraint "' + table + '_pkey"', 409);
        }
        beforeInsert(w, table, r);
        auditInsert(w, table, r);
        commitInsert(table, r);
        afterInsert(w, table, r);
        made.push(r);
      }
      return made.filter(Boolean);
    }

    /** UPDATE: rows the policy does not let through are simply not matched. */
    function update(ctx, table, patch, q) {
      const w = who(ctx);
      if (!w.uid) throw new PgErr("42501", "permission denied for table " + table, 401);
      if (VIEWS[table]) throw new PgErr("42501", "cannot update view " + table, 403);
      checkColumns(table, patch);
      const p = clone(patch);
      for (const k of ["id", "created_at", "created_by", "updated_at", "updated_by", "version", "is_financial"]) {
        if (k in p && !(k === "version")) delete p[k];
      }
      delete p.version;
      const targets = rows[table].filter((r) => canRead(w, table, r) && passes(r, q, "") && canUpdate(w, table, r));
      const out = [];
      for (const old of targets) {
        const r = Object.assign(clone(old), p);
        guardUpdate(w, table, old, r, p);
        auditUpdate(w, table, r, old);
        commitUpdate(table, old, r);
        afterUpdate(w, table, old, r);
        out.push(r);
      }
      return out;
    }

    /** DELETE: soft-delete tables are hidden, never removed; nothing comes back for them. */
    function del(ctx, table, q) {
      const w = who(ctx);
      if (!w.uid) throw new PgErr("42501", "permission denied for table " + table, 401);
      const targets = rows[table].filter((r) => canRead(w, table, r) && passes(r, q, "") && canDelete(w, table, r));
      const out = [];
      for (const old of targets) {
        if (SOFT.has(table)) { if (!old.deleted_at) softDelete(w, table, old); continue; }
        commitDelete(table, old);
        out.push(old);
      }
      return out;
    }
    function canDelete(w, table, r) {
      if (!w.active) return false;
      switch (table) {
        case "projects": return canEdit(w, "projects");
        case "journal_entries": return canEdit(w, "all_journal") || (canEdit(w, "journal") && r.created_by === w.uid);
        case "files": return canEdit(w, "all_files") || (canEdit(w, "files") && r.created_by === w.uid);
        case "contacts": return canEdit(w, "contacts");
        case "activity": return r.kind === "note" && (r.created_by === w.uid || w.admin);
        case "tasks": return canEdit(w, "tasks") || r.created_by === w.uid;
        case "task_notes": return r.created_by === w.uid || w.admin;
        case "crew_members": return canEdit(w, "people");
        case "timesheets": return tsWrites(w, r.employee_id);
        case "push_subscriptions": return r.profile_id === w.uid;
        default: return false;
      }
    }

    /* ── RPCs ───────────────────────────────────────────────────────── */
    const arg = (a, name) => (a ? a[name] : undefined);
    // the public functions' parameter names (supabase/migrations): PostgREST matches them by name
    const SIGNATURES = {
      create_project: { args: ["fields"], required: ["fields"] },
      next_project_number: { args: [], required: [] },
      search: { args: ["q"], required: ["q"] },
      soft_delete: { args: ["tbl", "id", "version"], required: ["tbl", "id"] },
      set_project_location: { args: ["project_id", "lat", "lng", "accuracy_m", "source"], required: ["project_id", "lat", "lng"] },
      password_changed: { args: [], required: [] },
      my_roster: { args: [], required: [] },
      update_my_contact: { args: ["p_phone", "p_address"], required: ["p_phone", "p_address"] },
      confirm_timesheet_week: { args: ["p_employee_id", "p_week_start", "p_seen_fingerprint"], required: ["p_employee_id", "p_week_start", "p_seen_fingerprint"] },
      unconfirm_timesheet_week: { args: ["p_confirmation_id"], required: ["p_confirmation_id"] },
      timesheet_weeks: { args: ["p_from", "p_to"], required: ["p_from", "p_to"] },
      add_task_note: { args: ["p_task_id", "p_text", "p_client_key"], required: ["p_task_id", "p_text"] },
      complete_task: { args: ["p_id", "p_version", "p_note", "p_via"], required: ["p_id"] },
      my_tasks: { args: ["p_view"], required: [] },
      my_tasks_summary: { args: [], required: [] },
      agents_server_status: { args: [], required: [] },
    };
    function checkArgs(name, args) {
      const sig = SIGNATURES[name];
      if (!sig) return;
      const keys = Object.keys(args || {});
      if (keys.some((k) => !sig.args.includes(k)) || sig.required.some((k) => !keys.includes(k))) {
        throw new PgErr("PGRST202", "Could not find the function public." + name + "(" + keys.join(", ") + ") in the schema cache", 404,
          "Searched for the function public." + name + " with parameters " + keys.join(", "));
      }
    }
    const CREATE_KEYS = ["name", "address", "city", "state", "zip", "client_contact_id", "client_name", "client_phone", "client_email",
      "status", "status_note", "scope", "tags", "plans_url", "start_date", "lat", "lng", "labor_rate", "rate_source"];

    function rpc(ctx, name, args) {
      const w = who(ctx);
      if (!w.uid) throw new PgErr("42501", "permission denied for function " + name, 401);
      checkArgs(name, args);
      switch (name) {
        case "create_project": {
          if (!w.active) throw deny("not allowed");
          if (!canEdit(w, "projects")) throw deny("not allowed to create projects");
          const fields = (args && args.fields) || {};
          for (const k of Object.keys(fields)) if (!CREATE_KEYS.includes(k)) throw rule("22023", "unknown field: " + k);
          if (("labor_rate" in fields || "rate_source" in fields) && !w.prices) throw deny("the labor rate needs the prices switch");
          const f = clone(fields);
          const extra = { labor_rate: f.labor_rate, rate_source: f.rate_source };
          delete f.labor_rate; delete f.rate_source;
          if (f.status === undefined || f.status === null) delete f.status;
          const r = Object.assign(clone(COLS.projects), f);
          beforeInsert(w, "projects", r, true);
          r.id = nextId("projects");
          auditInsert(w, "projects", r);
          commitInsert("projects", r);
          afterInsert(w, "projects", r, extra);
          return clone(r);
        }
        case "next_project_number": {
          if (!canEdit(w, "projects")) throw deny("not allowed");
          return takeNumber();
        }
        case "search":
          if (w.agents) throw deny("the DCR Agents 2 account does not search");
          return search(w, arg(args, "q"));
        case "soft_delete": {
          const tbl = arg(args, "tbl"), id = Number(arg(args, "id")), version = arg(args, "version");
          if (!SOFT.has(tbl)) throw rule("22023", (tbl || "null") + " has no soft delete");
          if (!w.active) throw deny("not allowed to delete this record");
          const old = rows[tbl].find((r) => r.id === id && !r.deleted_at && canRead(w, tbl, r));
          if (!old) throw new PgErr("PT404", "record not found", 404);
          if (version !== undefined && version !== null && Number(version) !== old.version) {
            throw new PgErr("PT409", "the record was changed by someone else", 409, JSON.stringify({ table: tbl, id, version: old.version }));
          }
          if (!canDelete(w, tbl, old)) throw deny("not allowed to delete this record");
          softDelete(w, tbl, old);
          return null;
        }
        case "set_project_location": {
          // 20261020000100_portal2_foundation.sql: write-once, {stored, reason, id, lat, lng, location_source, version}
          if (!w.active) throw deny("sign in first");
          if (w.role === "viewer") throw deny("a view-only account cannot place a project");
          const pidRaw = arg(args, "project_id");
          if (pidRaw === null || pidRaw === undefined) throw rule("22023", "which project (project_id)?");
          const pid = Number(pidRaw);
          const latRaw = arg(args, "lat"), lngRaw = arg(args, "lng");
          const lat = latRaw === null || latRaw === undefined ? NaN : Number(latRaw);
          const lng = lngRaw === null || lngRaw === undefined ? NaN : Number(lngRaw);
          if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            throw rule("22023", "lat must be -90 to 90 and lng -180 to 180");
          }
          const srcRaw = arg(args, "source");
          const src = String(srcRaw === null || srcRaw === undefined ? "gps" : srcRaw).trim().toLowerCase();
          if (!["gps", "geocode", "manual"].includes(src)) throw rule("22023", "source must be gps, geocode or manual");
          const editor = canEdit(w, "projects");
          if (src === "manual" && !editor) throw deny("only a manager or an admin places a project by hand");
          const old = rows.projects.find((p) => p.id === pid && (!p.deleted_at || w.admin));
          if (!old) throw new PgErr("PT404", "project not found", 404);
          const accRaw = arg(args, "accuracy_m");
          const acc = accRaw === null || accRaw === undefined ? null : Number(accRaw);
          const hasPoint = old.lat !== null && old.lng !== null && old.lat !== undefined && old.lng !== undefined;
          let reason = null;
          // an untouched import from the old portal (legacy_sp_id, version 1) takes no automatic point
          if (src !== "manual" && old.legacy_sp_id && Number(old.version || 1) <= 1) reason = "old_portal";
          else if (src === "gps" && (acc === null || !(acc > 0 && acc <= 100))) reason = "accuracy";
          else if (!hasPoint) reason = null;
          else if (src === "geocode") reason = "exists";
          else if (src === "gps" && (old.location_source || "geocode") === "geocode") reason = null;
          else if (editor) reason = null;
          else reason = "exists";
          if (reason) {
            return { stored: false, reason, id: old.id, lat: old.lat, lng: old.lng, location_source: old.location_source, version: old.version };
          }
          const r = Object.assign(clone(old), { lat, lng, location_source: src });
          auditUpdate(w, "projects", r, old);
          commitUpdate("projects", old, r);
          return { stored: true, reason: null, id: r.id, lat: r.lat, lng: r.lng, location_source: r.location_source, version: r.version };
        }
        case "password_changed": {
          if (!w.active) throw deny("sign in first");
          const p = profileOf(w.uid);
          if (!p || !p.must_change_password) return false;
          const r = Object.assign(clone(p), { must_change_password: false });
          auditUpdate(w, "profiles", r, p);
          commitUpdate("profiles", p, r);
          return true;
        }
        case "my_roster": {
          // id, name, number and the normal schedule of the employees in scope — never phone,
          // address or pay
          if (!w.active) throw deny("sign in first");
          return rows.employees.filter((e) => e.active && employeeReads(w, e))
            .sort((a, b) => cmp(a.full_name.toLowerCase(), b.full_name.toLowerCase()))
            .map((e) => ({ id: e.id, full_name: e.full_name, employee_no: e.employee_no, normal_start1: e.normal_start1,
              normal_end1: e.normal_end1, normal_start2: e.normal_start2, normal_end2: e.normal_end2,
              normal_lunch_hours: e.normal_lunch_hours, is_me: e.profile_id === w.uid }));
        }
        case "update_my_contact": {
          if (!w.active) throw deny("sign in first");
          const mine = myEmployeeId(w);
          const old = mine === null ? null : rows.employees.find((e) => e.id === mine);
          const ph = arg(args, "p_phone"), ad = arg(args, "p_address");
          if ((ph === null || ph === undefined) && (ad === null || ad === undefined)) throw rule("22023", "nothing to change (p_phone, p_address)");
          if (ph && String(ph).length > 80) throw rule("22023", "a phone has at most 80 characters");
          if (ad && String(ad).length > 500) throw rule("22023", "an address has at most 500 characters");
          if (!old) throw new PgErr("PT404", "no employee record is linked to your account", 404);
          // NULL leaves a value as it is, a blank clears it
          const r = clone(old);
          if (ph !== null && ph !== undefined) r.phone = String(ph).trim() || null;
          if (ad !== null && ad !== undefined) r.address = String(ad).trim() || null;
          r.phone_e164 = e164(r.phone);
          auditUpdate(w, "employees", r, old);
          commitUpdate("employees", old, r);
          return { id: r.id, phone: r.phone, address: r.address, version: r.version };
        }
        case "timesheet_weeks": {
          if (!w.active) throw deny("sign in first");
          const from = String(arg(args, "p_from") || ""), to = String(arg(args, "p_to") || "");
          if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw rule("22023", "from and to are dates (YYYY-MM-DD)");
          if (to < from) throw rule("22023", "to must not be before from");
          if ((Date.parse(to) - Date.parse(from)) / 86400000 > 120) throw rule("22023", "ask for 120 days or fewer");
          const weeks = [];
          for (let s = saturdayOfYmd(from); s <= to; s = addDaysYmd(s, 7)) weeks.push(s);
          const lo = weeks[0], hi = addDaysYmd(weeks[weeks.length - 1], 6);
          const pairs = new Map();
          const add = (emp, wk) => { const k = emp + "|" + wk; if (!pairs.has(k)) pairs.set(k, { emp, wk }); };
          rows.timesheets.forEach((t) => { if (t.work_date >= lo && t.work_date <= hi && tsReads(w, t.employee_id)) add(t.employee_id, saturdayOfYmd(t.work_date)); });
          rows.timesheet_confirmations.forEach((c) => { if (weeks.includes(c.week_start) && tsReads(w, c.employee_id)) add(c.employee_id, c.week_start); });
          const out = [];
          for (const { emp, wk } of pairs.values()) {
            const end = addDaysYmd(wk, 6);
            const list = rows.timesheets.filter((t) => t.employee_id === emp && t.work_date >= wk && t.work_date <= end);
            const fp = tsFingerprint(list);
            const marks = rows.timesheet_confirmations.filter((c) => c.employee_id === emp && c.week_start === wk)
              .sort((a, b) => cmp(a.confirmed_at, b.confirmed_at) || a.id - b.id).map((c) => {
                const by = profileOf(c.confirmed_by);
                return { id: c.id, confirmed_by: c.confirmed_by, name: by ? (by.full_name || by.email) : "", role: by ? by.role : null, color: by ? by.color : null,
                  confirmed_at: c.confirmed_at, hours_at_confirm: c.hours_at_confirm, stale: c.fingerprint !== fp,
                  mine: c.confirmed_by === w.uid, can_withdraw: c.confirmed_by === w.uid || w.admin };
              });
            const live = marks.filter((m) => !m.stale).length;
            const e = rows.employees.find((x) => x.id === emp);
            out.push({ employee_id: emp, employee_name: e ? e.full_name : "", week_start: wk, week_end: addDaysYmd(wk, 6), fingerprint: fp,
              hours: Math.round(list.reduce((s, t) => s + Number(t.hours || 0), 0) * 100) / 100, entries: list.length,
              confirmed: live > 0, live_count: live, stale_count: marks.length - live, marks });
          }
          return out.sort((a, b) => cmp(a.employee_name.toLowerCase(), b.employee_name.toLowerCase()) || a.employee_id - b.employee_id || cmp(a.week_start, b.week_start));
        }
        case "confirm_timesheet_week": {
          if (!w.active) throw deny("sign in first");
          if (!["admin", "manager", "lead"].includes(w.role)) throw deny("only a lead, a manager or an admin confirms hours");
          const emp = Number(arg(args, "p_employee_id"));
          const wk = String(arg(args, "p_week_start") || "");
          const seen = String(arg(args, "p_seen_fingerprint") || "").trim();
          if (!/^\d{4}-\d{2}-\d{2}$/.test(wk) || saturdayOfYmd(wk) !== wk) throw rule("22023", "a week starts on a Saturday");
          if (wk > today()) throw rule("22023", "that week has not started yet");
          if (!rows.employees.some((e) => e.id === emp)) throw new PgErr("PT404", "employee not found", 404);
          if (!tsWrites(w, emp)) throw deny("a lead confirms only their own crew's hours");
          if (!seen) throw rule("22023", "Reload the week before confirming: this request did not say which hours it was signing for.");
          const end = addDaysYmd(wk, 6);
          const list = rows.timesheets.filter((t) => t.employee_id === emp && t.work_date >= wk && t.work_date <= end);
          const fp = tsFingerprint(list);
          if (seen !== fp) throw new PgErr("PT409", "These hours changed while you were looking at them. Reload the week and check it again.", 409);
          const hours = Math.round(list.reduce((s, t) => s + Number(t.hours || 0), 0) * 100) / 100;
          const old = rows.timesheet_confirmations.find((c) => c.employee_id === emp && c.week_start === wk && c.confirmed_by === w.uid);
          if (old) {
            const r = Object.assign(clone(old), { confirmed_at: nowIso(), hours_at_confirm: hours, fingerprint: fp });
            auditUpdate(w, "timesheet_confirmations", r, old);
            commitUpdate("timesheet_confirmations", old, r);
            return rpc(ctx, "timesheet_weeks", { p_from: wk, p_to: wk }).find((x) => x.employee_id === emp) || null;
          }
          const r = Object.assign(clone(COLS.timesheet_confirmations), { id: nextId("timesheet_confirmations"), employee_id: emp, week_start: wk,
            confirmed_by: w.uid, confirmed_at: nowIso(), hours_at_confirm: hours, fingerprint: fp });
          auditInsert(w, "timesheet_confirmations", r);
          commitInsert("timesheet_confirmations", r);
          return rpc(ctx, "timesheet_weeks", { p_from: wk, p_to: wk }).find((x) => x.employee_id === emp) || null;
        }
        case "unconfirm_timesheet_week": {
          if (!w.active) throw deny("sign in first");
          const id = Number(arg(args, "p_confirmation_id"));
          const old = rows.timesheet_confirmations.find((c) => c.id === id);
          if (!old || !(old.confirmed_by === w.uid || tsReads(w, old.employee_id))) throw new PgErr("PT404", "confirmation not found", 404);
          if (old.confirmed_by !== w.uid && !w.admin) throw deny("You can only withdraw your own confirmation.");
          commitDelete("timesheet_confirmations", old);
          return { removed: true, id: old.id, employee_id: old.employee_id, week_start: old.week_start };
        }
        case "my_tasks": {
          if (!w.active) throw deny("sign in first");
          return myTasks(w, arg(args, "p_view"));
        }
        case "agents_server_status": {
          // an admin only (Portal 2's home page); the shape of public.agents_server_status() (M4)
          if (!w.admin) throw deny("Only an admin can read the DCR Agents 2 status.");
          const at = nowIso();
          const s = agentsServer;
          if (!s) return { ready: false, server: null, lease: null, others: [], status: null, minutesAgo: null, generatedAt: at };
          const minutes = Math.max(0, Math.round((clock().getTime() - Date.parse(s.at)) / 60000));
          const pay = s.payload || {};
          return {
            ready: false,
            server: { host: s.host_id, version: s.version || "", proto: s.proto || 0, lastSeen: s.at, minutesAgo: minutes,
              online: minutes <= (s.proto ? 3 : 12), standby: !!s.standby, paused: pay.paused === true, lastError: pay.lastError || "",
              sentToday: pay.sentToday || 0, failedToday: pay.failedToday || 0, repliesToday: pay.repliesToday || 0,
              enabledAgents: pay.enabledAgents || 0, consoleAt: "", consoleOn: false, assistantAt: "" },
            lease: { host: s.host_id, since: s.since || s.at, by: "started as the DCR server" },
            others: [], status: Object.assign({}, pay, { at: s.at, host: s.host_id }), minutesAgo: minutes, generatedAt: at,
          };
        }
        case "my_tasks_summary": {
          // {mine, mine_needs_update, mine_overdue, mine_due_today, crew, crew_needs_update, everyone,
          //  everyone_needs_update, today}: open tasks; crew / everyone null when the role has no such view
          if (!w.active) throw deny("sign in first");
          const lead = w.role === "lead";
          const office = ["admin", "manager", "lead", "accountant"].includes(w.role);
          const crew = lead ? crewProfiles(w) : [];
          const day = today();
          const open = readable(w, "tasks").filter((t) => t.status === "open").map((t) => ({
            mine: t.assigned_to === w.uid || (!t.assigned_to && t.created_by === w.uid), crew: crew.includes(t.assigned_to),
            due: t.due_date, needs: taskClock(t).needs_update }));
          const count = (f) => open.filter(f).length;
          return { mine: count((o) => o.mine), mine_needs_update: count((o) => o.mine && o.needs),
            mine_overdue: count((o) => o.mine && o.due && o.due < day), mine_due_today: count((o) => o.mine && o.due === day),
            crew: lead ? count((o) => o.mine || o.crew) : null, crew_needs_update: lead ? count((o) => (o.mine || o.crew) && o.needs) : null,
            everyone: office ? open.length : null, everyone_needs_update: office ? count((o) => o.needs) : null, today: day };
        }
        case "add_task_note": {
          // one line, at most 2,000 characters; 23514 "That task is already complete." on a done task; the
          // same client key accepted once (a resend answers the note already written)
          if (!w.active) throw deny("sign in first");
          const raw = arg(args, "p_task_id");
          if (raw === null || raw === undefined) throw rule("22023", "which task (p_task_id)?");
          const id = Number(raw);
          const key = String(arg(args, "p_client_key") === null || arg(args, "p_client_key") === undefined ? "" : arg(args, "p_client_key")).trim();
          if (key && (key.length > 100 || !/^[A-Za-z0-9._:-]+$/.test(key))) {
            throw rule("22023", "a client key is 1 to 100 letters, digits, dots, dashes, colons or underscores");
          }
          const t = rows.tasks.find((x) => x.id === id && canRead(w, "tasks", x));
          if (!t) throw new PgErr("PT404", "That task isn't on your list.", 404);
          const sk = key ? "portal:" + key : null;
          const seen = sk ? rows.task_notes.find((n) => n.task_id === id && n.source_key === sk) : null;
          if (seen) return clone(seen);
          if (t.status === "done") throw rule("23514", "That task is already complete.");
          const words = oneLine(arg(args, "p_text"));
          if (!words) throw rule("22023", "Write an update first.");
          if (words.length > 2000) throw rule("22023", "That update is too long - keep it under 2,000 characters.");
          const n = Object.assign(clone(COLS.task_notes), { task_id: id, text: words, via: "portal", source_key: sk });
          if (!canInsert(w, "task_notes", n)) throw new PgErr("42501", 'new row violates row-level security policy for table "task_notes"', 403);
          n.id = nextId("task_notes");
          taskNotesCheck(w, n, null);
          auditInsert(w, "task_notes", n);
          commitInsert("task_notes", n);
          return clone(n);
        }
        case "complete_task": {
          // the status and the closing note in ONE transaction; done already: answered as it is (completed_by
          // says who) and the closing words still added once (not when the caller already wrote those exact
          // words on it); a moved version: PT409; p_via portal (one line, 2,000) | desktop (trimmed, 4,000)
          if (!w.active) throw deny("sign in first");
          const raw = arg(args, "p_id");
          if (raw === null || raw === undefined) throw rule("22023", "which task (p_id)?");
          const via = String(arg(args, "p_via") === null || arg(args, "p_via") === undefined ? "portal" : arg(args, "p_via")).trim().toLowerCase();
          if (!["portal", "desktop"].includes(via)) throw rule("22023", "p_via is portal or desktop");
          const id = Number(raw);
          const t = rows.tasks.find((x) => x.id === id && canRead(w, "tasks", x));
          if (!t) throw new PgErr("PT404", "That task isn't on your list.", 404);
          const rawNote = arg(args, "p_note");
          const note = via === "portal" ? oneLine(rawNote) : String(rawNote === null || rawNote === undefined ? "" : rawNote).trim();
          const max = via === "portal" ? 2000 : 4000;
          if (note.length > max) throw rule("22023", "That closing note is too long - keep it under " + max.toLocaleString("en-US") + " characters.");
          if (t.status === "done") {
            if (note && !rows.task_notes.some((x) => x.task_id === id && x.created_by === w.uid && x.text === note)) {
              const late = Object.assign(clone(COLS.task_notes), { task_id: id, text: note, via });
              if (!canInsert(w, "task_notes", late)) throw deny("You can only complete the tasks you may change.");
              late.id = nextId("task_notes");
              auditInsert(w, "task_notes", late);
              commitInsert("task_notes", late);
            }
            return clone(t);
          }
          const v = arg(args, "p_version");
          if (v !== null && v !== undefined && Number(v) !== Number(t.version)) {
            throw new PgErr("PT409", "Someone else changed this task first.", 409, JSON.stringify({ table: "tasks", id, version: t.version }));
          }
          if (!canUpdate(w, "tasks", t)) throw deny("You can only complete the tasks you may change.");
          const r = Object.assign(clone(t), { status: "done" });
          guardUpdate(w, "tasks", t, r, { status: "done" });
          auditUpdate(w, "tasks", r, t);
          commitUpdate("tasks", t, r);
          if (note) {
            const n = Object.assign(clone(COLS.task_notes), { id: nextId("task_notes"), task_id: id, text: note, via });
            auditInsert(w, "task_notes", n);
            commitInsert("task_notes", n);
          }
          return clone(r);
        }
        default:
          throw new PgErr("PGRST202", "Could not find the function public." + name + " without parameters in the schema cache", 404,
            "Searched for the function public." + name, null);
      }
    }

    function search(w, qIn) {
      const v = String(qIn ?? "").trim();
      const empty = { projects: [], contacts: [], items: [], tasks: [], files: [] };
      if (v.length < 2 || !w.active) return empty;
      const pat = v.slice(0, 100).toLowerCase();
      const has = (s) => s !== null && s !== undefined && String(s).toLowerCase().includes(pat);
      const digits = /^[0-9 ()+.-]+$/.test(v) && v.replace(/[^0-9]/g, "").length >= 4 ? v.replace(/[^0-9]/g, "") : "";
      const short = /^[Aa]?([0-9]{1,4})(-[A-Za-z]{1,2}|[Tt][0-9])?$/.exec(v);
      const value = short ? Number(short[1]) : null;
      const suffix = short && short[2] ? short[2].toUpperCase() : "";
      const projects = readable(w, "projects").filter((p) => !p.deleted_at).map((p) => {
        const np = numberParts(p.number);
        const hit = value !== null && np.letter === "A" && np.value === value && (suffix === "" || np.suffix === suffix);
        return { p, hit, ok: hit || has(p.number) || has(p.name) || has(p.address) || has(p.city) || has(p.client_name) || has(p.scope) };
      }).filter((x) => x.ok).sort((a, b) => {
        const ea = String(a.p.number).toUpperCase() === v.toUpperCase(), eb = String(b.p.number).toUpperCase() === v.toUpperCase();
        if (ea !== eb) return ea ? -1 : 1;
        if (a.hit !== b.hit) return a.hit ? -1 : 1;
        if (a.hit && b.hit) return numberCmp(a.p.number, b.p.number);
        return numberCmp(b.p.number, a.p.number);
      }).slice(0, 20).map((x) => ({ id: x.p.id, number: x.p.number, name: x.p.name, address: x.p.address, city: x.p.city,
        client_name: x.p.client_name, status: x.p.status }));
      const contacts = readable(w, "contacts").filter((c) => !c.deleted_at && (has(c.name) || has(c.company) || has(c.trade) ||
        has(c.email) || has(c.phone) || has(c.city) || (digits && String(c.phone || "").replace(/[^0-9]/g, "").includes(digits))))
        .sort((a, b) => cmp(a.name, b.name)).slice(0, 20)
        .map((c) => ({ id: c.id, name: c.name, company: c.company, kind: c.kind, trade: c.trade, phone: c.phone, email: c.email, city: c.city, trades: [] }));
      const tasks = readable(w, "tasks").filter((t) => has(t.title) || has(t.description) || has(t.category))
        .sort((a, b) => (a.status === "done") - (b.status === "done") || (a.due_date === null) - (b.due_date === null) ||
          cmp(a.due_date || "", b.due_date || "") || b.id - a.id).slice(0, 20)
        .map((t) => ({ id: t.id, project_id: t.project_id, title: t.title, status: t.status, priority: t.priority, due_date: t.due_date, assigned_to: t.assigned_to }));
      const files = readable(w, "current_files").filter((f) => has(f.name)).sort((a, b) => cmp(b.created_at, a.created_at)).slice(0, 20)
        .map((f) => ({ id: f.id, project_id: f.project_id, folder: f.folder, name: f.name, version_no: f.version_no, created_at: f.created_at }));
      return { projects, contacts, items: [], tasks, files };
    }

    /* ── Storage (bucket project-files) ─────────────────────────────── */
    const KEY_RE = /^([pf])\/([0-9]+)\/([a-z]+)\/[^/]+\/[^/]+$/;
    function canUploadObject(w, key) {
      const m = KEY_RE.exec(key);
      if (!m || !w.active) return false;
      const folder = m[3];
      if (!FOLDERS.includes(folder) || !canEdit(w, "files") || !projectVisible(w, Number(m[2]))) return false;
      if (m[1] === "f" && !canEdit(w, "money")) return false;
      if (folder === "receipts" && m[1] !== "f") return false;
      if (folder === "estimates" && !w.prices) return false;
      if (folder === "invoices" && !canEdit(w, "money")) return false;
      if (folder === "thumbnail" && !canEdit(w, "projects")) return false;
      return true;
    }
    function canReadObject(w, key) {
      return readable(w, "files").some((f) => f.storage_path === key || f.preview_path === key);
    }
    function storageErr(status, statusCode, error, message) {
      const e = new Error(message);
      e.status = status; e.statusCode = String(statusCode); e.error = error;
      e.body = { statusCode: String(statusCode), error, message };
      return e;
    }
    function putObject(w, key, size, mime, blob) {
      objects.set(key, { size, mime, owner: w.uid, created_at: nowIso() });
      if (blob) blobs.set(key, blob);
      emitOp({ k: "obj", key, size, mime, owner: w.uid });
    }
    const storage = {
      bucket: BUCKET,
      upload(ctx, key, size, mime, blob, upsert) {
        const w = who(ctx);
        if (!w.uid) throw storageErr(400, 403, "Unauthorized", "new row violates row-level security policy");
        if (!canUploadObject(w, key)) throw storageErr(400, 403, "Unauthorized", "new row violates row-level security policy");
        if (objects.has(key) && !upsert) throw storageErr(400, 409, "Duplicate", "The resource already exists");
        if (opt.maxFileSize && size > opt.maxFileSize) throw storageErr(413, 413, "Payload too large", "The object exceeded the maximum allowed size");
        putObject(w, key, size, mime, blob);
        return { Key: BUCKET + "/" + key, Id: "obj-" + objects.size };
      },
      tusCreate(ctx, key, length, mime) {
        const w = who(ctx);
        if (!w.uid || !canUploadObject(w, key)) throw storageErr(403, 403, "Unauthorized", "new row violates row-level security policy");
        if (objects.has(key)) throw storageErr(409, 409, "Duplicate", "The resource already exists");
        if (opt.maxFileSize && length > opt.maxFileSize) throw storageErr(413, 413, "Payload too large", "The object exceeded the maximum allowed size");
        tusN += 1;
        const id = "tus" + tusN + "x" + Math.random().toString(36).slice(2, 8);
        tus.set(id, { key, length, offset: 0, mime, chunks: [], owner: w.uid });
        return id;
      },
      tusPatch(ctx, id, offset, chunk, size) {
        const w = who(ctx);
        const u = tus.get(id);
        if (!u) throw storageErr(404, 404, "Not found", "Upload not found");
        if (!w.uid || w.uid !== u.owner) throw storageErr(403, 403, "Unauthorized", "not your upload");
        if (Number(offset) !== u.offset) throw storageErr(409, 409, "Conflict", "Upload-Offset mismatch");
        if (u.offset + size < u.length && size !== CHUNK) throw storageErr(460, 460, "Chunk size", "every chunk but the last must be 6 MiB");
        if (u.offset + size > u.length) throw storageErr(400, 400, "Too long", "more bytes than Upload-Length");
        u.chunks.push(chunk);
        u.offset += size;
        if (u.offset === u.length) {
          let blob = null;
          try { blob = typeof Blob !== "undefined" && u.chunks.every((c) => c && typeof c === "object") ? new Blob(u.chunks, { type: u.mime }) : null; } catch (e) { blob = null; }
          putObject(w, u.key, u.length, u.mime, blob);
          u.done = true;
        }
        return u.offset;
      },
      tusHead(ctx, id) {
        const u = tus.get(id);
        if (!u) throw storageErr(404, 404, "Not found", "Upload not found");
        return { offset: u.offset, length: u.length };
      },
      tusInfo(id) {
        const u = tus.get(id);
        return u ? { key: u.key, done: !!u.done, offset: u.offset, length: u.length } : null;
      },
      /** forget an upload in progress (the tests: "the server lost it" -> 404) */
      tusDrop(id) { tus.delete(id); },
      /** -> {ok, blob?, meta} or throws (404 when not readable: no telling objects apart) */
      sign(ctx, key) {
        const w = who(ctx);
        if (!w.uid || !canReadObject(w, key)) throw storageErr(400, 404, "not_found", "Object not found");
        const meta = objects.get(key) || null;
        return { meta, blob: blobs.get(key) || null };
      },
      remove(ctx, keys) {
        const w = who(ctx);
        if (!w.admin) return [];
        const out = [];
        for (const k of keys) if (objects.delete(k)) { blobs.delete(k); out.push({ name: k }); emitOp({ k: "objdel", key: k }); }
        return out;
      },
      has: (key) => objects.has(key),
      blob: (key) => blobs.get(key) || null,
      setBlob: (key, blob) => blobs.set(key, blob),
    };

    /* Storage over HTTP, as Supabase answers it: POST /storage/v1/object/<bucket>/<key>,
       POST /storage/v1/upload/resumable (TUS create), PATCH / HEAD …/resumable/<id>.
       -> {status, headers, text}; anything else -> null (the caller treats it as no network). */
    function b64dec(s) {
      try {
        if (typeof atob === "function") return new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
        return Buffer.from(String(s), "base64").toString("utf8");
      } catch (e) { return ""; }
    }
    function storageRequest(method, path, hdrs, body) {
      const headers = {};
      for (const k of Object.keys(hdrs || {})) headers[k.toLowerCase()] = hdrs[k];
      const tok = String(headers.authorization || "").replace(/^Bearer\s+/i, "");
      const ctx = { uid: opt.uidFromToken ? opt.uidFromToken(tok) : tok || null };
      const size = body && body.size !== undefined ? body.size : body && body.byteLength !== undefined ? body.byteLength : 0;
      const json = (status, obj, extra) => ({ status, headers: Object.assign({ "content-type": "application/json" }, extra || {}), text: obj === null ? "" : JSON.stringify(obj) });
      const errOut = (e) => (e && e.body ? json(e.status || 400, e.body) : (() => { throw e; })());
      let m = /^\/storage\/v1\/object\/([^/]+)\/(.+)$/.exec(path);
      if (m && method === "POST") {
        const key = m[2].split("/").map(decodeURIComponent).join("/");
        try {
          storage.upload(ctx, key, size, headers["content-type"] || "application/octet-stream", body, headers["x-upsert"] === "true");
          return json(200, { Key: m[1] + "/" + key, Id: "obj-" + objects.size });
        } catch (e) { return errOut(e); }
      }
      if (path === "/storage/v1/upload/resumable" && method === "POST") {
        const meta = {};
        String(headers["upload-metadata"] || "").split(",").forEach((kv) => {
          const [k, v] = kv.trim().split(" ");
          if (k) meta[k] = b64dec(v || "");
        });
        try {
          const id = storage.tusCreate(ctx, meta.objectName, Number(headers["upload-length"]), meta.contentType || "application/octet-stream");
          return { status: 201, headers: { location: "/storage/v1/upload/resumable/" + id, "tus-resumable": "1.0.0" }, text: "" };
        } catch (e) { return errOut(e); }
      }
      m = /^\/storage\/v1\/upload\/resumable\/([^/]+)$/.exec(path);
      if (m && method === "PATCH") {
        try {
          const off = storage.tusPatch(ctx, m[1], Number(headers["upload-offset"]), body, size);
          return { status: 204, headers: { "upload-offset": String(off), "tus-resumable": "1.0.0" }, text: "" };
        } catch (e) { return errOut(e); }
      }
      if (m && method === "HEAD") {
        try {
          const h = storage.tusHead(ctx, m[1]);
          return { status: 200, headers: { "upload-offset": String(h.offset), "upload-length": String(h.length), "tus-resumable": "1.0.0" }, text: "" };
        } catch (e) { return { status: (e && e.status) || 404, headers: {}, text: "" }; }
      }
      return null;
    }
    storage.request = storageRequest;

    /* ── phone reminders (M3, BLUEPRINT 3.3.8): push_subscriptions and the Edge Function "push" ──
       push_subscriptions: own rows only (select, insert, delete; Portal 2 never updates one), profile_id
       default the caller, endpoint https and unique, a device's endpoint taken over by whoever subscribes
       on it now (M3's t10 trigger), the newest 5 per person kept. invoke(ctx, "push", body)
       answers like supabase/functions/push (Desktop 2 repo) with the delivery imitated: every device on
       file counts as reached. public_key gives RFC 8291's published example key (a valid P-256 point;
       the demo never sends anything with it); drain claims the outbox rows like
       app.push_take_new_task_notices (unsent, under 24 hours old, 50 at most). */
    const PUSH_KEEP = 5;
    const PUSH_SITE = "https://portal.dcrframing.com";
    const DEMO_VAPID_PUBLIC = "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
    const PUSH_LIMITS = { title: 80, body: 400, url: 500, tag: 60, profileIds: 50 };
    function pushSubCheck(r) {
      const bad = (c) => rule("23514", 'new row for relation "push_subscriptions" violates check constraint "push_subscriptions_' + c + '_check"');
      const ep = String(r.endpoint || "").trim();
      if (!/^https:\/\/\S+$/i.test(ep) || ep.length > 2000) throw bad("endpoint");
      if (!r.p256dh || String(r.p256dh).length > 200) throw bad("p256dh");
      if (!r.auth || String(r.auth).length > 100) throw bad("auth");
      if (rows.push_subscriptions.some((s) => s.endpoint === ep)) {
        throw new PgErr("23505", 'duplicate key value violates unique constraint "push_subscriptions_endpoint_key"', 409);
      }
      r.endpoint = ep;
      r.last_ok_at = null;
    }
    /** M3's t10 trigger: a device's endpoint moves to whoever subscribes on it now (a shared phone) */
    function pushSubTakeover(r) {
      const ep = String(r.endpoint || "").trim();
      for (const s of rows.push_subscriptions.filter((x) => x.endpoint === ep && x.profile_id !== r.profile_id)) commitDelete("push_subscriptions", s);
    }
    function pushSubKeep(r) {
      const mine = rows.push_subscriptions.filter((s) => s.profile_id === r.profile_id)
        .sort((a, b) => cmp(b.created_at, a.created_at) || b.id - a.id);
      for (const old of mine.slice(PUSH_KEEP)) commitDelete("push_subscriptions", old);
    }
    function invokeFunction(ctx, name, body) {
      const out = (status, data) => ({ status, data: clone(data) });
      const bad = (message) => out(400, { error: "invalid", message });
      if (name !== "push") return out(404, { code: "NOT_FOUND", message: "Requested function was not found" });
      const w = who(ctx);
      if (!w.uid) return out(401, { error: "unauthorized", message: "sign in first" });
      const b = body && typeof body === "object" && !Array.isArray(body) ? body : null;
      if (!b) return bad("the body must be a JSON object");
      if (!["public_key", "key", "send", "test", "drain"].includes(b.op)) return bad("op must be public_key, send, test or drain");
      if (!w.p || !w.p.active) return out(403, { error: "forbidden", message: "This account is not active." });
      const allowed = b.op === "send" ? ["op", "profile_ids", "employee_id", "title", "body", "url", "tag"] : ["op"];
      const extra = Object.keys(b).find((k) => !allowed.includes(k));
      if (extra) return bad("unknown field: " + extra);
      const devicesOf = (pids) => rows.push_subscriptions.filter((s) => pids.includes(s.profile_id));
      const reached = (subs) => {
        for (const s of subs) commitUpdate("push_subscriptions", s, Object.assign(clone(s), { last_ok_at: nowIso() }));
        return { sent: subs.length, gone: 0, failed: 0, none: subs.length === 0 };
      };
      switch (b.op) {
        case "public_key": case "key": return out(200, { key: DEMO_VAPID_PUBLIC });
        case "test": return out(200, reached(devicesOf([w.uid])));
        case "send": {
          if (!["admin", "agents"].includes(w.p.role)) {
            return out(403, { error: "forbidden", message: "Only the DCR Agents account or an admin can send phone notifications." });
          }
          const hasP = b.profile_ids !== undefined && b.profile_ids !== null;
          const hasE = b.employee_id !== undefined && b.employee_id !== null;
          if (hasP === hasE) return bad("give profile_ids or employee_id (one of them)");
          for (const k of ["title", "body", "tag"]) {
            if (b[k] !== undefined && b[k] !== null && typeof b[k] !== "string") return bad(k + " must be text");
            if (typeof b[k] === "string" && Array.from(b[k].trim()).length > PUSH_LIMITS[k]) return bad(k + " is too long (at most " + PUSH_LIMITS[k] + " characters)");
          }
          if (!String(b.title || "").trim() && !String(b.body || "").trim()) return bad("a title or a body is required");
          if (b.url !== undefined && b.url !== null && b.url !== "") {
            let u = null;
            try { u = new URL(String(b.url)); } catch (e) { u = null; }
            if (!u || u.origin !== PUSH_SITE || u.username || u.password || String(b.url).length > PUSH_LIMITS.url) return bad("url must be on " + PUSH_SITE);
          }
          let pids;
          if (hasE) {
            if (!Number.isSafeInteger(b.employee_id) || b.employee_id <= 0) return bad("employee_id must be a positive whole number");
            const e = rows.employees.find((x) => x.id === b.employee_id);
            const p = e && e.profile_id ? profileOf(e.profile_id) : null;
            if (!p || !p.active) return out(404, { error: "not_found", message: "No active account is linked to that employee." });
            pids = [p.id];
          } else {
            if (!Array.isArray(b.profile_ids) || !b.profile_ids.length) return bad("profile_ids must be a list of user ids");
            if (b.profile_ids.length > PUSH_LIMITS.profileIds) return bad("at most " + PUSH_LIMITS.profileIds + " profile_ids");
            pids = Array.from(new Set(b.profile_ids.map((x) => String(x).toLowerCase()))).filter((id) => { const p = profileOf(id); return !!(p && p.active); });
          }
          return out(200, reached(devicesOf(pids)));
        }
        case "drain": {
          // app.push_take_new_task_notices: rows over 24 hours old are marked 'expired' and never pushed; the
          // rest are taken once ('claimed' while the task is still open and still that person's, else
          // 'skipped' and not pushed), 50 at most
          const since = clock().getTime() - 24 * 3600000;
          const waiting = (o) => !o.push_sent_at && !o.push_result;
          for (const o of rows.notifications_outbox.filter((x) => waiting(x) && Date.parse(x.created_at) <= since)) {
            commitUpdate("notifications_outbox", o, Object.assign(clone(o), { push_result: "expired" }));
          }
          const taken = rows.notifications_outbox.filter((o) => waiting(o) && o.to_profile_id && Date.parse(o.created_at) > since)
            .sort((a, b) => a.id - b.id).slice(0, 50);
          const res = { notices: 0, sent: 0, gone: 0, failed: 0, none: 0 };
          for (const o of taken) {
            const t = rows.tasks.find((x) => x.id === o.task_id);
            const live = !!(t && t.status === "open" && t.assigned_to === o.to_profile_id);
            commitUpdate("notifications_outbox", o, Object.assign(clone(o), { push_sent_at: nowIso(), push_result: live ? "claimed" : "skipped" }));
            if (!live) continue;
            res.notices++;
            const p = profileOf(o.to_profile_id);
            const subs = p && p.active && p.role !== "agents" ? devicesOf([p.id]) : [];
            if (!subs.length) res.none++;
            else res.sent += reached(subs).sent;
          }
          return out(200, res);
        }
        default: return bad("op must be public_key, send, test or drain");
      }
    }

    /* ── load, ops, inspection ──────────────────────────────────────── */
    function load(data) {
      quiet++;
      try {
        for (const t of TABLES) {
          rows[t] = (data[t] || []).map((r) => Object.assign(clone(COLS[t]), r));
          const pk = pkOf(t);
          seq[t] = rows[t].reduce((m, r) => (typeof r[pk] === "number" && r[pk] > m ? r[pk] : m), 0);
        }
        for (const [k, v] of Object.entries(data.objects || {})) objects.set(k, v);
        agentsServer = data.agents_server ? clone(data.agents_server) : null;
      } finally { quiet--; }
    }
    function applyOps(ops, loud) {
      if (!loud) quiet++;
      try {
        for (const op of ops || []) {
          if (op.k === "row") {
            const t = op.t, pk = pkOf(t);
            const i = rows[t].findIndex((r) => r[pk] === op.row[pk]);
            const old = i === -1 ? null : rows[t][i];
            if (i === -1) rows[t].push(clone(op.row)); else rows[t][i] = clone(op.row);
            if (typeof op.row[pk] === "number" && op.row[pk] > seq[t]) seq[t] = op.row[pk];
            if (typeof op.seq === "number" && op.seq > seq[t]) seq[t] = op.seq;
            if (loud) emitChangeLoud({ table: t, type: old ? "UPDATE" : "INSERT", new: clone(op.row), old: old ? clone(old) : null });
          } else if (op.k === "del") {
            const pk = pkOf(op.t);
            const i = rows[op.t].findIndex((r) => r[pk] === op.id);
            if (i !== -1) {
              const old = rows[op.t][i];
              rows[op.t].splice(i, 1);
              if (loud) emitChangeLoud({ table: op.t, type: "DELETE", new: null, old: clone(old) });
            }
          } else if (op.k === "obj") {
            objects.set(op.key, { size: op.size, mime: op.mime, owner: op.owner, created_at: nowIso() });
          } else if (op.k === "objdel") {
            objects.delete(op.key); blobs.delete(op.key);
          }
        }
      } finally { if (!loud) quiet--; }
    }
    function emitChangeLoud(evt) {
      for (const cb of Array.from(listeners)) { try { cb(evt); } catch (e) { /* */ } }
    }

    return {
      PgErr, COLS, TABLES, FKS,
      select, insert, update, delete: del, rpc, storage,
      upsert: (ctx, table, input, q) => insert(ctx, table, input, Object.assign({}, q, { upsert: true })),
      who, canRead, profileOf,
      /** an Edge Function call (only "push" exists in the demo): {status, data} */
      invoke: invokeFunction,
      load, applyOps,
      onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
      onOp(cb) { opListeners.add(cb); return () => opListeners.delete(cb); },
      rows, seq, objects,
      /** a write as somebody else (the demo's "someone else edits this") */
      as(uid) { return { uid }; },
    };
  }

  NS.createEngine = createEngine;
  NS.md5 = md5;
  NS.tsFingerprint = tsFingerprint;
  NS.e164 = e164;
  NS.PgErr = PgErr;
  NS.parseSelect = parseSelect;
  NS.parseLogic = parseLogic;
  NS.numberCmp = numberCmp;
  NS.companyDay = companyDay;
  NS.STATUSES = STATUSES;
  NS.CHUNK = CHUNK;
})(typeof globalThis !== "undefined" ? globalThis : this);
