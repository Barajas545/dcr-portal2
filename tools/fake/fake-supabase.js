/* DCR Portal 2 — DEMO MODE ONLY: a stand-in for the supabase-js client, over engine.js + seed.js.

   tools/devserve.mjs serves engine.js + seed.js + this file as /__dev/fake-supabase.js and puts it in
   <head> of every page it serves on 127.0.0.1, in place of the supabase-js <script> tag. It defines
   window.supabase.createClient, so site/js/sb.js (which loads the real library only when none is
   there) builds its one client from this. The published site never contains any of this.

   What it imitates: auth (sign in as a demo account — any password but "wrong"; keep-me-signed-in
   storage; sign-out scopes; password change), from() queries, rpc(), storage (simple and TUS uploads
   through fetch and XMLHttpRequest to the Supabase host, signed URLs), channels (postgres_changes from
   every write, presence:dcr shared between tabs, two made-up colleagues online), with a small delay.
   Writes are kept in this browser (localStorage "dcr2-demo-ops"), so pages, tabs and reloads agree.
   NO request ever leaves for Supabase: anything else sent to a *.supabase.co address fails as offline.
   The tasks map's tiles (*.tile.openstreetmap.org) are drawn here too (a made-up tile per address), so
   nothing goes to OpenStreetMap either.

   window.DCR2Demo and the "DEMO" button (bottom right) offer: sign in as any role, offline on/off,
   colleagues on/off, "someone else edits this", on the task pages "someone else adds an update /
   finishes a task" and "the office gives you a new task", and reset.

   Phase 6: a made-up DCR server computer (tools/fake/p6.js pc + pc-demo.js) takes each console request
   a moment after it is made and answers it, and answers each chat message a little later, the way DCR
   Agents 2 would (in THIS tab: the answer reaches the other tabs as their changes do). It beats its
   heartbeat once a minute while a page is open. On the console and assistant pages the DEMO button also
   offers "the DCR server is off" (requests wait, then expire; chats wait) and "the office writes to you". */
(function (root) {
  "use strict";
  const F = root.DCR2Fake;
  if (!F || !F.createEngine || !F.seed) { console.error("demo: engine.js / seed.js missing"); return; }

  const LS_OPS = "dcr2-demo-ops";
  const LS_REVOKED = "dcr2-demo-revoked";
  const LS_COLLEAGUES = "dcr2-demo-colleagues";
  const SS_OFFLINE = "dcr2-demo-offline";
  const IDB = "dcr2-demo-objects";
  const TAB = Math.random().toString(36).slice(2, 10);

  const memLs = new Map();             // no localStorage (Node, a blocked browser): this page only
  const hasLs = (() => { try { return typeof localStorage !== "undefined" && !!localStorage; } catch (e) { return false; } })();
  const ls = {
    get(k) { try { return hasLs ? localStorage.getItem(k) : (memLs.has(k) ? memLs.get(k) : null); } catch (e) { return null; } },
    set(k, v) { try { if (hasLs) localStorage.setItem(k, v); else memLs.set(k, String(v)); return true; } catch (e) { return false; } },
    del(k) { try { if (hasLs) localStorage.removeItem(k); else memLs.delete(k); } catch (e) { /* */ } },
  };
  const state = {
    offline: (() => { try { return sessionStorage.getItem(SS_OFFLINE) === "1"; } catch (e) { return false; } })(),
    colleagues: ls.get(LS_COLLEAGUES) !== "0",
    latency: 70,
  };
  // "offline" in the demo is what a phone without signal reports too: navigator.onLine is false, so the
  // pages say "no signal" and the upload queue waits for the "online" event, as on a real phone
  try {
    if (root.navigator) Object.defineProperty(root.navigator, "onLine", { configurable: true, get: () => !state.offline });
  } catch (e) { /* this browser keeps its own value */ }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const delay = () => sleep(state.latency * (0.5 + Math.random()));
  const clone = (v) => (v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)));

  /* ── the engine, seeded, with this browser's changes on top ────────── */
  const engine = F.createEngine({ maxFileSize: 500 * 1024 * 1024, uidFromToken: (t) => uidFromToken(t) });
  engine.load(F.seed({ now: new Date() }));
  let ops = [];
  try { ops = JSON.parse(ls.get(LS_OPS) || "[]"); } catch (e) { ops = []; }
  try { engine.applyOps(ops); } catch (e) { console.warn("demo: the saved demo changes did not apply; starting fresh", e); ops = []; ls.del(LS_OPS); }
  let known = ops.length;
  let persistOk = true;
  engine.onOp((op) => {
    ops.push(op);
    known = ops.length;
    if (persistOk && !ls.set(LS_OPS, JSON.stringify(ops))) {
      persistOk = false;
      console.warn("demo: browser storage is full; demo changes now last only for this page");
    }
  });
  if (root.addEventListener) root.addEventListener("storage", (e) => {
    if (e.key === LS_OPS) {
      let all;
      try { all = JSON.parse(e.newValue || "[]"); } catch (x) { return; }
      if (all.length < known) { location.reload(); return; }
      const fresh = all.slice(known);
      ops = all; known = all.length;
      engine.applyOps(fresh, true);
    }
    if (e.key === LS_REVOKED) clients.forEach((c) => c.auth._checkRevoked());
  });

  const PEOPLE = F.PEOPLE;
  const byKey = (k) => PEOPLE.find((p) => p.key === k);
  const sandbox = engine.rows.projects.find((p) => p.number === "A267");

  /* ── objects kept in this browser (uploads), for signed URLs ────────── */
  let idbp = null;
  function idb() {
    if (idbp) return idbp;
    idbp = new Promise((resolve) => {
      try {
        const req = indexedDB.open(IDB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore("o");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
    return idbp;
  }
  async function keepBlob(key, blob) {
    const db = await idb();
    if (!db || !blob) return;
    try { db.transaction("o", "readwrite").objectStore("o").put(blob, key); } catch (e) { /* */ }
  }
  // P5c: an object an Edge Function's stand-in made (tools/fake/p5c-sub.js: the drawn signature) is kept the same way
  F.keepBlob = keepBlob;
  async function findBlob(key) {
    const mem = engine.storage.blob(key);
    if (mem) return mem;
    const db = await idb();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const r = db.transaction("o", "readonly").objectStore("o").get(key);
        r.onsuccess = () => { if (r.result) engine.storage.setBlob(key, r.result); resolve(r.result || null); };
        r.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
  }

  function hash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function placeholder(key, meta) {
    const leaf = decodeURIComponent(String(key).split("/").pop());
    const mime = (meta && meta.mime) || "";
    // P5c: a made-up submission's signature (the seed has no bytes for it) looks like ink on paper, not a photo
    if (/ signature\.png$/.test(leaf)) {
      const k = hash(key) % 40;
      const sig = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="340" viewBox="0 0 900 340"><rect width="100%" height="100%" fill="#fff"/>' +
        '<path d="M70 ' + (220 + k) + " C140 " + (90 + k) + " 190 " + (300 - k) + " 250 180 S360 " + (110 + k) + " 410 210 S520 " + (260 - k) +
        " 580 160 S700 " + (230 + k) + ' 820 150" fill="none" stroke="#12243a" stroke-width="7" stroke-linecap="round"/>' +
        '<line x1="40" y1="290" x2="860" y2="290" stroke="#c9d2dd" stroke-width="2"/></svg>';
      return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(sig);
    }
    const hue = hash(key) % 360;
    const thumb = /\/thumbnail\//.test(key);
    const small = /preview-320/.test(key);
    const w = small ? 320 : 800, h = small ? 240 : 600;
    const kind = thumb ? "Project picture" : mime.indexOf("image/") === 0 || small ? "Photo" : mime.indexOf("video/") === 0 ? "Video"
      : mime.indexOf("audio/") === 0 ? "Voice note" : "Document";
    const art = thumb
      ? '<polygon points="' + w * 0.3 + "," + h * 0.55 + " " + w * 0.5 + "," + h * 0.32 + " " + w * 0.7 + "," + h * 0.55 + '" fill="rgba(255,255,255,.85)"/>' +
        '<rect x="' + w * 0.34 + '" y="' + h * 0.55 + '" width="' + w * 0.32 + '" height="' + h * 0.25 + '" fill="rgba(255,255,255,.75)"/>'
      : '<circle cx="' + w * 0.75 + '" cy="' + h * 0.28 + '" r="' + h * 0.08 + '" fill="rgba(255,255,255,.8)"/>' +
        '<polygon points="0,' + h * 0.85 + " " + w * 0.3 + "," + h * 0.45 + " " + w * 0.55 + "," + h * 0.75 + " " + w * 0.7 + "," + h * 0.55 + " " + w + "," + h * 0.85 + '" fill="rgba(255,255,255,.55)"/>';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(' + hue + ',45%,55%)"/>' +
      '<stop offset="1" stop-color="hsl(' + ((hue + 40) % 360) + ',45%,35%)"/></linearGradient></defs>' +
      '<rect width="100%" height="100%" fill="url(#g)"/>' + art +
      '<text x="' + w / 2 + '" y="' + h * 0.93 + '" font-family="Segoe UI,Arial,sans-serif" font-size="' + (small ? 13 : 22) +
      '" fill="#fff" text-anchor="middle">' + esc(kind + " · demo · " + leaf).slice(0, 90) + "</text></svg>";
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  /* ── sessions ──────────────────────────────────────────────────────── */
  function revokedAt(uid) {
    try { return (JSON.parse(ls.get(LS_REVOKED) || "{}") || {})[uid] || 0; } catch (e) { return 0; }
  }
  function revokeOthers(uid, keepIat) {
    let m = {};
    try { m = JSON.parse(ls.get(LS_REVOKED) || "{}") || {}; } catch (e) { m = {}; }
    m[uid] = keepIat;
    ls.set(LS_REVOKED, JSON.stringify(m));
  }
  function uidFromToken(tok) {
    const m = /^demo\.([0-9a-f-]{36})\.(\d+)/.exec(String(tok || ""));
    if (!m) return null;
    const iat = Number(m[2]);
    return iat >= revokedAt(m[1]) ? m[1] : null;
  }
  function netError() {
    return { message: "TypeError: Failed to fetch", details: "TypeError: Failed to fetch (demo: offline)", hint: "", code: "" };
  }
  function authError(name, code, status, message) {
    const e = new Error(message);
    e.name = name; e.code = code; e.status = status; e.__isAuthError = true;
    return e;
  }

  const clients = [];

  class FakeAuth {
    constructor(client) {
      this.c = client;
      this.listeners = new Set();
      const a = client.opts.auth || {};
      this.storage = a.storage || { getItem: () => null, setItem() {}, removeItem() {} };
      this.key = a.storageKey || "sb-demo-auth-token";
      setTimeout(() => this._emit("INITIAL_SESSION", this._read()), 0);
    }
    _read() {
      let s = null;
      try { s = JSON.parse(this.storage.getItem(this.key) || "null"); } catch (e) { s = null; }
      if (!s || !s.user) return null;
      if (!uidFromToken(s.access_token)) return null;
      return s;
    }
    _write(s) { if (s) this.storage.setItem(this.key, JSON.stringify(s)); else this.storage.removeItem(this.key); }
    _emit(event, s) { for (const cb of Array.from(this.listeners)) { try { cb(event, s); } catch (e) { /* */ } } }
    _checkRevoked() {
      let raw = null;
      try { raw = JSON.parse(this.storage.getItem(this.key) || "null"); } catch (e) { raw = null; }
      if (raw && raw.user && !uidFromToken(raw.access_token)) { this._write(null); this._emit("SIGNED_OUT", null); }
    }
    _session(person) {
      const iat = Date.now();
      const exp = Math.floor(iat / 1000) + 3600;
      return { access_token: "demo." + person.id + "." + iat, token_type: "bearer", expires_in: 3600, expires_at: exp,
        refresh_token: "demo-refresh-" + Math.random().toString(36).slice(2), user: { id: person.id, email: person.email, aud: "authenticated",
          role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2025-01-01T00:00:00Z" } };
    }
    _signInAs(person) {
      const s = this._session(person);
      this._write(s);
      this._emit("SIGNED_IN", s);
      return s;
    }
    async getSession() {
      await sleep(5);
      const s = this._read();
      if (!s) {
        let raw = null;
        try { raw = JSON.parse(this.storage.getItem(this.key) || "null"); } catch (e) { raw = null; }
        if (raw && raw.user) { this._write(null); this._emit("SIGNED_OUT", null); }
      }
      return { data: { session: s }, error: null };
    }
    async getUser() {
      await delay();
      if (state.offline) return { data: { user: null }, error: authError("AuthRetryableFetchError", undefined, 0, "Failed to fetch") };
      const s = this._read();
      return s ? { data: { user: s.user }, error: null } : { data: { user: null }, error: authError("AuthSessionMissingError", "session_missing", 400, "Auth session missing!") };
    }
    async refreshSession() { return this.getSession().then((r) => ({ data: { session: r.data.session, user: r.data.session && r.data.session.user }, error: null })); }
    async signInWithPassword(creds) {
      await delay();
      if (state.offline) return { data: { user: null, session: null }, error: authError("AuthRetryableFetchError", undefined, 0, "Failed to fetch") };
      const email = String((creds && creds.email) || "").trim().toLowerCase();
      const person = PEOPLE.find((p) => p.email === email);
      if (!person || !creds.password || creds.password === "wrong") {
        return { data: { user: null, session: null }, error: authError("AuthApiError", "invalid_credentials", 400, "Invalid login credentials") };
      }
      const s = this._signInAs(person);
      return { data: { user: s.user, session: s }, error: null };
    }
    async signOut(o) {
      const scope = (o && o.scope) || "global";
      await delay();
      const s = this._read();
      if (state.offline && s) return { error: authError("AuthRetryableFetchError", undefined, 0, "Failed to fetch") };
      if (scope === "others") {
        if (s) {
          const iat = Number(String(s.access_token).split(".")[2]);
          revokeOthers(s.user.id, iat);
        }
        return { error: null };
      }
      if (scope === "global" && s) revokeOthers(s.user.id, Date.now() + 1);
      this._write(null);
      this._emit("SIGNED_OUT", null);
      return { error: null };
    }
    async updateUser(attrs) {
      await delay();
      if (state.offline) return { data: { user: null }, error: authError("AuthRetryableFetchError", undefined, 0, "Failed to fetch") };
      const s = this._read();
      if (!s) return { data: { user: null }, error: authError("AuthSessionMissingError", "session_missing", 400, "Auth session missing!") };
      const pw = attrs && attrs.password;
      if (pw !== undefined && (String(pw).length < 10 || !/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw))) {
        return { data: { user: null }, error: authError("AuthWeakPasswordError", "weak_password", 422, "Password should contain at least 10 characters, letters and digits.") };
      }
      this._emit("USER_UPDATED", s);
      return { data: { user: s.user }, error: null };
    }
    onAuthStateChange(cb) {
      this.listeners.add(cb);
      return { data: { subscription: { id: Math.random(), unsubscribe: () => this.listeners.delete(cb) } } };
    }
    async exchangeCodeForSession() { return { data: null, error: authError("AuthApiError", "not_supported", 400, "Not in the demo") }; }
    async resetPasswordForEmail() { return { data: null, error: authError("AuthApiError", "not_supported", 400, "Not in the demo") }; }
    startAutoRefresh() {}
    stopAutoRefresh() {}
  }

  /* ── queries ───────────────────────────────────────────────────────── */
  class Query {
    constructor(client, table) {
      this.c = client; this.t = table; this.m = null;
      this.q = { columns: "*", filters: [], orders: [], foreignLimits: {} };
      this.body = null; this.ret = false; this.sgl = null; this.cnt = null; this.head = false; this.thr = false; this.uopts = {};
    }
    select(cols, o) {
      if (this.m && this.m !== "select") { this.ret = true; this.q.columns = cols || "*"; return this; }
      this.m = "select"; this.q.columns = cols || "*";
      if (o) { this.cnt = o.count || null; this.head = !!o.head; }
      return this;
    }
    insert(v, o) { this.m = "insert"; this.body = v; this.cnt = (o && o.count) || null; return this; }
    upsert(v, o) { this.m = "upsert"; this.body = v; this.uopts = o || {}; this.cnt = (o && o.count) || null; return this; }
    update(v, o) { this.m = "update"; this.body = v; this.cnt = (o && o.count) || null; return this; }
    delete(o) { this.m = "delete"; this.cnt = (o && o.count) || null; return this; }
    _f(col, op, val, neg) { this.q.filters.push({ col, op, val, neg: !!neg }); return this; }
    eq(c, v) { return this._f(c, "eq", v); }
    neq(c, v) { return this._f(c, "neq", v); }
    gt(c, v) { return this._f(c, "gt", v); }
    gte(c, v) { return this._f(c, "gte", v); }
    lt(c, v) { return this._f(c, "lt", v); }
    lte(c, v) { return this._f(c, "lte", v); }
    like(c, v) { return this._f(c, "like", v); }
    ilike(c, v) { return this._f(c, "ilike", v); }
    is(c, v) { return this._f(c, "is", v === null ? "null" : String(v)); }
    in(c, v) { return this._f(c, "in", v); }
    contains(c, v) { return this._f(c, "cs", v); }
    containedBy(c, v) { return this._f(c, "cd", v); }
    overlaps(c, v) { return this._f(c, "ov", v); }
    textSearch(c, v) { return this._f(c, "fts", v); }
    match(o) { for (const k of Object.keys(o || {})) this._f(k, "eq", o[k]); return this; }
    not(c, op, v) { return this._f(c, op, v, true); }
    or(s, o) { const ft = o && (o.referencedTable || o.foreignTable); return this._f(ft ? ft + ".or" : "or", "or", s); }
    filter(c, op, v) { const neg = /^not\./.test(op); return this._f(c, op.replace(/^not\./, ""), v, neg); }
    order(c, o) {
      const ft = o && (o.referencedTable || o.foreignTable);
      this.q.orders.push({ col: c, asc: !o || o.ascending !== false, nullsFirst: o ? o.nullsFirst : undefined, foreign: ft || null });
      return this;
    }
    limit(n, o) {
      const ft = o && (o.referencedTable || o.foreignTable);
      if (ft) this.q.foreignLimits[ft] = { limit: n, offset: 0 }; else this.q.limit = n;
      return this;
    }
    range(a, b, o) {
      const ft = o && (o.referencedTable || o.foreignTable);
      if (ft) this.q.foreignLimits[ft] = { offset: a, limit: b - a + 1 };
      else { this.q.offset = a; this.q.limit = b - a + 1; }
      return this;
    }
    single() { this.sgl = "single"; return this; }
    maybeSingle() { this.sgl = "maybe"; return this; }
    abortSignal() { return this; }
    returns() { return this; }
    overrideTypes() { return this; }
    csv() { return this; }
    throwOnError() { this.thr = true; return this; }
    then(res, rej) { return this._run().then(res, rej); }
    _fail(err, status) {
      if (this.thr) return Promise.reject(Object.assign(new Error(err.message), err));
      return { data: null, error: err, count: null, status, statusText: status === 0 ? "" : "Error" };
    }
    _rowsBy(ctx, made) {
      // the table's own key: project_prices, and the later phases' one-row-per-record tables (P5c: the costs and prices
      // rows keyed by maintenance_id / task_id, NS.extTables[].pk) — an update's answer is the changed rows, as RETURNING
      let pk = this.t === "project_prices" ? "project_id" : "id";
      [F.p6Tables].concat(F.extTables || []).forEach((x) => { if (x && x.pk && x.pk[this.t]) pk = x.pk[this.t]; });
      if (!made.length) return [];
      return engine.select(ctx, this.t, { columns: this.q.columns, filters: [{ col: pk, op: "in", val: made.map((r) => r[pk]) }],
        orders: [{ col: pk, asc: true }], foreignLimits: this.q.foreignLimits }).data;
    }
    async _run() {
      await delay();
      if (state.offline) return this._fail(netError(), 0);
      const ctx = this.c._ctx();
      try {
        let data = null, count = null, status = 200;
        if (!this.m || this.m === "select") {
          const r = engine.select(ctx, this.t, this.q);
          data = this.head ? null : r.data;
          count = this.cnt ? r.count : null;
        } else if (this.m === "insert" || this.m === "upsert") {
          const made = this.m === "upsert"
            ? engine.upsert(ctx, this.t, clone(this.body), { onConflict: this.uopts.onConflict, ignoreDuplicates: this.uopts.ignoreDuplicates })
            : engine.insert(ctx, this.t, clone(this.body));
          status = 201;
          data = this.ret ? this._rowsBy(ctx, made) : null;
          count = this.cnt ? made.length : null;
        } else if (this.m === "update") {
          const changed = engine.update(ctx, this.t, clone(this.body), this.q);
          data = this.ret ? this._rowsBy(ctx, changed) : null;
          status = this.ret ? 200 : 204;
          count = this.cnt ? changed.length : null;
        } else if (this.m === "delete") {
          const gone = engine.delete(ctx, this.t, this.q);
          data = this.ret ? gone.map((r) => clone(r)) : null;
          status = this.ret ? 200 : 204;
          count = this.cnt ? gone.length : null;
        }
        if (this.sgl) {
          const arr = Array.isArray(data) ? data : data === null ? [] : [data];
          if (arr.length === 1) data = arr[0];
          else if (!arr.length && this.sgl === "maybe") data = null;
          else return this._fail({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned",
            details: "The result contains " + arr.length + " rows", hint: null }, 406);
        }
        return { data, error: null, count, status, statusText: "OK" };
      } catch (e) {
        if (e instanceof F.PgErr) return this._fail(e.toJSON(), e.status);
        console.error("demo engine:", e);
        return this._fail({ code: "XX000", message: String(e && e.message), details: null, hint: null }, 500);
      }
    }
  }

  class Rpc {
    constructor(client, name, args) { this.c = client; this.name = name; this.args = args || {}; this.sgl = null; this.thr = false; }
    single() { this.sgl = "single"; return this; }
    maybeSingle() { this.sgl = "maybe"; return this; }
    select() { return this; }
    abortSignal() { return this; }
    throwOnError() { this.thr = true; return this; }
    then(res, rej) { return this._run().then(res, rej); }
    async _run() {
      await delay();
      const fail = (err, status) => (this.thr ? Promise.reject(Object.assign(new Error(err.message), err)) : { data: null, error: err, count: null, status, statusText: "Error" });
      if (state.offline) return fail(netError(), 0);
      try {
        const data = engine.rpc(this.c._ctx(), this.name, clone(this.args));
        afterRpc(this.name);
        return { data: data === undefined ? null : clone(data), error: null, count: null, status: data === null ? 204 : 200, statusText: "OK" };
      } catch (e) {
        if (e instanceof F.PgErr) return fail(e.toJSON(), e.status);
        console.error("demo engine:", e);
        return fail({ code: "XX000", message: String(e && e.message), details: null, hint: null }, 500);
      }
    }
  }

  /* ── phase 6: the made-up DCR server answers (tools/fake/p6.js pc, pc-demo.js) ── */
  const PC_OFF = "dcr2-demo-pc-off";
  state.pcOff = (() => { try { return sessionStorage.getItem(PC_OFF) === "1"; } catch (e) { return false; } })();
  let pcTimer = null, chatTimer = null;
  function pcSoon(ms) {
    if (!engine.p6 || state.pcOff || pcTimer) return;
    pcTimer = setTimeout(() => {
      pcTimer = null;
      if (state.pcOff || state.offline) return;
      let q = null;
      try { q = engine.p6.pc.step(); } catch (e) { console.error("demo DCR server:", e); }
      if (q && engine.p6.pc.waiting()) pcSoon(400 + Math.random() * 500);
    }, ms);
  }
  function chatSoon(ms) {
    if (!engine.p6 || state.pcOff || chatTimer) return;
    chatTimer = setTimeout(() => {
      chatTimer = null;
      if (state.pcOff || state.offline) return;
      try { engine.p6.pc.answerChats(); } catch (e) { console.error("demo assistant:", e); }
    }, ms);
  }
  function afterRpc(name) {
    if (name === "console_request") pcSoon(500 + Math.random() * 900);
    else if (name === "assistant_say") chatSoon(1800 + Math.random() * 1600);
  }
  // the PC beats once a minute while a page is open (and answers what waited while it was "off")
  if (typeof setInterval === "function" && typeof window !== "undefined") {
    setInterval(() => {
      if (state.pcOff || !engine.p6) return;
      try { if (engine.p6.pc.waiting()) pcSoon(200); if (engine.p6.pc.chatsWaiting()) chatSoon(400); } catch (e) { /* */ }
    }, 60000);
  }
  function setPcOff(on) {
    state.pcOff = !!on;
    try { sessionStorage.setItem(PC_OFF, on ? "1" : "0"); } catch (e) { /* */ }
    if (!on && engine.p6) { pcSoon(300); chatSoon(600); }
    paintPanel();
  }

  /* ── storage ───────────────────────────────────────────────────────── */
  const signedCache = new Map();
  function storageError(e) {
    const err = new Error(e.message || "Storage error");
    err.name = "StorageApiError";
    err.status = e.status || 400;
    err.statusCode = String(e.statusCode || e.status || 400);
    err.__isStorageError = true;
    return err;
  }
  async function signedUrl(ctx, path) {
    const r = engine.storage.sign(ctx, path);          // throws when not readable
    if (signedCache.has(path)) return signedCache.get(path);
    const blob = r.blob || await findBlob(path);
    const url = blob && typeof URL !== "undefined" && URL.createObjectURL ? URL.createObjectURL(blob) : placeholder(path, r.meta);
    signedCache.set(path, url);
    return url;
  }
  function bucketApi(client, bucket) {
    const off = () => ({ data: null, error: storageError({ message: "Failed to fetch", status: 0 }) });
    return {
      async upload(path, body, o) {
        await delay();
        if (state.offline) return off();
        try {
          const size = body && (body.size !== undefined ? body.size : body.byteLength || String(body).length);
          engine.storage.upload(client._ctx(), path, size || 0, (o && o.contentType) || (body && body.type) || "application/octet-stream", body, !!(o && o.upsert));
          keepBlob(path, body);
          return { data: { path, id: "demo-" + hash(path), fullPath: bucket + "/" + path }, error: null };
        } catch (e) { return { data: null, error: storageError(e) }; }
      },
      /* P5c: the one upload the subform function minted (no sign-in: the token is the permission) */
      async uploadToSignedUrl(path, token, body, o) {
        await delay();
        if (state.offline) return off();
        try {
          const size = body && (body.size !== undefined ? body.size : body.byteLength || String(body).length);
          engine.storage.uploadSigned(path, token, size || 0, (o && o.contentType) || (body && body.type) || "application/octet-stream", body, bucket);
          keepBlob(path, body);
          return { data: { path, fullPath: bucket + "/" + path }, error: null };
        } catch (e) { return { data: null, error: storageError(e) }; }
      },
      async createSignedUrl(path) {
        await delay();
        if (state.offline) return off();
        try { return { data: { signedUrl: await signedUrl(client._ctx(), path) }, error: null }; }
        catch (e) { return { data: null, error: storageError(e) }; }
      },
      async createSignedUrls(paths) {
        await delay();
        if (state.offline) return off();
        const data = [];
        for (const p of paths || []) {
          try { data.push({ path: p, signedUrl: await signedUrl(client._ctx(), p), error: null }); }
          catch (e) { data.push({ path: p, signedUrl: null, error: "Either the object does not exist or you do not have access to it" }); }
        }
        return { data, error: null };
      },
      async download(path) {
        await delay();
        if (state.offline) return off();
        try {
          const r = engine.storage.sign(client._ctx(), path);
          const blob = r.blob || await findBlob(path);
          if (blob) return { data: blob, error: null };
          const svg = decodeURIComponent(placeholder(path, r.meta).split(",").slice(1).join(","));
          return { data: new Blob([svg], { type: "image/svg+xml" }), error: null };
        } catch (e) { return { data: null, error: storageError(e) }; }
      },
      async remove(paths) {
        await delay();
        if (state.offline) return off();
        return { data: engine.storage.remove(client._ctx(), paths || []), error: null };
      },
      async list() { await delay(); return { data: [], error: null }; },
      getPublicUrl(path) { return { data: { publicUrl: placeholder(path, null) } }; },
    };
  }

  /* ── realtime: changes and presence ────────────────────────────────── */
  const joined = new Set();
  const REPLICA_FULL = new Set(["activity", "timesheets", "tasks", "task_notes"]);

  function parseRtFilter(f) {
    const m = /^([a-z_][a-z0-9_]*)=(eq|neq|lt|lte|gt|gte|in)\.(.*)$/i.exec(String(f || ""));
    return m ? { col: m[1], op: m[2].toLowerCase(), val: m[3] } : null;
  }
  function rtMatch(row, f) {
    if (!f) return true;
    const v = row ? row[f.col] : undefined;
    const s = v === null || v === undefined ? "null" : String(v);
    if (f.op === "eq") return s === f.val;
    if (f.op === "neq") return s !== f.val;
    if (f.op === "in") return f.val.replace(/^\(|\)$/g, "").split(",").map((x) => x.trim()).includes(s);
    const a = Number(s), b = Number(f.val);
    const [x, y] = Number.isFinite(a) && Number.isFinite(b) ? [a, b] : [s, f.val];
    return f.op === "lt" ? x < y : f.op === "lte" ? x <= y : f.op === "gt" ? x > y : x >= y;
  }

  engine.onChange((evt) => {
    for (const ch of Array.from(joined)) {
      if (ch.kind !== "changes") continue;
      const w = engine.who(ch.c._ctx());
      if (!w.active) continue;
      for (const b of ch.bindings) {
        if (b.type !== "postgres_changes") continue;
        const fl = b.filter || {};
        if (fl.table && fl.table !== evt.table) continue;
        if (fl.event && fl.event !== "*" && fl.event !== evt.type) continue;
        const row = evt.type === "DELETE" ? evt.old : evt.new;
        if (!rtMatch(row, parseRtFilter(fl.filter))) continue;
        if (evt.type !== "DELETE" && !engine.canRead(w, evt.table, evt.new)) continue;
        const pk = evt.table === "project_prices" ? "project_id" : "id";
        const oldOut = !evt.old ? {} : REPLICA_FULL.has(evt.table) ? clone(evt.old) : { [pk]: evt.old[pk] };
        const payload = { schema: "public", table: evt.table, commit_timestamp: new Date().toISOString(), eventType: evt.type,
          new: evt.new ? clone(evt.new) : {}, old: oldOut, errors: null };
        setTimeout(() => { try { b.cb(payload); } catch (e) { console.error(e); } }, 40 + Math.random() * 120);
      }
    }
  });

  /* presence: this tab's channels, the other tabs (BroadcastChannel), and two made-up colleagues */
  const remote = new Map();     // tab -> {entries: [{key, meta}], at}
  let bc = null;
  try { bc = typeof window !== "undefined" ? new BroadcastChannel("dcr2-demo-presence") : null; } catch (e) { bc = null; }
  function localEntries() {
    const out = [];
    for (const ch of joined) if (ch.kind === "presence" && ch.tracked) out.push({ key: ch.pkey, meta: ch.tracked });
    return out;
  }
  function announce() { if (bc) { try { bc.postMessage({ tab: TAB, entries: localEntries(), at: Date.now() }); } catch (e) { /* */ } } }
  if (bc) {
    bc.onmessage = (m) => {
      const d = m.data || {};
      if (!d.tab || d.tab === TAB) return;
      if (d.ask) { announce(); return; }
      remote.set(d.tab, { entries: d.entries || [], at: d.at || Date.now() });
      presenceSync();
    };
    setInterval(() => {
      announce();
      let changed = false;
      for (const [k, v] of remote) if (Date.now() - v.at > 15000) { remote.delete(k); changed = true; }
      if (changed) presenceSync();
    }, 5000);
    try { bc.postMessage({ tab: TAB, ask: true }); } catch (e) { /* */ }
    if (root.addEventListener) root.addEventListener("pagehide", () => { try { bc.postMessage({ tab: TAB, entries: [], at: Date.now() }); } catch (e) { /* */ } });
  }
  const since = new Date(Date.now() - 11 * 60000).toISOString();
  function colleagues() {
    if (!state.colleagues) return [];
    const m = byKey("manager"), l = byKey("lead");
    const out = [];
    if (sandbox) out.push({ key: m.id, meta: { user_id: m.id, name: m.name, color: "#2f80d8", view: "project:" + sandbox.id, editing: true, project: String(sandbox.id), since } });
    out.push({ key: l.id, meta: { user_id: l.id, name: l.name, color: "#1f9d55", view: "web:board", editing: false, project: null, since } });
    return out;
  }
  function presenceState() {
    const st = {};
    let n = 0;
    const add = (e) => { (st[e.key] = st[e.key] || []).push(Object.assign({ presence_ref: "ref" + (++n) }, clone(e.meta))); };
    colleagues().forEach(add);
    for (const v of remote.values()) v.entries.forEach(add);
    localEntries().forEach(add);
    return st;
  }
  function presenceSync() {
    for (const ch of Array.from(joined)) {
      if (ch.kind !== "presence") continue;
      for (const b of ch.bindings) {
        if (b.type === "presence" && (!b.filter || !b.filter.event || b.filter.event === "sync")) {
          setTimeout(() => { try { b.cb({}); } catch (e) { console.error(e); } }, 20);
        }
      }
    }
  }

  class Channel {
    constructor(client, topic, opts) {
      this.c = client; this.topic = topic; this.opts = opts || {};
      const cfg = this.opts.config || {};
      this.kind = topic === "presence:dcr" ? "presence" : /^dcr-/.test(topic) ? "changes" : "other";
      this.pkey = (cfg.presence && cfg.presence.key) || "";
      this.bindings = [];
      this.tracked = null;
      this.statusCb = null;
      this.state = "closed";
    }
    on(type, filter, cb) { this.bindings.push({ type, filter: filter || {}, cb }); return this; }
    subscribe(cb) {
      this.statusCb = cb || null;
      setTimeout(() => this._join(), 40 + Math.random() * 120);
      return this;
    }
    _status(s) { if (this.statusCb) { try { this.statusCb(s, s === "CHANNEL_ERROR" ? new Error("refused") : undefined); } catch (e) { console.error(e); } } }
    _join() {
      if (this.state === "left") return;
      const w = engine.who(this.c._ctx());
      if (state.offline) { this._status("CHANNEL_ERROR"); return; }
      if (!w.active || !(this.opts.config && this.opts.config.private)) { this._status("CHANNEL_ERROR"); return; }
      this.state = "joined";
      joined.add(this);
      this._status("SUBSCRIBED");
      if (this.kind === "presence") presenceSync();
    }
    _drop(status) {
      if (this.state !== "joined") return;
      this.state = "closed";
      joined.delete(this);
      this._status(status);
    }
    async track(meta) {
      if (this.state !== "joined") return "error";
      this.tracked = clone(meta);
      announce(); presenceSync();
      return "ok";
    }
    async untrack() { this.tracked = null; announce(); presenceSync(); return "ok"; }
    presenceState() { return presenceState(); }
    async send() { return "ok"; }
    async unsubscribe() {
      const was = this.state === "joined";
      this.state = "left";
      joined.delete(this);
      if (this.tracked) { this.tracked = null; announce(); presenceSync(); }
      if (was) this._status("CLOSED");
      return "ok";
    }
  }

  /* ── the client ────────────────────────────────────────────────────── */
  class FakeClient {
    constructor(url, key, opts) {
      this.supabaseUrl = url; this.supabaseKey = key; this.opts = opts || {};
      this.auth = new FakeAuth(this);
      this.channelsList = [];
      const self = this;
      this.storage = { from: (bucket) => bucketApi(self, bucket) };
      this.realtime = { setAuth: async () => {}, channels: this.channelsList };
      // Edge Functions: "push" is imitated by the engine (engine.invoke); answered the way supabase-js
      // answers: {data, error}, error.context = the Response of a non-2xx answer, FunctionsFetchError offline
      this.functions = {
        invoke: async (name, opts) => {
          await delay();
          if (state.offline) {
            return { data: null, error: { name: "FunctionsFetchError", message: "Failed to send a request to the Edge Function",
              context: new TypeError("Failed to fetch (demo: offline)") } };
          }
          let body = opts && opts.body;
          if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
          const r = engine.invoke(self._ctx(), String(name), body === undefined ? {} : body);
          if (r.status >= 200 && r.status < 300) return { data: r.data, error: null };
          return { data: null, error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code",
            context: new Response(JSON.stringify(r.data), { status: r.status, headers: { "content-type": "application/json" } }) } };
        },
      };
      clients.push(this);
    }
    _ctx() {
      let s = null;
      try { s = JSON.parse(this.auth.storage.getItem(this.auth.key) || "null"); } catch (e) { s = null; }
      return { uid: s ? uidFromToken(s.access_token) : null };
    }
    from(table) { return new Query(this, table); }
    schema() { return this; }
    rpc(name, args) { return new Rpc(this, name, args); }
    channel(topic, opts) { const ch = new Channel(this, topic, opts); this.channelsList.push(ch); return ch; }
    getChannels() { return this.channelsList.slice(); }
    async removeChannel(ch) { if (ch) await ch.unsubscribe(); this.channelsList = this.channelsList.filter((c) => c !== ch); return "ok"; }
    async removeAllChannels() { for (const ch of this.channelsList.slice()) await this.removeChannel(ch); return []; }
  }

  root.supabase = { createClient: (url, key, opts) => new FakeClient(url, key, opts) };

  /* ── no network to Supabase: Storage HTTP is answered here, anything else fails ── */
  /* The address search Site Photos uses (nominatim.openstreetmap.org) answered here, from the made-up
     towns of the seed: the demo sends nothing to OpenStreetMap either. An address in a town gets a
     point near the town (the same point every time); anything else, no answer. */
  function geocodeAnswer(url) {
    let u;
    try { u = new URL(String(url)); } catch (e) { return null; }
    if (u.hostname !== "nominatim.openstreetmap.org") return null;
    const q = String(u.searchParams.get("q") || "").toLowerCase();
    const town = (F.TOWNS || []).find((t) => q.includes(t.name.toLowerCase()));
    if (!town) return { rows: [] };
    let h = 0;
    for (let i = 0; i < q.length; i++) h = (h * 31 + q.charCodeAt(i)) >>> 0;
    const lat = town.lat + ((h % 1000) / 1000 - 0.5) * 0.04, lng = town.lng + (((h >>> 10) % 1000) / 1000 - 0.5) * 0.04;
    return { rows: [{ lat: lat.toFixed(6), lon: lng.toFixed(6), display_name: q + " (demo)" }] };
  }

  function supaUrl(url) {
    try {
      const u = new URL(String(url), root.location ? root.location.href : "http://127.0.0.1/");
      return /\.supabase\.(co|in|net)$/i.test(u.hostname) ? u : null;
    } catch (e) { return null; }
  }
  function headerMap(h) {
    const out = {};
    if (!h) return out;
    if (typeof h.forEach === "function" && !Array.isArray(h)) h.forEach((v, k) => { out[String(k).toLowerCase()] = v; });
    else if (Array.isArray(h)) h.forEach(([k, v]) => { out[String(k).toLowerCase()] = v; });
    else for (const k of Object.keys(h)) out[k.toLowerCase()] = h[k];
    return out;
  }
  function b64dec(s) {
    try { return new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0))); } catch (e) { return ""; }
  }
  const UPLOAD_SPEED = 3 * 1024 * 1024;       // bytes per second, so progress bars move
  async function storageHttp(method, u, headers, body, onProgress) {
    const size = body && body.size !== undefined ? body.size : 0;
    const sending = method === "PATCH" || (method === "POST" && /^\/storage\/v1\/object\//.test(u.pathname));
    if (sending) {
      // the bytes "travel" at a modest speed so progress bars move; going offline stops them
      const steps = Math.max(1, Math.min(12, Math.ceil(size / (256 * 1024))));
      const total = Math.min(4000, (size / UPLOAD_SPEED) * 1000);
      for (let i = 1; i <= steps; i++) {
        await sleep(total / steps);
        if (state.offline) throw new TypeError("Failed to fetch (demo: offline)");
        if (onProgress) onProgress(Math.round((size * i) / steps), size);
      }
    } else {
      await delay();
    }
    const r = engine.storage.request(method, u.pathname, headers, body);
    if (!r) throw new TypeError("Failed to fetch (demo mode: no network to Supabase)");
    if (r.status < 300) {
      const m = /^\/storage\/v1\/object\/[^/]+\/(.+)$/.exec(u.pathname);
      if (m && method === "POST") keepBlob(m[1].split("/").map(decodeURIComponent).join("/"), body);
      const t = /^\/storage\/v1\/upload\/resumable\/([^/]+)$/.exec(u.pathname);
      if (t && method === "PATCH") {
        const info = engine.storage.tusInfo(t[1]);
        if (info && info.done) keepBlob(info.key, engine.storage.blob(info.key));
      }
    }
    return r;
  }

  /* Part 4 (tools/fake/p7-onedrive.js): the OneDrive host - the upload URLs the demo's broker made (PUT in chunks,
     GET how far) and this tab's download links (the self-test's ranged GET) - answered here: nothing reaches Microsoft */
  const odExt = () => (engine.exts || []).find((x) => x && x.name === "p7-onedrive") || null;
  function odOwns(url) { const x = odExt(); return !!(x && x.owns(url)); }
  async function onedriveHttp(method, url, headers, body, onProgress) {
    const size = body && body.size !== undefined ? body.size : 0;
    if (method === "PUT" && size) {
      const steps = Math.max(1, Math.min(12, Math.ceil(size / (256 * 1024))));
      const total = Math.min(4000, (size / UPLOAD_SPEED) * 1000);
      for (let i = 1; i <= steps; i++) {
        await sleep(total / steps);
        if (state.offline) throw new TypeError("Failed to fetch (demo: offline)");
        if (onProgress) onProgress(Math.round((size * i) / steps), size);
      }
    } else {
      await delay();
    }
    const r = odExt().http(method, String(url), headers || {}, body);
    return r || { status: 404, headers: {}, body: "" };
  }

  const realFetch = root.fetch ? root.fetch.bind(root) : null;
  if (realFetch) {
    root.fetch = async function (input, init) {
      const url = typeof input === "string" ? input : input && input.url;
      if (odOwns(url)) {
        if (state.offline) throw new TypeError("Failed to fetch (demo: offline)");
        const i = init || {};
        const r = await onedriveHttp(String(i.method || "GET").toUpperCase(), url, headerMap(i.headers), i.body);
        return new Response(r.status === 204 ? null : r.body, { status: r.status, headers: r.headers });
      }
      const geo = geocodeAnswer(url);
      if (geo) {
        if (state.offline) throw new TypeError("Failed to fetch (demo: offline)");
        return new Response(JSON.stringify(geo.rows), { status: 200, headers: { "content-type": "application/json" } });
      }
      const u = supaUrl(url);
      if (!u) return realFetch(input, init);
      if (state.offline) throw new TypeError("Failed to fetch (demo: offline)");
      const i = init || {};
      const r = await storageHttp(String(i.method || (input && input.method) || "GET").toUpperCase(), u, headerMap(i.headers || (input && input.headers)), i.body);
      const nobody = r.status === 204 || r.status === 304 || String(i.method || "").toUpperCase() === "HEAD";
      return new Response(nobody ? null : r.text, { status: r.status, headers: r.headers });
    };
  }

  const RealXHR = root.XMLHttpRequest;
  if (RealXHR) {
    class DemoXHR extends RealXHR {
      open(method, url, ...rest) {
        const u = supaUrl(url);
        this._demo = u ? { method: String(method).toUpperCase(), u, headers: {} } : null;
        if (!u && odOwns(url)) this._demo = { method: String(method).toUpperCase(), u: null, od: String(url), headers: {} };
        if (!this._demo) return super.open(method, url, ...rest);
        return undefined;
      }
      setRequestHeader(k, v) {
        if (this._demo) { this._demo.headers[String(k).toLowerCase()] = v; return; }
        super.setRequestHeader(k, v);
      }
      getResponseHeader(n) {
        if (this._demo) return (this._demoRes && this._demoRes.headers[String(n).toLowerCase()]) ?? null;
        return super.getResponseHeader(n);
      }
      abort() { if (this._demo) { this._aborted = true; return; } super.abort(); }
      send(body) {
        if (!this._demo) return super.send(body);
        const d = this._demo;
        const self = this;
        const fire = (name) => {
          const h = self["on" + name];
          if (typeof h === "function") { try { h.call(self, new Event(name)); } catch (e) { console.error(e); } }
        };
        (async () => {
          try {
            if (state.offline) throw new TypeError("offline");
            const r = await (d.od ? onedriveHttp.bind(null, d.method, d.od) : storageHttp.bind(null, d.method, d.u))(d.headers, body, (loaded, total) => {
              const up = self.upload;
              if (up && typeof up.onprogress === "function") {
                try { up.onprogress({ lengthComputable: true, loaded, total }); } catch (e) { /* */ }
              }
            });
            if (self._aborted) { fire("abort"); return; }
            self._demoRes = r;
            Object.defineProperty(self, "status", { value: r.status, configurable: true });
            Object.defineProperty(self, "responseText", { value: (d.od ? (typeof r.body === "string" ? r.body : "") : r.text) || "", configurable: true });
            Object.defineProperty(self, "readyState", { value: 4, configurable: true });
            fire("readystatechange");
            fire("load");
            fire("loadend");
          } catch (e) {
            fire("error");
            fire("loadend");
          }
        })();
        return undefined;
      }
    }
    root.XMLHttpRequest = DemoXHR;
  }

  /* ── map tiles (the tasks map): drawn here, so the demo sends nothing to OpenStreetMap ───────────
     Leaflet sets each tile's <img>.src to https://{a|b|c}.tile.openstreetmap.org/z/x/y.png; in demo
     pages that address becomes a made-up tile (a data: picture, which the pages' policy allows). */
  const TILE_RE = /^https:\/\/[abc]\.tile\.openstreetmap\.org\/(\d+)\/(\d+)\/(\d+)\.png$/;
  function demoTile(z, x, y) {
    const h = hash(z + "/" + x + "/" + y);
    const roads = [];
    for (let i = 0; i < 3; i++) {
      const a = (h >>> (i * 5)) % 256, b = (h >>> (i * 7 + 3)) % 256;
      roads.push(i % 2 ? '<path d="M0 ' + a + " L256 " + b + '" stroke="#fff" stroke-width="' + (3 + (i % 3)) + '" fill="none"/>'
        : '<path d="M' + a + " 0 L" + b + ' 256" stroke="#fff" stroke-width="' + (2 + (i % 2)) + '" fill="none"/>');
    }
    const green = (h % 7 === 0) ? '<rect x="' + (h % 160) + '" y="' + ((h >>> 8) % 160) + '" width="80" height="60" rx="10" fill="#cfe3c4"/>' : "";
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#ece8df"/>' + green +
      roads.join("") + '<path d="M0 0H256V256" stroke="#e2ddd2" fill="none"/>' +
      '<text x="6" y="250" font-family="Segoe UI,Arial" font-size="9" fill="#b9b2a4">demo map ' + esc(z + "/" + x + "/" + y) + "</text></svg>";
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }
  try {
    const IMG = root.HTMLImageElement && root.HTMLImageElement.prototype;
    const desc = IMG && Object.getOwnPropertyDescriptor(IMG, "src");
    if (desc && desc.set && desc.get) {
      Object.defineProperty(IMG, "src", {
        configurable: true, enumerable: desc.enumerable,
        get() { return desc.get.call(this); },
        set(v) { const m = TILE_RE.exec(String(v)); desc.set.call(this, m ? demoTile(m[1], m[2], m[3]) : v); },
      });
    }
  } catch (e) { /* this browser draws the real tiles */ }

  /* ── the demo panel ────────────────────────────────────────────────── */
  function setOffline(on) {
    state.offline = !!on;
    try { sessionStorage.setItem(SS_OFFLINE, on ? "1" : "0"); } catch (e) { /* */ }
    if (on) for (const ch of Array.from(joined)) ch._drop("CHANNEL_ERROR");
    try { root.dispatchEvent(new Event(on ? "offline" : "online")); } catch (e) { /* */ }
    paintPanel();
  }
  function setColleagues(on) {
    state.colleagues = !!on;
    ls.set(LS_COLLEAGUES, on ? "1" : "0");
    presenceSync();
    paintPanel();
  }
  function current() {
    const c = clients[clients.length - 1];
    if (!c) return null;
    const uid = c._ctx().uid;
    return uid ? PEOPLE.find((p) => p.id === uid) : null;
  }
  function signInAs(key) {
    const person = byKey(key);
    if (!person) return;
    const form = document.getElementById("loginForm");
    if (form && document.getElementById("email")) {
      document.getElementById("email").value = person.email;
      document.getElementById("password").value = "demo-password-1";
      const keep = document.getElementById("remember");
      if (keep) keep.checked = true;
      if (form.requestSubmit) form.requestSubmit(); else form.dispatchEvent(new Event("submit", { cancelable: true }));
      return;
    }
    const c = clients[clients.length - 1];
    if (c) { c.auth._signInAs(person); location.reload(); }
  }
  /** someone else saves a row (as `asKey`, default the manager): versions move, Realtime fires */
  function remoteEdit(table, id, patch, asKey) {
    const person = byKey(asKey || "manager");
    return engine.update({ uid: person.id }, table, patch, { filters: [{ col: table === "project_prices" ? "project_id" : "id", op: "eq", val: id }] });
  }
  function reset() {
    ls.del(LS_OPS); ls.del(LS_REVOKED);
    try { indexedDB.deleteDatabase(IDB); } catch (e) { /* */ }
    location.reload();
  }
  function pageProjectId() {
    const m = /[?&]id=(\d+)/.exec(location.search);
    return m ? Number(m[1]) : null;
  }

  let panel = null, open = false;
  function paintPanel() {
    if (!panel) return;
    const me = current();
    const pid = pageProjectId();
    panel.innerHTML = "";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dcr2demo-tab" + (state.offline ? " off" : "");
    btn.textContent = state.offline ? "DEMO · offline" : "DEMO";
    btn.title = "Demo mode: made-up data, no connection to the real database";
    btn.addEventListener("click", () => { open = !open; paintPanel(); });
    panel.appendChild(btn);
    if (!open) return;
    const box = document.createElement("div");
    box.className = "dcr2demo-box";
    box.innerHTML = '<div class="h">Portal 2 · demo mode</div><div class="s">Made-up data in this browser. Nothing reaches the real database.</div>' +
      '<div class="s">Signed in: <b>' + (me ? esc(me.name + " (" + me.role + ")") : "nobody") + "</b></div><div class=\"k\">Sign in as</div>";
    const grid = document.createElement("div");
    grid.className = "g";
    PEOPLE.forEach((p) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = p.role + (p.note ? " · " + p.note : "");
      b.title = p.name + " <" + p.email + ">";
      b.addEventListener("click", () => signInAs(p.key));
      grid.appendChild(b);
    });
    box.appendChild(grid);
    const row = (label, on, fn) => {
      const l = document.createElement("label");
      const c = document.createElement("input");
      c.type = "checkbox"; c.checked = on;
      c.addEventListener("change", () => fn(c.checked));
      l.appendChild(c); l.appendChild(document.createTextNode(" " + label));
      box.appendChild(l);
    };
    row("Offline (no connection)", state.offline, setOffline);
    row("Two colleagues online", state.colleagues, setColleagues);
    const act = (label, fn) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "a"; b.textContent = label;
      b.addEventListener("click", fn);
      box.appendChild(b);
    };
    if (pid) {
      act("Someone else edits this project", () => {
        const p = engine.rows.projects.find((x) => x.id === pid);
        if (p) remoteEdit("projects", pid, { status_note: "Changed by Morgan at " + new Date().toLocaleTimeString() });
      });
    }
    if (/timesheet/.test(location.pathname)) {
      act("Someone else changes an hour this week", () => {
        const sat = (() => { const t = F.companyDay(new Date()); const [y, m, d] = t.split("-").map(Number); const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
          const x = new Date(Date.UTC(y, m - 1, d - (w === 6 ? 0 : w + 1))); return x.toISOString().slice(0, 10); })();
        const lastSat = (() => { const [y, m, d] = sat.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d - 7)).toISOString().slice(0, 10); })();
        const list = engine.rows.timesheets.filter((t) => t.kind === "work" && t.work_date >= lastSat);
        const t = list[Math.floor(Math.random() * list.length)];
        if (t) remoteEdit("timesheets", t.id, { hours: Number(t.hours) === 8 ? 8.5 : 8 });
      });
    }
    if (/my-tasks|tasks-map|project/.test(location.pathname)) {
      const openTask = () => {
        const want = Number(new URLSearchParams(location.search).get("task")) || null;
        const me = current();
        const open = engine.rows.tasks.filter((t) => t.status === "open");
        return open.find((t) => t.id === want) || open.find((t) => me && t.assigned_to === me.id) || open[0] || null;
      };
      act("Someone else adds an update to a task", () => {
        const t = openTask();
        if (t) engine.insert({ uid: byKey("manager").id }, "task_notes", { task_id: t.id, text: "Checked from the office at " + new Date().toLocaleTimeString() + ".", via: "desktop" });
      });
      act("Someone else finishes a task", () => {
        const t = openTask();
        if (t) engine.rpc({ uid: byKey("manager").id }, "complete_task", { p_id: t.id, p_version: null, p_note: "Finished from the office." });
      });
      act("The office gives you a new task", () => {
        const me = current();
        if (me && me.role !== "agents") {
          engine.insert({ uid: byKey("manager").id }, "tasks", { project_id: sandbox ? sandbox.id : null, title: "Demo: check the north wall blocking",
            priority: "high", category: "General Task", assigned_to: me.id });
        }
      });
    }
    if (/agents-console|my-assistant|assistant-admin/.test(location.pathname)) {
      row("The DCR server is off (nothing is answered)", !!state.pcOff, setPcOff);
      act("The office writes to you in the assistant chat", () => {
        const me = current();
        if (me && engine.p6) engine.p6.pc.officeSays(me.id, "From the office: the crew meeting moved to 7:30 tomorrow.");
      });
    }
    act("Someone else moves a Board card", () => {
      const list = engine.rows.projects.filter((p) => p.status === "approved" && !p.deleted_at);
      const p = list[Math.floor(Math.random() * list.length)];
      if (p) remoteEdit("projects", p.id, { status: "in_progress" });
    });
    act("Reset demo data", reset);
    const foot = document.createElement("div");
    foot.className = "s";
    foot.textContent = ops.length + " demo change(s) kept in this browser.";
    box.appendChild(foot);
    panel.appendChild(box);
  }
  function mountPanel() {
    if (panel || !document.body) return;
    const css = document.createElement("style");
    css.textContent =
      ".dcr2demo{position:fixed;right:10px;bottom:10px;z-index:2147483600;font:12.5px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif;" +
      "display:flex;flex-direction:column;align-items:flex-end;gap:6px}" +
      ".dcr2demo-tab{border:0;border-radius:999px;padding:5px 11px;background:#e07a1f;color:#fff;font-weight:800;letter-spacing:.06em;" +
      "cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.25);order:2}.dcr2demo-tab.off{background:#8a2113}" +
      ".dcr2demo-box{order:1;width:290px;max-width:calc(100vw - 20px);max-height:70vh;overflow:auto;background:#fff;color:#1b2733;border:1px solid #dfe3e8;" +
      "border-radius:12px;padding:12px;box-shadow:0 8px 30px rgba(0,0,0,.25)}" +
      ".dcr2demo-box .h{font-weight:800;margin-bottom:2px}.dcr2demo-box .s{color:#61738a;margin:2px 0 6px}" +
      ".dcr2demo-box .k{font-weight:700;margin:6px 0 4px}.dcr2demo-box .g{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:8px}" +
      ".dcr2demo-box button{border:1px solid #dfe3e8;background:#f4f6f8;border-radius:7px;padding:5px 6px;cursor:pointer;font:inherit;text-align:left;color:#1b2733}" +
      ".dcr2demo-box button.a{display:block;width:100%;margin-top:5px}" +
      ".dcr2demo-box label{display:flex;align-items:center;gap:6px;margin:4px 0;font-weight:600}" +
      ".dcr2demo-box label input{width:auto;margin:0}";
    document.head.appendChild(css);
    panel = document.createElement("div");
    panel.className = "dcr2demo";
    panel.setAttribute("data-dcr2-demo", "1");
    document.body.appendChild(panel);
    paintPanel();
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountPanel);
    else mountPanel();
  }

  root.DCR2Demo = {
    engine, people: PEOPLE, signInAs, setOffline, setColleagues, remoteEdit, reset, setPcOff,
    pcStep: () => (engine.p6 ? engine.p6.pc.step() : null), answerChats: () => (engine.p6 ? engine.p6.pc.answerChats() : 0),
    isOffline: () => state.offline,
    setLatency: (ms) => { state.latency = Math.max(0, Number(ms) || 0); },
    opsCount: () => ops.length,
  };
  if (typeof window !== "undefined") console.info("%cDCR Portal 2 demo mode%c made-up data, no network to Supabase (window.DCR2Demo)", "background:#e07a1f;color:#fff;padding:2px 6px;border-radius:4px", "");
})(typeof globalThis !== "undefined" ? globalThis : this);
