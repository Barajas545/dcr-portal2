// PROJECT-PAGES test helper: the demo database (tools/fake/engine.js + seed.js, PORTAL-CORE) behind a
// node-sized supabase-js subset, signed in as one demo account, so the repo modules can be run over
// the same made-up data and the same rules the demo pages use. The browser stand-in
// (tools/fake/fake-supabase.js) needs a DOM; this is only the query / rpc / signed-URL part.
import { existsSync } from "node:fs";

const P6 = new URL("../tools/fake/p6.js", import.meta.url);        // phase 6: read by engine.js when it loads
const P5A = new URL("../tools/fake/p5a-est.js", import.meta.url);  // P5a estimates and takeoffs: read by engine.js too
const P5A_PM = new URL("../tools/fake/p5a-pm.js", import.meta.url); // P5a progress chart (flags, quotes, money): after p5a-est.js
const P5B_LEDGER = new URL("../tools/fake/p5b-ledger.js", import.meta.url); // P5b ledger (M5b costs columns, RPCs, rows): after p5a-pm.js
const P5B_BOOKS = new URL("../tools/fake/p5b-books.js", import.meta.url);   // P5b books (bills, payments, invoices rules, M5b RPCs, rows): after p5b-ledger.js
const P5C_LISTS = new URL("../tools/fake/p5c-lists.js", import.meta.url);   // P5c office lists (leads, vehicles, marketing tasks; M5c rules and rows)
const P5C_SUB = new URL("../tools/fake/p5c-sub.js", import.meta.url);       // P5c sub submissions + the subform function's stand-in: after p5b-books.js
const P5C_SALES = new URL("../tools/fake/p5c-sales.js", import.meta.url);   // P5c sales (the switch, comps, sales estimates, materials, sales-media)
const ENGINE = new URL("../tools/fake/engine.js", import.meta.url);
const PC = new URL("../tools/fake/pc-demo.js", import.meta.url);    // the made-up DCR server's answers
const SEED = new URL("../tools/fake/seed.js", import.meta.url);

export const available = existsSync(ENGINE) && existsSync(SEED);

let loaded = null;
export async function loadFake() {
  if (!available) return null;
  if (!loaded) {
    if (existsSync(P6)) await import(P6.href);
    if (existsSync(P5A)) await import(P5A.href);
    if (existsSync(P5A_PM)) await import(P5A_PM.href);
    if (existsSync(P5B_LEDGER)) await import(P5B_LEDGER.href);
    if (existsSync(P5B_BOOKS)) await import(P5B_BOOKS.href);
    if (existsSync(P5C_LISTS)) await import(P5C_LISTS.href);
    if (existsSync(P5C_SUB)) await import(P5C_SUB.href);
    if (existsSync(P5C_SALES)) await import(P5C_SALES.href);
    await import(ENGINE.href);
    if (existsSync(PC)) await import(PC.href);
    await import(SEED.href);
    loaded = globalThis.DCR2Fake;
  }
  return loaded;
}

/** A fresh seeded engine. */
export async function freshEngine(now) {
  const F = await loadFake();
  const engine = F.createEngine({ maxFileSize: 500 * 1024 * 1024 });
  engine.load(F.seed({ now: now || new Date() }));
  return engine;
}

export async function person(key) {
  const F = await loadFake();
  return F.PEOPLE.find((p) => p.key === key);
}

const clone = (v) => (v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)));
const fail = (e) => ({ data: null, error: e && e.toJSON ? e.toJSON() : { code: "XX000", message: String(e && e.message) }, status: (e && e.status) || 500 });

/** A client over `engine` as the profile `uid`. */
export function clientAs(engine, uid) {
  const ctx = () => ({ uid });
  function Q(t) { this.t = t; this.m = "select"; this.ret = false; this.body = null; this.q = { columns: "*", filters: [], orders: [], foreignLimits: {} }; }
  Q.prototype.select = function (cols) { if (this.m !== "select") this.ret = true; this.q.columns = cols || "*"; return this; };
  Q.prototype.insert = function (v) { this.m = "insert"; this.body = v; return this; };
  Q.prototype.update = function (v) { this.m = "update"; this.body = v; return this; };
  Q.prototype.delete = function () { this.m = "delete"; return this; };
  ["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in"].forEach((op) => {
    Q.prototype[op] = function (c, v) { this.q.filters.push({ col: c, op, val: v, neg: false }); return this; };
  });
  Q.prototype.is = function (c, v) { this.q.filters.push({ col: c, op: "is", val: v === null ? "null" : String(v), neg: false }); return this; };
  Q.prototype.order = function (c, o) { this.q.orders.push({ col: c, asc: !o || o.ascending !== false, foreign: null }); return this; };
  Q.prototype.range = function (a, b) { this.q.offset = a; this.q.limit = b - a + 1; return this; };
  Q.prototype.limit = function (n) { this.q.limit = n; return this; };
  Q.prototype.rowsBy = function (made) {
    if (!made.length) return [];
    // the table's key: id, or (a table keyed by its parent - project_prices, estimate_item_flags …) its first column
    const pk = "id" in made[0] ? "id" : Object.keys(engine.COLS[this.t] || {})[0] || "id";
    return engine.select(ctx(), this.t, { columns: this.q.columns, filters: [{ col: pk, op: "in", val: made.map((r) => r[pk]) }],
      orders: [{ col: pk, asc: true }], foreignLimits: {} }).data;
  };
  Q.prototype.run = function () {
    try {
      if (this.m === "select") return { data: clone(engine.select(ctx(), this.t, this.q).data), error: null, status: 200 };
      if (this.m === "insert") {
        const made = engine.insert(ctx(), this.t, clone(this.body));
        return { data: this.ret ? clone(this.rowsBy(made)) : null, error: null, status: 201 };
      }
      if (this.m === "delete") {
        const gone = engine.delete(ctx(), this.t, this.q);
        return { data: this.ret ? clone(gone) : null, error: null, status: 200 };
      }
      const changed = engine.update(ctx(), this.t, clone(this.body), this.q);
      return { data: this.ret ? clone(this.rowsBy(changed)) : null, error: null, status: 200 };
    } catch (e) { return fail(e); }
  };
  Q.prototype.then = function (ok, bad) { return Promise.resolve(this.run()).then(ok, bad); };
  function signOne(path) {
    try { engine.storage.sign(ctx(), path); return { data: { signedUrl: "blob:demo/" + path }, error: null }; }
    catch (e) { return { data: null, error: { message: e.message, status: e.status || 400 } }; }
  }
  return {
    from: (t) => new Q(t),
    rpc: (name, args) => {
      try { const d = engine.rpc(ctx(), name, clone(args)); return Promise.resolve({ data: d === undefined ? null : clone(d), error: null }); }
      catch (e) { return Promise.resolve(fail(e)); }
    },
    storage: {
      from: () => ({
        createSignedUrl: async (p) => signOne(p),
        createSignedUrls: async (paths) => ({ data: paths.map((p) => { const r = signOne(p); return { path: p, signedUrl: r.data && r.data.signedUrl, error: r.error ? r.error.message : null }; }), error: null }),
      }),
    },
  };
}
