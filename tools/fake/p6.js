/* DCR Portal 2 — DEMO MODE ONLY: phase 6 of the in-memory database (migration M6 20261024000100_agents_phase6,
   BLUEPRINT 3.3.10). Loaded BEFORE engine.js (its column lists are read when engine.js loads) and handed the
   engine's internals when an engine is made (NS.p6 below). Never published (tools/ is not part of the site).

   The same tables, columns, rules, RPC names, parameters and answers as M6 (the old portal's JSON):
   * The console relay: public.agents_console (a uuid id; only the admin who asked reads a row; nobody writes one
     directly). An admin (read live): console_request(p_method, p_args) -> {id, at} (the method's shape, args an
     object of at most 20,000 characters, 60 a minute / 900 an hour - PT429 rate with {retryAfter} in details -,
     20 open - PT429 too_many); console_get(p_id) -> {id, status, method, at, takenAt, doneAt, host, result (the
     envelope's data), error}, expired (new for more than 15 minutes) and lost (taken past its timeout + 2
     minutes) worked out on read; console_cancel(p_id) -> {ok, status} while new. Someone else's id: PT404.
     The agents account: agents_console_feed(), agents_console_take(p_id, p_host, p_timeout) (the oldest new one
     without p_id; atomic), agents_console_done(p_id, p_result, p_host), agents_console_error(p_id, p_error,
     p_host), agents_console_purge(p_host) (expired / lost written, finished rows deleted 10 minutes later).
   * The personal assistants: assistant_profiles (is_on, office_reads, prefs, rev, seen, unread),
     assistant_messages (m_ ids; user | assistant | office; status only on the person's own), assistant_items
     (i_ ids; at / end_at the company's wall clock; added_by employee | office | assistant; fired_at /
     fired_for), assistant_memory (n_ ids; added_by). The person reads their own; an admin reads every profile
     and item, and the chat and notes only where office_reads is on; nobody writes directly. The person:
     my_assistant(p_agenda, p_rev, p_summary) (the old GET, with the agenda), assistant_op(p_op, p_body) (the old
     POST ops), assistant_say(p_text, p_client_id), assistant_pc_status(). The office: assistant_office_list(),
     assistant_set(p_profile_id, p_on, p_office_reads), assistant_office_item(p_profile_id, p_do, p_item_id,
     p_item), assistant_office_view(p_profile_id) (chatHidden while the office may not read). The limits: 40
     messages, 1,500 characters a message, five waiting, 200 items, 50 notes, briefings 12:00 to 20:45.
   * The demo DCR server (`pc`, driven by fake-supabase.js a moment after each request, by the tests directly):
     pc.step() takes the next console request and answers it from tools/fake/pc-demo.js; pc.answerChats()
     answers the waiting chat messages the way an assistant would (no amount, nobody else's details), with a
     card where it fits; pc.officeSays() is a note from the office. Both beat the PC's heartbeat as they work.

   Made-up data only (NS.p6Seed, called by seed.js). */
(function (root) {
  "use strict";
  const NS = (root.DCR2Fake = root.DCR2Fake || {});

  /* ── the tables (M6) ────────────────────────────────────────────────── */
  NS.p6Tables = {
    tables: ["agents_console", "assistant_profiles", "assistant_messages", "assistant_items", "assistant_memory"],
    cols: {
      agents_console: { id: null, token: null, method: null, args: {}, status: "new", result: null, error: null, admin_id: null,
        admin_label: null, at: null, taken_at: null, done_at: null, host: null, timeout_s: null },
      assistant_profiles: { profile_id: null, is_on: false, office_reads: true, office_reads_since: null, prefs: null, rev: 0, seen: null, unread: 0 },
      assistant_messages: { id: null, profile_id: null, role: "user", text: "", status: null, reply_to: null, client_id: null, key: null, cards: [] },
      assistant_items: { id: null, profile_id: null, kind: "todo", text: "", at: null, end_at: null, due: null, location: "", notes: "",
        remind: null, done: false, done_at: null, added_by: "employee", fired_at: null, fired_for: null },
      assistant_memory: { id: null, profile_id: null, text: "", added_by: "employee" },
    },
    pk: { assistant_profiles: "profile_id" },
    uuid: ["agents_console"],
    noAudit: [],
  };

  const L = { ARGS: 20000, RESULT: 60000, OPEN: 20, PER_MIN: 60, PER_HOUR: 900, NEW_TTL: 15 * 60000, LOST_GRACE: 120000, KEEP: 10 * 60000,
    CHAT: 40, TEXT: 1500, WAITING: 5, ITEMS: 200, ITEM_TEXT: 300, NOTES: 1000, MEMORY: 50, MEMORY_TEXT: 300, CARDS: 4,
    BRIEF_FROM: "12:00", BRIEF_TO: "20:45" };
  NS.p6Limits = L;
  const METHOD_RE = /^[a-z][a-z0-9_.]{1,60}$/;
  const CODE_RE = /^[a-z_]{2,20}$/;
  const STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  const CLOCK_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const LINK_RE = /^[a-z0-9-]{1,40}\.html(\?[\w=&%.-]{0,200})?(#[\w-]{0,40})?$/;
  const OPS = ["say", "item.add", "item.update", "item.delete", "item.complete", "memory.add", "memory.delete", "prefs.set", "read"];
  const DEFAULT_PREFS = { evening: true, eveningAt: "18:00", weekly: true, weeklyAt: "18:00", language: "en", emailCopy: false };
  const ROLE_LABEL = { admin: "Admin", manager: "Manager", accountant: "Accountant", lead: "Lead", field: "Field", viewer: "ReadOnly", agents: "Agents" };
  const STATUS_LABEL = { new_request: "New Request", estimating: "Estimating", sent: "Sent", approved: "Approved", in_progress: "In Progress",
    on_hold: "On Hold", completed: "Completed", closed: "Closed", follow_up: "Follow Up" };
  const W = {
    ADMIN_ONLY: "Only an Admin can manage DCR Agents 2.", PC_ONLY: "Only the DCR Agents 2 account can do that.",
    NO_SUCH: "No such request.", BAD_METHOD: "method must be the name of a DCR Agents action, such as dashboard.status.",
    BAD_ARGS: "args must be an object.", TOO_MUCH: "That is too much to send to the DCR server at once.",
    TOO_FAST: "That is a lot of actions in a short time — wait a moment and try again.",
    TOO_MANY: "You have 20 actions waiting on the DCR server — wait for them to finish.",
    NOT_ON: "Your assistant isn’t turned on yet — ask the office.", WAIT_FIRST: "Wait for your assistant to answer first.",
    WRITE_FIRST: "Write a message first.", TOO_LONG: "Keep your message under 1,500 characters.",
    LIST_FULL: "Your list is full - delete some old items first.", OFFICE_ITEM: "The office added this one.",
    ITEM_GONE: "That item is gone - it may have been deleted.", BRIEF_TIME: "Pick a briefing time between 12:00 and 20:45.",
    MEMORY_FULL: "Your assistant already keeps 50 notes - delete one first.", PERSON: "Only an active employee account has an assistant.",
    OFFICE_ONLY: "Only an Admin can manage the assistants.", NO_ROW: "No assistant for that employee.",
  };
  NS.p6Words = W;

  const text = (v) => (v === null || v === undefined ? "" : String(v)).trim();
  const jstr = (v) => (v === null || v === undefined || typeof v === "object" ? "" : String(v));
  const CONTROL = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]", "g");
  const BREAKS = new RegExp("\\r\\n?|[\\u0085\\u2028\\u2029]", "g");
  const BLOCK_JUNK = new RegExp("[\\u0000-\\u0009\\u000b-\\u001f\\u007f-\\u0084\\u0086-\\u009f]", "g");
  const cleanLine = (v) => String(v === null || v === undefined ? "" : v).replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  function cleanBlock(v) {
    return String(v === null || v === undefined ? "" : v).replace(BREAKS, "\n").replace(/\t/g, " ").replace(BLOCK_JUNK, "")
      .split("\n").map((l) => l.replace(/\s+$/, "")).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  function uuid() {
    try { if (root.crypto && typeof root.crypto.randomUUID === "function") return root.crypto.randomUUID(); } catch (e) { /* */ }
    const h = () => Math.floor(Math.random() * 16).toString(16);
    let s = "";
    for (let i = 0; i < 32; i++) s += i === 12 ? "4" : i === 16 ? "8" : h();
    return s.slice(0, 8) + "-" + s.slice(8, 12) + "-" + s.slice(12, 16) + "-" + s.slice(16, 20) + "-" + s.slice(20);
  }
  /* amounts out of free text (M6 app.scrub_money: the old lib/assistant.js scrubMoney) - what the agenda carries */
  const MONEY = /(?:US)?\$\s?\d[\d,]*(?:\.\d+)?(?:\s?[kKmM]\b)?|\b\d[\d,]*(?:\.\d+)?\s?(?:dollars|usd|bucks)\b|\b(?:usd|dollars)\s?\d[\d,]*(?:\.\d+)?(?:\s?[kKmM]\b)?/gi;
  const MONEY_WORDS = "(?:deposits?|paid|payments?|balance|invoiced?|invoices|owes?|owed|costs?|price[ds]?|bid|budget|charged|refund(?:ed)?)";
  const AMOUNT = "(?:\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d{3,}(?:\\.\\d+)?|\\d+(?:\\.\\d+)?\\s?[kK]\\b)";
  const MONEY_NEAR = new RegExp("\\b" + MONEY_WORDS + "\\b(?:\\s+(?:us|them|him|her|me|you|of|for|was|is|at|=|:)){0,2}\\s*" + AMOUNT +
    "|\\b" + AMOUNT + "\\s+(?:in\\s+)?" + MONEY_WORDS + "\\b", "gi");
  const scrubMoney = (v) => String(v === null || v === undefined ? "" : v).replace(MONEY, "[amount]").replace(MONEY_NEAR, "[amount]");
  NS.p6ScrubMoney = scrubMoney;
  const rand36 = (n) => { let s = ""; for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 36).toString(36); return s; };
  /* the old portal's ids: m_ / i_ / n_ + the time in base 36 + 4 random characters */
  const newId = (prefix, now) => prefix + "_" + new Date(now).getTime().toString(36) + rand36(4);
  const stampFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  function localStamp(d) {
    const p = {};
    for (const x of stampFmt.formatToParts(d instanceof Date ? d : new Date(d))) p[x.type] = x.value;
    return p.year + "-" + p.month + "-" + p.day + "T" + (p.hour === "24" ? "00" : p.hour) + ":" + p.minute;
  }
  /* a wall-clock column as PostgREST sends a timestamp without a zone, and back to the old "YYYY-MM-DDTHH:MM" */
  const toWall = (st) => (st ? st + ":00" : null);
  const fromWall = (v) => (v ? String(v).replace(" ", "T").slice(0, 16) : "");
  const addDay = (d, n) => { const [y, m, x] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 1, x + n)).toISOString().slice(0, 10); };
  NS.p6LocalStamp = localStamp;

  /* ── the old item rules (M6 app.assistant_item_fields), refusing with the database's sentences ── */
  function itemFields(kind, raw, partial, today, bad) {
    const r = raw && typeof raw === "object" ? raw : {};
    const has = (k) => Object.prototype.hasOwnProperty.call(r, k);
    const o = {};
    const atRaw = has("at") ? r.at : has("start") ? r.start : undefined;
    const hasAt = has("at") || has("start");
    if (has("text") || has("title") || !partial) {
      const v = cleanLine(jstr(has("text") ? r.text : r.title));
      if (!v) throw bad(kind === "event" ? "Give the event a title." : "Say what it is about.");
      if (v.length > L.ITEM_TEXT) throw bad("Keep it under 300 characters.");
      o.text = v;
    }
    if (kind === "todo") {
      if ((hasAt && text(jstr(atRaw))) || (has("end") && text(jstr(r.end)))) throw bad("A to-do has a due day, not a time.");
      if (has("due") || !partial) {
        const v = text(jstr(r.due));
        if (v && !DAY_RE.test(v)) throw bad("due must be YYYY-MM-DD.");
        if (v && today && (v < addDay(today, -366) || v > addDay(today, 732))) throw bad("That day is too far away.");
        o.due = v;
      }
      if (!partial) { o.at = ""; o.end = ""; o.remind = null; }
    } else {
      if (hasAt || !partial) {
        const v = text(jstr(atRaw));
        if (!STAMP_RE.test(v)) throw bad(kind === "event" ? "start must be YYYY-MM-DDTHH:MM." : "at must be YYYY-MM-DDTHH:MM.");
        if (today && (v.slice(0, 10) < addDay(today, -366) || v.slice(0, 10) > addDay(today, 732))) throw bad("That day is too far away.");
        o.at = v;
      }
      if (has("due") && text(jstr(r.due))) throw bad("Only a to-do has a due day.");
      if (!partial) o.due = "";
    }
    if (kind === "event") {
      if (has("end") || !partial) {
        const v = text(jstr(r.end));
        if (v && !STAMP_RE.test(v)) throw bad("end must be YYYY-MM-DDTHH:MM.");
        o.end = v;
      }
      const hasRem = has("remind") || has("remind_minutes");
      const rem = has("remind") ? r.remind : r.remind_minutes;
      if (hasRem || !partial) {
        if (hasRem && rem === null) o.remind = null;
        else if (!hasRem) o.remind = 30;
        else {
          const n = Number(rem);
          if (!Number.isInteger(n) || n < 0 || n > 1440) throw bad("remind must be 0 to 1440 minutes, or null.");
          o.remind = n;
        }
      }
    } else if (kind === "reminder") {
      if (has("end") && text(jstr(r.end))) throw bad("Only an event has an end.");
      if (!partial) { o.end = ""; o.remind = null; }
    }
    if (has("location") || !partial) {
      const v = cleanLine(jstr(r.location));
      if (v.length > 200) throw bad("Keep the location under 200 characters.");
      o.location = v;
    }
    if (has("notes") || !partial) {
      const v = cleanBlock(jstr(r.notes));
      if (v.length > L.NOTES) throw bad("Keep the notes under 1,000 characters.");
      o.notes = v;
    }
    return o;
  }
  function readPrefs(raw, bad) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw bad("prefs must be an object.");
    const out = {};
    for (const k of ["evening", "weekly", "emailCopy"]) {
      if (raw[k] === undefined) continue;
      if (typeof raw[k] !== "boolean") throw bad(k + " must be true or false.");
      out[k] = raw[k];
    }
    for (const k of ["eveningAt", "weeklyAt"]) {
      if (raw[k] === undefined) continue;
      if (!CLOCK_RE.test(text(raw[k]))) throw bad(k + " must be a time like 18:00.");
      if (text(raw[k]) < L.BRIEF_FROM || text(raw[k]) > L.BRIEF_TO) throw bad(W.BRIEF_TIME);
      out[k] = text(raw[k]);
    }
    if (raw.language !== undefined) {
      if (raw.language !== "en" && raw.language !== "es") throw bad("language must be en or es.");
      out.language = raw.language;
    }
    if (!Object.keys(out).length) throw bad("Nothing to change in prefs.");
    return out;
  }
  function cleanPrefs(p) {
    const x = p && typeof p === "object" ? p : {};
    const brief = (v) => CLOCK_RE.test(text(v)) && text(v) >= L.BRIEF_FROM && text(v) <= L.BRIEF_TO;
    return { evening: typeof x.evening === "boolean" ? x.evening : true, eveningAt: brief(x.eveningAt) ? text(x.eveningAt) : "18:00",
      weekly: typeof x.weekly === "boolean" ? x.weekly : true, weeklyAt: brief(x.weeklyAt) ? text(x.weeklyAt) : "18:00",
      language: x.language === "es" ? "es" : "en", emailCopy: x.emailCopy === true };
  }
  function cleanCards(list) {
    const out = [];
    for (const c of Array.isArray(list) ? list : []) {
      if (out.length >= L.CARDS || !c || typeof c !== "object") continue;
      if (c.type === "item" && /^i_[a-z0-9]{6,24}$/.test(text(c.itemId))) out.push({ type: "item", itemId: text(c.itemId) });
      else if (c.type === "email") out.push({ type: "email", to: text(c.to).slice(0, 200), subject: cleanLine(c.subject).slice(0, 200), body: cleanBlock(c.body).slice(0, 2000) });
      else if (c.type === "task" && /^\d{1,10}$/.test(text(c.taskId))) out.push({ type: "task", taskId: text(c.taskId), name: cleanLine(c.name).slice(0, 200) });
      else if (c.type === "link" && LINK_RE.test(text(c.href)) && cleanLine(c.label)) out.push({ type: "link", href: text(c.href), label: cleanLine(c.label).slice(0, 60) });
    }
    return out;
  }

  /* ── the extension: rules and RPCs over the engine's internals ──────── */
  NS.p6 = function install(E) {
    const { rows, clone, nowIso, PgErr, profileOf, auditInsert, auditUpdate, commitInsert, commitUpdate, commitDelete } = E;
    const TABLES = new Set(NS.p6Tables.tables);
    const now = () => E.clock().getTime();
    const refuse = (code, message, status, hint, details) => new PgErr(code, message, status, details === undefined ? null : details, hint || null);
    const bad = (message) => refuse("22023", message, 400, "invalid");
    const rates = new Map();            // admin id -> [request times] (app.console_rates)

    /* ── who may read (RLS) ───────────────────────────────────────────── */
    function profileRow(pid) { return rows.assistant_profiles.find((p) => p.profile_id === pid) || null; }
    function officeReads(pid) { const p = profileRow(pid); return !!(p && p.office_reads); }
    /* M6 (review fix): the office reads only what was written since office reads went on (office_reads_since) */
    function officeMay(pid, at) {
      const p = profileRow(pid);
      return !!(p && p.office_reads && p.office_reads_since && String(at || "") >= String(p.office_reads_since));
    }
    function canRead(w, table, r) {
      switch (table) {
        case "agents_console": return w.admin && r.admin_id === w.uid;
        case "assistant_profiles": case "assistant_items": return r.profile_id === w.uid || w.admin;
        case "assistant_messages": case "assistant_memory": return r.profile_id === w.uid || (w.admin && officeMay(r.profile_id, r.created_at));
        default: return false;
      }
    }
    function setRow(table, old, patch, uid) {
      const r = Object.assign(clone(old), patch);
      auditUpdate({ uid: uid || null }, table, r, old);
      commitUpdate(table, old, r);
      return r;
    }
    function insertRow(table, r, uid) {
      auditInsert({ uid: uid || null }, table, r);
      commitInsert(table, r);
      return r;
    }

    /* ── the console relay ────────────────────────────────────────────── */
    function state(r) {                               // app.console_state
      const t = now();
      if (r.status === "new" && (!r.at || t - Date.parse(r.at) > L.NEW_TTL)) return "expired";
      if (r.status === "taken") {
        const at = Date.parse(r.taken_at || r.at);
        if (!Number.isFinite(at) || t - at > ((r.timeout_s === null || r.timeout_s === undefined ? 900 : Number(r.timeout_s)) * 1000 + L.LOST_GRACE)) return "lost";
      }
      return r.status;
    }
    const WORDS = {
      expired: "The DCR server did not pick this up — it may be off or in Standby.",
      lost: "The DCR server stopped while working on this — check before trying again.",
      cancelled: "Cancelled before the DCR server picked it up.",
      unreadable: "The DCR server's answer could not be read.", failed: "Something went wrong on the DCR server.",
    };
    const words = (code) => ({ code: code === "unreadable" ? "failed" : code, message: WORDS[code] || WORDS.failed });
    function publicOf(r) {                            // app.console_public
      const st = state(r);
      let status = r.status, result = null, error = null;
      if (st === "expired" && r.status === "new") { status = "expired"; error = words("expired"); }
      else if (st === "lost") { status = "error"; error = words("lost"); }
      else if (r.status === "done") {
        if (r.result && typeof r.result === "object" && !Array.isArray(r.result)) result = r.result.data === undefined ? null : clone(r.result.data);
        else { status = "error"; error = words("unreadable"); }
      } else if (["error", "expired", "cancelled"].includes(r.status)) {
        const e = r.error && typeof r.error === "object" ? r.error : null;
        error = e && CODE_RE.test(text(e.code)) ? { code: text(e.code), message: text(e.message).slice(0, 500) }
          : words(r.status === "expired" ? "expired" : r.status === "cancelled" ? "cancelled" : "failed");
      }
      return { id: r.id, status, method: r.method, at: r.at, takenAt: r.taken_at || null, doneAt: r.done_at || null, host: r.host || null, result, error };
    }
    function freshAdmin(w) { if (!w.admin) throw refuse("42501", W.ADMIN_ONLY, 403, "forbidden"); }
    function freshAgents(w) { if (!w.agents) throw refuse("42501", W.PC_ONLY, 403, "forbidden"); }
    const mineOrNone = (w, id) => rows.agents_console.find((x) => x.id === text(id) && x.admin_id === w.uid) || null;

    function consoleRequest(w, a) {
      freshAdmin(w);
      const method = text(a.p_method);
      if (!METHOD_RE.test(method)) throw refuse("22023", W.BAD_METHOD, 400, "bad_request");
      const args = a.p_args === undefined || a.p_args === null ? {} : a.p_args;
      if (typeof args !== "object" || Array.isArray(args)) throw refuse("22023", W.BAD_ARGS, 400, "bad_request");
      if (JSON.stringify(args).length > L.ARGS) throw refuse("PT413", W.TOO_MUCH, 413, "too_big");
      const t = now();
      const list = (rates.get(w.uid) || []).filter((x) => t - x < 3600000);
      const lastMinute = list.filter((x) => t - x < 60000);
      if (lastMinute.length >= L.PER_MIN || list.length >= L.PER_HOUR) {
        const until = lastMinute.length >= L.PER_MIN ? lastMinute[lastMinute.length - L.PER_MIN] + 60000 : list[list.length - L.PER_HOUR] + 3600000;
        throw refuse("PT429", W.TOO_FAST, 429, "rate", JSON.stringify({ retryAfter: Math.max(1, Math.ceil((until - t) / 1000)) }));
      }
      const open = rows.agents_console.filter((r) => r.admin_id === w.uid && ["new", "taken"].includes(state(r))).length;
      if (open >= L.OPEN) throw refuse("PT429", W.TOO_MANY, 429, "too_many");
      list.push(t);
      rates.set(w.uid, list);
      const p = w.p || {};
      const name = text(p.full_name).replace(/[<>\s]+/g, " ").trim(), email = text(p.email).replace(/[<>\s]/g, "");
      const r = Object.assign(clone(NS.p6Tables.cols.agents_console), {
        id: uuid(), token: rand36(24), method, args: clone(args), status: "new", admin_id: w.uid,
        admin_label: (name && email ? name + " <" + email + ">" : name || (email ? "<" + email + ">" : "an admin")).slice(0, 200), at: nowIso(),
      });
      insertRow("agents_console", r, w.uid);
      return { id: r.id, at: r.at };
    }
    function consoleGet(w, a) {
      freshAdmin(w);
      const r = mineOrNone(w, a.p_id);
      if (!r) throw refuse("PT404", W.NO_SUCH, 404, "not_found");
      return publicOf(r);
    }
    function consoleCancel(w, a) {
      freshAdmin(w);
      const r = mineOrNone(w, a.p_id);
      if (!r) throw refuse("PT404", W.NO_SUCH, 404, "not_found");
      const st = state(r);
      if (st !== "new") return { ok: false, status: st === "lost" ? "error" : st };
      setRow("agents_console", r, { status: "cancelled", done_at: nowIso(), error: words("cancelled") }, w.uid);
      return { ok: true, status: "cancelled" };
    }
    function host(p) { const s = E.server(); return text(p) || (s && s.host_id) || "DCR-OFFICE-PC#agents2"; }
    const itemOf = (r) => ({ id: r.id, method: r.method, args: clone(r.args), at: r.at, admin: r.admin_label, adminId: r.admin_id,
      timeout: r.timeout_s, host: r.host });
    function consoleFeed(w) {
      freshAgents(w);
      const reqs = rows.agents_console.filter((r) => state(r) === "new").sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(0, 50).map(itemOf);
      const s = E.server();
      return { feed: "console", ready: true, requests: reqs, lease: s ? { host: s.host_id, since: s.since || s.at, by: "started as the DCR server" } : null,
        now: nowIso(), generatedAt: nowIso() };
    }
    function consoleTake(w, a) {
      freshAgents(w);
      const h = host(a.p_host);
      const timeout = a.p_timeout === undefined || a.p_timeout === null ? 60 : Number(a.p_timeout);
      if (!Number.isInteger(timeout) || timeout < 5 || timeout > 900) throw refuse("22023", "timeout must be a whole number of seconds from 5 to 900.", 400, "bad_request");
      let r;
      if (a.p_id) {
        r = rows.agents_console.find((x) => x.id === text(a.p_id));
        if (r && r.status === "taken" && r.host === h && state(r) === "taken") return { ok: true, again: true, request: itemOf(r) };
        if (!r || state(r) !== "new") throw refuse("PT409", "That request is no longer waiting.", 409, "gone");
      } else {
        r = rows.agents_console.filter((x) => state(x) === "new").sort((x, y) => String(x.at).localeCompare(String(y.at)))[0];
        if (!r) return { ok: true, request: null };
      }
      const t = setRow("agents_console", r, { status: "taken", taken_at: nowIso(), host: h, timeout_s: timeout }, w.uid);
      return { ok: true, request: itemOf(t) };
    }
    function takenBy(id, h) {
      const r = rows.agents_console.find((x) => x.id === text(id));
      if (!r || r.status !== "taken" || r.host !== h) throw refuse("PT409", "That request is not being worked on by this computer.", 409, "not_yours");
      return r;
    }
    function consoleDone(w, a) {
      freshAgents(w);
      const res = a.p_result;
      if (!res || typeof res !== "object" || Array.isArray(res)) throw refuse("22023", "result must be the answer object.", 400, "bad_request");
      if (JSON.stringify(res).length > L.RESULT) throw refuse("PT413", "That answer is too big to send back through the portal.", 413, "too_big");
      const r = takenBy(a.p_id, host(a.p_host));
      setRow("agents_console", r, { status: "done", result: clone(res), done_at: nowIso() }, w.uid);
      return { ok: true };
    }
    function consoleError(w, a) {
      freshAgents(w);
      const e = a.p_error || {};
      const code = text(e.code);
      if (!CODE_RE.test(code)) throw refuse("22023", "code must be a short error code such as bad_args.", 400, "bad_request");
      const r = takenBy(a.p_id, host(a.p_host));
      setRow("agents_console", r, { status: "error", error: { code, message: cleanLine(e.message).slice(0, 500) }, done_at: nowIso() }, w.uid);
      return { ok: true };
    }
    function consolePurge(w) {
      freshAgents(w);
      const t = now();
      let expired = 0, lost = 0, deleted = 0;
      for (const r of rows.agents_console.slice()) {
        const st = state(r);
        if (st === "expired" && r.status === "new") { setRow("agents_console", r, { status: "expired", done_at: nowIso(), error: words("expired") }, w.uid); expired++; }
        else if (st === "lost") { setRow("agents_console", r, { status: "error", done_at: nowIso(), error: words("lost") }, w.uid); lost++; }
      }
      for (const r of rows.agents_console.slice()) {
        if (["done", "error", "expired", "cancelled"].includes(r.status) && t - Date.parse(r.done_at || r.at) > L.KEEP && deleted < 50) {
          commitDelete("agents_console", r);
          deleted++;
        }
      }
      return { ok: true, deleted, expired, lost };
    }

    /* ── the assistants ───────────────────────────────────────────────── */
    const nameOf = (pid) => { const p = profileOf(pid); return p ? (text(p.full_name) || text(p.email)) : ""; };
    const firstOf = (name) => text(name).split(/\s+/)[0] || "";
    const today = () => E.today();
    function messageJson(m) {
      const out = { id: m.id, role: m.role, text: m.text, at: m.created_at, status: m.status || "" };
      if (m.reply_to) out.replyTo = m.reply_to;
      if (m.client_id) out.clientId = m.client_id;
      if (m.cards && m.cards.length) out.cards = clone(m.cards);
      return out;
    }
    function itemJson(i) {
      return { id: i.id, kind: i.kind, text: i.text, at: fromWall(i.at), end: fromWall(i.end_at), due: i.due || "", location: i.location || "",
        notes: i.notes || "", remind: i.remind === undefined ? null : i.remind, done: !!i.done, doneAt: i.done_at || "", by: i.added_by,
        firedAt: i.fired_at || "", firedFor: fromWall(i.fired_for), created: i.created_at, updated: i.updated_at };
    }
    const memoryJson = (n) => ({ id: n.id, text: n.text, at: n.created_at, by: n.added_by });
    const byTime = (a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id));
    const chatOf = (pid) => rows.assistant_messages.filter((m) => m.profile_id === pid).sort(byTime).map(messageJson);
    const itemsOf = (pid) => rows.assistant_items.filter((i) => i.profile_id === pid).sort(byTime).map(itemJson);
    const memoryOf = (pid) => rows.assistant_memory.filter((n) => n.profile_id === pid).sort(byTime).map(memoryJson);
    function waitingOf(pid) {
      const w = rows.assistant_messages.filter((m) => m.profile_id === pid && m.role === "user" && m.status === "waiting").sort(byTime);
      return w.length ? w[0].created_at : "";
    }
    function dueToday(pid, day) {
      return rows.assistant_items.filter((i) => i.profile_id === pid && !i.done &&
        (i.kind === "todo" ? !!i.due && i.due <= day : fromWall(i.at).slice(0, 10) === day)).length;
    }
    function pcJson() {
      const s = E.server();
      if (!s) return { lastSeen: "", minutesAgo: null, chatAt: "", paused: false };
      const pay = s.payload || {};
      return { lastSeen: s.at, minutesAgo: Math.max(0, Math.round((now() - Date.parse(s.at)) / 60000)), chatAt: pay.assistantAt || "", paused: pay.paused === true };
    }
    /* app.assistant_touch: the newest 40 messages (a waiting question goes last), 200 items, 50 notes; rev + 1;
       unread = the answers and office notes after seen */
    function touch(pid) {
      const msgs = rows.assistant_messages.filter((m) => m.profile_id === pid);
      while (msgs.length > L.CHAT) {
        msgs.sort((a, b) => (Number(a.role === "user" && a.status === "waiting") - Number(b.role === "user" && b.status === "waiting")) || byTime(a, b));
        commitDelete("assistant_messages", msgs.shift());
      }
      const its = rows.assistant_items.filter((i) => i.profile_id === pid);
      while (its.length > L.ITEMS) {
        its.sort((a, b) => (Number(b.done) - Number(a.done)) || byTime(a, b));
        commitDelete("assistant_items", its.shift());
      }
      const cur = profileRow(pid);
      const unread = rows.assistant_messages.filter((m) => m.profile_id === pid && (m.role === "assistant" || m.role === "office") &&
        (!cur.seen || String(m.created_at) > String(cur.seen))).length;
      return setRow("assistant_profiles", cur, { rev: (Number(cur.rev) || 0) + 1, unread }).rev;
    }
    function person(w) { if (!w.active) throw refuse("42501", W.PERSON, 403, "forbidden"); }
    function office(w) { if (!w.admin) throw refuse("42501", W.OFFICE_ONLY, 403, "forbidden"); }

    /* the agenda (M6 app.assistant_agenda + assistant_page_agenda): own hours, own open tasks, own hours filed,
       the linked jobs and their last log lines - amount-free (the demo's words have none) */
    function agendaOf(pid) {
      const day = today();
      const emp = rows.employees.find((e) => e.profile_id === pid) || null;
      const hm = (v) => (v ? String(v).slice(0, 5) : "");
      const projectOf = (id) => rows.projects.find((p) => p.id === id && !p.deleted_at) || null;
      const label = (p) => (p ? [p.number, p.name].filter(Boolean).join(" - ") : "");
      let clocks = [];
      try { clocks = E.myTasks({ uid: pid, p: profileOf(pid), active: true, role: (profileOf(pid) || {}).role, admin: false }, "mine") || []; } catch (e) { clocks = []; }
      const clockById = new Map(clocks.map((c) => [c.id, c]));
      const tasks = rows.tasks.filter((t) => t.assigned_to === pid && t.status === "open").map((t) => {
        const p = projectOf(t.project_id);
        const c = clockById.get(t.id) || {};
        return { id: String(t.id), name: scrubMoney(text(t.title) || "(untitled task)").slice(0, 200), project: label(p), projectId: t.project_id ? String(t.project_id) : "",
          address: p ? text(p.address).slice(0, 200) : "", city: p ? text(p.city) : "", requested: String(t.created_at || "").slice(0, 10),
          lastUpdate: c.last_update ? String(c.last_update).slice(0, 10) : "", lastUpdateText: "", needsUpdate: !!c.needs_update,
          shootDate: t.agent_kind === "photo" && t.agent_date ? t.agent_date : "", lastNote: scrubMoney(text(c.last_note)).slice(0, 300),
          link: "https://portal.dcrframing.com/my-tasks.html?task=" + t.id };
      }).sort((a, b) => (Number(b.needsUpdate) - Number(a.needsUpdate)) || ((a.shootDate ? 0 : 1) - (b.shootDate ? 0 : 1))
        || String(a.shootDate || "9999").localeCompare(String(b.shootDate || "9999")) || a.requested.localeCompare(b.requested) || Number(a.id) - Number(b.id));
      const sheets = emp ? rows.timesheets.filter((t) => t.employee_id === emp.id && t.work_date >= addDay(day, -30) && t.work_date <= day) : [];
      const linked = new Map();
      tasks.forEach((t) => { if (t.projectId) linked.set(Number(t.projectId), "task"); });
      sheets.forEach((t) => { if (t.kind === "work" && t.project_id && !linked.has(t.project_id)) linked.set(t.project_id, "timesheet"); });
      const projects = Array.from(linked.entries()).map(([id, from]) => ({ p: projectOf(id), from })).filter((x) => x.p).map(({ p, from }) => ({
        id: String(p.id), code: p.number, label: label(p), city: text(p.city), address: text(p.address).slice(0, 200), mapLink: "",
        status: STATUS_LABEL[p.status] || "", active: p.status === "approved" || p.status === "in_progress", from, logsAllowed: true,
        logs: rows.activity.filter((a) => a.project_id === p.id && E.companyDay(new Date(a.created_at)) >= addDay(day, -30))
          .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id).slice(0, 5)
          .map((a) => ({ date: E.companyDay(new Date(a.created_at)), text: scrubMoney(text(a.text)).slice(0, 500) })),
      })).sort((a, b) => (a.from === "task" ? 0 : 1) - (b.from === "task" ? 0 : 1) || a.label.localeCompare(b.label));
      const sites = [];
      const seen = new Set();
      projects.forEach((s) => { if (!s.address && !s.city) return; const k = (s.address || s.label).toLowerCase(); if (seen.has(k)) return; seen.add(k);
        sites.push({ label: s.label, address: s.address, city: s.city, mapLink: s.mapLink, from: s.from }); });
      tasks.forEach((t) => { if (!t.address) return; const k = t.address.toLowerCase(); if (seen.has(k)) return; seen.add(k);
        sites.push({ label: t.project || t.name, address: t.address, city: t.city, mapLink: "", from: "task" }); });
      const proj = (t) => label(projectOf(t.project_id));
      return {
        hours: { start: emp ? hm(emp.normal_start1) : "", end: emp ? hm(emp.normal_end2 || emp.normal_end1) : "" },
        tasks, sites,
        timesheets: sheets.filter((t) => t.work_date > addDay(day, -14)).sort((a, b) => b.work_date.localeCompare(a.work_date))
          .map((t) => ({ day: t.work_date, project: t.kind === "work" ? proj(t) : "", hours: Number(t.hours) || 0 })),
        projects,
      };
    }

    function myAssistant(w, a) {
      person(w);
      const pid = w.uid;
      const name = nameOf(pid);
      const p = profileRow(pid);
      if (!p || !p.is_on) {
        if (a.p_summary) return { linked: true, enabled: false, unread: 0, dueToday: 0 };
        return { linked: true, enabled: false, employeeName: name, message: W.NOT_ON };
      }
      if (a.p_summary) return { linked: true, enabled: true, unread: p.unread, dueToday: dueToday(pid, today()) };
      if (a.p_rev !== undefined && a.p_rev !== null && Number(a.p_rev) === Number(p.rev) && !a.p_agenda) {
        return { linked: true, enabled: true, unchanged: true, rev: p.rev, waiting: waitingOf(pid), unread: p.unread, pc: pcJson(), generatedAt: nowIso() };
      }
      const out = { linked: true, enabled: true, employeeName: name, firstName: firstOf(name), rev: p.rev, waiting: waitingOf(pid), chat: chatOf(pid),
        items: itemsOf(pid), memory: memoryOf(pid), prefs: cleanPrefs(p.prefs), officeReads: !!p.office_reads, unread: p.unread,
        dueToday: dueToday(pid, today()), pc: pcJson(), today: today(), now: localStamp(E.clock()), tz: "America/Los_Angeles", generatedAt: nowIso() };
      if (a.p_agenda) out.agenda = agendaOf(pid);
      return out;
    }
    function assistantOp(w, a) {
      person(w);
      const op = text(a.p_op);
      const b = a.p_body === undefined || a.p_body === null ? {} : a.p_body;
      if (typeof b !== "object" || Array.isArray(b)) throw bad("The body must be an object.");
      if (!OPS.includes(op)) throw bad("op must be say, item.add, item.update, item.delete, item.complete, memory.add, memory.delete, prefs.set or read.");
      const pid = w.uid;
      let words = "", client = "", id = "", item = null, prefs = null, done = true;
      if (op === "say") {
        words = cleanBlock(jstr(b.text));
        if (!words) throw bad(W.WRITE_FIRST);
        if (words.length > L.TEXT) throw bad(W.TOO_LONG);
        client = text(jstr(b.clientId));
        if (client && !/^[A-Za-z0-9_-]{1,64}$/.test(client)) throw bad("clientId must be up to 64 letters, digits, - or _.");
      } else if (op === "item.add") {
        const raw = b.item;
        if (!raw || typeof raw !== "object") throw bad("item must be an object.");
        const kind = text(jstr(raw.kind));
        if (!["reminder", "todo", "event"].includes(kind)) throw bad("kind must be reminder, todo or event.");
        item = Object.assign({ kind }, itemFields(kind, raw, false, today(), bad));
        if (kind === "event" && item.end && item.end < item.at) throw bad("The event ends before it starts.");
      } else if (["item.update", "item.delete", "item.complete"].includes(op)) {
        id = text(jstr(b.id));
        if (!/^i_[a-z0-9]{6,24}$/.test(id)) throw bad("Which item?");
        if (op === "item.complete") {
          if (b.done !== undefined && typeof b.done !== "boolean") throw bad("done must be true or false.");
          done = b.done !== false;
        }
      } else if (op === "memory.add") {
        words = cleanLine(jstr(b.text));
        if (!words) throw bad("Write the note first.");
        if (words.length > L.MEMORY_TEXT) throw bad("Keep the note under 300 characters.");
      } else if (op === "memory.delete") {
        id = text(jstr(b.id));
        if (!/^n_[a-z0-9]{6,24}$/.test(id)) throw bad("Which note?");
      } else if (op === "prefs.set") {
        prefs = readPrefs(b.prefs, bad);
      }
      const p = profileRow(pid);
      if (!p || !p.is_on) throw refuse("42501", W.NOT_ON, 403, "not_on");
      if (op === "say") {
        if (client) {
          const was = rows.assistant_messages.find((m) => m.profile_id === pid && m.role === "user" && m.client_id === client);
          if (was) return { ok: true, already: true, message: messageJson(was), rev: p.rev };
        }
        if (rows.assistant_messages.filter((m) => m.profile_id === pid && m.role === "user" && m.status === "waiting").length >= L.WAITING) {
          throw refuse("PT409", W.WAIT_FIRST, 409, "wait_first");
        }
        const m = insertRow("assistant_messages", Object.assign(clone(NS.p6Tables.cols.assistant_messages),
          { id: newId("m", now()), profile_id: pid, role: "user", text: words, status: "waiting", client_id: client || null }), pid);
        return { ok: true, message: messageJson(m), rev: touch(pid) };
      }
      if (op === "item.add") {
        if (rows.assistant_items.filter((i) => i.profile_id === pid).length >= L.ITEMS) throw refuse("PT409", W.LIST_FULL, 409, "full");
        const r = insertRow("assistant_items", rowOfItem(pid, item, "employee"), pid);
        const rev = touch(pid);
        return { ok: true, item: itemJson(rows.assistant_items.find((x) => x.id === r.id)), items: itemsOf(pid), rev };
      }
      if (["item.update", "item.complete", "item.delete"].includes(op)) {
        const it = rows.assistant_items.find((x) => x.profile_id === pid && x.id === id);
        if (!it) {
          if (op === "item.delete") return { ok: true, already: true, items: itemsOf(pid), rev: p.rev };
          throw refuse("PT404", W.ITEM_GONE, 404, "gone");
        }
        if (op === "item.complete") {
          if (!!it.done === done) return { ok: true, already: true, item: itemJson(it), items: itemsOf(pid), rev: p.rev };
          const r = setRow("assistant_items", it, { done, done_at: done ? nowIso() : null }, pid);
          const rev = touch(pid);
          return { ok: true, item: itemJson(r), items: itemsOf(pid), rev };
        }
        if (it.added_by === "office") throw refuse("42501", W.OFFICE_ITEM, 403, "office_item");
        if (op === "item.delete") {
          commitDelete("assistant_items", it);
          return { ok: true, items: itemsOf(pid), rev: touch(pid) };
        }
        const r = patchItem(it, b.patch, pid);
        const rev = touch(pid);
        return { ok: true, item: itemJson(rows.assistant_items.find((x) => x.id === r.id)), items: itemsOf(pid), rev };
      }
      if (op === "memory.add") {
        if (rows.assistant_memory.some((n) => n.profile_id === pid && n.text.toLowerCase() === words.toLowerCase())) {
          return { ok: true, already: true, memory: memoryOf(pid), rev: p.rev };
        }
        if (rows.assistant_memory.filter((n) => n.profile_id === pid).length >= L.MEMORY) throw refuse("PT409", W.MEMORY_FULL, 409, "full");
        insertRow("assistant_memory", Object.assign(clone(NS.p6Tables.cols.assistant_memory), { id: newId("n", now()), profile_id: pid, text: words, added_by: "employee" }), pid);
        return { ok: true, memory: memoryOf(pid), rev: touch(pid) };
      }
      if (op === "memory.delete") {
        const n = rows.assistant_memory.find((x) => x.profile_id === pid && x.id === id);
        if (!n) return { ok: true, already: true, memory: memoryOf(pid), rev: p.rev };
        commitDelete("assistant_memory", n);
        return { ok: true, memory: memoryOf(pid), rev: touch(pid) };
      }
      if (op === "prefs.set") {
        const np = setRow("assistant_profiles", p, { prefs: cleanPrefs(Object.assign({}, p.prefs || {}, prefs)) }, pid);
        return { ok: true, prefs: clone(np.prefs), rev: touch(pid) };
      }
      // read
      if (!p.unread && p.seen) return { ok: true, already: true, rev: p.rev };
      setRow("assistant_profiles", p, { seen: nowIso() }, pid);
      return { ok: true, rev: touch(pid) };
    }
    function rowOfItem(pid, item, by) {
      return Object.assign(clone(NS.p6Tables.cols.assistant_items), {
        id: newId("i", now()), profile_id: pid, kind: item.kind, text: item.text, at: toWall(item.at), end_at: toWall(item.end), due: item.due || null,
        location: item.location || "", notes: item.notes || "", remind: item.remind === undefined ? null : item.remind, added_by: by,
      });
    }
    function patchItem(it, patch, uid) {
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw bad("patch must be an object.");
      if (patch.kind !== undefined && patch.kind !== it.kind) throw bad("An item's kind cannot change - add a new one.");
      if (!["text", "title", "at", "start", "end", "due", "location", "notes", "remind", "remind_minutes"].some((k) => k in patch)) throw bad("Nothing to change.");
      const f = itemFields(it.kind, patch, true, today(), bad);
      const next = { text: f.text !== undefined ? f.text : it.text, at: f.at !== undefined ? toWall(f.at) : it.at,
        end_at: f.end !== undefined ? toWall(f.end) : it.end_at, due: f.due !== undefined ? (f.due || null) : it.due,
        location: f.location !== undefined ? f.location : it.location, notes: f.notes !== undefined ? f.notes : it.notes,
        remind: f.remind !== undefined ? f.remind : it.remind };
      if (it.kind === "event" && next.end_at && next.end_at < next.at) throw bad("The event ends before it starts.");
      if (next.at !== it.at) { next.fired_at = null; next.fired_for = null; }
      return setRow("assistant_items", it, next, uid);
    }
    function say(w, a) {
      person(w);
      return assistantOp(w, { p_op: "say", p_body: { text: a.p_text === undefined || a.p_text === null ? "" : a.p_text, clientId: a.p_client_id || "" } });
    }
    function pcStatus(w) { person(w); return pcJson(); }
    function officeList(w) {
      office(w);
      const people = rows.profiles.filter((p) => p.role !== "agents" && (p.active || profileRow(p.id))).map((p) => {
        const a = profileRow(p.id);
        const e = rows.employees.find((x) => x.profile_id === p.id) || null;
        return { profile_id: p.id, employee_id: e ? e.id : null, name: nameOf(p.id), role: ROLE_LABEL[p.role] || p.role, active: !!p.active,
          on: !!(a && a.is_on), officeReads: a ? !!a.office_reads : true, rev: a ? a.rev : 0, waiting: a ? waitingOf(p.id) : "",
          unread: a ? a.unread : 0, updated: a ? a.updated_at : "", dueToday: a ? dueToday(p.id, today()) : 0 };
      }).sort((x, y) => x.name.toLowerCase().localeCompare(y.name.toLowerCase()) || String(x.profile_id).localeCompare(String(y.profile_id)));
      return { people, generatedAt: nowIso() };
    }
    function officeSet(w, a) {
      office(w);
      if (a.p_on === null || a.p_on === undefined) throw bad("on must be true or false.");
      const pid = text(a.p_profile_id);
      const target = profileOf(pid);
      if (!target || target.role === "agents") throw refuse("PT404", "No such person.", 404, "no_person");
      if (a.p_on && !target.active) throw refuse("22023", "That person needs an active sign-in to have an assistant.", 400, "no_employee");
      const on = !!a.p_on;
      const reads = a.p_office_reads === undefined || a.p_office_reads === null ? null : !!a.p_office_reads;
      let cur = profileRow(pid);
      let out;
      if (!cur) {
        if (!on) out = { ok: true, already: true, rev: 0, created: false };
        else {
          const r0 = reads === null ? true : reads;
          insertRow("assistant_profiles", Object.assign(clone(NS.p6Tables.cols.assistant_profiles), { profile_id: pid, is_on: true,
            office_reads: r0, office_reads_since: r0 ? nowIso() : null, prefs: clone(DEFAULT_PREFS) }), w.uid);
          out = { ok: true, created: true, rev: touch(pid) };
        }
      } else if (cur.is_on === on && (reads === null || cur.office_reads === reads)) {
        out = { ok: true, already: true, rev: cur.rev, created: false };
      } else {
        const next = reads === null ? cur.office_reads : reads;
        const since = !next ? null : cur.office_reads ? cur.office_reads_since : nowIso();
        setRow("assistant_profiles", cur, { is_on: on, office_reads: next, office_reads_since: since }, w.uid);
        if (reads !== null && reads !== !!cur.office_reads) {
          /* M6: the person is told in their chat, in their language */
          const es = (cur.prefs && cur.prefs.language) === "es";
          insertRow("assistant_messages", Object.assign(clone(NS.p6Tables.cols.assistant_messages), { id: newId("m", now()), profile_id: pid,
            role: "office", status: null, text: reads
              ? (es ? "La oficina ahora puede leer tus conversaciones con el asistente, desde este mensaje en adelante (lo anterior sigue privado)."
                : "The office can now read your conversations with the assistant, from this message on (what came before stays private).")
              : (es ? "La oficina ya no lee tus conversaciones con el asistente." : "The office no longer reads your conversations with the assistant.") }), w.uid);
        }
        out = { ok: true, created: false, rev: touch(pid) };
      }
      cur = profileRow(pid);
      return Object.assign(out, { profile: { profile_id: pid, on: !!(cur && cur.is_on), officeReads: cur ? !!cur.office_reads : true } });
    }
    function officeItem(w, a) {
      office(w);
      const what = text(a.p_do).toLowerCase();
      if (!["add", "update", "complete", "delete"].includes(what)) throw bad("do must be add, update, complete or delete.");
      const pid = text(a.p_profile_id);
      let item = null;
      if (what === "add") {
        const raw = a.p_item;
        if (!raw || typeof raw !== "object") throw bad("item must be an object.");
        const kind = text(jstr(raw.kind));
        if (!["reminder", "todo", "event"].includes(kind)) throw bad("kind must be reminder, todo or event.");
        item = Object.assign({ kind }, itemFields(kind, raw, false, today(), bad));
      } else if (!/^i_[a-z0-9]{6,24}$/.test(text(a.p_item_id))) throw bad("Which item?");
      const p = profileRow(pid);
      if (!p) throw refuse("PT404", W.NO_ROW, 404, "no_row");
      if (what === "add") {
        if (rows.assistant_items.filter((i) => i.profile_id === pid).length >= L.ITEMS) return { ok: true, already: true, ids: [], skipped: ["full"], rev: p.rev };
        const r = insertRow("assistant_items", rowOfItem(pid, item, "office"), w.uid);
        return { ok: true, rev: touch(pid), ids: [r.id], skipped: [] };
      }
      const it = rows.assistant_items.find((x) => x.profile_id === pid && x.id === text(a.p_item_id));
      if (!it) return { ok: true, already: true, ids: [], skipped: ["gone"], rev: p.rev };
      if (what === "complete") {
        const done = !(a.p_item && a.p_item.done === false);
        setRow("assistant_items", it, { done, done_at: done ? nowIso() : null }, w.uid);
      } else if (what === "delete") {
        if (it.added_by !== "office") throw refuse("42501", "The office changes only its own items.", 403, "not_office");
        commitDelete("assistant_items", it);
      } else {
        if (it.added_by !== "office") throw refuse("42501", "The office changes only its own items.", 403, "not_office");
        patchItem(it, a.p_item, w.uid);
      }
      return { ok: true, rev: touch(pid), ids: [it.id], skipped: [] };
    }
    function officeView(w, a) {
      office(w);
      const pid = text(a.p_profile_id);
      const p = profileRow(pid);
      if (!p) throw refuse("PT404", W.NO_ROW, 404, "no_row");
      const name = nameOf(pid);
      const since = p.office_reads ? String(p.office_reads_since || "") : "";
      const out = { feed: "assistant", employee: name, firstName: firstOf(name), profile_id: pid, on: !!p.is_on, rev: p.rev, waiting: waitingOf(pid),
        chat: since ? rows.assistant_messages.filter((m) => m.profile_id === pid && String(m.created_at) >= since).sort(byTime).map(messageJson) : [],
        items: itemsOf(pid),
        memory: since ? rows.assistant_memory.filter((n) => n.profile_id === pid && String(n.created_at) >= since).sort(byTime).map(memoryJson) : [],
        prefs: cleanPrefs(p.prefs), officeReads: !!p.office_reads, officeReadsSince: since, unread: p.unread, generatedAt: nowIso() };
      if (!p.office_reads) out.chatHidden = true;
      return out;
    }

    const RPCS = {
      console_request: { args: ["p_method", "p_args"], required: ["p_method"], fn: consoleRequest },
      console_get: { args: ["p_id"], required: ["p_id"], fn: consoleGet },
      console_cancel: { args: ["p_id"], required: ["p_id"], fn: consoleCancel },
      agents_console_feed: { args: [], required: [], fn: consoleFeed },
      agents_console_take: { args: ["p_id", "p_host", "p_timeout"], required: [], fn: consoleTake },
      agents_console_done: { args: ["p_id", "p_result", "p_host"], required: ["p_id", "p_result"], fn: consoleDone },
      agents_console_error: { args: ["p_id", "p_error", "p_host"], required: ["p_id", "p_error"], fn: consoleError },
      agents_console_purge: { args: ["p_host"], required: [], fn: consolePurge },
      my_assistant: { args: ["p_agenda", "p_rev", "p_summary"], required: [], fn: myAssistant },
      assistant_op: { args: ["p_op", "p_body"], required: ["p_op"], fn: assistantOp },
      assistant_say: { args: ["p_text", "p_client_id"], required: ["p_text"], fn: say },
      assistant_pc_status: { args: [], required: [], fn: pcStatus },
      assistant_office_list: { args: [], required: [], fn: officeList },
      assistant_set: { args: ["p_profile_id", "p_on", "p_office_reads"], required: ["p_profile_id", "p_on"], fn: officeSet },
      assistant_office_item: { args: ["p_profile_id", "p_do", "p_item_id", "p_item"], required: ["p_profile_id", "p_do"], fn: officeItem },
      assistant_office_view: { args: ["p_profile_id"], required: ["p_profile_id"], fn: officeView },
    };

    /* ── the demo DCR server (the agents account's side) ──────────────── */
    const agentsId = () => { const a = rows.profiles.find((p) => p.role === "agents" && p.active); return a ? a.id : null; };
    const asPc = () => E.who({ uid: agentsId() });
    const pc = {
      /** take the next console request and answer it (pc-demo.js); -> the request answered, or null */
      step() {
        const w = asPc();
        if (!w.agents) return null;
        E.beat();
        consolePurge(w);
        const t = consoleTake(w, { p_timeout: 60 });
        if (!t.request) return null;
        const q = t.request;
        const tm = NS.pcDemo && NS.pcDemo.timeoutOf ? NS.pcDemo.timeoutOf(q.method) : 60;
        const row = rows.agents_console.find((x) => x.id === q.id);
        if (row && row.timeout_s !== tm) setRow("agents_console", row, { timeout_s: Math.max(5, Math.min(900, tm)) }, w.uid);
        let out;
        try { out = NS.pcDemo ? NS.pcDemo.answer(q.method, q.args || {}, { engine: E, rows, now: E.clock() }) : { error: { code: "unknown_method", message: "" } }; }
        catch (e) { out = { error: { code: "failed", message: "Error: " + (e && e.message) } }; }
        if (out && out.error) consoleError(w, { p_id: q.id, p_error: out.error });
        else consoleDone(w, { p_id: q.id, p_result: { v: 1, ok: true, data: out && "data" in out ? out.data : out, ms: 120, host: host() } });
        return q;
      },
      /** answer every waiting chat message (pc-demo.js reply) -> how many */
      answerChats() {
        const w = asPc();
        if (!w.agents) return 0;
        E.beat();
        const s = E.server();
        if (s) s.payload = Object.assign({}, s.payload || {}, { assistantAt: nowIso() });
        let n = 0;
        const waiting = rows.assistant_messages.filter((m) => m.role === "user" && m.status === "waiting").sort(byTime);
        for (const m of waiting) {
          const p = profileRow(m.profile_id);
          if (!p || !p.is_on) continue;
          const reply = NS.pcDemo && NS.pcDemo.reply ? NS.pcDemo.reply(m.text, { person: profileOf(m.profile_id) || {}, today: today(), now: E.clock(),
            lang: (p.prefs || {}).language }) : { text: "Got it." };
          const cards = [];
          for (const c of reply.cards || []) {
            if (c.type === "item" && c.item) {
              const it = insertRow("assistant_items", rowOfItem(m.profile_id, Object.assign({ kind: c.item.kind },
                itemFields(c.item.kind, c.item, false, today(), bad)), "assistant"), w.uid);
              cards.push({ type: "item", itemId: it.id });
            } else cards.push(c);
          }
          setRow("assistant_messages", rows.assistant_messages.find((x) => x.id === m.id), { status: "answered" }, w.uid);
          insertRow("assistant_messages", Object.assign(clone(NS.p6Tables.cols.assistant_messages), { id: newId("m", now()), profile_id: m.profile_id,
            role: "assistant", text: cleanBlock(reply.text).slice(0, L.TEXT), status: null, reply_to: m.id, key: "answer:" + m.id, cards: cleanCards(cards) }), w.uid);
          touch(m.profile_id);
          n++;
        }
        return n;
      },
      /** a message from the office in someone's chat (the console's Assistants tab, through the PC) */
      officeSays(pid, words) {
        const cur = profileRow(pid);
        if (!cur || !cur.is_on) return null;
        const m = insertRow("assistant_messages", Object.assign(clone(NS.p6Tables.cols.assistant_messages), { id: newId("m", now()), profile_id: pid,
          role: "office", text: cleanBlock(words).slice(0, L.TEXT), status: null, key: "office:" + now() }), agentsId());
        touch(pid);
        return messageJson(m);
      },
      waiting() { return rows.agents_console.filter((r) => state(r) === "new").length; },
      chatsWaiting() { return rows.assistant_messages.filter((m) => m.role === "user" && m.status === "waiting").length; },
    };

    return {
      tables: TABLES,
      canRead,
      state,
      handles: (name) => Object.prototype.hasOwnProperty.call(RPCS, name),
      checkArgs(name, args) {
        const sig = RPCS[name];
        const keys = Object.keys(args || {});
        if (keys.some((k) => !sig.args.includes(k)) || sig.required.some((k) => !keys.includes(k))) {
          throw new PgErr("PGRST202", "Could not find the function public." + name + "(" + keys.join(", ") + ") in the schema cache", 404,
            "Searched for the function public." + name + " with parameters " + keys.join(", "));
        }
      },
      rpc(w, name, args) { return clone(RPCS[name].fn(w, args)); },
      pc,
      limits: L,
      words: W,
    };
  };

  /* ── the made-up assistants (called by seed.js) ─────────────────────── */
  NS.p6Seed = function (out, h) {
    const { P, minutesAgo, today } = h;
    const tomorrow = addDay(today, 1);
    const audit = (at, by) => ({ created_at: at, created_by: by || null, updated_at: at, updated_by: null, version: 1 });
    out.assistant_profiles = [];
    out.assistant_messages = [];
    out.assistant_items = [];
    out.assistant_memory = [];
    out.agents_console = [];
    let mid = 0, iid = 0, nid = 0;
    const id = (p, n) => p + "_seed" + String(n).padStart(4, "0");
    const prof = (key, on, reads, prefs, unread) => out.assistant_profiles.push(Object.assign({ profile_id: P[key], is_on: on, office_reads: reads,
      office_reads_since: reads ? minutesAgo(20 * 1440) : null,
      prefs: Object.assign({}, DEFAULT_PREFS, prefs || {}), rev: 12, seen: minutesAgo(60), unread: unread || 0 }, audit(minutesAgo(20 * 1440), P.admin)));
    // Jordan (field): on, the office reads; Riley (lead): on, the office does not read; Avery (admin): on; the
    // viewer's was turned off again; the managers have none (their page says "ask the office")
    prof("field", true, true, { eveningAt: "18:30" }, 1);
    prof("lead", true, false, { weekly: false });
    prof("admin", true, true, {});
    prof("viewer", false, true, {});
    const msg = (key, role, words, ago, extra) => {
      out.assistant_messages.push(Object.assign({ id: id("m", ++mid), profile_id: P[key], role, text: words,
        status: role === "user" ? "answered" : null, reply_to: null, client_id: null, key: null, cards: [] }, extra || {},
      audit(minutesAgo(ago), role === "user" ? P[key] : null)));
      return id("m", mid);
    };
    const item = (key, kind, words, f, by, ago) => {
      out.assistant_items.push(Object.assign({ id: id("i", ++iid), profile_id: P[key], kind, text: words, at: null, end_at: null, due: null, location: "",
        notes: "", remind: null, done: false, done_at: null, added_by: by || "employee", fired_at: null, fired_for: null }, f || {},
      audit(minutesAgo(ago || 600), by === "office" ? P.admin : P[key])));
      return id("i", iid);
    };
    const wall = (d, hm) => d + "T" + hm + ":00";
    // Jordan's list
    const call = item("field", "reminder", "Call the lumber yard about the Tuesday delivery", { at: wall(today, "15:00") }, "assistant", 300);
    item("field", "event", "Framing inspection", { at: wall(tomorrow, "09:00"), end_at: wall(tomorrow, "10:00"), location: "Sandbox job, north wall", remind: 60 }, "employee", 900);
    item("field", "todo", "Sign the safety sheet", { due: today }, "office", 1500);
    item("field", "todo", "Bring the long level back to the shop", { due: addDay(today, 3), notes: "The 6 ft one." }, "employee", 1300);
    item("field", "todo", "Upload last week's receipts", { done: true, done_at: minutesAgo(2 * 1440) }, "employee", 4000);
    item("field", "event", "Toolbox talk at the shop", { at: wall(addDay(today, 2), "06:30"), end_at: wall(addDay(today, 2), "07:00"), location: "The shop", remind: 30 }, "office", 2000);
    let q = msg("field", "user", "What do I have tomorrow?", 400);
    msg("field", "assistant", "Tomorrow you have the framing inspection at 9:00 am at the Sandbox job (north wall). Your normal start is 7:00 am.", 399, { reply_to: q });
    q = msg("field", "user", "Remind me at 3 pm to call the lumber yard about the Tuesday delivery", 301);
    msg("field", "assistant", "Done. I'll remind you today at 3:00 pm.", 300, { reply_to: q, cards: [{ type: "item", itemId: call }] });
    msg("field", "office", "Thanks for the photos of the north wall this morning.", 120);
    q = msg("field", "user", "Can you draft an email to the office asking for a new tape measure?", 40);
    msg("field", "assistant", "Here is a draft. It opens in your own mail app; nothing is sent by me.", 39, { reply_to: q,
      cards: [{ type: "email", to: "office@example.com", subject: "New tape measure", body: "Hi,\n\nMy 25 ft tape measure broke today. Could the shop order a new one?\n\nThanks,\nJordan" }] });
    out.assistant_memory.push(Object.assign({ id: id("n", ++nid), profile_id: P.field, text: "I start at 7 am most days", added_by: "employee" }, audit(minutesAgo(9000), P.field)));
    out.assistant_memory.push(Object.assign({ id: id("n", ++nid), profile_id: P.field, text: "Prefers reminders by text in the morning", added_by: "assistant" }, audit(minutesAgo(5000), null)));
    // Riley's
    item("lead", "reminder", "Check the crew's hours before Friday", { at: wall(addDay(today, 1), "16:00") }, "employee", 800);
    item("lead", "todo", "Order blocking for the second floor", { due: addDay(today, -1) }, "employee", 3000);
    q = msg("lead", "user", "How is my job going?", 200);
    msg("lead", "assistant", "The Sandbox job had two log lines today: the north wall is sheathed and the hold-downs passed. One task waits for an update.", 199, { reply_to: q });
    // Avery's
    item("admin", "todo", "Review the photo plan for the next shoot", { due: addDay(today, 1) }, "employee", 500);
    q = msg("admin", "user", "What's on my week?", 900);
    msg("admin", "assistant", "This week: one to-do (review the photo plan, due tomorrow). No events yet.", 899, { reply_to: q });
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
